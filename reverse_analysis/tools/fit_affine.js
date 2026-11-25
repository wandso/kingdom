// 搜索最优仿射 y' = a*y + b，使lua路径贴合背景土路
const {readPNG}=require('./pnglib');
const RP=require('../../kro-minigame/js/real_paths_full.json');
const SX=1000/1280,SY=600/698;
const img=readPNG('D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_01.png');
const {w,h,data}=img;
const road=new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];road[y*w+x]=(r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65)?1:0;}
// 收集lua原始坐标点（背景像素空间）
const pts=[];for(const c of RP['01'].curves)for(const p of c.mapped)pts.push({x:p.x/SX,y:p.y/SY});
function fit(a,b){let on=0,tot=0;for(const p of pts){const x=Math.round(p.x),y=Math.round(a*p.y+b);if(x<0||x>=w||y<0||y>=h)continue;let hit=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&road[yy*w+xx])hit++;}tot++;if(hit>0)on++;}return tot?on/tot:0;}
let best={s:0,a:1,b:0};
for(let a=0.5;a<=1.5;a+=0.02)for(let b=-150;b<=250;b+=5){const s=fit(a,b);if(s>best.s)best={s,a,b};}
console.log('最优仿射: y\' = ',best.a.toFixed(3),'* y +',best.b,' 贴合率',(best.s*100).toFixed(1)+'%');
console.log('恒等(a=1,b=0):',(fit(1,0)*100).toFixed(1)+'%',' Y翻转(a=-1,b=698):',(fit(-1,698)*100).toFixed(1)+'%');
// 分段拟合：x>900(右段) 和 400<x<800(中段) 分别最优
function fitRange(a,b,x0,x1){let on=0,tot=0;for(const p of pts){if(p.x<x0||p.x>x1)continue;const x=Math.round(p.x),y=Math.round(a*p.y+b);if(x<0||x>=w||y<0||y>=h)continue;let hit=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&road[yy*w+xx])hit++;}tot++;if(hit>0)on++;}return tot?on/tot:0;}
for(const[x0,x1,name]of[[900,1280,'右段'],[400,800,'中段'],[0,400,'左段']]){
  let bb={s:0,a:1,b:0};for(let a=-1.5;a<=1.5;a+=0.05)for(let b=-400;b<=800;b+=10){const s=fitRange(a,b,x0,x1);if(s>bb.s)bb={s,a,b};}
  console.log(name,'最优 a=',bb.a.toFixed(2),'b=',bb.b,'贴合',(bb.s*100).toFixed(0)+'%');
}
