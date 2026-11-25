// 从背景土路逐x扫描中心线，生成两条贴合土路的敌人路径（Y形：上入口/下入口 → 汇合 → 左出口）
// 输出覆盖 real_paths_full.json 的 mapped 坐标（引擎1000x600逻辑坐标），保留原路径条数结构
const fs=require('fs');
const {readPNG,writePNG}=require('./pnglib');
const {buildRoadMask}=require('./roadlib');
const LID=(process.argv[2]||'01').padStart(2,'0');
const SX=1000/1280,SY=600/698;
const fs2=require('fs');
let bgPath=`D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_${LID}.png`;
if(!fs2.existsSync(bgPath))bgPath=`D:/xyh/game/kingdom/kro-minigame/pkg_assets/stages/bg_${LID}.png`;
const img=readPNG(bgPath);
const {w,h,data}=img;
const road=buildRoadMask(img).mask;
function segsAtX(x,minLen=14){const segs=[];let st=-1;
  for(let y=0;y<h;y++){if(road[y*w+x]){if(st<0)st=y;}else{if(st>=0){if(y-st>=minLen)segs.push({y0:st,y1:y-1,c:(st+y-1)/2});st=-1;}}}
  if(st>=0&&h-st>=minLen)segs.push({y0:st,y1:h-1,c:(st+h-1)/2});
  return segs;
}
// 从右到左逐x采样。对每一列：若有2段=上下分叉，若1段=主路
// 追踪两条 lane：lane0=下路(入口y≈550), lane1=上路(入口y≈140)，汇合后都走主路
const step=6;
const samples=[];
for(let x=w-3;x>=0;x-=step) samples.push({x,segs:segsAtX(x)});

function nearestSeg(segs,targetY){if(!segs.length)return null;let b=segs[0],bd=1e9;for(const s of segs){const d=Math.abs(s.c-targetY);if(d<bd){bd=d;b=s;}}return {seg:b,dist:bd};}

// 追踪：从右入口出发，维护上/下两条当前y，跟随最接近的段中心
function trace(startY){
  const pts=[];let cy=startY;
  for(const s of samples){
    const n=nearestSeg(s.segs,cy);
    if(n&&n.dist<120){cy=n.seg.c;pts.push({x:s.x,y:cy});}
    else if(n){cy=n.seg.c;pts.push({x:s.x,y:cy});} // 跟随最近的
  }
  return pts;
}
// 入口y从最右列段取
const firstSegs=samples[0].segs;
console.log('最右列段:',JSON.stringify(firstSegs.map(s=>s.c.toFixed(0))));
// 两条入口：上(最小y)、下(最大y)
const sorted=[...firstSegs].sort((a,b)=>a.c-b.c);
const upY=sorted[0].c, downY=sorted[sorted.length-1].c;
console.log('上入口y=',upY.toFixed(0),' 下入口y=',downY.toFixed(0));
let pUp=trace(upY), pDown=trace(downY);

// 平滑：移动平均消除逐列中心抖动
function smooth(pts,win=6){const out=[];for(let i=0;i<pts.length;i++){let sy=0,n=0;for(let k=-win;k<=win;k++){const j=i+k;if(j>=0&&j<pts.length){sy+=pts[j].y;n++;}}out.push({x:pts[i].x,y:sy/n});}return out;}
pUp=smooth(pUp);pDown=smooth(pDown);
// 抽稀：每5点取1
function thin(pts,every=5){return pts.filter((_,i)=>i%every===0||i===pts.length-1);}
const pUpT=thin(pUp),pDownT=thin(pDown);
console.log('上路点数',pUpT.length,'首',JSON.stringify(pUpT[0]),'尾',JSON.stringify(pUpT[pUpT.length-1]));
console.log('下路点数',pDownT.length,'首',JSON.stringify(pDownT[0]),'尾',JSON.stringify(pDownT[pDownT.length-1]));
// 映射为引擎逻辑坐标；屏幕外入口点保留 x 略>1000（模拟原作屏外刷怪）
function toMapped(pts){return pts.map(p=>({x:Math.round(p.x*SX*10)/10,y:Math.round(p.y*SY*10)/10}));}
// 检查贴合率（用原始像素坐标）
function fitRate(pts){let on=0,tot=0;for(const p of pts){let cnt=0;for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const x=Math.round(p.x)+dx,y=Math.round(p.y)+dy;if(x>=0&&x<w&&y>=0&&y<h&&road[y*w+x])cnt++;}tot++;if(cnt>0)on++;}return (on/tot*100).toFixed(1);}
console.log('上路贴合率',fitRate(pUp)+'%','下路贴合率',fitRate(pDown)+'%');

const out={up:pUpT,down:pDownT,upMapped:toMapped(pUpT),downMapped:toMapped(pDownT)};
fs.writeFileSync(`D:/xyh/game/kingdom/_shots/road_centerline_${LID}.json`,JSON.stringify(out));

// 可视化
for(const[pts,col]of[[pUpT,[255,0,0]],[pDownT,[0,80,255]]]){
  for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];const st=Math.ceil(Math.hypot(b.x-a.x,b.y-a.y));for(let s=0;s<=st;s++){const x=Math.round(a.x+(b.x-a.x)*s/st),y=Math.round(a.y+(b.y-a.y)*s/st);if(x<0||y<0||x>=w||y>=h)continue;const k=(y*w+x)*4;data[k]=col[0];data[k+1]=col[1];data[k+2]=col[2];}}
}
writePNG(`D:/xyh/game/kingdom/_shots/road_centerline_${LID}.png`,data,w,h);
console.log('输出 road_centerline_'+LID+'.png');
