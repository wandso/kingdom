// 诊断原始Lua塔位种子的质量：距路距离、种子间距、障碍占比
const fs = require('fs');
const path = require('path');
const { readPNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');
const ROOT = 'D:/xyh/game/kingdom/';
const DECOMP = ROOT + 'reverse_analysis/decompiled/levels/';
const SX = 1000 / 1280, SY = 600 / 698;

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
  if (g > r + 18 && g > b + 10 && g < 175 && s > 0.3) return true;
  if (b > r + 30 && g > r + 12 && v < 215 && s > 0.12) return true;
  if (r > 125 && b > 125 && g < r - 20 && g < b - 15) return true;
  return false;
}
function evalSpot(im, x, y) {
  const w = im.w, h = im.h, d = im.data;
  let n = 0, bad = 0;
  for (let dy = -8; dy <= 8; dy += 2) for (let dx = -8; dx <= 8; dx += 2) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    n++; const i = (py * w + px) * 4;
    if (isObstacle(d[i], d[i + 1], d[i + 2])) bad++;
  }
  return n ? bad / n : 1;
}
function dedup(slots, minD) {
  const out = [];
  for (const s of slots) {
    if (out.every(o => Math.hypot(o.x - s.x, o.y - s.y) >= minD)) out.push(s);
  }
  return out;
}

const LIDS = Object.keys(RP).filter(k => /^\d+$/.test(k) && bgPath(k)).sort((a, b) => +a - +b);
console.log('关卡  种子 去重(30px)  距路<70px(压路)  距路min/median  最近种子距  障碍>0.22');
for (const lid of LIDS) {
  const bf = bgPath(lid); if (!bf) continue;
  const im = readPNG(bf);
  const pathsBg = pathsToBg(lid);
  const raw = extractRawSlots(DECOMP + 'level' + lid + '_data.lua');
  const ded = dedup(raw, 30);
  const drs = ded.map(s => nearestPath(s.x, s.y, pathsBg).d).filter(d => d < 1e8).sort((a, b) => a - b);
  const tooClose = drs.filter(d => d < 70).length;
  const minDr = drs.length ? drs[0].toFixed(0) : '-';
  const medDr = drs.length ? drs[Math.floor(drs.length / 2)].toFixed(0) : '-';
  let md = 1e9;
  for (let i = 0; i < ded.length; i++) for (let j = i + 1; j < ded.length; j++) {
    const d = Math.hypot(ded[i].x - ded[j].x, ded[i].y - ded[j].y); if (d < md) md = d;
  }
  const obst = ded.filter(s => evalSpot(im, s.x, s.y) > 0.22).length;
  console.log(lid.padStart(3) + '  ' + String(raw.length).padStart(4) + '  ' + String(ded.length).padStart(8) + '  ' +
    String(tooClose).padStart(14) + '  ' + (minDr + '/' + medDr).padStart(13) + '  ' + md.toFixed(0).padStart(10) + '  ' + String(obst).padStart(8));
}
