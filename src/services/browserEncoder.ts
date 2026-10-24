import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, canEncodeVideo } from 'mediabunny';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { composedFrames, mediaAssetUrl, prepareBrowserPlan, type BrowserRenderOptions, type BrowserPlan, type DecoderFallback, type FrameSink } from './browserCompositor';

let ffmpeg: FFmpeg | undefined;
let loading: Promise<FFmpeg> | undefined;
let exclusive: Promise<void> = Promise.resolve();

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;
  if (!loading) loading = (async()=>{
    const instance = new FFmpeg();
    try { await instance.load({ coreURL, wasmURL }); ffmpeg=instance; return instance; }
    catch(error) { loading=undefined; throw error; }
  })();
  return loading;
}

export async function withFFmpeg<T>(work: (instance: FFmpeg)=>Promise<T>): Promise<T> {
  const previous=exclusive; let release!: ()=>void;
  exclusive=new Promise<void>(resolve=>{release=resolve;});
  await previous;
  try { return await work(await getFFmpeg()); }
  catch(error) {
    // A fatal WASM abort poisons its worker; the next retry must load a fresh one.
    if(error instanceof Error && /Aborted|memory access|out of memory/i.test(error.message)) {
      ffmpeg?.terminate();ffmpeg=undefined;loading=undefined;
    }
    throw error;
  } finally { release(); }
}

async function execute(instance: FFmpeg,args: string[]) {
  const messages:string[]=[]; const listener=({message}:{message:string})=>{messages.push(message);if(messages.length>24)messages.shift();};
  instance.on('log',listener);
  try { if(await instance.exec(args)!==0) throw new Error(`Browser encoding failed: ${messages.join("\n")}`); }
  catch(error) {throw new Error(`Browser encoding failed: ${messages.join("\n")}\n${error instanceof Error?error.message:String(error)}`,{cause:error});}
  finally { instance.off('log',listener); }
}

export interface BrowserBatchOptions extends BrowserRenderOptions { segments?: BrowserRenderOptions[] }

