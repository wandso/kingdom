// 精确对比：同一x处，lua路径点y vs 土路掩码中心y，寻找最优仿射映射
const fs=require('fs');
const {readPNG}=require('./pnglib');
const RP=require('../../kro-minigame/js/real_paths_full.json');
const img=readPNG('D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_01.png');
const {w,h,data}=img;
function isRoad(x,y){if(x<0||y<0||x>=w||y>=h)return false;const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];return r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65;}
// 对每个x，找土路所有段的中心
function roadCenters(x){const segs=[];let st=-1;for(let y=0;y<h;y++){if(isRoad(x,y)){if(st<0)st=y;}else{if(st>=0){if(y-st>8)segs.push((st+y-1)/2);st=-1;}}}if(st>=0)segs.push((st+h-1)/2);return segs;}
// lua 原始坐标（反算：从mapped除SX,SY还原到原始lua坐标空间=背景像素空间假设）
const SX=1000/1280,SY=600/698;
const lv=RP['01'];
for(const [pi,c] of lv.curves.entries()){
  const pts=c.mapped.map(p=>({x:p.x/SX,y:p.y/SY}));
  console.log(`\n=== path${pi}：lua原始(x,y) → 该x处土路中心y ===`);
  for(const p of pts){
    if(p.x<0||p.x>=w)continue;
    const rc=roadCenters(Math.round(p.x));
    if(!rc.length)continue;
    // 找最近的土路中心
    let best=rc[0],bd=1e9;for(const c of rc){const d=Math.abs(c-p.y);if(d<bd){bd=d;best=c;}}
    console.log(`  x=${p.x.toFixed(0)} pathY=${p.y.toFixed(0)} 土路中心=[${rc.map(c=>c.toFixed(0)).join(',')}] 最近=${best.toFixed(0)} 差=${(p.y-best).toFixed(0)}`);
  }
}
