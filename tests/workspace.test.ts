import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProject, importProject } from '../src/services/projectArchive';
import { getProject, getRender, recoverRender, restoreRender, saveProject, saveRender, type SavedProject } from '../src/services/workspaceStore';
import { captionValidation } from '../src/utils/captionWords';

const project:SavedProject={version:1,id:'upload_test_project',updated:1,marked:{'0_2':true},
  result:{video_id:'upload_test_project',title:'Editable project',duration:2,heatmap:[],summary:'',source_type:'upload',clips:[{
    title:'Clip',start_time:0,end_time:2,virality_score:70,key_quotes:[],transcript:'Hello',caption_words:[{word:'Corrected',start:.1,end:1}],
  }]},draft:{watermarkText:'Brand',bgmVolume:18,customClipTitles:{'0_2':'Custom title'}},
  assets:[{kind:'source',name:'video.mp4',blob:new Blob(['video-bytes'])},{kind:'bgm',name:'music.wav',blob:new Blob(['music-bytes'])}],
  batch:{batch_id:'client_project_test',overall_status:'cancelled',current_clip_index:1,total_clips:2,clips:[
    {clip_index:0,title:'Done',status:'completed',progress_percent:100},{clip_index:1,title:'Interrupted',status:'cancelled',progress_percent:0}]}};

test('project archive round trip preserves edits, binary assets, and completed render',async()=>{
  await saveRender({id:project.batch!.batch_id,state:project.batch!,files:{'0':new Blob(['mp4-bytes']),zip:new Blob(['zip-bytes'])},context:{result:project.result,settings:{aspectRatio:'9:16',backgroundStyle:'black',enableFaceTracking:false,streamerPreset:'none',titlePosition:'none',captionStyle:'none',captionFont:'Outfit',fontSize:'medium',textCase:'uppercase',selectedClips:project.result.clips}}});
  await saveProject(project);
  assert.equal((await getProject(project.id))!.draft!.watermarkText,'Brand');
  const archive=await exportProject(project);
  const restored=await importProject(new File([archive],'project.zip'));
  assert.deepEqual(restored.result.clips[0].caption_words,project.result.clips[0].caption_words);
  assert.equal(await restored.assets[0].blob.text(),'video-bytes');
  assert.equal(await restored.assets[1].blob.text(),'music-bytes');
  assert.deepEqual(restored.draft,project.draft);
  const render=await getRender(project.batch!.batch_id);
  assert.equal(await render!.files['0'].text(),'mp4-bytes');
  assert.deepEqual(render!.context!.settings.selectedClips,project.result.clips);
  const state=restoreRender({...render!,state:{...render!.state,overall_status:'running'}});
  assert.equal(state.overall_status,'cancelled');assert.equal(state.clips[0].status,'completed');
  assert.equal(await (await fetch(state.clips[0].download_url!)).text(),'mp4-bytes');
  URL.revokeObjectURL(state.clips[0].download_url!);URL.revokeObjectURL(state.zip_url!);
});
test('caption validation rejects overlap, nonfinite times and out-of-clip words',()=>{
  assert.equal(captionValidation([{word:'Valid',start:0,end:1}],2),undefined);
  for(const words of [[{word:'',start:0,end:1}],[{word:'Bad',start:NaN,end:1}],
    [{word:'Bad',start:1,end:3}],[{word:'One',start:0,end:1},{word:'Two',start:.8,end:2}]])assert.ok(captionValidation(words,2));
});
test('import rejects invalid project versions and unexpected archive entries',async()=>{
  const {browserZip}=await import('../src/services/browserZip');
  for(const entries of [[{name:'project.json',blob:new Blob(['{"version":999}'])}],[{name:'../secret',blob:new Blob(['bad'])}]])
    await assert.rejects(()=>browserZip(entries).then(zip=>importProject(new File([zip],'bad.zip'))));
});
test('streamed project import preserves a nested ZIP across chunk boundaries',async()=>{
  const {browserZip}=await import('../src/services/browserZip');
  const bytes=new Uint8Array(200_000).fill(42);
  const nested=await browserZip([{name:'render.mp4',blob:new Blob([bytes])}]);
  await saveRender({id:project.batch!.batch_id,state:project.batch!,files:{'0':new Blob([bytes]),zip:nested}});
  const restored=await importProject(new File([await exportProject(project)],'nested.zip'));
  const render=await getRender(restored.batch!.batch_id);
  assert.equal(render!.files.zip.size,nested.size);
  assert.deepEqual(new Uint8Array(await render!.files['0'].arrayBuffer()),bytes);
});
test('import rejects damaged subtitle timing before opening a project',async()=>{
  const {browserZip}=await import('../src/services/browserZip');
  const broken={...project,assets:[],result:{...project.result,clips:[{...project.result.clips[0],caption_words:[{word:'Bad',start:0,end:99}]}]}};
  const archive=await browserZip([{name:'project.json',blob:new Blob([JSON.stringify(broken)])}]);
  await assert.rejects(()=>importProject(new File([archive],'bad-timing.zip')),/subtitle timing/);
});

