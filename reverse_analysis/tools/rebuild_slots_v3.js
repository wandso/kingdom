// 塔位重建 v4：全局约束分配，硬性保证 (1)塔边缘不压路 (2)塔与塔不重合
// 策略：预计算全图"可建候选点"(离路86~175px + 非障碍 + 平坦)，
//       每个原作种子按"离种子近+距路适中+平坦"贪心认领一个候选，强制塔间距>=94px。
// 用法: node rebuild_slots_v3.js [lid ...]   不带参数则处理全部并写 real_slots_v3.json
const fs = require('fs');
const path = require('path');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');
const ROOT = 'D:/xyh/game/kingdom/';
const DECOMP = ROOT + 'reverse_analysis/decompiled/levels/';
const SX = 1000 / 1280, SY = 600 / 698;

// ---- 硬约束参数（背景图像素 1280x698）----
const ROAD_MIN = 88;       // 塔中心距路中心线最小（塔半宽44+路半宽~24+间隙）
const ROAD_MAX = 180;      // 距路上限
const ROAD_TARGET = 116;   // 期望距路
const MIN_TOWER_DIST = 96; // 两塔最小中心距（塔画面宽约88px + 间隙）
const EDGE = 46;           // 离背景边缘余量
const OBST_LIMIT = 0.20;   // 障碍占比上限

function extractRawSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const slots = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    let start = i;
    while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
    let depth = 0, end = start;
    for (; end < lines.length; end++) {
      for (const ch of lines[end]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth <= 0 && end > start) break;
    }
    const block = lines.slice(start, end + 1).join('\n');
    const m = block.match(/(?:^|[^\w.])pos\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*,\s*y\s*=\s*(-?[\d.]+)\s*\}/m);
    if (m) slots.push({ x: +m[1], y: +m[2] });
  }
  return slots;
}
function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
function pathsToBg(lid) {
  return ((RP[lid] && RP[lid].curves) || []).map(c => c.mapped.map(p => ({ x: p.x / SX, y: p.y / SY })));
}
function nearestPath(px, py, pathsBg) {
  let best = 1e9, bpt = null;
  for (const pth of pathsBg) for (let i = 1; i < pth.length; i++) {
    const a = pth[i - 1], b = pth[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L; t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * dx, qy = a.y + t * dy, dd = Math.hypot(px - qx, py - qy);
    if (dd < best) { best = dd; bpt = { x: qx, y: qy }; }
  }
  return { d: best, pt: bpt };
}
function isObstacle(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0;
  // 亮青湖水：b、g 都高(>140)且明显大于 r —— 排除关卡1/9的水面
  // 关键：暗色石板[55,89,101]、蓝绿草地[64,107,109] b<140，不会被误判
  if (b > 140 && g > 140 && b > r + 20 && g > r + 15) return true;
  // 橙红岩浆：r 高、g 中低、b 很低 —— 排除关卡21熔岩
  if (r > 175 && g < 135 && b < 75) return true;
  // 深绿密林：暗到中等亮度、明显偏绿（排除亮草地 v>135）
  if (g > r + 25 && g > b + 18 && v >= 60 && v <= 135 && s > 0.4) return true;
  return false;
}
function evalSpot(im, x, y) {
  const w = im.w, h = im.h, d = im.data;
  let n = 0, bad = 0, sum = 0, sum2 = 0;
  for (let dy = -9; dy <= 9; dy += 2) for (let dx = -9; dx <= 9; dx += 2) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    n++; const i = (py * w + px) * 4;
    if (isObstacle(d[i], d[i + 1], d[i + 2])) bad++;
    const lum = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    sum += lum; sum2 += lum * lum;
  }
  if (!n) return { bad: 1, std: 99 };
  const mean = sum / n;
  return { bad: bad / n, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
}
function dedup(slots, minD) {
  const out = [];
  for (const s of slots) if (out.every(o => Math.hypot(o.x - s.x, o.y - s.y) >= minD)) out.push(s);
  return out;
}

function rebuild(lid) {
  const bf = bgPath(lid); if (!bf) return null;
  const im = readPNG(bf), w = im.w, h = im.h;
  const pathsBg = pathsToBg(lid);
  if (!pathsBg.length) return null;
  const seeds = dedup(extractRawSlots(DECOMP + 'level' + lid + '_data.lua'), 34);
  if (!seeds.length) return null;

  // 全局候选池：离路 + 非障碍
  const cands = [];
  for (let gy = EDGE; gy < h - EDGE; gy += 6) for (let gx = EDGE; gx < w - EDGE; gx += 6) {
    const np = nearestPath(gx, gy, pathsBg);
    if (np.d < ROAD_MIN || np.d > ROAD_MAX) continue;
    const e = evalSpot(im, gx, gy);
    if (e.bad > OBST_LIMIT) continue;
    cands.push({ x: gx, y: gy, dr: np.d, bad: e.bad, std: e.std, rp: np.pt });
  }

  const placed = [];
  let relaxed = 0;
  // 贪心认领：每个种子在候选池里找最优（离种子近 + 距路适中 + 平坦 + 离已放塔足够远）
  for (const seed of seeds) {
    let best = null;
    for (const c of cands) {
      const move = Math.hypot(c.x - seed.x, c.y - seed.y);
      let minD = 1e9;
      for (const p of placed) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < minD) minD = d; }
      if (minD < MIN_TOWER_DIST) continue;                      // 硬约束：不重合
      // 评分：贴近原作种子优先，其次距路接近目标、障碍少、平坦
      const score = -move / 55 - Math.abs(c.dr - ROAD_TARGET) / 70 - c.bad * 7 - c.std / 45;
      if (!best || score > best.score) best = { x: c.x, y: c.y, dr: c.dr, bad: c.bad, std: c.std, rp: c.rp, move, score };
    }
    if (!best) {
      // 候选耗尽：放宽塔间距到 82px 再找（仍保证离路+非障碍，绝不压路）
      relaxed++;
      for (const c of cands) {
        let minD = 1e9;
        for (const p of placed) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < minD) minD = d; }
        if (minD < 82) continue;
        const move = Math.hypot(c.x - seed.x, c.y - seed.y);
        const score = -move / 55 - Math.abs(c.dr - ROAD_TARGET) / 70 - c.bad * 7;
        if (!best || score > best.score) best = { x: c.x, y: c.y, dr: c.dr, bad: c.bad, std: c.std, rp: c.rp, move, score, relaxed: true };
      }
    }
    if (!best) {
      // 极端：候选全被占，用种子自身外推到路边（保证离路，允许略近其他塔）
      const np = nearestPath(seed.x, seed.y, pathsBg);
      let fx = seed.x, fy = seed.y;
      if (np.pt) {
        const vx = seed.x - np.pt.x, vy = seed.y - np.pt.y, vl = Math.hypot(vx, vy) || 1;
        fx = np.pt.x + vx / vl * (ROAD_MIN + 8); fy = np.pt.y + vy / vl * (ROAD_MIN + 8);
      }
      const fn = nearestPath(fx, fy, pathsBg);
      best = { x: fx, y: fy, dr: fn.d, bad: 0, std: 0, rp: fn.pt, move: Math.hypot(fx - seed.x, fy - seed.y), fallback: true };
      relaxed++;
    }
    placed.push(best);
  }
  return { lid, seeds, slots: placed, relax: relaxed };
}

