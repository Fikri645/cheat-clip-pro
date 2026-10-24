import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analysisCacheKey, type AnalysisCacheContext } from '../src/utils/analysisCache';
import { cropAt, mediaAssetUrl } from '../src/services/browserCompositor';
import { browserZip } from '../src/services/browserZip';
import { unzipSync, strFromU8 } from 'fflate';

const base:AnalysisCacheContext={provider:'gemini',model:'gemini-test',duration:'30s',clipCount:'auto',prompt:'',
  subtitleSource:'youtube',subtitleContent:'',transcriptLanguage:'id',mode:'live'};

test('provider, effective model, subtitle contents and mock mode cannot share cached results',async()=>{
  const contexts:AnalysisCacheContext[]=[base,{...base,provider:'openrouter'},{...base,provider:'openrouter',model:'another'},
    {...base,subtitleSource:'manual',subtitleContent:'alpha'}, {...base,subtitleSource:'manual',subtitleContent:'beta'},
    {...base,mode:'mock'}];
  const keys=await Promise.all(contexts.map(context=>analysisCacheKey('12345678901',context)));
  assert.equal(new Set(keys).size,contexts.length);
});

test('whitespace normalization preserves semantic cache identity',async()=>{
  assert.equal(await analysisCacheKey('id',{...base,prompt:' hello '}),await analysisCacheKey('id',{...base,prompt:'hello'}));
  assert.notEqual(await analysisCacheKey('id',base),await analysisCacheKey('id',{...base,rangeStart:10}));
});

test('browser crop moves smoothly within shots and switches at scene cuts',()=>{
  const points=[{time:0,cx:.2,cy:.4,w:.2,h:.3},{time:1,cx:.8,cy:.4,w:.2,h:.3}];
  assert.equal(cropAt(points,.5).cx,.5);
  assert.equal(cropAt([points[0],{...points[1],cut:true}],.5).cx,.2);
  assert.equal(cropAt([points[0],{...points[1],cut:true}],1).cx,.8);
});

test('uploaded media paths are mapped to public asset endpoints without disclosing local paths',()=>{
  assert.equal(mediaAssetUrl('C:\\media\\music.mp3','audio'),'/api/render-asset/bXVzaWMubXAz');
});

test('HTTP LAN fallback computes the same SHA-256 cache identity',async()=>{
  const expected=await analysisCacheKey('same',base);
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  try {
    Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
    assert.equal(await analysisCacheKey('same',base),expected);
  } finally {
    if(original)Object.defineProperty(globalThis,'crypto',original);
  }
});

test('browser ZIP preserves all outputs including duplicate clip titles',async()=>{
  const blob=await browserZip([{name:'Clip.mp4',blob:new Blob(['first'])},{name:'Clip.mp4',blob:new Blob(['second'])}]);
  const files=unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(strFromU8(files['Clip.mp4']),'first');
  assert.equal(strFromU8(files['Clip (1).mp4']),'second');
});
