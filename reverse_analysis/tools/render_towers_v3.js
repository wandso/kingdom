// 无头渲染 v3：精确复刻 engine.drawTower 当前逻辑（画布中心对齐 BASE_H=58）
// 渲染全部塔位到真实背景，验证塔边缘不压路、塔间不重合
const fs = require('fs');
const { readPNG, writePNG } = require('./pnglib');
const RS = require('../../kro-minigame/js/real_slots_data');
const M = require('../../kro-minigame/js/sprite_manifest');
const ROOT = 'D:/xyh/game/kingdom/kro-minigame/';

function bgPath(LID) {
  let f = ROOT + 'assets/stages/bg_' + LID + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'pkg_assets/stages/bg_' + LID + '.png';
  return f;
}
function renderLid(LID) {
  const im = readPNG(bgPath(LID));
  const w = im.w, h = im.h;
  const SX = 1000 / w, SY = 600 / h;
  function load(k) { const s = M[k]; if (!s) return null; return readPNG(ROOT + s.file); }
  // 与引擎一致：整张画布缩放，中心对齐
  function drawCanvas(dst, img, cx, bottomY, H) {
    const scale = H / img.h, dw = img.w * scale, dh = H;
    const dx = Math.round(cx - dw / 2), dy = Math.round(bottomY - dh);
    for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
      const sx = Math.floor(xx / scale), sy = Math.floor(yy / scale);
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const si = (sy * img.w + sx) * 4, a = img.data[si + 3] / 255;
      if (a < 0.02) continue;
      const px = dx + xx, py = dy + yy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const di = (py * w + px) * 4;
      dst[di] = dst[di] * (1 - a) + img.data[si] * a;
      dst[di + 1] = dst[di + 1] * (1 - a) + img.data[si + 1] * a;
      dst[di + 2] = dst[di + 2] * (1 - a) + img.data[si + 2] * a;
    }
  }
  const fams = ['archer', 'mage', 'artillery', 'barracks'];
  const BASE_H = 58;
  const slots = RS[LID] || [];
  slots.forEach((slot, i) => {
    const fam = fams[i % 4];
    const cx = slot.x / SX, anchorBottom = slot.y / SY + 16;
    const base = load('base_' + fam);
    const top = load('top_' + fam + '_f0');
    if (base) drawCanvas(im.data, base, cx, anchorBottom, BASE_H);
    if (top) drawCanvas(im.data, top, cx, anchorBottom, BASE_H);
  });
  const out = 'D:/xyh/game/kingdom/_shots/towers_v3_' + LID + '.png';
  writePNG(out, im.data, w, h);
  console.log(LID + ': 渲染 ' + slots.length + ' 塔 -> ' + out);
}
['01', '09', '21', '08'].forEach(renderLid);
