// 从背景图精确修正塔位 v2：Lua塔位作区域种子，吸附到最近的路边平整空地
// 关键改进：用"局部纹理(空地平坦) + 紧邻真实路径 + 排除高饱和水/水晶/深绿树林"
// 保留原作每关塔位数量（不做会丢点的NMS，仅对吸附后重合点做微调）
// 用法: node refine_slots.js [lid ...]   不带参数则处理全部并写 real_slots_refined.json
const fs = require('fs');
const path = require('path');
const { readPNG, writePNG } = require('./pnglib');
const RP = require('../../kro-minigame/js/real_paths_data');
const ROOT = 'D:/xyh/game/kingdom/';
const DECOMP = ROOT + 'reverse_analysis/decompiled/levels/';
const SX = 1000/1280, SY = 600/698;

function extractRawSlots(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const slots = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/holder_id/.test(lines[i])) continue;
    let start = i;
    while (start > 0 && !/\{\s*$/.test(lines[start])) start--;
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
function bgPath(lid) {
  let f = ROOT + 'kro-minigame/assets/stages/bg_' + lid + '.png';
  if (!fs.existsSync(f)) f = ROOT + 'kro-minigame/pkg_assets/stages/bg_' + lid + '.png';
  return fs.existsSync(f) ? f : null;
}
// 障碍判定（用于排除），返回 true=不可建
// 关键：区分"深水/水晶/密林"与"浅色雪路/土路/草地"
function isObstacle(r,g,b) {
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),v=mx,s=mx?(mx-mn)/mx:0;
  // 深绿密林：明显偏绿、中等亮度、高饱和
  if (g>r+18 && g>b+10 && g<175 && s>0.3) return true;
  // 深蓝水：b明显>r，中等亮度（排除很亮的浅蓝雪路 v>215）
  if (b>r+30 && g>r+12 && v<215 && s>0.12) return true;
  // 紫水晶：r、b都高，g明显低
  if (r>125 && b>125 && g<r-20 && g<b-15) return true;
  return false;
}
function pathsToBg(lid) {
  return (RP[lid].curves || []).map(c => c.mapped.map(p => ({ x: p.x/SX, y: p.y/SY })));
}
// 点到所有路径的最近距离与最近点
function nearestPath(px, py, pathsBg) {
  let best=1e9, bpt=null;
  for (const pth of pathsBg) for (let i=1;i<pth.length;i++) {
    const a=pth[i-1],b=pth[i],dx=b.x-a.x,dy=b.y-a.y,L=dx*dx+dy*dy||1;
    let t=((px-a.x)*dx+(py-a.y)*dy)/L;t=Math.max(0,Math.min(1,t));
    const qx=a.x+t*dx,qy=a.y+t*dy,dd=Math.hypot(px-qx,py-qy);
    if(dd<best){best=dd;bpt={x:qx,y:qy};}
  }
  return { d: best, pt: bpt };
}
// 评估候选点：周围障碍占比 + 纹理平坦度
function evalSpot(im,x,y){
  const w=im.w,h=im.h,d=im.data;
  let n=0,bad=0,sum=0,sum2=0;
  for(let dy=-8;dy<=8;dy+=2)for(let dx=-8;dx<=8;dx+=2){
    const px=Math.round(x+dx),py=Math.round(y+dy);
    if(px<0||py<0||px>=w||py>=h)continue;
    n++;const i=(py*w+px)*4;
    if(isObstacle(d[i],d[i+1],d[i+2]))bad++;
    const lum=0.3*d[i]+0.59*d[i+1]+0.11*d[i+2];sum+=lum;sum2+=lum*lum;
  }
  if(!n)return{bad:1,std:99};
  const mean=sum/n;
  return{bad:bad/n,std:Math.sqrt(Math.max(0,sum2/n-mean*mean))};
}
function refine(lid){
  const bf=bgPath(lid);if(!bf)return null;
  const im=readPNG(bf),w=im.w,h=im.h;
  const pathsBg=pathsToBg(lid);
  const raw=extractRawSlots(path.join(DECOMP,'level'+lid+'_data.lua'));
  const out=[];
  for(const seed of raw){
    // 先把种子按当前映射画到背景像素，再在其周围搜索
    const seedBx=seed.x, seedBy=seed.y; // raw 已是背景量级坐标
    let best=null;
    for(let dy=-150;dy<=150;dy+=5)for(let dx=-150;dx<=150;dx+=5){
      const sx=seedBx+dx,sy=seedBy+dy;
      if(sx<25||sy<25||sx>=w-25||sy>=h-25)continue;
      const np=nearestPath(sx,sy,pathsBg);
      if(np.d<22||np.d>90)continue;        // 紧邻路
      const e=evalSpot(im,sx,sy);
      if(e.bad>0.22)continue;              // 周围障碍少
      const move=Math.hypot(dx,dy);
      // 评分：障碍少、平坦、离种子近、距路~50px
      const score=-e.bad*5-e.std/25-move/110-Math.abs(np.d-50)/100;
      if(!best||score>best.score)best={x:sx,y:sy,score,dr:np.d,bad:e.bad,std:e.std,move};
    }
    if(best){
      out.push({x:Math.round(best.x*SX),y:Math.round(best.y*SY),seed:seed,dr:Math.round(best.dr),bad:+best.bad.toFixed(2),std:+best.std.toFixed(1),move:Math.round(best.move)});
    }else{
      // fallback：沿种子到最近路方向，把种子推到路边50px的可建点
      const np=nearestPath(seedBx,seedBy,pathsBg);
      let fx=seedBx,fy=seedBy,fallback=true;
      if(np.pt){
        const vx=seedBx-np.pt.x,vy=seedBy-np.pt.y,vl=Math.hypot(vx,vy)||1;
        // 若种子离路太近(<22)或太远(>90)，推到50px
        const target=Math.min(90,Math.max(30,np.d));
        fx=np.pt.x+vx/vl*target;fy=np.pt.y+vy/vl*target;
        // 检查该点是否障碍，若是则沿路找附近
        const e=evalSpot(im,fx,fy);
        if(e.bad<0.25)fallback=false;
      }
      out.push({x:Math.round(fx*SX),y:Math.round(fy*SY),seed:seed,fallback:fallback});
    }
  }
  return {lid,slots:out,rawCount:raw.length};
}

