const fs = require('fs');
const { readPNG, writePNG } = require('./pnglib');
const RS = require('../../kro-minigame/js/real_slots_data');
const ROOT = 'D:/xyh/game/kingdom/';
const SX = 1000 / 1280, SY = 600 / 698;

function crop(im, cx, cy, half, scale) {
  const sz = half * 2 * scale, out = Buffer.alloc(sz * sz * 4);
  for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
    const sx = Math.round(cx - half + x / scale), sy = Math.round(cy - half + y / scale);
    const si = (sy * im.w + sx) * 4, di = (y * sz + x) * 4;
    if (sx >= 0 && sy >= 0 && sx < im.w && sy < im.h) {
      out[di] = im.data[si]; out[di+1] = im.data[si+1]; out[di+2] = im.data[si+2]; out[di+3] = 255;
    }
  }
  return { data: out, w: sz, h: sz };
}

const lids = process.argv.slice(2).length ? process.argv.slice(2) : ['01', '09'];
for (const lid of lids) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  const im = readPNG(f);
  const slots = RS[lid].slice(0, 6);
  const half = 70, scale = 2, cs = half * 2 * scale, gap = 6, cols = 3, rows = 2;
  const GW = cols * cs + (cols + 1) * gap, GH = rows * cs + (rows + 1) * gap;
  const grid = Buffer.alloc(GW * GH * 4);
  for (let i = 0; i < grid.length; i += 4) { grid[i]=30; grid[i+1]=30; grid[i+2]=35; grid[i+3]=255; }
  slots.forEach((s, i) => {
    const bx = s.x / SX, by = s.y / SY;
    // 中心十字标记
    const sub = crop(im, bx, by, half, scale);
    const gx = gap + (i % cols) * (cs + gap), gy = gap + Math.floor(i / cols) * (cs + gap);
    for (let y = 0; y < sub.h; y++) for (let x = 0; x < sub.w; x++) {
      const px = gx + x, py = gy + y;
      if (px >= GW || py >= GH) continue;
      const si = (y * sub.w + x) * 4, di = (py * GW + px) * 4;
      grid[di]=sub.data[si]; grid[di+1]=sub.data[si+1]; grid[di+2]=sub.data[si+2];
    }
    // 画十字
    const ccx = gx + cs/2, ccy = gy + cs/2;
    for (let d = -10; d <= 10; d++) {
      for (const [dx,dy] of [[d,0],[0,d]]) {
        const px=Math.round(ccx+dx), py=Math.round(ccy+dy);
        if(px<0||py<0||px>=GW||py>=GH)continue;
        const di=(py*GW+px)*4; grid[di]=255;grid[di+1]=0;grid[di+2]=0;
      }
    }
  });
  const out = ROOT + '_shots/slots_zoom_' + lid + '.png';
  writePNG(out, grid, GW, GH);
  console.log(lid + ' -> ' + out);
}
