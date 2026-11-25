// 纯 Node PNG 解码/编码（支持 colorType 2/6/3，8bit，非隔行）
const zlib=require('zlib'),fs=require('fs');
function readPNG(p){
  const b=fs.readFileSync(p);let o=8,idat=[],w,h,ct,bd,plte;
  while(o<b.length){const len=b.readUInt32BE(o),type=b.slice(o+4,o+8).toString();const d=b.slice(o+8,o+8+len);
    if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);bd=d[8];ct=d[9];}
    else if(type==='PLTE')plte=d;
    else if(type==='IDAT')idat.push(d);
    else if(type==='IEND')break;
    o+=12+len;
  }
  const raw=zlib.inflateSync(Buffer.concat(idat));
  const ch=ct===6?4:ct===2?3:ct===3?1:0;
  if(!ch)throw new Error('unsupported ct='+ct);
  const stride=w*ch,out=Buffer.alloc(h*stride);let pos=0;
  for(let y=0;y<h;y++){
    const ft=raw[pos++];const line=raw.slice(pos,pos+stride);pos+=stride;
    const prev=y>0?out.slice((y-1)*stride,y*stride):Buffer.alloc(stride);
    const cur=out.slice(y*stride,(y+1)*stride);
    for(let x=0;x<stride;x++){
      const a=x>=ch?cur[x-ch]:0,bb=prev[x],c=x>=ch?prev[x-ch]:0;let v=line[x];
      if(ft===1)v+=a;else if(ft===2)v+=bb;else if(ft===3)v+=Math.floor((a+bb)/2);
      else if(ft===4){const pp=a+bb-c,pa=Math.abs(pp-a),pb=Math.abs(pp-bb),pc=Math.abs(pp-c);v+=(pa<=pb&&pa<=pc)?a:(pb<=pc?bb:c);}
      cur[x]=v&255;
    }
  }
  // 转 RGBA
  const rgba=Buffer.alloc(w*h*4);
  for(let i=0;i<w*h;i++){
    if(ct===6){rgba[i*4]=out[i*4];rgba[i*4+1]=out[i*4+1];rgba[i*4+2]=out[i*4+2];rgba[i*4+3]=out[i*4+3];}
    else if(ct===2){rgba[i*4]=out[i*3];rgba[i*4+1]=out[i*3+1];rgba[i*4+2]=out[i*3+2];rgba[i*4+3]=255;}
    else if(ct===3){const idx=out[i];rgba[i*4]=plte[idx*3];rgba[i*4+1]=plte[idx*3+1];rgba[i*4+2]=plte[idx*3+2];rgba[i*4+3]=255;}
  }
  return {w,h,data:rgba};
}
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return (~c)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc32(td));return Buffer.concat([len,td,cr]);}
function writePNG(p,rgba,w,h){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc(h*(1+w*4));
  for(let y=0;y<h;y++){raw[y*(1+w*4)]=0;rgba.copy(raw,y*(1+w*4)+1,y*w*4,(y+1)*w*4);}
  const buf=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(p,buf);
}
module.exports={readPNG,writePNG};
