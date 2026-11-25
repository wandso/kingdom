// 扫描背景图：对每个给定x列，输出土路像素的y区间（分段），用于精确测量土路走向
const { readPNG } = require('./pnglib');
const img = readPNG('D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_01.png');
const { w, h, data } = img;
function isRoad(x, y) {
  if (x<0||y<0||x>=w||y>=h) return false;
  const i=(y*w+x)*4, r=data[i], g=data[i+1], b=data[i+2];
  return r>200 && g>175 && b>105 && b<200 && (r-b)>30 && Math.abs(r-g)<65;
}
function roadSegsAtX(x){
  const segs=[]; let st=-1;
  for(let y=0;y<h;y++){
    if(isRoad(x,y)){ if(st<0)st=y; }
    else { if(st>=0){ if(y-st>6)segs.push([st,y-1]); st=-1; } }
  }
  if(st>=0)segs.push([st,h-1]);
  return segs.map(s=>[s[0],s[1],Math.round((s[0]+s[1])/2)]);
}
const xs=[1240,1200,1100,1000,950,900,850,800,780,760,740,700,650,600,550,500,450,400,300,200,100,0];
console.log('x 列 -> 土路段的 y 区间 [起,止,中心]');
for(const x of xs) console.log(`x=${x}: ${JSON.stringify(roadSegsAtX(x))}`);
