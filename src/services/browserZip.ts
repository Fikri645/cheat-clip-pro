import { Zip, ZipPassThrough } from 'fflate';

/** Stream already-compressed MP4 files into a stored ZIP without recompression. */
export async function browserZip(entries:{name:string;blob:Blob}[]):Promise<Blob> {
  const chunks:Uint8Array<ArrayBuffer>[]=[];
  let finish!:()=>void, fail!:(error:Error)=>void;
  const done=new Promise<void>((resolve,reject)=>{finish=resolve;fail=reject;});
  const zip=new Zip((error,data,final)=>{
    if(error){fail(error);return;}
    chunks.push(new Uint8Array(data));if(final)finish();
  });
  const counts=new Map<string,number>();
  for(const entry of entries) {
    const count=counts.get(entry.name) || 0;counts.set(entry.name,count+1);
    const name=count?entry.name.replace(/\.mp4$/i,` (${count}).mp4`):entry.name;
    const stream=new ZipPassThrough(name);zip.add(stream);
    const reader=entry.blob.stream().getReader();
    try {
      while(true){const chunk=await reader.read();if(chunk.done)break;stream.push(chunk.value,false);}
      stream.push(new Uint8Array(0),true);
    } finally {reader.releaseLock();}
  }
  zip.end();await done;
  return new Blob(chunks,{type:'application/zip'});
}
