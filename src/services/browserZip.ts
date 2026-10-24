// Known sizes prevent nested ZIP signatures from being mistaken for new entries.
const crcTable=Uint32Array.from({length:256},(_,index)=>{
  let value=index;for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;
});
function header(length:number,signature:number) {
  const bytes=new Uint8Array(length),view=new DataView(bytes.buffer);view.setUint32(0,signature,true);return {bytes,view};
}
export async function browserZip(entries:{name:string;blob:Blob}[]):Promise<Blob> {
  const chunks:BlobPart[]=[],central:Uint8Array<ArrayBuffer>[]=[];let offset=0;
  const counts=new Map<string,number>(),encoder=new TextEncoder();
  for(const entry of entries){
    const count=counts.get(entry.name) || 0;counts.set(entry.name,count+1);
    const name=encoder.encode(count?entry.name.replace(/(\.[^/.]+)?$/,` (${count})$1`):entry.name);
    if(entry.blob.size>0xffffffff || offset+entry.blob.size>0xffffffff || entries.length>65535)throw new Error('ZIP exceeds the supported 4 GB archive size. Export smaller batches.');
    const local=header(30+name.length,0x04034b50);
    local.view.setUint16(4,20,true);local.view.setUint16(6,0x0800,true);
    local.view.setUint32(18,entry.blob.size,true);local.view.setUint32(22,entry.blob.size,true);local.view.setUint16(26,name.length,true);local.bytes.set(name,30);
    let crc=0xffffffff;
    const reader=entry.blob.stream().getReader();
    try {while(true){const part=await reader.read();if(part.done)break;for(const byte of part.value)crc=crcTable[(crc^byte)&255]^(crc>>>8);}}
    finally {reader.releaseLock();}
    crc=(crc^0xffffffff)>>>0;local.view.setUint32(14,crc,true);chunks.push(local.bytes,entry.blob);
    const record=header(46+name.length,0x02014b50);
    record.view.setUint16(4,20,true);record.view.setUint16(6,20,true);record.view.setUint16(8,0x0800,true);
    record.view.setUint32(16,crc,true);record.view.setUint32(20,entry.blob.size,true);record.view.setUint32(24,entry.blob.size,true);
    record.view.setUint16(28,name.length,true);record.view.setUint32(42,offset,true);record.bytes.set(name,46);central.push(record.bytes);
    offset+=local.bytes.length+entry.blob.size;
  }
  const centralSize=central.reduce((sum,record)=>sum+record.length,0),end=header(22,0x06054b50);
  if(offset+centralSize+22>0xffffffff)throw new Error('ZIP exceeds the supported 4 GB archive size. Export smaller batches.');
  end.view.setUint16(8,entries.length,true);end.view.setUint16(10,entries.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...chunks,...central,end.bytes],{type:'application/zip'});
}
