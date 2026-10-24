import { Unzip,UnzipInflate } from 'fflate';
import { browserZip } from './browserZip';
import { getRender,saveRender,type SavedProject,type SavedRender } from './workspaceStore';
import {captionValidation} from '../utils/captionWords';
import type {CaptionWord} from '../types';

function validCaptionWords(value:unknown,duration:number) {
  return Array.isArray(value) && value.every(word=>word && typeof word.word==='string' && typeof word.start==='number' && typeof word.end==='number') && !captionValidation(value as CaptionWord[],duration);
}

export async function exportProject(project:SavedProject):Promise<Blob> {
  const render=project.batch?await getRender(project.batch.batch_id):undefined;
  const assets=project.assets.map((asset,i)=>({...asset,path:`assets/${i}`,blob:undefined}));
  const outputKeys=render?Object.keys(render.files):[];
  const manifest={...project,assets,render:render?{...render,files:undefined,outputKeys}:undefined};
  return browserZip([{name:'project.json',blob:new Blob([JSON.stringify(manifest)],{type:'application/json'})},
    ...project.assets.map((asset,i)=>({name:`assets/${i}`,blob:asset.blob})),
    ...outputKeys.map(key=>({name:`renders/${key}`,blob:render!.files[key]}))]);
}

export async function importProject(file:File):Promise<SavedProject> {
  const files=new Map<string,Blob>();let failure:Error|undefined;let count=0;let total=0;
  const unzip=new Unzip(entry=>{
    if(++count>1000 || !/^(project\.json|assets\/\d+|renders\/(\d+|zip))$/.test(entry.name)) {
      failure=new Error('Unsupported project archive entry');return;
    }
    const chunks:Uint8Array<ArrayBuffer>[]=[];
    entry.ondata=(error,data,final)=>{
      if(error){failure=error;return;}
      total+=data.length;
      if(total>8*1024**3 || (entry.name==='project.json' && chunks.reduce((n,c)=>n+c.length,0)+data.length>10*1024**2)) {
        failure=new Error('Project archive is too large');entry.terminate();return;
      }
      chunks.push(new Uint8Array(data));
      if(final)files.set(entry.name,new Blob(chunks));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  const reader=file.stream().getReader();
  try {
    while(true){const chunk=await reader.read();if(chunk.done)break;unzip.push(chunk.value);if(failure)throw failure;}
    unzip.push(new Uint8Array(),true);if(failure)throw failure;
  } finally {reader.releaseLock();}
  const manifest=files.get('project.json');if(!manifest)throw new Error('Missing project.json');
  const data=JSON.parse(await manifest.text());
  if(data.version!==1 || typeof data.id!=='string' || !data.result || typeof data.result.video_id!=='string' ||
    typeof data.result.title!=='string' || !Number.isFinite(data.result.duration) || !Array.isArray(data.result.clips) ||
    !Array.isArray(data.assets) || data.assets.length>100)throw new Error('Invalid or unsupported project');
  if(!data.result.clips.every((clip:Record<string,unknown>)=>clip && typeof clip.title==='string' &&
    typeof clip.start_time==='number' && typeof clip.end_time==='number' && Number.isFinite(clip.start_time) && Number.isFinite(clip.end_time) &&
    clip.start_time>=0 && clip.end_time>clip.start_time && (clip.caption_words===undefined || validCaptionWords(clip.caption_words,clip.end_time-clip.start_time))))
    throw new Error('Project contains invalid clip or subtitle timing');
  const assets=data.assets.map((asset:{name:string;kind:SavedProject['assets'][number]['kind'];path:string})=>{
    const blob=files.get(asset.path);if(!blob || typeof asset.name!=='string' || !['source','bgm','sfx','watermark','font'].includes(asset.kind))throw new Error('Missing or invalid project asset');
    return {name:asset.name,kind:asset.kind,blob};
  });
  if(data.render){
    const render:SavedRender={id:data.render.id,state:data.render.state,files:{},context:data.render.context};
    if(!(/^(client_|batch_)/.test(render.id || '')) || !Array.isArray(data.render.outputKeys) || !Array.isArray(render.state?.clips))throw new Error('Invalid saved render');
    for(const key of data.render.outputKeys){const blob=files.get(`renders/${key}`);if(!blob)throw new Error('Missing rendered clip');render.files[key]=blob;}
    await saveRender(render);
  }
  return {version:1,id:data.id,updated:Date.now(),result:data.result,marked:data.marked || {},draft:data.draft,assets,batch:data.batch};
}