/** Hardware and software encoders consume the same composited frames and audio mix. */
export async function encodeBrowser(options: BrowserBatchOptions, engine:'gpu'|'wasm'): Promise<Blob> {
  return withFFmpeg(async instance=>{
    const plans: BrowserPlan[]=[];
    const files = new Set<string>();
    const prefix=`render_${Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')}`;
    const filename=(name:string)=>{const result=`${prefix}_${name}`;files.add(result);return result;};
    const cached = new Map<string,string>();
    async function inputFile(url:string) {
      if(cached.has(url))return cached.get(url)!;
      const name=filename(`asset_${cached.size}`);await instance.writeFile(name,await fetchFile(url));cached.set(url,name);return name;
    }
    const segments=options.segments || [options];
    try {
      for(const segment of segments) plans.push(await prepareBrowserPlan({...segment,onProgress:options.onProgress,decoderFallback:async(url)=>createFFmpegDecoder(instance,await inputFile(url),prefix,files)}));
      let titleOffset=0;
      for(const plan of plans){plan.titleTimeOffset=titleOffset;titleOffset+=plan.duration;}
      const duration=plans.reduce((sum,p)=>sum+p.duration,0);
      const videoName=filename('video.mp4');
      if(engine==='gpu') {
        const canvas=plans[0].canvas;
        if(!await canEncodeVideo('avc',{width:canvas.width,height:canvas.height,bitrate:4_500_000})) throw new Error('H.264 encoding is unavailable in this browser');
        const target=new BufferTarget();
        const output=new Output({format:new Mp4OutputFormat(),target});
        const source=new CanvasSource(canvas,{codec:'avc',bitrate:4_500_000,hardwareAcceleration:'prefer-hardware'});
        output.addVideoTrack(source,{frameRate:30});
        await output.start();
        let offset=0;
        try {
          for(let i=0;i<plans.length;i++) {
            const plan=plans[i];
            for await(const frame of composedFrames(plan,segments[i])) {
              if(plan.canvas!==canvas) canvas.getContext('2d')!.drawImage(plan.canvas,0,0);
              await source.add(offset+frame.time,frame.duration);
              if(frame.index%15===0) options.onProgress?.(15+Math.round((offset+frame.time)/duration*65),'Encoding composited video on your GPU...');
            }
            offset+=plan.duration;
          }
          source.close();await output.finalize();
          if(!target.buffer) throw new Error('No encoded GPU video was produced');
          await instance.writeFile(videoName,new Uint8Array(target.buffer));
        } catch(error) { await output.cancel(); throw error; }
      } else {
        // Encode bounded groups of JPEG frames; never keep an entire uncompressed clip in RAM.
        const chunks:string[]=[];let frameNames:string[]=[];let total=0;let chunkIndex=0;
        const flush=async()=>{
          if(!frameNames.length)return;
          const chunk=filename(`chunk_${chunkIndex++}.mp4`);chunks.push(chunk);
          await execute(instance,['-framerate','30','-i',`${prefix}_frame_%03d.jpg`,'-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-an',chunk]);
          for(const name of frameNames){await instance.deleteFile(name);files.delete(name);}frameNames=[];
        };
        for(let i=0;i<plans.length;i++) {
          for await(const frame of composedFrames(plans[i],segments[i])) {
            const blob=await new Promise<Blob>((resolve,reject)=>plans[i].canvas.toBlob(result=>result?resolve(result):reject(new Error('Could not compose frame')),'image/jpeg',.95));
            const name=filename(`frame_${String(frameNames.length).padStart(3,'0')}.jpg`);
            frameNames.push(name);await instance.writeFile(name,new Uint8Array(await blob.arrayBuffer()));
            total++;
            if(frameNames.length===30) await flush();
            if(frame.index%15===0) options.onProgress?.(15+Math.round(total/(duration*30)*65),'Encoding composited video with WASM...');
          }
        }
        await flush();
        const list=filename('chunks.txt');await instance.writeFile(list,chunks.map(name=>`file '${name}'`).join('\n'));
        await execute(instance,['-f','concat','-safe','0','-i',list,'-c','copy','-t',String(duration),videoName]);
        for(const name of chunks){await instance.deleteFile(name);files.delete(name);}
      }
      options.onProgress?.(85,'Mixing voice, background music and hook sound...');
      const inputs=['-i',videoName], filters:string[]=[], audioNames:string[]=[];
      let inputIndex=1;
      for(let i=0;i<plans.length;i++) {
        if(plans[i].hasAudio) {
          inputs.push('-i',await inputFile(segments[i].videoSourceUrl));
          filters.push(`[${inputIndex++}:a]atrim=start=${plans[i].start}:duration=${plans[i].duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${plans[i].duration}[voice${i}]`);
        } else filters.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${plans[i].duration}[voice${i}]`);
        audioNames.push(`[voice${i}]`);
      }
      filters.push(`${audioNames.join('')}concat=n=${plans.length}:v=0:a=1,volume=${(plans[0].settings.originalAudioVolume ?? 100)/100}[voice]`);
      const mix=['[voice]'];const settings=plans[0].settings;
      const bgm=mediaAssetUrl(settings.bgmFilePath,'audio');
      if(settings.bgmEnabled && bgm) {
        inputs.push('-stream_loop','-1','-i',await inputFile(bgm));
        filters.push(`[${inputIndex++}:a]atrim=start=${settings.bgmStartOffset || 0}:duration=${duration},asetpts=PTS-STARTPTS,volume=${(settings.bgmVolume ?? 25)/100},afade=t=out:st=${Math.max(0,duration-1.5)}:d=1.5[bgm]`);mix.push('[bgm]');
      }
      const sfx=mediaAssetUrl(settings.hookSfxFilePath,'audio');
      if(settings.hookSfxEnabled && sfx) {
        inputs.push('-i',await inputFile(sfx));
        filters.push(`[${inputIndex++}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,volume=${(settings.hookSfxVolume ?? 100)/100}[sfx]`);mix.push('[sfx]');
      }
      filters.push(`${mix.join('')}amix=inputs=${mix.length}:duration=first:normalize=0[audio]`);
      const out=filename('output.mp4');
      await execute(instance,[...inputs,'-filter_complex',filters.join(';'),'-map','0:v','-map','[audio]','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',out]);
      const data=await instance.readFile(out);
      if(typeof data==='string')throw new Error('Invalid encoded media');
      options.onProgress?.(100,'Rendering complete');
      return new Blob([new Uint8Array(data)],{type:'video/mp4'});
    } finally {
      plans.forEach(plan=>plan.input?.dispose());
      for(const file of files)try {await instance.deleteFile(file);}catch{/* Already removed after encoding a chunk. */}
    }
  });
}


async function createFFmpegDecoder(instance:FFmpeg, source:string, prefix:string, files:Set<string>):Promise<DecoderFallback> {
  const metadata:string[]=[];
  const listener=({message}:{message:string})=>metadata.push(message);
  instance.on('log',listener);
  const probe=`${prefix}_probe.png`;files.add(probe);
  try {await execute(instance,['-y','-hide_banner','-nostats','-i',source,'-map','0:v:0','-frames:v','1','-c:v','png','-threads','1','-update','1',probe]);}
  finally {instance.off('log',listener);}
  const text=metadata.join('\n');
  const match=text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if(!match)throw new Error('Could not read source video duration');
  const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;
  let bucket=-1, names:string[]=[];
  const framePrefix=`${prefix}_decode_${files.size}_`;
  const sink:FrameSink={
    async getCanvas(time) {
      const next=Math.floor(time/.5);
      if(next!==bucket) {
        for(const name of names){await instance.deleteFile(name);files.delete(name);}
        await execute(instance,['-y','-ss',String(next*.5),'-i',source,'-t','0.5','-vf','fps=30','-c:v','png','-threads','1',`${framePrefix}%04d.png`]);
        names=(await instance.listDir('.')).map(entry=>entry.name).filter(name=>name.startsWith(framePrefix)).sort();
        names.forEach(name=>files.add(name));bucket=next;
      }
      if(!names.length)return null;
      const index=Math.max(0,Math.min(names.length-1,Math.floor((time-bucket*.5)*30)));
      const data=await instance.readFile(names[index]);
      if(typeof data==='string')throw new Error('Invalid decoded frame');
      const image=await createImageBitmap(new Blob([new Uint8Array(data)],{type:'image/png'}));
      canvas.width=image.width;canvas.height=image.height;context.drawImage(image,0,0);image.close();
      return {canvas};
    },
    async *canvasesAtTimestamps(times) {for(const time of times)yield await sink.getCanvas(time);},
  };
  return {sink,duration,hasAudio:text.includes('Audio:')};
}

export async function encodeRawBrowser(options:BrowserRenderOptions):Promise<Blob> {
  return withFFmpeg(async instance=>{
    const prefix=`raw_${Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('')}`,input=prefix+'_in',output=prefix+'.mp4';
    try {
      await instance.writeFile(input,await fetchFile(options.videoSourceUrl));
      const args=['-y','-ss',String(options.startTime || 0),'-i',input];
      if(options.endTime!==undefined)args.push('-t',String(options.endTime-(options.startTime || 0)));
      await execute(instance,[...args,'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac','-movflags','+faststart',output]);
      const data=await instance.readFile(output);if(typeof data==='string')throw new Error('Invalid raw video output');
      return new Blob([new Uint8Array(data)],{type:'video/mp4'});
    } finally {for(const path of [input,output])try{await instance.deleteFile(path);}catch{/* No partial output left. */}}
  });
}
