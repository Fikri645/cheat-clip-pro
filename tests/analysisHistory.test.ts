import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAnalysisHistory } from '../src/utils/analysisHistory';

test('history preserves legacy and versioned cache identities and sorts their timestamps',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  const legacy='cheat_clip_cache_abcdefghijk_30s_model_old';
  const versioned='cheat_clip_cache_upload_sample_15s_v2_hash';
  const items=new Map<string,string>([
    [legacy,JSON.stringify({video_id:'abcdefghijk',title:'Older video',clips:[],source_type:'youtube'})],
    [legacy.replace('cache_','ts_'),'2026-01-01T00:00:00Z'],
    [versioned,JSON.stringify({video_id:'upload_sample',title:'Newer upload',source_type:'upload',video_url:'/api/video/upload_sample.mp4',clips:[{title:'Clip',key_quotes:['Quote']}]})],
    [versioned.replace('cache_','ts_'),'2026-01-02T00:00:00Z'],
    ['cheat_clip_cache_broken','invalid JSON'],
  ]);
  const storage={get length(){return items.size;},key(index:number){return [...items.keys()][index] ?? null;},getItem(key:string){return items.get(key) ?? null;}};
  try {
    Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true});
    const history=readAnalysisHistory();
    assert.deepEqual(history.map(entry=>entry.title),['Newer upload','Older video']);
    assert.equal(history[0].duration_pref,'15s');
    assert.equal(history[0].range_suffix,'_v2_hash');
    assert.equal(`cheat_clip_cache_${history[0].video_id}_${history[0].duration_pref}${history[0].range_suffix}`,versioned);
    assert.equal(history[0].source_type,'upload');
    assert.deepEqual(history[0].key_quotes,['Quote']);
    assert.match(history[0].thumbnail,/^\/api\/clip-frame\?/);
  } finally {
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);
    else Reflect.deleteProperty(globalThis,'localStorage');
  }
});
