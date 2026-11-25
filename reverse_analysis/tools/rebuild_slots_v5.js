// 塔位重建 v5：核心改为"原作种子附近的自适应浅色空地"
// 用户反馈：塔要落在明显更浅的建塔地皮上（相对周围深草/深石板）
// 方法：
//   1) 每关用可建区域亮度分布自适应求"空地亮度阈值"（高位分位数）
//   2) 全局候选池 = 亮度>=阈值 + 非水非路非障碍 + 距路合理
//   3) 原作种子(可加全局平移)按"近种子+空地亮度高+平坦"贪心认领，硬约束塔间距
const fs = require('fs');
const path = require('path');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');
const ROOT = 'D:/xyh/game/kingdom/';
const DECOMP = ROOT + 'reverse_analysis/decompiled/levels/';
const SX = 1000 / 1280, SY = 600 / 698;

const ROAD_MIN = 70;       // 塔半宽44+路半宽24+间隙，保证塔边缘不压路
const ROAD_MAX = 155;
const MIN_TOWER_DIST = 88; // 塔不重合
const EDGE = 42;
const SEARCH_R = 130;      // 种子附近搜索半径

function extractRawSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const s = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    let st = i; while (st > 0 && !/\{\s*$/.test(lines[st])) st--;
    let d = 0, e = st;
    for (; e < lines.length; e++) { for (const c of lines[e]) { if (c === '{') d++; else if (c === '}') d--; } if (d <= 0 && e > st) break; }
    const b = lines.slice(st, e + 1).join('\n');
    const m = b.match(/(?:^|[^\w.])pos\s*=\s*\{\s*x\s*=\s*(-?[\d.]+)\s*,\s*y\s*=\s*(-?[\d.]+)\s*\}/m);
    if (m) s.push({ x: +m[1], y: +m[2] });
  }
  return s;
}
function dedup(slots, minD) { const o = []; for (const s of slots) if (o.every(p => Math.hypot(p.x - s.x, p.y - s.y) >= minD)) o.push(s); return o; }
function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
function pathsToBg(lid) { return ((RP[lid] && RP[lid].curves) || []).map(c => c.mapped.map(p => ({ x: p.x / SX, y: p.y / SY }))); }
function nearestPath(px, py, paths) {
  let best = 1e9, bpt = null;
  for (const pth of paths) for (let i = 1; i < pth.length; i++) {
    const a = pth[i - 1], b = pth[i], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
    let t = ((px - a.x) * dx + (py - a.y) * dy) / L; t = Math.max(0, Math.min(1, t));
    const qx = a.x + t * dx, qy = a.y + t * dy, dd = Math.hypot(px - qx, py - qy);
    if (dd < best) { best = dd; bpt = { x: qx, y: qy }; }
  }
  return { d: best, pt: bpt };
}
function isHardObs(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), v = mx, s = mx ? (mx - mn) / mx : 0;
  // 亮青湖水：g、b 都高且明显大于 r，且偏青绿(g不比b低太多)、饱和度高
  // 关键：熔岩关浅灰蓝石板[136,170,177] g≈b≈r、饱和度低 -> 不算水
  if (b > 145 && g > 145 && g > r + 30 && b > r + 30 && s > 0.22) return true;
  if (r > 175 && g < 135 && b < 75) return true;                                   // 橙岩浆
  if (g > r + 25 && g > b + 18 && v >= 60 && v <= 130 && s > 0.42) return true;    // 深密林
  return false;
}
function sample(im, x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return null;
  const i = (y * im.w + x) * 4, r = im.data[i], g = im.data[i + 1], b = im.data[i + 2];
  return { r, g, b, lum: 0.3 * r + 0.59 * g + 0.11 * b };
}
// 局部(半径9)平均亮度、亮度方差、障碍占比
function localStat(im, x, y) {
  const w = im.w, h = im.h, d = im.data;
  let n = 0, sum = 0, sum2 = 0, bad = 0;
  for (let dy = -9; dy <= 9; dy += 2) for (let dx = -9; dx <= 9; dx += 2) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    n++; const i = (py * w + px) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const l = 0.3 * r + 0.59 * g + 0.11 * b; sum += l; sum2 += l * l;
    if (isHardObs(r, g, b)) bad++;
  }
  if (!n) return { mean: 0, std: 99, bad: 1 };
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)), bad: bad / n };
}
// 求本关"空地亮度阈值"：远处可建点(距路>=ROAD_MIN)亮度的 60 分位
// 只纳入远离路面的点，避开路面(最亮)与深障碍(最暗)，取中间偏上=空地色
function airThreshold(im, paths) {
  const vals = [];
  for (let y = EDGE; y < im.h - EDGE; y += 6) for (let x = EDGE; x < im.w - EDGE; x += 6) {
    const p = sample(im, x, y); if (!p) continue;
    if (isHardObs(p.r, p.g, p.b)) continue;                  // 岩浆/深林/湖水
    if (paths && paths.length && nearestPath(x, y, paths).d < ROAD_MIN) continue; // 排除路面
    if (p.lum < 70) continue;
    vals.push(p.lum);
  }
  vals.sort((a, b) => a - b);
  return vals.length ? vals[Math.floor(vals.length * 0.60)] : 150;
}

