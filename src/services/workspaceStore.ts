import type { StudioDraft } from '../components/studio/preferences';
import type { AnalyzeResponse,BatchRenderProgress,RenderSettings } from '../types';

export interface ProjectAsset {url?:string;name:string;kind:'source'|'bgm'|'sfx'|'watermark'|'font';blob:Blob}
export interface SavedProject {
  version:1; id:string; updated:number; result:AnalyzeResponse; marked:Record<string,boolean>;
  draft?:StudioDraft; assets:ProjectAsset[]; batch?:BatchRenderProgress;
}
export interface SavedRender {id:string;state:BatchRenderProgress;files:Record<string,Blob>;context?:{settings:RenderSettings;result:AnalyzeResponse}}

let opening:Promise<IDBDatabase>|undefined;
function database() {
  return opening ||= new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('cheat_clip_workspace',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('projects',{keyPath:'id'});
      request.result.createObjectStore('renders',{keyPath:'id'});
    };
    request.onsuccess=()=>resolve(request.result);
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
export const saveRender=(render:SavedRender)=>access('renders','readwrite',store=>store.put(render));
export const getRender=(id:string)=>access<SavedRender|undefined>('renders','readonly',store=>store.get(id));

export function restoreRender(saved:SavedRender):BatchRenderProgress {
  return {...saved.state,overall_status:['running','cancelling'].includes(saved.state.overall_status)?'cancelled':saved.state.overall_status,
    clips:saved.state.clips.map(clip=>({...clip,
      status:clip.status==='completed' && saved.files[String(clip.clip_index)]?'completed':clip.status==='error'?'error':'cancelled',
      download_url:saved.files[String(clip.clip_index)]?URL.createObjectURL(saved.files[String(clip.clip_index)]):undefined})),
    zip_url:saved.files.zip?URL.createObjectURL(saved.files.zip):undefined};
}
