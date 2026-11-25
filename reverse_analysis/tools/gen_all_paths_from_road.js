// 批量：从每关背景图土路提取中心线，生成贴合土路的路径，写回 real_paths_full.json
// 保持每关原路径条数（波次 path_index 需要），多条路径 = 主路径的轻微车道偏移
const fs=require('fs');
const {readPNG}=require('./pnglib');
const {buildRoadMask}=require('./roadlib');
const OUT='D:/xyh/game/kingdom/kro-minigame/js/real_paths_full.json';
const SX=1000/1280,SY=600/698;
const RP=JSON.parse(fs.readFileSync(OUT,'utf8'));

function bgPath(id){let p=`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${id}.png`;if(!fs.existsSync(p))p=`D:/xyh/game/kingdom/kro-minigame/pkg_assets/stages/bg_${id}.png`;return fs.existsSync(p)?p:null;}

function segsAtX(road,w,h,x,minLen=14){const segs=[];let st=-1;
  for(let y=0;y<h;y++){if(road[y*w+x]){if(st<0)st=y;}else{if(st>=0){if(y-st>=minLen)segs.push({c:(st+y-1)/2});st=-1;}}}
  if(st>=0&&h-st>=minLen)segs.push({c:(st+h-1)/2});
  return segs;
}
function extractCenterlines(img){
  const {w,h}=img,road=buildRoadMask(img).mask;
  const samples=[];for(let x=w-3;x>=0;x-=6)samples.push({x,segs:segsAtX(road,w,h,x)});
  const first=samples[0].segs.sort((a,b)=>a.c-b.c);
  if(!first.length)return null;
  const upY=first[0].c,downY=first[first.length-1].c;
  const dual=first.length>1&&(downY-upY)>60;
  function trace(startY){const pts=[];let cy=startY;for(const s of samples){if(!s.segs.length){pts.push({x:s.x,y:cy});continue;}let b=s.segs[0],bd=1e9;for(const g of s.segs){const d=Math.abs(g.c-cy);if(d<bd){bd=d;b=g;}}cy=b.c;pts.push({x:s.x,y:cy});}return pts;}
  function smooth(pts,win=6){return pts.map((p,i)=>{let sy=0,n=0;for(let k=-win;k<=win;k++){const j=i+k;if(j>=0&&j<pts.length){sy+=pts[j].y;n++;}}return{x:p.x,y:sy/n};});}
  function thin(pts,every=5){return pts.filter((_,i)=>i%every===0||i===pts.length-1);}
  let lines;
  if(dual){lines=[trace(downY),trace(upY)];}else{lines=[trace(upY)];}
  // 贴合率自检
  function fitRate(pts){let on=0,tot=0;for(const p of pts){const x=Math.round(p.x),y=Math.round(p.y);if(x<0||x>=w||y<0||y>=h)continue;let hit=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<w&&yy>=0&&yy<h&&road[yy*w+xx])hit++;}tot++;if(hit>0)on++;}return tot?on/tot:0;}
  return lines.map(l=>{const s=thin(smooth(l));return{pts:s,rate:fitRate(s)};});
}

let okCount=0,failCount=0;const log=[];
for(const id of Object.keys(RP).sort()){
  const p=bgPath(id);const N=RP[id].curves.length;
  if(!p){console.log(id,'无背景图，跳过');continue;}
  const lines=extractCenterlines(readPNG(p));
  if(!lines){console.log(id,'道路提取失败');failCount++;continue;}
  const avgRate=lines.reduce((a,l)=>a+l.rate,0)/lines.length;
  // 生成 N 条路径：主路径循环分配 + 轻微车道偏移
  const curves=[];
  for(let i=0;i<N;i++){
    const base=lines[i%lines.length].pts;
    const lane=(Math.floor(i/lines.length)-(N/lines.length-1)/2)*6; // 车道偏移±
    const mapped=base.map(pt=>({x:Math.round(pt.x*SX*10)/10,y:Math.round((pt.y+lane)*SY*10)/10}));
    // 起点向屏外延伸（右入口 x>1000），终点向屏外延伸（左出口 x<0），让敌人完整进出屏幕
    if(mapped.length>=2){
      const a=mapped[0],b=mapped[1];
      const dx=a.x-b.x,dy=a.y-b.y,len=Math.hypot(dx,dy)||1;
      mapped.unshift({x:Math.round((a.x+dx/len*40)*10)/10,y:Math.round((a.y+dy/len*40)*10)/10});
      const c=mapped[mapped.length-1],d=mapped[mapped.length-2];
      const ex=c.x-d.x,ey=c.y-d.y,elen=Math.hypot(ex,ey)||1;
      mapped.push({x:Math.round((c.x+ex/elen*40)*10)/10,y:Math.round((c.y+ey/elen*40)*10)/10});
    }
    curves.push({mapped});
  }
  RP[id].curves=curves;
  RP[id].paths=curves.map(c=>c.mapped);
  const tag=avgRate>=0.85?'OK':(avgRate>=0.6?'WARN':'FAIL');
  log.push(`${id} N=${N} 入口=${lines.length} 贴合=${(avgRate*100).toFixed(0)}% ${tag}`);
  if(avgRate>=0.85)okCount++;else if(avgRate<0.6)failCount++;
}
fs.writeFileSync(OUT,JSON.stringify(RP));
console.log(log.join('\n'));
console.log(`\n完成: OK=${okCount} FAIL=${failCount} 总计=${Object.keys(RP).length}`);
