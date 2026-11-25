// 从 fullhd 图集切出塔的分层部件：塔基 + 塔顶单位 + 兵营士兵
// 塔结构（REA复核确认）：塔基(go_towers-1.png) + 塔顶射手(go_towers-2/3.png)
const {readPNG,writePNG}=require('./pnglib.js');
const fs=require('fs'),path=require('path');
const ATLAS='D:/xyh/game/kingdom/reverse_analysis/atlas_fullhd';
const CFG='D:/xyh/game/kingdom/reverse_analysis/decompiled/atlas/go_towers.lua';
const OUT='D:/xyh/game/kingdom/kro-minigame/assets/sprites';
const MANIFEST='D:/xyh/game/kingdom/kro-minigame/js/sprite_manifest.js';

// 部件定义：key -> {base, maxFrames, want(取几帧), pickBy(内容量)}
const PARTS={
  // 塔基（建筑，静态，5帧取1张最饱满的）
  base_archer:   {base:'archer_towers',           atlas:'go_towers-1.png', frames:1},
  base_mage:     {base:'mage_towers_layer1',      atlas:'go_towers-1.png', frames:1},
  base_artillery:{base:'artillery_base',          atlas:'go_towers-1.png', frames:1},
  base_barracks: {base:'barracks_towers_layer1',  atlas:'go_towers-1.png', frames:1},
  // 塔顶单位（取6帧动画：远程攻击动作）
  top_archer:    {base:'archer_silver_shooter',   atlas:'go_towers-2.png', frames:6},
  top_mage:      {base:'mage_wild_shooter',       atlas:'go_towers-3.png', frames:6},
  top_artillery: {base:'artillery_thrower',       atlas:'go_towers-2.png', frames:6},
  // 兵营士兵（3人小队，取6帧：待命+出战动作）
  top_barracks:  {base:'soldiers_123',            atlas:'go_towers-3.png', frames:6},
  // 兵营二层/旗（可选装饰）
  barracks_flag: {base:'barracks_towers_layer2',  atlas:'go_towers-2.png', frames:1},
};

const txt=fs.readFileSync(CFG,'utf8');
// 解析所有 base_NNNN 的 f_quad/size/trim/a_name
const framesByBase={};
for(const m of txt.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)_(\d{4})\s*=\s*\{([\s\S]*?)\n\t\}/gm)){
  const base=m[1],frame=parseInt(m[2],10),body=m[3],nums={};
  for(const field of ['size','trim','f_quad']){
    const fm=new RegExp(field+'\\s*=\\s*\\{([^}]*)\\}').exec(body);
    if(fm)nums[field]=[...fm[1].matchAll(/-?[\d.]+/g)].map(x=>parseFloat(x[0]));
  }
  const an=/a_name\s*=\s*"([^"]+)"/.exec(body);
  if(!nums.size||!nums.trim||!nums.f_quad)continue;
  (framesByBase[base]=framesByBase[base]||[]).push({base,frame,size:nums.size,trim:nums.trim,f_quad:nums.f_quad});
}

const atlasCache={};
function getAtlas(name){
  if(atlasCache[name])return atlasCache[name];
  const p=path.join(ATLAS,name);
  if(!fs.existsSync(p))return null;
  return atlasCache[name]=readPNG(p);
}
function cutOne(cfg,atlasName){
  const atlas=getAtlas(atlasName||cfg.a_name||'go_towers-2.png');
  if(!atlas)return null;
  const [qx,qy,qw,qh]=cfg.f_quad,[sw,sh]=cfg.size,[tl,tt]=cfg.trim;
  if(qx<0||qy<0||qx+qw>atlas.w||qy+qh>atlas.h)return null;
  const data=Buffer.alloc(sw*sh*4);
  for(let y=0;y<qh;y++)for(let x=0;x<qw;x++){
    const dx=tl+x,dy=tt+y;if(dx>=sw||dy>=sh||dx<0||dy<0)continue;
    const si=((qy+y)*atlas.w+(qx+x))*4,di=(dy*sw+dx)*4;
    atlas.data.copy(data,di,si,si+4);
  }
  return {data,w:sw,h:sh};
}
function opacity(data){let n=0;for(let i=3;i<data.length;i+=4)if(data[i]>0)n++;return n;}

let sm={};try{sm=require(MANIFEST);}catch(e){}
const out=Object.assign({},sm);
let total=0,failed=[];

for(const [key,def] of Object.entries(PARTS)){
  const frames=(framesByBase[def.base]||[]).sort((a,b)=>a.frame-b.frame);
  if(!frames.length){failed.push(key+'(no cfg)');continue;}
  // 按内容量排序，取最饱满的N帧
  const cand=[];
  for(const fr of frames){
    const cut=cutOne(fr,def.atlas);
    if(!cut)continue;
    const op=opacity(cut.data);
    if(op>50)cand.push({fr,cut,op});
  }
  if(!cand.length){failed.push(key+'(empty)');continue;}
  // 按帧号顺序排列（特效帧尺寸异常，已通过 op>50 粗滤；再按帧号保证取到人物帧）
  cand.sort((a,b)=>a.fr.frame-b.fr.frame);
  // 过滤面积异常大的帧（特效：面积 > 中位数*1.8）
  const areas=cand.map(c=>c.fr.f_quad[2]*c.fr.f_quad[3]).sort((a,b)=>a-b);
  const medArea=areas[Math.floor(areas.length/2)]||1;
  const normal=cand.filter(c=>(c.fr.f_quad[2]*c.fr.f_quad[3])<=medArea*1.8);
  const pool=normal.length>=def.frames?normal:cand;
  // 塔基取最饱满1帧；单位按帧号顺序均匀取（构成动作序列）
  const picks=[];
  if(def.frames===1){
    // 塔基：取面积最大且帧号靠前的
    const byOp=pool.slice().sort((a,b)=>b.op-a.op);
    picks.push(byOp[0]);
  } else {
    for(let i=0;i<def.frames;i++){
      const idx=Math.floor(i*(pool.length-1)/Math.max(1,def.frames-1));
      if(pool[idx])picks.push(pool[idx]);
    }
  }
  if(def.frames===1){
    const file='assets/sprites/'+key+'.png';
    writePNG(path.join('D:/xyh/game/kingdom/kro-minigame',file),picks[0].cut.data,picks[0].cut.w,picks[0].cut.h);
    out[key]={file,w:picks[0].cut.w,h:picks[0].cut.h,base:def.base,frame:picks[0].fr.frame};
    total++;
  } else {
    picks.forEach((p,i)=>{
      const k=key+'_f'+i,file='assets/sprites/'+k+'.png';
      writePNG(path.join('D:/xyh/game/kingdom/kro-minigame',file),p.cut.data,p.cut.w,p.cut.h);
      out[k]={file,w:p.cut.w,h:p.cut.h,base:def.base,frame:p.fr.frame};
      total++;
    });
    out[key]={file:'assets/sprites/'+key+'_f0.png',w:picks[0].cut.w,h:picks[0].cut.h,base:def.base,frames:picks.length};
  }
}
fs.writeFileSync(MANIFEST,'module.exports = '+JSON.stringify(out)+';\n');
console.log('切出塔部件帧:',total,'失败:',failed.length,failed.join(', '));
console.log('manifest总条目:',Object.keys(out).length);
