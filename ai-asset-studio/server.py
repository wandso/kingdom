#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
AI 素材工坊（本地服务）
- 魔搭 ModelScope API-Inference 文生图：一次提交 4 个变体任务，结果落盘
- 统一画廊：历史批次（modelscope-krea2/*/manifest.json）+ 新批次
- 游戏素材库：Kingdom Rush Origins 小游戏工程内已提取的素材

启动前设置令牌（不写入任何文件）：
    MS_TOKEN=ms-xxxx python server.py
"""
import io
import json
import shutil
import mimetypes
import os
import random
import re
import sys
import threading
import time
import uuid
import zipfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUTS = os.path.join(ROOT, "outputs")
IMAGE_ROOT = r"D:\xyh\ai\workbd\cache\图片"
GAME_ASSETS = r"D:\xyh\game\kingdom\kro-minigame\assets"
TOKEN = os.environ.get("MS_TOKEN", "")

# 复用既有魔搭客户端的提交/轮询/下载逻辑（含 429 退避与断点能力）
if IMAGE_ROOT not in sys.path:
    sys.path.insert(0, IMAGE_ROOT)
import ms_krea2  # noqa: E402

PRESETS = [
    {
        "id": "kro_forest",
        "label": "精灵森林",
        "prompt": "hand-painted fantasy tower defense game environment concept art, lush elven woods, mossy stone winding path, ancient gnarled trees, warm dappled sunlight through canopy, whimsical medieval cartoon rendering, bold clean shapes, saturated jewel tones, detailed painterly textures, wide establishing shot, no text, no logo, no watermark",
        "negative": "photograph, realistic photo, text, watermark, logo, blurry, low resolution",
    },
    {
        "id": "kro_snow",
        "label": "雪境隘口",
        "prompt": "hand-painted fantasy tower defense game environment concept art, snow-covered mountain pass, frozen river winding between pines, ice crystals, cold blue morning light, whimsical medieval cartoon rendering, bold clean shapes, saturated jewel tones, detailed painterly textures, wide establishing shot, no text, no logo, no watermark",
        "negative": "photograph, realistic photo, text, watermark, logo, blurry, low resolution",
    },
    {
        "id": "kro_lava",
        "label": "熔岩要塞",
        "prompt": "hand-painted fantasy tower defense game environment concept art, obsidian fortress above molten lava cracks, glowing embers, dark volcanic rock, dramatic red-orange rim light, whimsical medieval cartoon rendering, bold clean shapes, saturated jewel tones, detailed painterly textures, wide establishing shot, no text, no logo, no watermark",
        "negative": "photograph, realistic photo, text, watermark, logo, blurry, low resolution",
    },
    {
        "id": "kro_desert",
        "label": "沙漠遗迹",
        "prompt": "hand-painted fantasy tower defense game environment concept art, sunlit desert ruins with broken sandstone arches, palm oasis, drifting sand, warm golden afternoon light, whimsical medieval cartoon rendering, bold clean shapes, saturated jewel tones, detailed painterly textures, wide establishing shot, no text, no logo, no watermark",
        "negative": "photograph, realistic photo, text, watermark, logo, blurry, low resolution",
    },
    {
        "id": "kro_gothic",
        "label": "哥特城堡",
        "prompt": "hand-painted fantasy tower defense game environment concept art, gothic castle courtyard at night, stone arches, crimson banners, moonlight and torch glow, mist, whimsical medieval cartoon rendering, bold clean shapes, saturated jewel tones, detailed painterly textures, wide establishing shot, no text, no logo, no watermark",
        "negative": "photograph, realistic photo, text, watermark, logo, blurry, low resolution",
    },
    {
        "id": "custom",
        "label": "自定义",
        "prompt": "",
        "negative": "text, watermark, logo, blurry, low resolution",
    },
]

MODELS = [
    {"id": "Qwen/Qwen-Image-2.1-Turbo", "label": "Qwen-Image 2.1 Turbo（快）", "steps": 8, "guidance": None},
    {"id": "Qwen/Qwen-Image", "label": "Qwen-Image（精细）", "steps": 30, "guidance": 4.0},
    {"id": "krea/Krea-2-Turbo", "label": "Krea 2 Turbo（均衡）", "steps": 8, "guidance": None},
    {"id": "Tongyi-MAI/Z-Image", "label": "Z-Image（写实）", "steps": 30, "guidance": None},
]

# 提示词增强：用魔搭在线文本模型把简短目标扩写成完整的生图提示词
ENHANCE_MODEL = "Qwen/Qwen3.5-35B-A3B"
ENHANCE_SYSTEM = (
    "你是魔搭社区的提示词增强器，服务于 Kingdom Rush Origins 风格的奇幻塔防游戏美术工坊。"
    "用户会给出一个简短的创作目标，你要把它扩写成一段可直接用于文生图的英文提示词。\n"
    "严格按以下层次组织，输出为一整段连续英文（不要编号、不要换行、不要解释）：\n"
    "1) 画幅与构图（横版场景用 wide establishing shot, horizontal composition）；"
    "2) 主体与关键物件（具体名词，不要抽象形容词）；"
    "3) 场景三层：前景-中景-背景，每层都要给出具体材质与相对位置；"
    "4) 光线与色彩（明确光源方向、色温、明暗对比）；"
    "5) 风格锚点：hand-painted fantasy tower defense game concept art, whimsical medieval cartoon rendering, "
    "bold clean shapes, saturated jewel tones, detailed painterly textures；"
    "6) 约束：no text, no logo, no watermark, no photograph。\n"
    "总长 120-180 个英文词，信息要可执行（写 'a mossy stone path with irregular slabs 3m wide' 而不是 'beautiful path'）。"
    "只输出提示词本身，不要输出任何中文、标题或引号。"
)
ENHANCE_NEG_FALLBACK = "photograph, realistic photo, text, watermark, logo, blurry, low resolution, deformed, jpeg artifacts"

JOBS = {}
JOBS_LOCK = threading.Lock()


def enhance_prompt(goal, style_label, size):
    """调用魔搭文本模型扩写提示词；失败时退回本地模板增强，保证功能可用。"""
    goal = (goal or "").strip()
    if not goal:
        raise RuntimeError("目标描述不能为空")
    user = "创作目标：%s\n风格：%s\n画幅：%s" % (goal, style_label or "奇幻塔防游戏场景", size or "1280x720")
    payload = {
        "model": ENHANCE_MODEL,
        "messages": [
            {"role": "system", "content": ENHANCE_SYSTEM},
            {"role": "user", "content": user},
        ],
        "max_tokens": 700,
        "stream": False,
    }
    req = urllib.request.Request(
        "https://api-inference.modelscope.cn/v1/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json",
                 "User-Agent": "ms-studio-enhancer/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8", "replace"))
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError("增强服务未返回内容")
    text = (choices[0].get("message") or {}).get("content") or ""
    text = re.sub(r"^```(?:text|markdown)?\s*|\s*```$", "", text.strip()).strip()
    text = text.strip('"').strip("'").strip()
    if len(text) < 40:
        raise RuntimeError("增强结果过短")
    # 风格锚点兜底：模型已按要求写入风格锚点，缺失时才补，避免重复堆砌
    style_preset = next((p for p in PRESETS if p.get("label") == style_label), None)
    anchor = style_preset["prompt"] if style_preset else PRESETS[0]["prompt"]
    final = text if "hand-painted fantasy tower defense" in text.lower() else anchor + " " + text
    return {
        "prompt": final,
        "negative": (style_preset or {}).get("negative", ENHANCE_NEG_FALLBACK),
        "model": ENHANCE_MODEL,
        "original_goal": goal,
        "enhanced_words": len(final.split()),
    }


def job_set(job_id, **kwargs):
    with JOBS_LOCK:
        JOBS[job_id].update(kwargs)


def run_job(job_id, params):
    """后台生成 4 张：先顺序提交（避开 429），再并行轮询与下载。"""
    batch_id = time.strftime("%Y%m%d-%H%M%S") + "-" + job_id[:6]
    out_dir = os.path.join(OUTPUTS, batch_id)
    os.makedirs(out_dir, exist_ok=True)
    items = [{"index": i + 1, "status": "提交中", "file": None, "error": None} for i in range(4)]
    job_set(job_id, status="running", batch_id=batch_id, items=items, progress=0)

    task_ids = []
    for i in range(4):
        try:
            seed = params["seed"] + i if params.get("seed") else None
            res = ms_krea2.submit_retry(
                TOKEN, params["model"], params["prompt"], params["size"],
                params["steps"], params["guidance"], params["negative"], seed,
            )
            tid = res.get("task_id")
            if not tid:
                raise RuntimeError("未返回 task_id: " + json.dumps(res, ensure_ascii=False)[:200])
            task_ids.append(tid)
            items[i]["status"] = "排队生成"
            job_set(job_id, progress=10 + (i + 1) * 5)
        except Exception as exc:  # 单张提交失败不拖垮其余三张
            task_ids.append(None)
            items[i]["status"] = "失败"
            items[i]["error"] = str(exc)[:300]
        time.sleep(1.2)

    def fetch(i):
        tid = task_ids[i]
        if not tid:
            return
        try:
            items[i]["status"] = "生成中"
            data = ms_krea2.poll(TOKEN, tid)
            urls = data.get("output_images") or []
            if not urls:
                raise RuntimeError("任务成功但无输出图片")
            path = os.path.join(out_dir, "%02d.png" % (i + 1))
            ms_krea2.download(urls[0], path)
            items[i]["file"] = os.path.basename(path)
            items[i]["status"] = "完成"
            items[i]["url"] = urls[0]
            job_set(job_id, progress=min(95, 30 + sum(1 for x in items if x["status"] == "完成") * 16))
        except Exception as exc:
            items[i]["status"] = "失败"
            items[i]["error"] = str(exc)[:300]

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, range(4)))

    manifest = {
        "id": batch_id,
        "title": params.get("title") or params["prompt"][:36],
        "style": params.get("style", "custom"),
        "prompt": params["prompt"],
        "negative": params["negative"],
        "model": params["model"],
        "size": params["size"],
        "steps": params["steps"],
        "guidance": params["guidance"],
        "seed": params.get("seed"),
        "created": time.strftime("%Y-%m-%d %H:%M:%S"),
        "images": items,
        "task_ids": task_ids,
    }
    with open(os.path.join(out_dir, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    ok = sum(1 for x in items if x["status"] == "完成")
    job_set(job_id, status="done", progress=100, batch_id=batch_id,
            summary="成功 %d/4" % ok)


def safe_path(rel):
    """只允许访问工作室产物、历史画廊与游戏素材三个根目录内的文件。"""
    rel = unquote(rel).replace("\\", "/")
    if ".." in rel.split("/"):
        return None
    candidates = [(OUTPUTS, rel), (IMAGE_ROOT, rel), (ROOT, rel)]
    prefix = "kro-minigame/assets/"
    if rel.startswith(prefix):
        candidates.append((GAME_ASSETS, rel[len(prefix):]))
    for base, sub in candidates:
        full = os.path.abspath(os.path.join(base, sub))
        if full.startswith(os.path.abspath(base) + os.sep) and os.path.isfile(full):
            return full
    return None


def file_url(rel):
    return "/file?p=" + urllib_quote(rel.replace("\\", "/"))


def urllib_quote(s):
    from urllib.parse import quote
    return quote(s, safe="/")


def collect_batches():
    batches = []
    if os.path.isdir(OUTPUTS):
        for name in sorted(os.listdir(OUTPUTS), reverse=True):
            path = os.path.join(OUTPUTS, name, "manifest.json")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    b = json.load(f)
                b["images"] = [dict(x, src=file_url(os.path.join(name, x["file"]).replace("\\", "/")))
                               for x in b.get("images", []) if x.get("file")]
                b["source"] = "studio"
                batches.append(b)
            except Exception:
                continue
    gallery_root = os.path.join(IMAGE_ROOT, "modelscope-krea2")
    if os.path.isdir(gallery_root):
        for name in sorted(os.listdir(gallery_root)):
            path = os.path.join(gallery_root, name, "manifest.json")
            if not os.path.isfile(path):
                continue
            try:
                with open(path, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                if not isinstance(raw, list) or not raw:
                    continue
                images = []
                for r in raw:
                    rel = r.get("file") or r.get("name", "")
                    rel = rel.replace("\\", "/")
                    if not rel.startswith("modelscope-krea2/"):
                        rel = "modelscope-krea2/" + name + "/" + os.path.basename(rel)
                    images.append({
                        "src": file_url(rel),
                        "caption": r.get("scene_cn") or r.get("name") or os.path.basename(rel),
                        "prompt": r.get("prompt", ""),
                        "seed": r.get("seed"),
                    })
                batches.append({
                    "id": "legacy-" + name,
                    "title": name,
                    "style": "历史批次",
                    "prompt": (raw[0].get("prompt", "") or "")[:300],
                    "model": raw[0].get("model", ""),
                    "size": raw[0].get("size", ""),
                    "steps": raw[0].get("steps"),
                    "created": "",
                    "images": images,
                    "source": "legacy",
                    "count": len(images),
                })
            except Exception:
                continue
    return batches


def collect_assets():
    groups = {}
    exts = (".png", ".jpg", ".jpeg", ".webp")
    if os.path.isdir(GAME_ASSETS):
        for root, _, files in os.walk(GAME_ASSETS):
            for fn in files:
                if not fn.lower().endswith(exts):
                    continue
                full = os.path.join(root, fn)
                rel = os.path.relpath(full, GAME_ASSETS).replace("\\", "/")
                group = rel.split("/")[0] if "/" in rel else "其他"
                groups.setdefault(group, []).append({
                    "name": fn,
                    "src": file_url(os.path.join("kro-minigame", "assets", rel).replace("\\", "/")),
                    "rel": rel,
                })
    return [{"group": k, "count": len(v), "items": sorted(v, key=lambda x: x["name"])}
            for k, v in sorted(groups.items())]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stderr.write("[studio] " + (fmt % args) + "\n")

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, full, download_name=None):
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        if download_name:
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % download_name)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/presets":
            return self.send_json({"presets": PRESETS, "models": MODELS, "token_ready": bool(TOKEN)})
        if path == "/api/batches":
            return self.send_json({"batches": collect_batches()})
        if path == "/api/assets":
            return self.send_json({"groups": collect_assets()})
        if path.startswith("/api/job/"):
            jid = path[len("/api/job/"):]
            with JOBS_LOCK:
                job = dict(JOBS.get(jid, {"status": "not_found"}))
            return self.send_json(job)
        if path.startswith("/api/download/"):
            bid = path[len("/api/download/"):].split("/")[0]
            folder = os.path.join(OUTPUTS, os.path.basename(bid))
            if not os.path.isdir(folder):
                return self.send_json({"error": "批次不存在"}, 404)
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_COMPRESSED) as z:
                for fn in sorted(os.listdir(folder)):
                    if fn.endswith(".png"):
                        z.write(os.path.join(folder, fn), fn)
            body = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", 'attachment; filename="%s.zip"' % bid)
            self.end_headers()
            return self.wfile.write(body)
        if path == "/file":
            rel = query.get("p", [""])[0]
            full = safe_path(rel)
            if not full:
                return self.send_json({"error": "文件不存在"}, 404)
            return self.send_file(full, os.path.basename(full))
        static = {"": "index.html", "/": "index.html", "/index.html": "index.html",
                  "/app.js": "app.js", "/style.css": "style.css"}
        if path in static:
            full = os.path.join(ROOT, static[path])
            if os.path.isfile(full):
                return self.send_file(full)
        return self.send_json({"error": "not found"}, 404)

    def do_DELETE(self):
        """删除工坊产出批次；历史批次为只读资料，不允许从界面删除。"""
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/batch/"):
            return self.send_json({"error": "not found"}, 404)
        bid = os.path.basename(unquote(parsed.path[len("/api/batch/"):]))
        folder = os.path.join(OUTPUTS, bid)
        if not bid or not os.path.isdir(folder):
            return self.send_json({"error": "批次不存在或不可删除"}, 404)
        with JOBS_LOCK:
            busy = any(j.get("batch_id") == bid and j.get("status") == "running"
                       for j in JOBS.values())
        if busy:
            return self.send_json({"error": "该批次仍在生成中，无法删除"}, 409)
        try:
            shutil.rmtree(folder)
        except Exception as exc:
            return self.send_json({"error": "删除失败: %s" % exc}, 500)
        return self.send_json({"ok": True, "id": bid})

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/enhance":
            if not TOKEN:
                return self.send_json({"error": "未设置 MS_TOKEN 环境变量"}, 400)
            length = int(self.headers.get("Content-Length", 0))
            try:
                data = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception as exc:
                return self.send_json({"error": "请求体解析失败: %s" % exc}, 400)
            try:
                result = enhance_prompt(data.get("goal", ""), data.get("style", ""), data.get("size", ""))
                return self.send_json(result)
            except Exception as exc:
                return self.send_json({"error": "增强失败: %s" % str(exc)[:300]}, 502)
        if parsed.path != "/api/generate":
            return self.send_json({"error": "not found"}, 404)
        if not TOKEN:
            return self.send_json({"error": "未设置 MS_TOKEN 环境变量"}, 400)
        length = int(self.headers.get("Content-Length", 0))
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except Exception as exc:
            return self.send_json({"error": "请求体解析失败: %s" % exc}, 400)
        prompt = (data.get("prompt") or "").strip()
        if not prompt:
            return self.send_json({"error": "提示词不能为空"}, 400)
        style = data.get("style", "custom")
        if not any(p["id"] == style for p in PRESETS):
            style = "custom"
        if style != "custom":
            preset = next(p for p in PRESETS if p["id"] == style)
            full_prompt = preset["prompt"] + " Subject: " + prompt
            negative = data.get("negative") or preset["negative"]
        else:
            full_prompt = prompt
            negative = data.get("negative") or "text, watermark, logo, blurry"
        model = data.get("model") or MODELS[0]["id"]
        meta = next((m for m in MODELS if m["id"] == model), MODELS[0])
        try:
            steps = int(data.get("steps") or meta["steps"])
        except (TypeError, ValueError):
            steps = meta["steps"]
        guidance = data.get("guidance")
        if guidance is None:
            guidance = meta["guidance"]
        try:
            guidance = float(guidance) if guidance is not None else None
        except (TypeError, ValueError):
            guidance = None
        seed = data.get("seed")
        try:
            seed = int(seed) if seed not in (None, "", 0) else None
        except (TypeError, ValueError):
            seed = None
        params = {
            "title": (data.get("title") or prompt)[:80],
            "prompt": full_prompt, "negative": negative, "style": style,
            "model": model, "size": data.get("size") or "1280x720",
            "steps": max(1, min(60, steps)), "guidance": guidance, "seed": seed,
        }
        jid = uuid.uuid4().hex
        with JOBS_LOCK:
            JOBS[jid] = {"status": "queued", "progress": 0, "items": [], "params": params}
        threading.Thread(target=run_job, args=(jid, params), daemon=True).start()
        return self.send_json({"job_id": jid, "params": params}, 202)


if __name__ == "__main__":
    os.makedirs(OUTPUTS, exist_ok=True)
    port = int(os.environ.get("PORT", "8765"))
    print("AI 素材工坊: http://127.0.0.1:%d" % port, flush=True)
    print("魔搭令牌: %s" % ("已加载" if TOKEN else "未设置（请设置 MS_TOKEN）"), flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
