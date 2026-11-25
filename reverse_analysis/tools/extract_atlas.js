// 从 exe 尾部 ZIP 提取指定高清图集（用 Node 手写 ZIP 解析 + inflate）
const fs=require('fs'),zlib=require('zlib'),path=require('path');
const exe="D:/SteamLibrary/steamapps/common/Kingdom Rush Origins/Kingdom Rush Origins.exe";
const OUT="D:/xyh/game/kingdom/reverse_analysis/atlas_fullhd";
fs.mkdirSync(OUT,{recursive:true});
const stat=fs.statSync(exe);
const fd=fs.openSync(exe,'r');
// 读EOCD尾部
const tail=Buffer.alloc(65557);
fs.readSync(fd,tail,0,tail.length,stat.size-tail.length);
let eocd=-1;
for(let i=tail.length-22;i>=0;i--){if(tail[i]==0x50&&tail[i+1]==0x4b&&tail[i+2]==0x05&&tail[i+3]==0x06){eocd=i;break;}}
const cdSize=tail.readUInt32LE(eocd+12),cdOff=tail.readUInt32LE(eocd+16),count=tail.readUInt16LE(eocd+10);
const eocdAbs=stat.size-tail.length+eocd;
const zipStart=eocdAbs-cdSize-cdOff;
console.log('zipStart:',zipStart);
// 读中央目录
const cd=Buffer.alloc(cdSize);
fs.readSync(fd,cd,0,cdSize,zipStart+cdOff);
let pos=0;const entries=[];
for(let i=0;i<count;i++){
  // signature PK0102
  if(cd.readUInt32LE(pos)!==0x02014b50){pos++;continue;}
  const method=cd.readUInt16LE(pos+10);
  const compSize=cd.readUInt32LE(pos+20),uncompSize=cd.readUInt32LE(pos+24);
  const nameLen=cd.readUInt16LE(pos+28),extraLen=cd.readUInt16LE(pos+30),commentLen=cd.readUInt16LE(pos+32);
  const localOff=cd.readUInt32LE(pos+42);
  const name=cd.slice(pos+46,pos+46+nameLen).toString();
  entries.push({name,method,compSize,uncompSize,localOff});
  pos+=46+nameLen+extraLen+commentLen;
}
console.log('ZIP条目:',entries.length);
// 目标：ipad 高清图集
const targets=entries.filter(e=>{
  const n=e.name;
  return /images\/fullhd\/go_(enemies|towers|hero)[^\/]*-\d+\.png$/i.test(n);
});
console.log('目标高清图集:',targets.length);
let ok=0,fail=0;
for(const e of targets){
  // 读本地头
  const lh=Buffer.alloc(30);
  fs.readSync(fd,lh,0,30,zipStart+e.localOff);
  const nameLen=lh.readUInt16LE(26),extraLen=lh.readUInt16LE(28);
  const dataOff=zipStart+e.localOff+30+nameLen+extraLen;
  const comp=Buffer.alloc(e.compSize);
  fs.readSync(fd,comp,0,e.compSize,dataOff);
  let data;
  try{
    if(e.method===0)data=comp;
    else if(e.method===8)data=zlib.inflateRawSync(comp);
    else throw new Error('method '+e.method);
    const base=path.basename(e.name);
    fs.writeFileSync(path.join(OUT,base),data);
    ok++;
  }catch(err){fail++;console.log('FAIL',e.name,err.message);}
}
fs.closeSync(fd);
console.log('提取成功:',ok,'失败:',fail,'输出目录:',OUT);
