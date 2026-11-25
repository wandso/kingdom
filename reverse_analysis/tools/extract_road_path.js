// 从背景图土路掩码直接提取真实道路中心线（骨架化 + 图搜索）
// 输出贴合背景土路的路径点（背景像素坐标），供重新映射到引擎逻辑坐标
const fs=require('fs');
const {readPNG,writePNG}=require('./pnglib');
const LID=(process.argv[2]||'01').padStart(2,'0');
const img=readPNG(`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`);
const {w,h,data}=img;
const road=new Uint8Array(w*h);
for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4,r=data[i],g=data[i+1],b=data[i+2];
  road[y*w+x]=(r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65)?1:0;
}
console.log('土路像素',road.reduce((a,b)=>a+b,0));

// 形态学膨胀填补小洞（3x3），让路网连续
function dilate(src){const d=new Uint8Array(w*h);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){if(src[y*w+x]){for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)d[(y+dy)*w+x+dx]=1;}}return d;}
const roadD=dilate(dilate(road));

// 距离变换（到非路像素的距离）→ 用于找骨架中心（路越宽中心dist越大）
const INF=1e9,dist=new Float32Array(w*h).fill(INF);const q=new Int32Array(w*h);let qh=0,qt=0;
for(let y=0;y<h;y++)for(let x=0;x<w;x++){if(!roadD[y*w+x]){dist[y*w+x]=0;q[qt++]=y*w+x;}}
while(qh<qt){const c=q[qh++],cx=c%w,cy=(c/w)|0,d=dist[c]+1;
  for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(dist[ni]>d){dist[ni]=d;q[qt++]=ni;}}}

// 找入口点：右边界(x>=w-3)的路段中心y；出口：左边界
function boundaryCenters(side){const ys=[];const x0=side==='right'?w-3:2;
  for(let y=0;y<h;y++){let cnt=0;for(let x=x0;side==='right'?x<w:x<=x0+1;x+=side==='right'?1:-1)cnt+=road[y*w+x];if(cnt>0)ys.push(y);}
  const segs=[];let st=-1,prev=-2;for(const y of ys){if(y!==prev+1){if(st>=0&&prev-st>5)segs.push([st,prev]);st=y;}prev=y;}if(st>=0&&prev-st>5)segs.push([st,prev]);
  return segs.map(s=>({y:Math.round((s[0]+s[1])/2),y0:s[0],y1:s[1]}));
}
const entries=boundaryCenters('right'),exits=boundaryCenters('left');
console.log('右侧入口候选:',JSON.stringify(entries),' 左侧出口:',JSON.stringify(exits));

// Dijkstra：在土路上从起点到终点，代价=路径长度 - 中心奖励（优先走路中心dist大的地方）
function shortest(start,goal){
  const cost=new Float32Array(w*h).fill(INF),prev=new Int32Array(w*h).fill(-1);
  const S=start[1]*w+start[0],G=goal[1]*w+goal[0];cost[S]=0;
  // 简易二叉堆
  const heap=[];function push(n,c){heap.push([c,n]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}}
  function pop(){const top=heap[0],last=heap.pop();if(heap.length){heap[0]=last;let i=0;for(;;){let l=2*i+1,r=l+1,m=i;if(l<heap.length&&heap[l][0]<heap[m][0])m=l;if(r<heap.length&&heap[r][0]<heap[m][0])m=r;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m;}}return top;}
  push(S,0);
  let iter=0;
  while(heap.length&&iter++<2e6){const [c,cur]=pop();if(c>cost[cur]+1e-6)continue;if(cur===G)break;
    const cx=cur%w,cy=(cur/w)|0;
    for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(!roadD[ni])continue;
      const step=Math.hypot(dx,dy);
      const centerBonus=Math.max(0,8-dist[ni])*0.35; // dist<8的边缘加惩罚
      const nc=c+step+centerBonus;
      if(nc<cost[ni]){cost[ni]=nc;prev[ni]=cur;push(ni,nc);}
    }
  }
  if(cost[G]>=INF)return null;
  const path=[];let c=G;while(c>=0){path.push({x:c%w,y:(c/w)|0});c=prev[c];}path.reverse();return path;
}

const exit=exits.reduce((a,b)=>Math.abs(b.y-360)<Math.abs(a.y-360)?b:a,exits[0]);
const goal=[2,exit.y];
const results=[];
for(const e of entries){
  const p=shortest([w-3,e.y],goal);
  if(!p){console.log('入口y='+e.y+' 无路径');continue;}
  // 平滑+抽稀：每6点取1
  const simp=p.filter((_,i)=>i%6===0||i===p.length-1);
  results.push(simp);
  console.log(`入口y=${e.y} 路径点${p.length}→抽稀${simp.length} 首=${JSON.stringify(simp[0])} 尾=${JSON.stringify(simp[simp.length-1])}`);
}
fs.writeFileSync(`D:/xyh/game/kingdom/_shots/road_extracted_${LID}.json`,JSON.stringify(results));
// 可视化
for(const [pi,pts] of results.entries()){const col=pi===0?[255,0,0]:[0,80,255];for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];const st=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));for(let s=0;s<=st;s++){const x=Math.round(a.x+(b.x-a.x)*s/st),y=Math.round(a.y+(b.y-a.y)*s/st);if(x<0||y<0||x>=w||y>=h)continue;const i2=(y*w+x)*4;data[i2]=col[0];data[i2+1]=col[1];data[i2+2]=col[2];}}}
writePNG(`D:/xyh/game/kingdom/_shots/road_extracted_${LID}.png`,data,w,h);