function rebuild(lid) {
  const bf = bgPath(lid); if (!bf) return null;
  const im = readPNG(bf);
  const paths = pathsToBg(lid); if (!paths.length) return null;
  const raw = dedup(extractRawSlots(DECOMP + 'level' + lid + '_data.lua'), 34);
  if (!raw.length) return null;
  const air = airThreshold(im, paths);

  // 全局候选池：本关空地(亮度>=air) + 非硬障碍 + 距路（路面靠几何距离排除，不靠颜色）
  const cands = [];
  for (let gy = EDGE; gy < im.h - EDGE; gy += 5) for (let gx = EDGE; gx < im.w - EDGE; gx += 5) {
    const p = sample(im, gx, gy); if (!p) continue;
    if (isHardObs(p.r, p.g, p.b)) continue;
    const np = nearestPath(gx, gy, paths);
    if (np.d < ROAD_MIN || np.d > ROAD_MAX) continue;
    const ls = localStat(im, gx, gy);
    if (ls.bad > 0.12) continue;
    // 空地亮度区间 [air-25, air+45]：太暗=深林/深水，太亮=路面(雪关/石板关路面最亮)
    if (ls.mean < air - 25 || ls.mean > air + 45) continue;
    if (ls.std > 26) continue;                   // 平坦
    cands.push({ x: gx, y: gy, lum: ls.mean, std: ls.std, dr: np.d, rp: np.pt });
  }

  const placed = [];
  for (const seed of raw) {
    let best = null;
    // 只在种子附近挑候选，保证贴合原作布局
    for (const c of cands) {
      const move = Math.hypot(c.x - seed.x, c.y - seed.y);
      if (move > SEARCH_R) continue;
      let minD = 1e9;
      for (const p of placed) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < minD) minD = d; }
      if (minD < MIN_TOWER_DIST) continue;
      // 评分：靠近种子 + 空地更亮 + 平坦 + 距路适中
      const score = -move / 45 + (c.lum - air) / 12 - c.std / 30 - Math.abs(c.dr - 85) / 90;
      if (!best || score > best.score) best = { x: c.x, y: c.y, lum: c.lum, dr: c.dr, rp: c.rp, move, score };
    }
    if (!best) {
      // 第2档：附近局部，塔间距放宽到76px（仍不重合）
      for (const c of cands) {
        const move = Math.hypot(c.x - seed.x, c.y - seed.y);
        if (move > SEARCH_R) continue;
        let minD = 1e9; for (const p of placed) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < minD) minD = d; }
        if (minD < 72) continue;
        const score = -move / 45 + (c.lum - air) / 12 - c.std / 30;
        if (!best || score > best.score) best = { x: c.x, y: c.y, lum: c.lum, dr: c.dr, rp: c.rp, move, score };
      }
    }
    if (!best) {
      // 第3档：放宽到全图候选
      for (const c of cands) {
        let minD = 1e9; for (const p of placed) { const d = Math.hypot(p.x - c.x, p.y - c.y); if (d < minD) minD = d; }
        if (minD < 72) continue;
        const move = Math.hypot(c.x - seed.x, c.y - seed.y);
        const score = -move / 90 + (c.lum - air) / 12 - c.std / 30;
        if (!best || score > best.score) best = { x: c.x, y: c.y, lum: c.lum, dr: c.dr, rp: c.rp, move, score, far: true };
      }
    }
    if (!best) {
      // 兜底：种子自身外推到路(仍尽量找亮)
      const np = nearestPath(seed.x, seed.y, paths);
      let fx = seed.x, fy = seed.y;
      if (np.pt) { const vx = seed.x - np.pt.x, vy = seed.y - np.pt.y, vl = Math.hypot(vx, vy) || 1; fx = np.pt.x + vx / vl * (ROAD_MIN + 10); fy = np.pt.y + vy / vl * (ROAD_MIN + 10); }
      const ls = localStat(im, fx, fy), fn = nearestPath(fx, fy, paths);
      best = { x: fx, y: fy, lum: ls.mean, dr: fn.d, rp: fn.pt, move: 0, fallback: true };
    }
    placed.push(best);
  }
  return { lid, seeds: raw, slots: placed, air: Math.round(air), cands: cands.length };
}

