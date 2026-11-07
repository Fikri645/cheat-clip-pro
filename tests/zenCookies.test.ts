import assert from 'node:assert/strict';
import test from 'node:test';
import {disableZenCookies,enableZenCookies,getCookiesForRequest,getStoredCookies,removeStoredCookies} from '../src/utils/cookieUtils';

test('Zen refresh uses fresh cookies, deduplicates requests, and preserves manual mode',async()=>{
  const values=new Map<string,string>();
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:new EventTarget()});
  Object.defineProperty(globalThis,'StorageEvent',{configurable:true,value:class extends Event {}});
  const original=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{
    requests++;
    return new Response(JSON.stringify({cookies_content:`# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t1999999999\tSID\tfake-session-${requests}\n`}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try {
    await enableZenCookies('12345678901234567890');
    assert.equal(requests,1);
    const [first,second]=await Promise.all([getCookiesForRequest(),getCookiesForRequest()]);
    assert.equal(requests,2);assert.equal(first,second);assert.match(first,/fake-session-2/);
    assert.match(await getCookiesForRequest(),/fake-session-3/);
    disableZenCookies();
    assert.equal(await getCookiesForRequest(),getStoredCookies());assert.equal(requests,3);
    removeStoredCookies();assert.equal(await getCookiesForRequest(),'');assert.equal(requests,3);
  } finally {globalThis.fetch=original;}
});