const args=process.argv.slice(2);
const lids=args.length?args:Object.keys(RP).filter(k=>/^\d+$/.test(k)&&bgPath(k)).sort();
const results=[];
for(const lid of lids){
  const r=refine(lid);if(!r)continue;results.push(r);
  const moved=r.slots.filter(s=>!s.fallback&&s.move>8).length;
  const fb=r.slots.filter(s=>s.fallback).length;
  const avgDr=(()=>{const a=r.slots.filter(s=>s.dr);return a.length?(a.reduce((x,s)=>x+s.dr,0)/a.length).toFixed(0):'-';})();
  console.log(lid+': n='+r.slots.length+' 移动>8px='+moved+' fallback='+fb+' 平均距路='+avgDr);
  // 叠加图
  const im=readPNG(bgPath(lid)),w=im.w,h=im.h,data=im.data;
  function ring(cx,cy,rr,col,t){for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){const q=dx*dx+dy*dy;if(q>rr*rr||q<(rr-t)*(rr-t))continue;const x=Math.round(cx)+dx,y=Math.round(cy)+dy;if(x<0||y<0||x>=w||y>=h)continue;const i=(y*w+x)*4;data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];}}
  function solid(cx,cy,rr,col){for(let dy=-rr;dy<=rr;dy++)for(let dx=-rr;dx<=rr;dx++){if(dx*dx+dy*dy>rr*rr)continue;const x=Math.round(cx)+dx,y=Math.round(cy)+dy;if(x<0||y<0||x>=w||y>=h)continue;const i=(y*w+x)*4;data[i]=col[0];data[i+1]=col[1];data[i+2]=col[2];}}
  for(const s of r.slots)ring(s.x/SX,s.y/SY,13,[255,220,0],3);
  for(const s of r.slots)solid(s.seed.x,s.seed.y,3,[255,0,0]);
  writePNG(ROOT+'_shots/slots_refined_'+lid+'.png',data,w,h);
}
if(args.length===0){
  const outObj={};
  for(const r of results){
    outObj[r.lid]=r.slots.map(s=>({x:s.x,y:s.y,rally:{x:s.x,y:Math.min(596,s.y+55)}}));
  }
  fs.writeFileSync(ROOT+'kro-minigame/js/real_slots_refined.json',JSON.stringify(outObj));
  console.log('\n已写 real_slots_refined.json');
}
