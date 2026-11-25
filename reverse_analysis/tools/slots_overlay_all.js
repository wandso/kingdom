// 批量生成各关塔位叠加图：黄圈=塔位, 红点=中心, 青圈=rally集结点
// 用于独立验证塔位是否落在地图空地（而非水面/土路/树/建筑）
const fs = require('fs');
const { readPNG, writePNG } = require('./pnglib');
const RS = require('../../kro-minigame/js/real_slots_data');

const ROOT = 'D:/xyh/game/kingdom/';
const SX = 1000 / 1280, SY = 600 / 698;

function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
function ring(data, w, h, cx, cy, r, col, thick) {
  thick = thick || 2;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r || d2 < (r - thick) * (r - thick)) continue;
    const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    data[i] = col[0]; data[i+1] = col[1]; data[i+2] = col[2];
  }
}
function solid(data, w, h, cx, cy, r, col) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx*dx+dy*dy > r*r) continue;
    const x = Math.round(cx)+dx, y = Math.round(cy)+dy;
    if (x<0||y<0||x>=w||y>=h) continue;
    const i=(y*w+x)*4; data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];
  }
}

const lids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(RS).sort();
for (const lid of lids) {
  const bf = bgPath(lid);
  if (!bf) { console.log(lid + ': 无背景图，跳过'); continue; }
  const im = readPNG(bf);
  const w = im.w, h = im.h, data = im.data;
  const slots = RS[lid] || [];
  slots.forEach((s, i) => {
    const bx = s.x / SX, by = s.y / SY;
    ring(data, w, h, bx, by, 12, [255, 220, 0], 3);   // 黄圈=塔位
    solid(data, w, h, bx, by, 4, [255, 0, 0]);         // 红心
    if (s.rally && (s.rally.x !== s.x || s.rally.y !== s.y)) {
      const rx = s.rally.x / SX, ry = s.rally.y / SY;
      ring(data, w, h, rx, ry, 7, [0, 220, 255], 2);  // 青圈=rally
    }
  });
  const out = ROOT + '_shots/slots_overlay_' + lid + '.png';
  writePNG(out, data, w, h);
  console.log(lid + ': ' + slots.length + ' 塔位 -> ' + out);
}
