import { useRef } from 'react';
import type { useProjectWorkspace } from '../hooks/useProjectWorkspace';
import { triggerBrowserDownload } from '../services/clientRenderer';

export function ProjectLibrary({workspace,hasProject,disabled}:{workspace:ReturnType<typeof useProjectWorkspace>;hasProject:boolean;disabled:boolean}) {
  const input=useRef<HTMLInputElement>(null);
  return <section className="project-panel" aria-label="Saved projects">
    <h2>Projects / Proyek</h2>
    <p>Autosave keeps your edits and media on this device. Export a project to move it to another browser or computer.</p>
    <div className="project-actions">
      <button type="button" disabled={!hasProject || workspace.busy} onClick={()=>void workspace.save().catch(()=>{})}>Save now</button>
      <button type="button" disabled={!hasProject || workspace.busy || disabled} onClick={()=>void workspace.exportCurrent().then(result=>{if(result)triggerBrowserDownload(result.blob,`${result.name.replace(/[\\/*?:"<>|]/g,'')}.cheatclip.zip`);})}>Export project</button>
      <button type="button" disabled={workspace.busy || disabled} onClick={()=>input.current?.click()}>Import project</button>
      <input ref={input} type="file" accept=".zip,.cheatclip" hidden onChange={e=>{const file=e.target.files?.[0];if(file)void workspace.importFile(file);e.target.value='';}}/>
    </div>
    <p role="status">{workspace.status}</p>
    {workspace.projects.length>0 && <details><summary>Saved projects ({workspace.projects.length})</summary><ul>
      {workspace.projects.map(project=><li key={project.id}><button type="button" disabled={disabled || workspace.busy} onClick={()=>void workspace.open(project)}>{project.result.title}</button> <small>{new Date(project.updated).toLocaleString()}</small></li>)}
    </ul></details>}
  </section>;
}
