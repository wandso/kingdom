// 对比验证：原映射 vs Y翻转映射，哪条路径贴合背景土路
const fs=require('fs');
const {readPNG,writePNG}=require('./pnglib');
const RP=require('../../kro-minigame/js/real_paths_full.json');
const LID=(process.argv[2]||'01').padStart(2,'0');
const SX=1000/1280,SY=600/698;
const img=readPNG(`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`);
const {w,h,data}=img;
function isRoad(x,y){if(x<0||y<0||x>=w||y>=h)return false;const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];return r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65;}
const lv=RP[LID];
function draw(pts,col,r){for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];const d=Math.hypot(b.x-a.x,b.y-a.y),st=Math.max(1,Math.ceil(d/2));for(let s=0;s<=st;s++){const x=Math.round(a.x+(b.x-a.x)*s/st),y=Math.round(a.y+(b.y-a.y)*s/st);if(x<0||y<0||x>=w||y>=h)continue;for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){if(dx*dx+dy*dy>r*r)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const i=(yy*w+xx)*4;data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];}}}}
// 先统计贴合率（像素未被覆盖）
lv.curves.forEach((c,ci)=>{
  const orig=c.mapped.map(p=>({x:p.x/SX,y:p.y/SY}));
  const flip=c.mapped.map(p=>({x:p.x/SX,y:h-p.y/SY}));
  for(const [tag,pts] of [['原映射',orig],['Y翻转',flip]]){
    let on=0,tot=0;
    for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];const d=Math.hypot(b.x-a.x,b.y-a.y),st=Math.max(1,Math.ceil(d/2));for(let s=0;s<=st;s++){const x=Math.round(a.x+(b.x-a.x)*s/st),y=Math.round(a.y+(b.y-a.y)*s/st);if(x>=0&&x<w&&y>=0&&y<h){tot++;if(isRoad(x,y))on++;}}}
    console.log(`path${ci} ${tag}贴合率: ${(on/tot*100).toFixed(1)}% (${on}/${tot})`);
  }
});
// 再画图
lv.curves.forEach((c,ci)=>{
  const orig=c.mapped.map(p=>({x:p.x/SX,y:p.y/SY}));
  const flip=c.mapped.map(p=>({x:p.x/SX,y:h-p.y/SY}));
  const col=ci===0?[255,0,0]:[0,80,255];
  draw(orig,[255,0,255],1); // 洋红=原映射
  draw(flip,col,2);         // 红/蓝=翻转后
});
writePNG(`D:/xyh/game/kingdom/_shots/overlay_flip_${LID}.png`,data,w,h);
console.log('输出 overlay_flip_'+LID+'.png  红/蓝=Y翻转后  洋红=原映射');
