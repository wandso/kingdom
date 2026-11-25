// 从关卡背景图自动检测"路边平坦空地"作为防御塔位（模拟原作固定建塔点）
// 用法: node gen_slots_from_map.js            → 生成全部关卡
//       node gen_slots_from_map.js 01         → 只生成关卡01并输出叠加图
const fs = require('fs');
const path = require('path');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');

const ROOT = 'D:/xyh/game/kingdom';
const OUT_JSON = ROOT + '/kro-minigame/js/real_slots.json';
const SHOTS = ROOT + '/_shots';

function bgPath(lid) {
  let p = ROOT + '/kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(p)) p = ROOT + '/kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(p) ? p : null;
}

// 像素分类：水/土路/建筑/树冠/空地。用相对特征适配不同主题
function makeClassifier(im) {
  const w = im.w, h = im.h, d = im.data;
  // 采样全图主色判断主题（雪地/岩浆/普通）
  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) {
    const i = (y * w + x) * 4; sumR += d[i]; sumG += d[i + 1]; sumB += d[i + 2]; n++;
  }
  const avg = { r: sumR / n, g: sumG / n, b: sumB / n };
  const cold = avg.b > avg.r * 0.95 && avg.g > avg.r; // 冷色主题(雪/暗)
  return {
    avg, cold, w, h, d,
    // 'clear' = 可建塔的空地；'block' = 水/路/树/建筑
    kind(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return 'out';
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0;
      if (!cold) {
        // 水：明显偏青蓝
        if (b > r + 18 && g > r + 15 && b > 90) return 'water';
        // 土路：暖黄/沙色，高亮低饱和暖色
        if (r > 175 && g > 150 && b < r - 25 && b > 80 && s < 0.55) return 'road';
        // 空地草地：明亮中绿，非深树冠
        if (g > r && g > b && g > 105 && v > 110) {
          // 深绿且饱和低=树冠阴影，排除
          if (g < 135 && s > 0.55) return 'tree';
          return 'clear';
        }
        return 'other';
      } else {
        // 冷色主题：土路/石板是亮低饱和；雪地空地亮白/浅灰；水/深色是block
        if (v > 185 && s < 0.28) return 'road'; // 浅色路/雪勘
        if (g > r && g > b && g > 100) return 'clear';
        if (v < 95) return 'tree';
        return 'other';
      }
    }
  };
}

function detectSlots(lid, wantShot) {
  const bgp = bgPath(lid);
  if (!bgp) return { lid, ok: false, reason: 'no-bg' };
  const im = readPNG(bgp);
  const cf = makeClassifier(im);
  const w = im.w, h = im.h;
  const SX = 1000 / w, SY = 600 / h;
  const lv = RP[lid];
  if (!lv || !lv.curves || !lv.curves.length) return { lid, ok: false, reason: 'no-path' };
  // 真实路径（背景像素坐标）
  const paths = lv.curves.map(c => c.mapped.map(p => ({ x: p.x / SX, y: p.y / SY })));
  function distToRoad(x, y) {
    let best = 1e9;
    for (const pth of paths) for (let i = 1; i < pth.length; i++) {
      const a = pth[i - 1], b = pth[i];
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / L; t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx, py = a.y + t * dy;
      const dd = Math.hypot(x - px, y - py); if (dd < best) best = dd;
    }
    return best;
  }
  // 区域"空地纯度"：中心及周围大多是clear，且没有water/road
  function clearScore(cx, cy, rad) {
    let clear = 0, bad = 0, n = 0;
    for (let dy = -rad; dy <= rad; dy += 4) for (let dx = -rad; dx <= rad; dx += 4) {
      const k = cf.kind(cx + dx, cy + dy); n++;
      if (k === 'clear') clear++;
      else if (k === 'water' || k === 'road' || k === 'out' || k === 'other') bad++;
    }
    return { clear: clear / n, bad: bad / n };
  }
  const cand = [];
  const step = Math.max(16, Math.round(w / 58));
  for (let y = 55; y < h - 40; y += step) for (let x = 55; x < w - 40; x += step) {
    const dr = distToRoad(x, y);
    if (dr < 48 || dr > 115) continue; // 距路边适中
    const s = clearScore(x, y, Math.round(w * 0.022));
    if (s.clear >= 0.78 && s.bad < 0.1) cand.push({ x, y, dr, score: s.clear });
  }
  cand.sort((a, b) => b.score - a.score);
  // 贪心：间距足够，且优先沿路均匀分布
  const out = [];
  const minGap = Math.round(w * 0.078);
  for (const c of cand) {
    if (out.every(o => Math.hypot(o.x - c.x, o.y - c.y) >= minGap)) out.push(c);
    if (out.length >= 14) break;
  }
  // 目标数量参考原程序Slots（10~13）
  const target = 10 + (parseInt(lid) % 4);
  const chosen = out.slice(0, target);
  const slots = chosen.map(c => ({ x: Math.round(c.x * SX), y: Math.round(c.y * SY) }));
  const result = { lid, ok: true, count: slots.length, slots, cold: cf.cold };
  if (wantShot) {
    const dc = readPNG(bgp);
    const dd = dc.data;
    function dot(cx, cy, r, col) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4; dd[i] = col[0]; dd[i + 1] = col[1]; dd[i + 2] = col[2];
      }
    }
    chosen.forEach(c => { dot(c.x, c.y, 10, [255, 220, 0]); dot(c.x, c.y, 4, [255, 0, 0]); });
    writePNG(SHOTS + '/slots_detected_' + lid + '.png', dd, w, h);
  }
  return result;
}

const single = process.argv[2];
if (single) {
  const r = detectSlots(single.padStart(2, '0'), true);
  console.log(JSON.stringify(r, null, 2));
} else {
  const all = {};
  const ids = Object.keys(RP).sort();
  let ok = 0, fail = [];
  for (const lid of ids) {
    const r = detectSlots(lid, false);
    if (r.ok) { all[lid] = r.slots; ok++; console.log(lid + ': ' + r.slots.length + ' slots ' + (r.cold ? '(cold)' : '')); }
    else { fail.push(lid + ':' + r.reason); console.log(lid + ': FAIL ' + r.reason); }
  }
  fs.writeFileSync(OUT_JSON, JSON.stringify(all));
  console.log('\n完成: ' + ok + '/' + ids.length + ' 关卡, 失败: ' + fail.join(', '));
  console.log('输出: ' + OUT_JSON);
}
