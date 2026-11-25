// 穷举仿射：把关卡9的27个原始塔位映射到背景图，寻找使"落在路边空地"比例最高的线性变换
// x' = sx*x + tx, y' = sy*y + ty；先测纯缩放+平移（含翻转）
const fs = require('fs');
const { readPNG } = require('./pnglib');
const path = require('path');
const DECOMP = 'D:/xyh/game/kingdom/reverse_analysis/decompiled/levels/';
const ROOT = 'D:/xyh/game/kingdom/';
const { buildRoadMask } = require('./roadlib');

function extractRawSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const slots = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    let start = i; while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
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
const lid = process.argv[2] || '09';
const raw = extractRawSlots(path.join(DECOMP, 'level'+lid+'_data.lua'));
const bf = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
const im = readPNG(fs.existsSync(bf) ? bf : ROOT + 'kro-minigame/assets/stages/bg_'+lid+'.png');
const w = im.w, h = im.h, d = im.data;
const { mask: road } = buildRoadMask(im);
// 水掩码（深水：b明显>r且较暗或中等亮度）
const water = new Uint8Array(w*h);
for (let i=0;i<w*h;i++){const k=i*4,r=d[k],g=d[k+1],b=d[k+2];if(b>r+25&&g>r+10&&b>110)water[i]=1;}
// 水晶/紫：r,b高g低
const crystal = new Uint8Array(w*h);
for (let i=0;i<w*h;i++){const k=i*4,r=d[k],g=d[k+1],b=d[k+2];if(r>120&&b>120&&g<r-20&&g<b-15)crystal[i]=1;}

function dr(x,y){let b=1e9;for(let dy=-60;dy<=60;dy+=2)for(let dx=-60;dx<=60;dx+=2){const px=Math.round(x+dx),py=Math.round(y+dy);if(px<0||py<0||px>=w||py>=h)continue;if(road[py*w+px]){const dd=Math.hypot(dx,dy);if(dd<b)b=dd;}}return b;}
function nearBad(x,y,mask){let c=0,n=0;for(let dy=-8;dy<=8;dy+=2)for(let dx=-8;dx<=8;dx+=2){const px=Math.round(x+dx),py=Math.round(y+dy);if(px<0||py<0||px>=w||py>=h)continue;n++;if(mask[py*w+px])c++;}return n?c/n:0;}

let best=null;
const xs=raw.map(s=>s.x),ys=raw.map(s=>s.y);
const xMin=Math.min(...xs),xMax=Math.max(...xs),yMin=Math.min(...ys),yMax=Math.max(...ys);
// 目标：塔位x铺开到背景 60~w-60, y到 60~h-60
for (const flipY of [false,true]) for (const flipX of [false,true]) {
  for (let sx=(w-120)/(xMax-xMin)*0.7; sx<=(w-120)/(xMax-xMin)*1.5; sx+=0.05) {
    for (let sy=(h-120)/(yMax-yMin)*0.7; sy<=(h-120)/(yMax-yMin)*1.5; sy+=0.05) {
      let good=0,badWater=0;
      for(const s of raw){
        let nx=flipX?(xMax-s.x):(s.x-xMin);
        let ny=flipY?(yMax-s.y):(s.y-yMin);
        const px=nx*sx+60, py=ny*sy+60;
        if(px<0||py<0||px>=w||py>=h){badWater++;continue;}
        const onRoad=dr(px,py), wf=nearBad(px,py,water), cf=nearBad(px,py,crystal);
        if(onRoad>=18&&onRoad<=100&&wf<0.2&&cf<0.2)good++;
      }
      if(!best||good>best.good)best={good,flipX,flipY,sx,sy,frac:good/raw.length};
    }
  }
}
console.log(lid,'原始范围 x['+xMin+','+xMax+'] y['+yMin+','+yMax+'] n='+raw.length);
console.log('最优变换:',JSON.stringify(best));
