import {browserZip} from '../services/browserZip';
import { useCallback,useEffect,useEffectEvent,useRef,useState } from 'react';
import type { StudioDraft } from '../components/studio/preferences';
import { captureAssets,reopenAssets } from '../services/projectAssets';
import { getProject,getRender,listProjects,saveProject,saveRender,type SavedProject } from '../services/workspaceStore';
import type { AnalyzeResponse,BatchRenderProgress } from '../types';
import {mediaAssetUrl} from '../utils/mediaAssets';
import { getErrorMessage } from '../utils/errors';

interface WorkspaceOptions {
  result:AnalyzeResponse|null;marked:Record<string,boolean>;file:File|null;batch:BatchRenderProgress|null;
  onOpen:(project:SavedProject)=>void;
}
export function useProjectWorkspace({result,marked,file,batch,onOpen}:WorkspaceOptions) {
  const [projects,setProjects]=useState<SavedProject[]>([]);
  const [drafts,setDrafts]=useState<Record<string,StudioDraft>>({});
  const [status,setStatus]=useState('');
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const restoring=useRef(false);
  const queue=useRef(Promise.resolve());
  const refresh=useCallback(async()=>setProjects((await listProjects()).sort((a,b)=>b.updated-a.updated)),[]);
  const open=useCallback(async(project:SavedProject)=>{
    restoring.current=true;setBusy(true);
    try {
      await queue.current.catch(()=>{});
      const restored=await reopenAssets(project);
      setDrafts(prev=>({...prev,[restored.id]:restored.draft || {}}));
      onOpen(restored);setRevision(v=>v+1);localStorage.setItem('cheat_clip_last_project',restored.id);
      setStatus('Project opened.');
    } catch(error){setStatus(getErrorMessage(error));}
    finally {restoring.current=false;setBusy(false);}
  },[onOpen]);
  const openLatest=useEffectEvent(async()=>{
    try {
      const id=localStorage.getItem('cheat_clip_last_project');
      if(id){const project=await getProject(id);if(project)await open(project);}
    } catch(error){setStatus(getErrorMessage(error));}
  });
  useEffect(()=>{
    let disposed=false;
    void listProjects().then(items=>{if(!disposed){setProjects(items.sort((a,b)=>b.updated-a.updated));void openLatest();}}).catch(error=>{if(!disposed)setStatus(getErrorMessage(error));});
    return ()=>{disposed=true;};
  },[]);
  const currentDraft=result?drafts[result.video_id]:undefined;
  const onDraftChange=useCallback((draft:StudioDraft)=>{
    if(result)setDrafts(prev=>({...prev,[result.video_id]:draft}));
  },[result]);
  const snapshot=useRef({result,marked,file,batch,draft:currentDraft});
  useEffect(()=>{snapshot.current={result,marked,file,batch,draft:currentDraft};},[result,marked,file,batch,currentDraft]);
  const save=useCallback(async()=>{
    const input=snapshot.current;
    if(!input.result || restoring.current)return;
    const result=input.result;
    const task=async()=>{
      setStatus('Saving project…');
      const previous=await getProject(result.video_id);
      const assets=await captureAssets(result,input.draft,input.file,previous?.assets);
      const batch=input.batch && (input.batch.video_id===result.video_id || previous?.batch?.batch_id===input.batch.batch_id)?input.batch:undefined;
      const project:SavedProject={version:1,id:result.video_id,updated:Date.now(),result:structuredClone(result),marked:input.marked,
        draft:input.draft,assets,batch};
      // Blob URLs are process-local. The actual source and outputs are stored separately.
      if(project.result.video_url?.startsWith('blob:'))project.result.video_url=`/api/video/${result.video_id}`;
      if(batch && !batch.batch_id.startsWith('client_')){
        const previousRender=await getRender(batch.batch_id);
        const files:Record<string,Blob>={};
        for(const clip of batch.clips)if(clip.status==='completed' && clip.download_url){
          const existing=previousRender?.state.clips.find(c=>c.clip_index===clip.clip_index);
          if(existing?.download_url===clip.download_url && previousRender?.files[String(clip.clip_index)])files[String(clip.clip_index)]=previousRender.files[String(clip.clip_index)];
          else {const response=await fetch(mediaAssetUrl(clip.download_url,'audio')!);if(!response.ok)throw new Error('Completed render unavailable');files[String(clip.clip_index)]=await response.blob();}
        }
        if(Object.keys(files).length){files.zip=await browserZip(batch.clips.filter(c=>files[String(c.clip_index)]).map(c=>({name:`${c.title.replace(/[\\/*?:"<>|]/g,'') || 'clip'}.mp4`,blob:files[String(c.clip_index)]})));}
        await saveRender({id:batch.batch_id,state:batch,files});
      }
      await saveProject(project);localStorage.setItem('cheat_clip_last_project',project.id);
      await refresh();setStatus('Saved on this device.');
    };
    queue.current=queue.current.catch(()=>{}).then(task);
    try {await queue.current;}catch(error){setStatus(`Save failed: ${getErrorMessage(error)}`);throw error;}
  },[refresh]);
  useEffect(()=>{
    if(!result)return;
    const timer=setTimeout(()=>{void save().catch(()=>{});},700);
    return ()=>clearTimeout(timer);
  },[result,marked,currentDraft,file,batch,save]);
  const exportCurrent=async()=>{
    if(!result)return;setBusy(true);
    try {await save();const project=await getProject(result.video_id);if(!project)throw new Error('Project could not be saved');
      const {exportProject}=await import('../services/projectArchive');return {blob:await exportProject(project),name:result.title};
    } catch(error){setStatus(getErrorMessage(error));}finally {setBusy(false);}
  };
  const importFile=async(file:File)=>{
    setBusy(true);
    try {const {importProject}=await import('../services/projectArchive');const project=await importProject(file);await saveProject(project);await refresh();await open(project);}
    catch(error){setStatus(getErrorMessage(error));}finally{setBusy(false);}
  };
  return {projects,status,busy,initialDraft:currentDraft,onDraftChange,revision,save,open,exportCurrent,importFile};
}
