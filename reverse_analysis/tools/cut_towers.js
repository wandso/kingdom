// 从 fullhd go_towers 图集切出4个塔系的 idle + attack 帧
const {readPNG,writePNG}=require('./pnglib.js');
const fs=require('fs'),path=require('path');
const ATLAS='D:/xyh/game/kingdom/reverse_analysis/atlas_fullhd';
const CFG='D:/xyh/game/kingdom/reverse_analysis/decompiled/atlas/go_towers.lua';
const OUT='D:/xyh/game/kingdom/kro-minigame/assets/sprites';
const MANIFEST='D:/xyh/game/kingdom/kro-minigame/js/sprite_manifest.js';

const TOWERS={
  archer:'archer_silver_shooter',
  mage:'mage_wild_shooter',
  artillery:'artillery_thrower',
  barracks:'soldiers_123'
};

const txt=fs.readFileSync(CFG,'utf8');
const cfgByBase={};
for(const m of txt.matchAll(/^\s*([A-Za-z][A-Za-z0-9_]*)_(\d{4})\s*=\s*\{([\s\S]*?)\n\t\}/gm)){
  const base=m[1],frame=parseInt(m[2],10),body=m[3],nums={};
  for(const field of ['size','trim','f_quad']){
    const fm=new RegExp(field+'\\s*=\\s*\\{([^}]*)\\}').exec(body);
    if(fm)nums[field]=[...fm[1].matchAll(/-?[\d.]+/g)].map(x=>parseFloat(x[0]));
  }
  const an=/a_name\s*=\s*"([^"]+)"/.exec(body);
  if(!nums.size||!nums.trim||!nums.f_quad||!an)continue;
  (cfgByBase[base]=cfgByBase[base]||[]).push({base,frame,size:nums.size,trim:nums.trim,f_quad:nums.f_quad,a_name:an[1]});
}

const atlasCache={};
function getAtlas(name){
  if(atlasCache[name])return atlasCache[name];
  const p=path.join(ATLAS,name);
  if(!fs.existsSync(p))return null;
  return atlasCache[name]=readPNG(p);
}
function cutOne(cfg){
  const atlas=getAtlas(cfg.a_name);if(!atlas)return null;
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

let sm={};try{sm=require(MANIFEST);}catch(e){}
const out=Object.assign({},sm);

for(const [tower,base] of Object.entries(TOWERS)){
  const frames=(cfgByBase[base]||[]).sort((a,b)=>a.frame-b.frame);
  console.log(tower,base,'帧数:',frames.length);
  if(!frames.length){console.log('  WARN 无帧');continue;}
  // 选8帧：均匀采样，且过滤内容太少的
  const candidates=[];
  for(const fr of frames){
    const cut=cutOne(fr);if(!cut)continue;
    let opaque=0;for(let i=3;i<cut.data.length;i+=4)if(cut.data[i]>0)opaque++;
    if(opaque>200)candidates.push({fr,cut,opaque});
  }
  console.log('  有效帧:',candidates.length);
  // 均匀取8帧
  const picks=[];
  for(let i=0;i<8;i++){
    const idx=Math.floor(i*(candidates.length-1)/7);
    if(candidates[idx]&&!picks.includes(candidates[idx]))picks.push(candidates[idx]);
  }
  picks.forEach((p,i)=>{
    const key='tower_'+tower+'_f'+i;
    const file='assets/sprites/'+key+'.png';
    writePNG(path.join('D:/xyh/game/kingdom/kro-minigame',file),p.cut.data,p.cut.w,p.cut.h);
    out[key]={file,w:p.cut.w,h:p.cut.h,pw:p.fr.size[0],ph:p.fr.size[1],hd:true,frame:p.fr.frame,base};
  });
  // 第一帧也作为传统 key（兼容）
  if(picks[0]){
    const file='assets/sprites/tower_'+tower+'.png';
    writePNG(path.join('D:/xyh/game/kingdom/kro-minigame',file),picks[0].cut.data,picks[0].cut.w,picks[0].cut.h);
    out['tower_'+tower]={file,w:picks[0].cut.w,h:picks[0].cut.h,pw:picks[0].fr.size[0],ph:picks[0].fr.size[1],hd:true,frames:8};
  }
}
fs.writeFileSync(MANIFEST,'module.exports = '+JSON.stringify(out)+';\n');
console.log('manifest总条目:',Object.keys(out).length);
