// 生成纯土路掩码可视化（黑底白路），用于评估掩码质量与连通性
const { readPNG, writePNG } = require('./pnglib');
const img = readPNG('D:/xyh/game/kingdom/kro-minigame/assets/stages/bg_01.png');
const { w, h, data } = img;
function isRoad(x, y) {
  if (x<0||y<0||x>=w||y>=h) return false;
  const i=(y*w+x)*4, r=data[i], g=data[i+1], b=data[i+2];
  return r>200 && g>175 && b>105 && b<200 && (r-b)>30 && Math.abs(r-g)<65;
}
const out = Buffer.alloc(w*h*4);
for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
  const i=(y*w+x)*4, on=isRoad(x,y);
  out[i]=on?255:20; out[i+1]=on?255:20; out[i+2]=on?255:20; out[i+3]=255;
}
writePNG('D:/xyh/game/kingdom/_shots/mask_view_01.png', out, w, h);
// BFS 连通性：从右侧上下入口能否到达左侧出口
const visited=new Uint8Array(w*h), q=new Int32Array(w*h);
function bfs(sx,sy){
  visited.fill(0);let head=0,tail=0;const s=sy*w+sx;q[tail++]=s;visited[s]=1;
  while(head<tail){const c=q[head++],cx=c%w,cy=(c/w)|0;
    for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=cx+dx,ny=cy+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=ny*w+nx;if(!visited[ni]&&isRoad(nx,ny)){visited[ni]=1;q[tail++]=ni;}}
  }
  // 是否到达左边界
  let reachLeft=false,maxX=0;for(let i=head-1;i>=0;i--){const c=q[i],cx=c%w;if(cx<=5)reachLeft=true;if(cx>maxX)maxX=cx;}
  return {count:tail,reachLeft,maxX};
}
console.log('右下入口(1270,544):',JSON.stringify(bfs(1270,544)));
console.log('右上入口(1270,140):',JSON.stringify(bfs(1270,140)));
console.log('左出口(5,360):',JSON.stringify(bfs(5,360)));
