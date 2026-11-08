import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {getProject,getRender} from '../src/services/workspaceStore';

test('upgrading to chunked media storage preserves version-one projects and rendered files',async()=>{
  const request=indexedDB.open('cheat_clip_workspace',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('projects',{keyPath:'id'});request.result.createObjectStore('renders',{keyPath:'id'});};
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction(['projects','renders'],'readwrite');
    transaction.objectStore('projects').put({version:1,id:'legacy_project',result:{title:'Original project'}});
    transaction.objectStore('renders').put({id:'batch_legacy',state:{batch_id:'batch_legacy',overall_status:'completed',clips:[]},files:{'0':new Blob(['original video']),zip:new Blob(['original ZIP'])}});
    transaction.oncomplete=()=>resolve();transaction.onerror=()=>reject(transaction.error);
  });
  db.close();
  assert.equal((await getProject('legacy_project'))!.result.title,'Original project');
  const rendered=await getRender('batch_legacy');
  assert.equal(await rendered!.files['0'].text(),'original video');
  assert.equal(await rendered!.files.zip.text(),'original ZIP');
});
