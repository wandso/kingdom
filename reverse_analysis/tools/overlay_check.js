// 独立验证：把引擎实际使用的路径映射回背景图像素坐标，画叠加图直观检查是否贴合土路
// 用法：node overlay_check.js [levelId]   例：node overlay_check.js 01
const fs = require('fs'), path = require('path');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_full.json');

const LID = (process.argv[2] || '01').padStart(2, '0');
let BG = `D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`;
if (!fs.existsSync(BG)) BG = `D:/xyh/game/kingdom/kro-minigame/pkg_assets/stages/bg_${LID}.png`;
const OUT = `D:/xyh/game/kingdom/_shots/overlay_check_${LID}.png`;
const SX = 1000 / 1280, SY = 600 / 698; // gen_paths.js 使用的映射

const img = readPNG(BG);
const { w, h, data } = img;
console.log('背景', w + 'x' + h);

function setPixel(x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const i = (y * w + x) * 4;
  data[i] = data[i] * (1 - a) + r * a;
  data[i + 1] = data[i + 1] * (1 - a) + g * a;
  data[i + 2] = data[i + 2] * (1 - a) + b * a;
}
function dot(cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy <= r * r) setPixel(cx + dx, cy + dy, col[0], col[1], col[2], 0.9);
  }
}
function drawPath(mapped, col) {
  // 反算回背景像素坐标
  const pts = mapped.map(p => ({ x: p.x / SX, y: p.y / SY }));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 2));
    for (let s = 0; s <= steps; s++) dot(a.x + (b.x - a.x) * s / steps, a.y + (b.y - a.y) * s / steps, 3, col);
  }
  // 起点画大圈
  dot(pts[0].x, pts[0].y, 8, [255, 0, 0]);
}

const lv = RP[LID];
if (!lv) { console.error('无此关卡', LID); process.exit(1); }
const colors = [[255, 40, 40], [40, 90, 255], [255, 140, 0], [140, 40, 255], [0, 180, 120]];
lv.curves.forEach((c, i) => drawPath(c.mapped, colors[i % colors.length]));
writePNG(OUT, data, w, h);
console.log('输出', OUT, '路径条数', lv.curves.length);
