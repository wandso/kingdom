// 关键验证：把关卡N的lua路径画到所有背景图上，找真正匹配该路径的背景图（排查关卡号错位）
const fs=require('fs');
const {readPNG}=require('./pnglib');
const RP=require('../../kro-minigame/js/real_paths_full.json');
const SX=1000/1280,SY=600/698;
const LID=(process.argv[2]||'01').padStart(2,'0');
const pts=[];for(const c of RP[LID].curves)for(const p of c.mapped)pts.push({x:p.x/SX,y:p.y/SY});
function roadMask(im){const m=new Uint8Array(im.w*im.h);for(let y=0;y<im.h;y++)for(let x=0;x<im.w;x++){const i=(y*im.w+x)*4,r=im.data[i],g=im.data[i+1],b=im.data[i+2];m[y*im.w+x]=(r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65)?1:0;}return m;}
function fitRate(im,m){let on=0,tot=0;for(const p of pts){const x=Math.round(p.x),y=Math.round(p.y);if(x<0||x>=im.w||y<0||y>=im.h)continue;let hit=0;for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<im.w&&yy>=0&&yy<im.h&&m[yy*im.w+xx])hit++;}tot++;if(hit>0)on++;}return tot?on/tot:0;}
const results=[];
for(let n=1;n<=22;n++){const id=String(n).padStart(2,'0');let f=`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${id}.png`;if(!fs.existsSync(f))f=`D:/xyh/game/kingdom/kro-minigame/pkg_assets/stages/bg_${id}.png`;if(!fs.existsSync(f))continue;
  const im=readPNG(f),m=roadMask(im);results.push({id,rate:fitRate(im,m)});
}
results.sort((a,b)=>b.rate-a.rate);
console.log(`关卡${LID}路径 vs 各背景图贴合率(降序前8):`);
results.slice(0,8).forEach(r=>console.log(`  bg_${r.id}: ${(r.rate*100).toFixed(1)}%`));
