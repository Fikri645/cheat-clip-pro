import type { StudioDraft } from '../components/studio/preferences';
import type { AnalyzeResponse,FontItem } from '../types';
import {mediaAssetUrl} from '../utils/mediaAssets';
import type { ProjectAsset,SavedProject } from './workspaceStore';

async function download(url:string,previous:ProjectAsset[]) {
  const saved=previous.find(asset=>asset.url===url);if(saved)return saved.blob;
  const response=await fetch(url);
  if(!response.ok || response.headers.get('content-type')?.includes('text/html'))throw new Error('Project asset unavailable. Reattach the missing media before saving.');
  return response.blob();
}
export async function captureAssets(result:AnalyzeResponse,draft:StudioDraft|undefined,file:File|null,previous:ProjectAsset[]=[]):Promise<ProjectAsset[]> {
  const assets:ProjectAsset[]=[];
  if(file)assets.push({kind:'source',name:file.name,blob:file});
  else if(result.source_type!=='youtube' && /^(upload_|gdrive_)/.test(result.video_id)) {
    const url=result.video_url || `/api/video/${result.video_id}`;
    const name=url.split('/').pop()?.split('?')[0] || 'source.mp4';
    assets.push({kind:'source',name,url,blob:await download(url,previous)});
  }
  for(const [kind,path,name] of [
    ['bgm',draft?.bgmFilePath,draft?.bgmFileName],['sfx',draft?.hookSfxFilePath,draft?.hookSfxFileName],
    ['watermark',draft?.watermarkImageFilePath,draft?.watermarkImageFileName],
  ] as const)if(path){const url=mediaAssetUrl(path,kind==='watermark'?'watermark':'audio')!;assets.push({kind,name:name || path.split(/[\\/]/).pop()!,url,blob:await download(url,previous)});}
  if(draft?.captionFont || draft?.titleFont){
    const response=await fetch('/api/fonts');
    if(!response.ok)throw new Error('Could not save the project font library');
    const data=await response.json();
    for(const font of (data.fonts || []) as FontItem[])if(font.is_custom && font.url && [draft.captionFont,draft.titleFont].includes(font.name))
      assets.push({kind:'font',name:font.filename || `${font.name}.ttf`,url:font.url,blob:await download(font.url,previous)});
  }
  return assets;
}

export async function reopenAssets(saved:SavedProject):Promise<SavedProject> {
  const project=structuredClone(saved),draft=project.draft ||= {};
  for(const asset of project.assets){
    const existing=asset.kind==='source'?project.result.video_url:asset.kind==='font'?`/api/font-file/${encodeURIComponent(asset.name)}`:
      mediaAssetUrl(asset.kind==='bgm'?draft.bgmFilePath:asset.kind==='sfx'?draft.hookSfxFilePath:draft.watermarkImageFilePath,asset.kind==='watermark'?'watermark':'audio');
    if(existing && !existing.startsWith('blob:')){
      const response=await fetch(existing,{headers:{Range:'bytes=0-0'}});
      await response.body?.cancel();
      if(response.ok && !response.headers.get('content-type')?.includes('text/html'))continue;
    }
    const form=new FormData();form.append('file',asset.blob,asset.name);
    const endpoint={source:'video',bgm:'bgm',sfx:'sfx',watermark:'watermark',font:'font'}[asset.kind];
    const response=await fetch(`/api/upload-${endpoint}`,{method:'POST',body:form}),data=await response.json();
    if(!response.ok)throw new Error(data.detail || `Could not restore ${asset.name}`);
    if(asset.kind==='source')project.result.video_url=data.video_url;
    if(asset.kind==='bgm'){draft.bgmFilePath=data.file_path;draft.bgmAudioUrl=data.url;}
    if(asset.kind==='sfx'){draft.hookSfxFilePath=data.file_path;draft.hookSfxAudioUrl=data.url;}
    if(asset.kind==='watermark'){draft.watermarkImageFilePath=data.file_path;draft.watermarkImageUrl=data.url;}
  }
  return project;
}
