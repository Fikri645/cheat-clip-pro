import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { exportProject, importProject } from '../src/services/projectArchive';
import { getProject, getRender, restoreRender, saveProject, saveRender, type SavedProject } from '../src/services/workspaceStore';
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