const args = process.argv.slice(2);
const lids = args.length ? args : Object.keys(RP).filter(k => /^\d+$/.test(k) && bgPath(k)).sort((a, b) => +a - +b);
const results = [];
for (const lid of lids) {
  const r = rebuild(lid); if (!r) continue;
  results.push(r);
  const lums = r.slots.map(s => s.lum).filter(v => v != null).sort((a, b) => a - b);
  const drs = r.slots.map(s => s.dr).sort((a, b) => a - b);
  let md = 1e9; for (let i = 0; i < r.slots.length; i++) for (let j = i + 1; j < r.slots.length; j++) { const d = Math.hypot(r.slots[i].x - r.slots[j].x, r.slots[i].y - r.slots[j].y); if (d < md) md = d; }
  console.log(lid + ': n=' + r.slots.length + ' air=' + r.air + ' 空地亮度min/med=' + (lums[0] || 0).toFixed(0) + '/' + (lums[Math.floor(lums.length / 2)] || 0).toFixed(0) +
    ' 最近塔距=' + md.toFixed(0) + ' 距路min=' + drs[0].toFixed(0) + ' 兜底=' + r.slots.filter(s => s.fallback).length + ' 远=' + r.slots.filter(s => s.far).length + ' 候选=' + r.cands);

  const im = readPNG(bgPath(lid)), w = im.w, h = im.h, data = Buffer.from(im.data);
  function ring(cx, cy, rr, col, t) { for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const q = dx * dx + dy * dy; if (q > rr * rr || q < (rr - t) * (rr - t)) continue; const x = Math.round(cx) + dx, y = Math.round(cy) + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue; const i = (y * w + x) * 4; data[i] = col[0]; data[i + 1] = col[1]; data[i + 2] = col[2]; } }
  for (const s of r.slots) ring(s.x, s.y, 40, [255, 40, 220], 3);
  writePNG(ROOT + '_shots/v5_slots_' + lid + '.png', data, w, h);
}
if (args.length === 0) {
  const outObj = {};
  for (const r of results) outObj[r.lid] = r.slots.map(s => ({ x: Math.round(s.x * SX), y: Math.round(s.y * SY), rally: s.rp ? { x: Math.round(s.rp.x * SX), y: Math.round(s.rp.y * SY) } : { x: Math.round(s.x * SX), y: Math.round(Math.min(640, s.y + 55) * SY) } }));
  fs.writeFileSync(ROOT + 'kro-minigame/js/real_slots_v5.json', JSON.stringify(outObj));
  console.log('\n已写 real_slots_v5.json');
}
