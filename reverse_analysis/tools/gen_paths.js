// 从反编译 lua paths 中心段提取真实路径，映射到引擎1000x600坐标系
// 背景图1280x698 被 drawImage 到逻辑1000x600 → X缩放1000/1280, Y缩放600/698
const fs=require('fs'),path=require('path');
const SRC='D:/xyh/game/kingdom/reverse_analysis/decompiled/levels';
const OUT='D:/xyh/game/kingdom/kro-minigame/js/real_paths_full.json';
const SX=1000/1280, SY=600/698;

function parseSegments(file){
  const txt=fs.readFileSync(file,'utf8');
  const idx=txt.indexOf('\tpaths = {');
  if(idx<0)return null;
  const sub=txt.slice(idx);
  const paths=[];let curPath=null,curSeg=null,depth=0;
  for(let i=0;i<sub.length;i++){
    const ch=sub[i];
    if(ch==='{'){
      depth++;
      if(depth===2){curPath=[];paths.push(curPath);}
      else if(depth===3){curSeg=[];curPath.push(curSeg);}
      else if(depth===4){
        const m=/x\s*=\s*(-?[\d.]+)\s*,\s*\n\s*y\s*=\s*(-?[\d.]+)/.exec(sub.slice(i,i+120));
        if(m&&curSeg)curSeg.push({x:parseFloat(m[1]),y:parseFloat(m[2])});
      }
    } else if(ch==='}'){depth--;if(depth===0)break;}
  }
  return paths;
}

const result={};let total=0,files=0;
for(const f of fs.readdirSync(SRC).filter(f=>/^level\d+_paths\.lua$/.test(f))){
  const sid=/level(\d+)_paths/.exec(f)[1].padStart(2,'0');
  const paths=parseSegments(path.join(SRC,f));
  if(!paths||!paths.length)continue;
  const centers=paths.map(segs=>{
    const pick=segs[Math.floor(segs.length/2)]||segs[0];
    const sampled=pick.filter((_,i)=>i%6===0||i===pick.length-1);
    // 映射到1000x600逻辑坐标（保留2位小数）
    return sampled.map(p=>({x:Math.round(p.x*SX*10)/10,y:Math.round(p.y*SY*10)/10}));
  }).filter(p=>p.length>1);
  // 同时提供raw(世界坐标,缩放前)供背景绘制参考
  result[sid]={active:[],curves:centers.map(pts=>({mapped:pts})),paths:centers};
  total+=centers.reduce((a,p)=>a+p.length,0);files++;
}
fs.writeFileSync(OUT,JSON.stringify(result));
console.log('关卡:',files,'路径点总数:',total);
console.log('level01 路径条数:',result['01'].curves.length,'点数:',result['01'].curves.map(c=>c.mapped.length));
console.log('level01 path0 首:',JSON.stringify(result['01'].curves[0].mapped[0]),'末:',JSON.stringify(result['01'].curves[0].mapped.slice(-1)[0]));
