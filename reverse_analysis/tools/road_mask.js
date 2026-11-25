// 从背景图提取土路掩码并叠加路径，直观判断贴合度；同时输出每条路径点的着地颜色统计
const fs = require('fs');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_full.json');
const LID = (process.argv[2] || '01').padStart(2, '0');
const SX = 1000 / 1280, SY = 600 / 698;
const img = readPNG(`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`);
const { w, h, data } = img;

function isRoad(x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  const i = (y * w + x) * 4, r = data[i], g = data[i+1], b = data[i+2];
  // 土路：亮暖色，R>200 G>175 B 中低（排除草地G>>R、水面B高）
  return r > 200 && g > 175 && b > 105 && b < 195 && (r - b) > 35 && Math.abs(r - g) < 60;
}
// 先判定并统计贴合率（此时 data 仍是原始像素），再改掩码颜色
const roadPaint = [];
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isRoad(x, y)) roadPaint.push((y*w+x)*4);
function mark(x, y, col) {
  x=Math.round(x); y=Math.round(y);
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const xx=x+dx, yy=y+dy; if(xx<0||yy<0||xx>=w||yy>=h)continue;
    const i=(yy*w+xx)*4; data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];
  }
}
const lv = RP[LID];
lv.curves.forEach((c, ci) => {
  const pts = c.mapped.map(p => ({ x: p.x / SX, y: p.y / SY }));
  let onRoad = 0, total = 0;
  const col = ci === 0 ? [255,0,0] : [0,80,255];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i+1];
    const d = Math.hypot(b.x-a.x, b.y-a.y), steps = Math.max(1, Math.ceil(d/3));
    for (let s = 0; s <= steps; s++) {
      const x=a.x+(b.x-a.x)*s/steps, y=a.y+(b.y-a.y)*s/steps;
      if (x>=0&&x<w&&y>=0&&y<h){ total++; if(isRoad(x|0,y|0))onRoad++; }
    }
  }
  console.log(`path${ci}: 落在土路 ${(onRoad/total*100).toFixed(1)}% (${onRoad}/${total})`);
});
// 覆盖：土路画淡白，路径画绿=贴合/红蓝=偏离
for (const i of roadPaint) { data[i]=(data[i]+255)/2; data[i+1]=(data[i+1]+255)/2; data[i+2]=(data[i+2]+255)/2; }
lv.curves.forEach((c, ci) => {
  const pts = c.mapped.map(p => ({ x: p.x / SX, y: p.y / SY }));
  const col = ci === 0 ? [255,0,0] : [0,80,255];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i+1];
    const d = Math.hypot(b.x-a.x, b.y-a.y), steps = Math.max(1, Math.ceil(d/3));
    for (let s = 0; s <= steps; s++) {
      const x=a.x+(b.x-a.x)*s/steps, y=a.y+(b.y-a.y)*s/steps;
      mark(x, y, isRoad(x|0,y|0) ? [0,255,0] : col);
    }
  }
});
writePNG(`D:/xyh/game/kingdom/_shots/road_mask_${LID}.png`, data, w, h);
console.log('输出 road_mask_' + LID + '.png');