const args = process.argv.slice(2);
const lids = args.length ? args : Object.keys(RP).filter(k => /^\d+$/.test(k) && bgPath(k)).sort((a, b) => +a - +b);
const results = [];
for (const lid of lids) {
  const r = rebuild(lid); if (!r) continue;
  results.push(r);
  const drs = r.slots.map(s => s.dr).filter(d => d != null).sort((a, b) => a - b);
  let md = 1e9;
  for (let i = 0; i < r.slots.length; i++) for (let j = i + 1; j < r.slots.length; j++) {
    const d = Math.hypot(r.slots[i].x - r.slots[j].x, r.slots[i].y - r.slots[j].y); if (d < md) md = d;
  }
  console.log(lid + ': n=' + r.slots.length + ' 最近塔距=' + md.toFixed(0) +
    ' 距路min/median=' + (drs.length ? drs[0].toFixed(0) + '/' + drs[Math.floor(drs.length / 2)].toFixed(0) : '-') +
    ' 压路(<' + ROAD_MIN + ')=' + drs.filter(d => d < ROAD_MIN).length +
    ' 放宽=' + r.slots.filter(s => s.relaxed).length + ' 兜底=' + r.slots.filter(s => s.fallback).length);

  const im = readPNG(bgPath(lid)), w = im.w, h = im.h, data = im.data;
  function ring(cx, cy, rr, col, t) {
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const q = dx * dx + dy * dy; if (q > rr * rr || q < (rr - t) * (rr - t)) continue;
      const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2];
    }
  }
  function solid(cx, cy, rr, col) {
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      if (dx * dx + dy * dy > rr * rr) continue;
      const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2];
    }
  }
  for (const s of r.slots) ring(s.x, s.y, 44, [255, 220, 0], 3); // 塔占地(半径≈塔半宽44px)
  for (const s of r.seeds) solid(s.x, s.y, 3, [255, 40, 40]);
  writePNG(ROOT + '_shots/v3_slots_' + lid + '.png', data, w, h);
}
if (args.length === 0) {
  const outObj = {};
  for (const r of results) {
    outObj[r.lid] = r.slots.map(s => {
      const rp = s.rp ? { x: s.rp.x, y: s.rp.y } : { x: s.x, y: Math.min(640, s.y + 60) };
      return {
        x: Math.round(s.x * SX), y: Math.round(s.y * SY),
        rally: { x: Math.round(rp.x * SX), y: Math.round(rp.y * SY) }
      };
    });
  }
  fs.writeFileSync(ROOT + 'kro-minigame/js/real_slots_v3.json', JSON.stringify(outObj));
  console.log('\n已写 real_slots_v3.json（关卡 ' + Object.keys(outObj).length + '，塔位 ' +
    Object.values(outObj).reduce((a, b) => a + b.length, 0) + '）');
}
