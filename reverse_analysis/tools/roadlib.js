// 通用道路掩码：结合暖色土路(草地关) + 冷亮浅路(雪地关) + 中饱和土路
// 返回 Uint8Array 掩码
function buildRoadMask(im){
  const {w,h,data}=im,m=new Uint8Array(w*h);
  let warm=0,cool=0;
  for(let i=0;i<w*h;i++){
    const k=i*4,r=data[k],g=data[k+1],b=data[k+2];
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),v=mx,s=mx?(mx-mn)/mx:0,span=mx-mn;
    const isWarm = r>200&&g>175&&b>105&&b<200&&(r-b)>30&&Math.abs(r-g)<65; // 浅黄沙路
    const isCool = v>185&&s<0.30&&span<72; // 冷色浅路(雪/石)
    const isTan  = r>155&&g>135&&b>105&&(r-b)>28&&(g-b)>12&&Math.abs(r-g)<48; // 偏暗土路
    if(isWarm||isCool||isTan){m[i]=1;if(isWarm)warm++;if(isCool)cool++;}
  }
  return {mask:m,warm,cool};
}
module.exports={buildRoadMask};
