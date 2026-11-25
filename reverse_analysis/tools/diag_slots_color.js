// 诊断每关 Lua 塔位落点是否落在"空地"上：采样塔位周围像素颜色分类
const fs = require('fs');
const { readPNG } = require('./pnglib');
const RS = require('../../kro-minigame/js/real_slots_data');
const ROOT = 'D:/xyh/game/kingdom/';
const SX = 1000 / 1280, SY = 600 / 698;

function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
// 分类：返回主导色类别
function classify(im, x, y) {
  const w = im.w, h = im.h, d = im.data;
  let water = 0, warm = 0, green = 0, bright = 0, n = 0;
  for (let dy = -14; dy <= 14; dy += 3) for (let dx = -14; dx <= 14; dx += 3) {
    const px = Math.round(x) + dx, py = Math.round(y) + dy;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    const i = (py * w + px) * 4, r = d[i], g = d[i+1], b = d[i+2];
    n++;
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), v = mx, s = mx ? (mx-mn)/mx : 0;
    if (b > r + 22 && g > r + 10) water++;
    else if (r > 185 && g > 160 && b > 90 && b < 190 && r >= g - 20) warm++;
    else if (v > 185 && s < 0.3 && (mx-mn) < 70) bright++;
    else if (g >= r && g >= b) green++;
  }
  if (!n) return 'out';
  const frac = (c) => c / n;
  if (frac(water) > 0.35) return 'water';
  if (frac(warm) > 0.35) return 'road';
  if (frac(bright) > 0.35) return 'bright';
  return 'ground';
}

const lids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RS).sort();
console.log('关卡  塔位  水  路  亮  地  (落点分类统计)');
for (const lid of lids) {
  const bf = bgPath(lid);
  if (!bf) continue;
  const im = readPNG(bf);
  const slots = RS[lid] || [];
  const cnt = { water: 0, road: 0, bright: 0, ground: 0, out: 0 };
  const detail = [];
  for (const s of slots) {
    const bx = s.x / SX, by = s.y / SY;
    const c = classify(im, bx, by);
    cnt[c]++;
    detail.push(c === 'water' ? 'W' : c === 'road' ? 'R' : c === 'bright' ? 'B' : c === 'ground' ? '.' : '?');
  }
  const bad = cnt.water + cnt.road;
  console.log(lid + '    ' + String(slots.length).padStart(2) + '   ' +
    String(cnt.water).padStart(2) + '  ' + String(cnt.road).padStart(2) + '  ' +
    String(cnt.bright).padStart(2) + '  ' + String(cnt.ground).padStart(2) +
    '   ' + detail.join('') + (bad > slots.length * 0.25 ? '  <== 异常' : ''));
}
