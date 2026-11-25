// 从 fullhd 图集切出所有波次敌人的高清精灵（首帧）
const {readPNG,writePNG}=require('./pnglib.js');
const fs=require('fs'),path=require('path');
const ATLAS='D:/xyh/game/kingdom/reverse_analysis/atlas_fullhd';
const CFG='D:/xyh/game/kingdom/reverse_analysis/decompiled/atlas';
const OUT='D:/xyh/game/kingdom/kro-minigame/assets/sprites';
const MANIFEST='D:/xyh/game/kingdom/kro-minigame/js/sprite_manifest.js';

// id(去掉enemy_) -> 图集基名
const MAP={
  arachnomancer:'arachnomancer',bandersnatch:'bandersnatch',blood_servant:'bloodServant',
  bloodsydian_warlock:'bloodsydianWarlock',boomshrooms:'fungusRider',dark_spitters:'dark_spitters',
  drider:'drider',ettin:'ettin',gloomy:'gloomy',gnoll_blighter:'gnoll_blighter',
  gnoll_bloodsydian:'bloodsydianGnoll',gnoll_burner:'gnoll_burner',gnoll_gnawer:'gnoll_gnawer',
  gnoll_reaver:'gnoll_reaver',grim_devourers:'grim_devourers',hyena:'hyena',mantaray:'mantaray',
  mounted_avenger:'mountedAvenger',munchshrooms:'fungusRider',ogre_magi:'ogre_mage',
  ogre_magi_custody_ettin:'ettin',ogre_magi_custody_gnoll_gnawer:'gnoll_gnawer',
  ogre_magi_custody_warlock:'bloodsydianWarlock',perython:'perython',
  perython_gnoll_gnawer:'gnoll_gnawer',perython_rock_thrower:'perython',rabbit:'rabbit',
  razorboar:'razorboar',redcap:'redcap',satyr_cutthroat:'satyr',satyr_hoplite:'satyrHoplite',
  screecher_bat:'screecher_bat',shadow_champion:'shadow_champion',shadows_spawns:'shadow_spawn',
  shroom_breeder:'fungusRider',spider_arachnomancer:'arachnomancer',
  spider_son_of_mactans:'son_of_mactans',sword_spider:'sword_spider',
  twilight_avenger:'twilight_avenger',twilight_elf_harasser:'harraser',
  twilight_evoker:'twilight_evoker',twilight_golem:'gollem',twilight_heretic:'twilight_heretic',
  twilight_scourger:'scourger',webspitting_spider:'webspitterSpider',
  // DATA 预定义敌人/Boss 补充
  gnoll_catapult:'gnoll_gnawer',son_of_mactans:'son_of_mactans',cloud_stalker:'mantaray',
  shadowspawn:'shadow_spawn',bunny:'rabbit',munchshroom:'fungusRider',boomshroom:'fungusRider',
  dark_spitter:'dark_spitters',devourer:'grim_devourers',bram:'ettin',godieth:'drider',
  spider_goddess:'mactans_malicia',malicia:'malicia',bajninmen:'bloodsydianGnoll',
  hihi_enha:'bandersnatch',twilight_brute:'twilight_avenger'

};

// 读取所有敌人图集配置，建立 base -> [{file,size,trim,f_quad,frameNo}]
const cfgs=[];
for(const f of fs.readdirSync(CFG).filter(f=>/^go_enemies_.*\.lua$/.test(f))){
  const txt=fs.readFileSync(path.join(CFG,f),'utf8');
  const re=/^\s*([A-Za-z][A-Za-z0-9_]*)_(\d{4})\s*=\s*\{([\s\S]*?)\n\t\}/gm;
  let m;
  while((m=re.exec(txt))){
    const base=m[1],frame=parseInt(m[2],10),body=m[3];
    const nums={};
    for(const field of ['size','trim','f_quad']){
      const fm=new RegExp(field+'\\s*=\\s*\\{([^}]*)\\}').exec(body);
      if(fm)nums[field]=[...fm[1].matchAll(/-?[\d.]+/g)].map(x=>parseFloat(x[0]));
    }
    const an=/a_name\s*=\s*"([^"]+)"/.exec(body);
    if(!nums.size||!nums.trim||!nums.f_quad||!an)continue;
    cfgs.push({base,frame,size:nums.size,trim:nums.trim,f_quad:nums.f_quad,a_name:an[1]});
  }
}
console.log('配置帧总数:',cfgs.length);

// 图集缓存
const atlasCache={};
function getAtlas(name){
  if(atlasCache[name])return atlasCache[name];
  const p=path.join(ATLAS,name);
  if(!fs.existsSync(p))return null;
  return atlasCache[name]=readPNG(p);
}

function cutOne(cfg){
  const atlas=getAtlas(cfg.a_name);
  if(!atlas)return null;
  const [qx,qy,qw,qh]=cfg.f_quad;
  const [sw,sh]=cfg.size,[tl,tt]=cfg.trim;
  if(qx<0||qy<0||qx+qw>atlas.w||qy+qh>atlas.h)return null;
  const data=Buffer.alloc(sw*sh*4);
  for(let y=0;y<qh;y++)for(let x=0;x<qw;x++){
    const dx=tl+x,dy=tt+y;
    if(dx>=sw||dy>=sh||dx<0||dy<0)continue;
    const si=((qy+y)*atlas.w+(qx+x))*4,di=(dy*sw+dx)*4;
    atlas.data.copy(data,di,si,si+4);
  }
  return {data,w:sw,h:sh};
}

// 现有manifest保留塔/英雄，敌人全部重切
let sm={};
try{sm=require(MANIFEST);}catch(e){}
const out={};let done=0,failed=[];

for(const [id,base] of Object.entries(MAP)){
  // 取该base的前若干帧（0001,0002...），选非透明最多的作为代表帧
  const frames=cfgs.filter(c=>c.base===base).sort((a,b)=>a.frame-b.frame).slice(0,12);
  if(!frames.length){failed.push(id+'(no config)');continue;}
  let best=null,bestScore=-1;
  for(const fr of frames){
    const cut=cutOne(fr);if(!cut)continue;
    let opaque=0;
    for(let i=3;i<cut.data.length;i+=4)if(cut.data[i]>0)opaque++;
    if(opaque>bestScore){bestScore=opaque;best={cut,fr};}
  }
  if(!best||bestScore<20){failed.push(id+'(empty)');continue;}
  const key='enemy_'+id;
  const file='assets/sprites/'+key+'.png';
  writePNG(path.join('D:/xyh/game/kingdom/kro-minigame',file),best.cut.data,best.cut.w,best.cut.h);
  out[key]={file,w:best.cut.w,h:best.cut.h,pw:best.fr.size[0],ph:best.fr.size[1],hd:true,frame:best.fr.frame};
  done++;
}
// 合并：保留非敌人的塔/英雄条目
for(const k in sm){if(!/^enemy_/.test(k))out[k]=sm[k];}
fs.writeFileSync(MANIFEST,'module.exports = '+JSON.stringify(out)+';\n');
console.log('切出敌人精灵:',done,'失败:',failed.length,failed.join(', '));
console.log('manifest总条目:',Object.keys(out).length);
