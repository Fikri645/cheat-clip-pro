import assert from 'node:assert/strict';
import test from 'node:test';
import {fetchMediaBlob} from '../src/services/mediaBlob';

test('large media is saved byte-for-byte using bounded uncached ranges',async()=>{
  const original=globalThis.fetch;
  const bytes=new Uint8Array(8*1024*1024+31);bytes[0]=21;bytes[bytes.length-1]=98;
  const ranges:string[]=[];
  globalThis.fetch=async(_url,options)=>{
    assert.equal(options?.cache,'no-store');
    const range=new Headers(options?.headers).get('Range')!;ranges.push(range);
    const [,a,b]=/bytes=(\d+)-(\d+)/.exec(range)!;const start=Number(a),end=Number(b);
    return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Type':'application/octet-stream'}});
  };
  try {
    const saved=await fetchMediaBlob('/api/render-asset/large');
    assert.equal(saved.size,bytes.length);assert.deepEqual(new Uint8Array(await saved.arrayBuffer()),bytes);
    assert.deepEqual(ranges,['bytes=0-0','bytes=0-8388607','bytes=8388608-8388638']);
  } finally {globalThis.fetch=original;}
});

test('a failed chunk is retried without restarting previous chunks',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{
    requests++;if(requests===2)throw new TypeError('Interrupted');
    return new Response('x',{status:206,headers:{'Content-Range':'bytes 0-0/1'}});
  };
  try {assert.equal(await (await fetchMediaBlob('/media')).text(),'x');assert.equal(requests,3);}
  finally {globalThis.fetch=original;}
});

test('unsupported ranges use the full response and malformed ranges are rejected',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response('original bytes');
    assert.equal(await (await fetchMediaBlob('/media')).text(),'original bytes');
    globalThis.fetch=async()=>new Response('x',{status:206,headers:{'Content-Range':'bytes 0-0/0'}});
    await assert.rejects(()=>fetchMediaBlob('/media'),/Invalid media byte range/);
  } finally {globalThis.fetch=original;}
});
