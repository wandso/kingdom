// 无头渲染：用真实引擎 drawTower 逻辑 + 实际精灵 PNG，把塔画到关卡1背景上
// 直接复刻 engine.drawTower 的几何参数，便于目视检查塔/人物大小与塔位
const fs = require('fs');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');
const RS = require('../../kro-minigame/js/real_slots_data');
const M = require('../../kro-minigame/js/sprite_manifest');
const ROOT = 'D:/xyh/game/kingdom/kro-minigame/';
const LID = '01';

const im = readPNG(ROOT + 'assets/stages/bg_' + LID + '.png');
const w = im.w, h = im.h;
const SX = 1000 / w, SY = 600 / h;

// 读精灵为 {img, trim}
function load(k) {
  const s = M[k]; if (!s) return null;
  const img = readPNG(ROOT + s.file);
  return { img, trim: s.trim || { x: 0, y: 0, w: img.w, h: img.h } };
}
// 把 img 的 trim 区域按目标高度缩放后 alpha 合成到画布
function drawTrim(dst, spr, cx, bottomY, targetH, attackIdx) {
  const { img, trim } = spr;
  const sw = trim.w, sh = trim.h, sx = trim.x, sy = trim.y;
  const scale = targetH / sh, dw = sw * scale, dh = targetH;
  const dx = Math.round(cx - dw / 2), dy = Math.round(bottomY - dh);
  for (let yy = 0; yy < dh; yy++) for (let xx = 0; xx < dw; xx++) {
    const srcx = sx + Math.floor(xx / scale), srcy = sy + Math.floor(yy / scale);
    if (srcx < 0 || srcy < 0 || srcx >= img.w || srcy >= img.h) continue;
    const si = (srcy * img.w + srcx) * 4, a = img.data[si + 3] / 255;
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
const PERSON_H = { archer: 30, mage: 30, artillery: 30, barracks: 24 };
fams.forEach((fam, i) => {
  const slot = RS[LID][i];
  if (!slot) return;
  const cx = slot.x / SX, groundY = slot.y / SY + 16;
  const baseSpr = load('base_' + fam);
  const topSpr = load('top_' + fam + '_f0');
  if (baseSpr) drawTrim(im.data, baseSpr, cx, groundY, BASE_H);
  if (topSpr) drawTrim(im.data, topSpr, cx, groundY - BASE_H * 0.80, PERSON_H[fam]);
  // 标记塔位编号
});

writePNG('D:/xyh/game/kingdom/_shots/towers_newstyle_01.png', im.data, w, h);
console.log('新塔渲染图已生成: towers_newstyle_01.png');
console.log('前4塔位逻辑坐标:', RS[LID].slice(0, 4).map(s => `(${s.x},${s.y})`).join(' '));
