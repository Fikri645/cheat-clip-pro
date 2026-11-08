import type { StudioDraft } from '../components/studio/preferences';
import type { AnalyzeResponse,BatchRenderProgress,RenderSettings } from '../types';

export interface ProjectAsset {url?:string;name:string;kind:'source'|'bgm'|'sfx'|'watermark'|'font';blob:Blob}
export interface SavedProject {
  version:1; id:string; updated:number; result:AnalyzeResponse; marked:Record<string,boolean>;
  draft?:StudioDraft; assets:ProjectAsset[]; batch?:BatchRenderProgress;
}
export interface SavedRender {id:string;state:BatchRenderProgress;files:Record<string,Blob>;context?:{settings:RenderSettings;result:AnalyzeResponse}}
interface StoredRender extends SavedRender {storedFiles?:Record<string,{chunks:number;size:number;type:string}>}
const CHUNK_BYTES=32*1024*1024;

let opening:Promise<IDBDatabase>|undefined;
function database() {
  return opening ||= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('cheat_clip_workspace',2);
    request.onupgradeneeded=event=>{
      if(event.oldVersion<1){
        request.result.createObjectStore('projects',{keyPath:'id'});
        request.result.createObjectStore('renders',{keyPath:'id'});
      }
      if(event.oldVersion<2)request.result.createObjectStore('renderFiles',{keyPath:'id'});
    };
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>{db.close();opening=undefined;};
      resolve(db);
    };
    request.onblocked=()=>{opening=undefined;reject(new Error('Close other Auto Clipper tabs to upgrade project storage, then retry saving.'));};
    request.onerror=()=>{opening=undefined;reject(request.error);};
  });
}
async function access<T>(store:'projects'|'renders',mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(store,mode),request=work(transaction.objectStore(store));
    transaction.oncomplete=()=>resolve(request.result);
    transaction.onabort=()=>reject(transaction.error || request.error || new Error('Storage transaction aborted'));
    transaction.onerror=()=>reject(transaction.error || request.error);
  });
}
export const saveProject=(project:SavedProject)=>access('projects','readwrite',store=>store.put(project));
export const getProject=(id:string)=>access<SavedProject|undefined>('projects','readonly',store=>store.get(id));
export const listProjects=()=>access<SavedProject[]>('projects','readonly',store=>store.getAll());
export const deleteProject=(id:string)=>access('projects','readwrite',store=>store.delete(id));
export async function saveRender(render:SavedRender):Promise<void> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(['renders','renderFiles'],'readwrite');
    const renders=transaction.objectStore('renders'),files=transaction.objectStore('renderFiles');
    const previous=renders.get(render.id);
    previous.onsuccess=()=>{
      const old=previous.result as StoredRender|undefined;
      const storedFiles:NonNullable<StoredRender['storedFiles']>={};
      // Each Blob is written in bounded records. A large batch and its ZIP must
      // never become one multi-gigabyte IndexedDB value or one huge Blob write.
      for(const [key,blob] of Object.entries(render.files)) {
        const chunks=Math.ceil(blob.size/CHUNK_BYTES);
        storedFiles[key]={chunks,size:blob.size,type:blob.type};
        for(let part=0;part<chunks;part++)files.put({id:[render.id,key,part],blob:blob.slice(part*CHUNK_BYTES,(part+1)*CHUNK_BYTES)});
      }
      for(const [key,file] of Object.entries(old?.storedFiles || {}))
        for(let part=storedFiles[key]?.chunks || 0;part<file.chunks;part++)files.delete([render.id,key,part]);
      renders.put({...render,files:{},storedFiles});
    };
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(transaction.error || previous.error || new Error('Could not save rendered media'));
    transaction.onerror=()=>reject(transaction.error || previous.error || new Error('Could not save rendered media'));
  });
}
export async function getRender(id:string):Promise<SavedRender|undefined> {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(['renders','renderFiles'],'readonly');
    const request=transaction.objectStore('renders').get(id);
    const chunks=new Map<string,Blob[]>();let saved:StoredRender|undefined;
    request.onsuccess=()=>{
      saved=request.result as StoredRender|undefined;
      for(const [key,file] of Object.entries(saved?.storedFiles || {})) {
        const parts:Blob[]=[];chunks.set(key,parts);
        for(let part=0;part<file.chunks;part++) {
          const item=transaction.objectStore('renderFiles').get([id,key,part]);
          item.onsuccess=()=>{if(item.result?.blob)parts[part]=item.result.blob;};
        }
      }
    };
    transaction.oncomplete=()=>{
      if(!saved){resolve(undefined);return;}
      const {storedFiles,...render}=saved;
      for(const [key,file] of Object.entries(storedFiles || {})) {
        const parts=chunks.get(key) || [];
        if(parts.filter(Boolean).length!==file.chunks){reject(new Error('Saved video is incomplete; restore it from the server or project archive.'));return;}
        const blob=new Blob(parts,{type:file.type});
        if(blob.size!==file.size){reject(new Error('Saved video size does not match its project.'));return;}
        render.files[key]=blob;
      }
      resolve(render);
    };
    transaction.onabort=()=>reject(transaction.error || request.error || new Error('Could not open rendered media'));
    transaction.onerror=()=>reject(transaction.error || request.error || new Error('Could not open rendered media'));
  });
}

export function restoreRender(saved:SavedRender):BatchRenderProgress {
  return {...saved.state,overall_status:['running','cancelling'].includes(saved.state.overall_status)?'cancelled':saved.state.overall_status,
    clips:saved.state.clips.map(clip=>({...clip,
      status:clip.status==='completed' && saved.files[String(clip.clip_index)]?'completed':clip.status==='error'?'error':'cancelled',
      download_url:saved.files[String(clip.clip_index)]?URL.createObjectURL(saved.files[String(clip.clip_index)]):undefined})),
    zip_url:saved.files.zip?URL.createObjectURL(saved.files.zip):undefined};
}

export async function recoverRender(state:BatchRenderProgress):Promise<BatchRenderProgress> {
  if(state.batch_id.startsWith('batch_'))try {
    const response=await fetch(`/api/render-batch/${encodeURIComponent(state.batch_id)}`,{signal:AbortSignal.timeout(5000)});
    if(response.ok){
      const current=await response.json() as BatchRenderProgress;
      if(current.batch_id===state.batch_id && Array.isArray(current.clips))return current;
    }
  } catch { /* The complete local render remains available offline. */ }
  const saved=await getRender(state.batch_id);
  return saved?restoreRender(saved):state;
}
