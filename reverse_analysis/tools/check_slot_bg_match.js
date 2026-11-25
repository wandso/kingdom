// 验证：Lua塔位与哪张背景图最匹配（塔位应落在路边空地：距路20-110px，且非水）
const fs = require('fs');
const { readPNG } = require('./pnglib');
const { buildRoadMask } = require('./roadlib');
const RS = require('../../kro-minigame/js/real_slots_data');
const ROOT = 'D:/xyh/game/kingdom/';
const SX = 1000 / 1280, SY = 600 / 698;

function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
const LIDS = ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22'];

// 预加载所有背景的道路掩码 + 水掩码
const BGS = {};
for (const lid of LIDS) {
  const im = readPNG(bgPath(lid));
  const { mask } = buildRoadMask(im);
  const water = new Uint8Array(im.w * im.h);
  for (let i = 0; i < im.w * im.h; i++) {
    const k = i * 4, r = im.data[k], g = im.data[k+1], b = im.data[k+2];
    if (b > r + 18 && g > r + 6) water[i] = 1;
  }
  BGS[lid] = { im, mask, water };
}
// 到最近路的距离（像素），限制搜索
function distRoad(bg, x, y) {
  const { mask, im } = bg, w = im.w, h = im.h;
  let best = 1e9;
  for (let dy = -140; dy <= 140; dy += 2) for (let dx = -140; dx <= 140; dx += 2) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (mask[py * w + px]) { const d = Math.hypot(dx, dy); if (d < best) best = d; }
  }
  return best;
}
function waterFrac(bg, x, y) {
  const { water, im } = bg, w = im.w, h = im.h;
  let c = 0, n = 0;
  for (let dy = -12; dy <= 12; dy += 3) for (let dx = -12; dx <= 12; dx += 3) {
    const px = Math.round(x + dx), py = Math.round(y + dy);
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    n++; if (water[py * w + px]) c++;
  }
  return n ? c / n : 0;
}

console.log('塔位集 -> 最匹配的背景图（得分=路边空地且非水的塔位比例）');
for (const srcLid of LIDS) {
  const slots = RS[srcLid] || [];
  const scores = [];
  for (const bgLid of LIDS) {
    const bg = BGS[bgLid];
    let good = 0;
    for (const s of slots) {
      const x = s.x / SX, y = s.y / SY;
      const dr = distRoad(bg, x, y);
      const wf = waterFrac(bg, x, y);
      if (dr >= 18 && dr <= 120 && wf < 0.25) good++;
    }
    scores.push({ lid: bgLid, good, frac: good / slots.length });
  }
  scores.sort((a, b) => b.frac - a.frac);
  const top = scores.slice(0, 4).map(s => s.lid + ':' + (s.frac * 100).toFixed(0) + '%').join(' ');
  const self = scores.find(s => s.lid === srcLid);
  console.log(srcLid + ' (' + slots.length + '塔) -> Top: ' + top + '  | 本关bg_' + srcLid + '=' + (self.frac * 100).toFixed(0) + '%');
}