test('large render blobs use bounded records and survive replacement without stale chunks',async()=>{
  const id='batch_chunked_storage';
  const bytes=new Uint8Array(33*1024*1024);bytes[0]=17;bytes[bytes.length-1]=93;
  const blob=new Blob([bytes],{type:'video/mp4'});
  await saveRender({id,state:{...project.batch!,batch_id:id},files:{'0':blob,zip:new Blob(['original zip'])}});
  const saved=await getRender(id);
  assert.equal(saved!.files['0'].size,bytes.length);
  assert.equal(saved!.files['0'].type,'video/mp4');
  assert.equal(new Uint8Array(await saved!.files['0'].slice(-1).arrayBuffer())[0],93);
  const request=indexedDB.open('cheat_clip_workspace',2);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const records=await new Promise<{id:(string|number)[];blob:Blob}[]>((resolve,reject)=>{
    const transaction=db.transaction('renderFiles','readonly'),query=transaction.objectStore('renderFiles').getAll();
    transaction.oncomplete=()=>resolve(query.result.filter(item=>item.id[0]===id));transaction.onerror=()=>reject(transaction.error);
  });
  assert.equal(records.length,3);assert.ok(records.every(item=>item.blob.size<=32*1024*1024));
  await saveRender({id,state:{...project.batch!,batch_id:id},files:{'0':new Blob(['replacement'])}});
  const replaced=await getRender(id);
  assert.equal(await replaced!.files['0'].text(),'replacement');assert.equal(replaced!.files.zip,undefined);
  const remaining=await new Promise<number>((resolve,reject)=>{
    const transaction=db.transaction('renderFiles','readonly'),query=transaction.objectStore('renderFiles').getAllKeys();
    transaction.oncomplete=()=>resolve(query.result.filter(key=>Array.isArray(key)&&key[0]===id).length);transaction.onerror=()=>reject(transaction.error);
  });
  assert.equal(remaining,1);db.close();
});

test('reopening a server batch prefers its finished state over a stale saved snapshot and still works offline',async()=>{
  const state={...project.batch!,batch_id:'batch_recover_finished',overall_status:'running' as const};
  await saveRender({id:state.batch_id,state,files:{'0':new Blob(['finished'])}});
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({...state,overall_status:'completed',zip_url:'/api/download-batch-zip/finished'}));
    const online=await recoverRender(state);assert.equal(online.overall_status,'completed');assert.equal(online.zip_url,'/api/download-batch-zip/finished');
    globalThis.fetch=async()=>{throw new TypeError('Offline');};
    const offline=await recoverRender(state);assert.equal(offline.overall_status,'cancelled');assert.equal(offline.clips[0].status,'completed');
    assert.ok(offline.clips[0].download_url?.startsWith('blob:'));URL.revokeObjectURL(offline.clips[0].download_url!);
  } finally {globalThis.fetch=original;}
});

test('autosave reuses immutable media chunks while imports and new output URLs replace their bytes',async()=>{
  const id='batch_immutable_files';
  const state={...project.batch!,batch_id:id,clips:[{clip_index:0,title:'Done',status:'completed' as const,progress_percent:100,download_url:'/api/download-rendered/unique-one.mp4'}]};
  await saveRender({id,state,files:{'0':new Blob(['old']),zip:new Blob(['ZIP'])}});
  const original=IDBObjectStore.prototype.put;let writes=0;
  IDBObjectStore.prototype.put=function(value:unknown,key?:IDBValidKey){if(this.name==='renderFiles')writes++;return key===undefined?original.call(this,value):original.call(this,value,key);};
  try {
    await saveRender({id,state,files:{'0':new Blob(['old']),zip:new Blob(['ZIP'])}},{reuseUnchanged:true});assert.equal(writes,0);
    await saveRender({id,state,files:{'0':new Blob(['new']),zip:new Blob(['ZIP'])}});assert.equal(await (await getRender(id))!.files['0'].text(),'new');assert.equal(writes,2);
    const changed={...state,clips:[{...state.clips[0],download_url:'/api/download-rendered/unique-two.mp4'}]};
    await saveRender({id,state:changed,files:{'0':new Blob(['two']),zip:new Blob(['ZIP'])}},{reuseUnchanged:true});assert.equal(writes,4);assert.equal(await (await getRender(id))!.files['0'].text(),'two');
  } finally {IDBObjectStore.prototype.put=original;}
});
