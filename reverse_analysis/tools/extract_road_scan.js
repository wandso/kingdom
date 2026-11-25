// 稳健方案：逐x列扫描土路段，因道路从右向左单调延伸，直接取每段土路中心构造中心线
const fs=require('fs');
const {readPNG,writePNG}=require('./pnglib');
const LID=(process.argv[2]||'01').padStart(2,'0');
const img=readPNG(`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`);
const {w,h,data}=img;
const road=new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];road[y*w+x]=(r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65)?1:0;}

// 对某x列，返回土路段 [{y0,y1,center}]，过滤掉太短的噪点
function segsAtX(x,minLen=14){const segs=[];let st=-1;
  for(let y=0;y<h;y++){if(road[y*w+x]){if(st<0)st=y;}else{if(st>=0){if(y-st>=minLen)segs.push({y0:st,y1:y-1,c:(st+y-1)/2});st=-1;}}}
  if(st>=0&&h-st>=minLen)segs.push({y0:st,y1:h-1,c:(st+h-1)/2});
  return segs;
}
// 打印关键列的段，理解路网
for(const x of [1270,1200,1100,1000,950,900,880,860,840,820,800,780,760,740,700,650,600,550,500,450,400,350,300,250,200,150,100,50,5]){
  console.log(`x=${x}: ${segsAtX(x).map(s=>`[${s.y0}-${s.y1} c${s.c.toFixed(0)}]`).join(' ')}`);
}
fs.writeFileSync(`D:/xyh/game/kingdom/_shots/road_segs_${LID}.json`,JSON.stringify({w,h}));
