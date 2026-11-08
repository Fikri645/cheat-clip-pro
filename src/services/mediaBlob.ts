const CHUNK_BYTES=8*1024*1024;

async function requestBlob(url:string,range?:string) {
  for(let attempt=0;;attempt++)try {
    const response=await fetch(url,{cache:'no-store',headers:range?{Range:range}:undefined});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    return {response,blob:await response.blob()};
  } catch(error) {
    if(attempt===2)throw error;
    await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
  }
}

export async function fetchMediaBlob(url:string):Promise<Blob> {
  if(url.startsWith('blob:'))return (await requestBlob(url)).blob;
  // Bounded, uncached reads avoid stale partial responses and allow a failed
  // transfer to resume at its current chunk instead of losing the whole video.
  const first=await requestBlob(url,'bytes=0-0');
  if(first.response.status!==206)return first.blob;
  const match=/^bytes 0-0\/(\d+)$/.exec(first.response.headers.get('content-range') || '');
  const size=Number(match?.[1]);
  if(!match || !Number.isSafeInteger(size) || size<1 || first.blob.size!==1)throw new Error('Invalid media byte range');
  const parts:Blob[]=[];
  for(let offset=0;offset<size;offset+=CHUNK_BYTES) {
    const end=Math.min(size-1,offset+CHUNK_BYTES-1);
    const part=await requestBlob(url,`bytes=${offset}-${end}`);
    if(part.response.status!==206 || part.response.headers.get('content-range')!==`bytes ${offset}-${end}/${size}` || part.blob.size!==end-offset+1)
      throw new Error('Incomplete media byte range');
    parts.push(part.blob);
  }
  return new Blob(parts,{type:first.blob.type});
}
