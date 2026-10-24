import {mediaAssetUrl} from '../utils/mediaAssets';
export {mediaAssetUrl} from '../utils/mediaAssets';
import { ALL_FORMATS,BlobSource,CanvasSink,Input,UrlSource } from 'mediabunny';
import type { RenderSettings,TranscriptLine,ViralClip } from '../types';

export interface CropPoint { time: number; cx: number; cy: number; w: number; h: number; cut?: boolean }
export interface CaptionWord { word: string; word_text?:string; start: number; end: number }
interface CaptionEvent { start:number;end:number;words:CaptionWord[];active_index:number }
interface CaptionStyle { highlight:string;outline:string;outlineWidth:number;shadowWidth:number }
export interface FrameSink {
  getCanvas(time:number):Promise<{canvas:HTMLCanvasElement|OffscreenCanvas}|null>;
  canvasesAtTimestamps(times:Iterable<number>):AsyncGenerator<{canvas:HTMLCanvasElement|OffscreenCanvas}|null>;
}
export interface DecoderFallback { sink:FrameSink; duration:number; hasAudio:boolean }
export interface BrowserRenderOptions {
  videoSourceUrl: string;
  startTime?: number;
  endTime?: number;
  aspectRatio: string;
  backgroundStyle: string;
  titleText?: string;
  fileName?: string;
  settings?: RenderSettings;
  clip?: ViralClip;
  transcript?: TranscriptLine[];
  audioSource?: string;
  audioSourceStart?: number;
  timelineStart?: number;
  onProgress?: (percent: number, stage: string) => void;
  signal?: AbortSignal;
  decoderFallback?: (url:string)=>Promise<DecoderFallback>;
}
export interface BrowserPlan {
  input: Input|null; sink: FrameSink; hasAudio:boolean; canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D; duration: number; start: number;
  words: CaptionWord[]; captionEvents:CaptionEvent[]; captionStyle:CaptionStyle; trajectory: CropPoint[]; settings: RenderSettings;
  dispose:()=>void; title: string; titleTimeOffset?:number; watermark?: HTMLImageElement;
}

export function cropAt(points: CropPoint[], time: number): CropPoint {
  if (!points.length) return { time, cx: .5, cy: .35, w: .22, h: .25 };
  const next = points.findIndex(point => point.time > time);
  if (next < 0) return points[points.length-1];
  if (next === 0) return points[0];
  const a = points[next-1], b = points[next];
  const t = b.cut ? 0 : Math.max(0, Math.min(1, (time-a.time)/(b.time-a.time)));
  return { time, cx: a.cx+(b.cx-a.cx)*t, cy: a.cy+(b.cy-a.cy)*t, w: a.w+(b.w-a.w)*t, h: a.h+(b.h-a.h)*t };
}


function defaultSettings(options: BrowserRenderOptions): RenderSettings {
  return options.settings || {
    aspectRatio: options.aspectRatio as RenderSettings['aspectRatio'], backgroundStyle: options.backgroundStyle === 'black' ? 'black' : 'blurred',
    enableFaceTracking: false, streamerPreset: 'none', titlePosition: 'auto',
    captionStyle: 'none', captionFont: 'Outfit', fontSize: 'medium', textCase: 'uppercase', selectedClips: [],
    titleText: options.titleText,
  };
}

export async function prepareBrowserPlan(options: BrowserRenderOptions): Promise<BrowserPlan> {
  options.signal?.throwIfAborted();
  const source = options.videoSourceUrl.startsWith('blob:')
    ? new BlobSource(await (await fetch(options.videoSourceUrl, { signal: options.signal })).blob())
    : new UrlSource(options.videoSourceUrl);
  let input:Input|null = new Input({ source, formats: ALL_FORMATS });
  const abortInput=()=>input?.dispose();options.signal?.addEventListener('abort',abortInput,{once:true});
  const dispose=()=>{options.signal?.removeEventListener('abort',abortInput);input?.dispose();};
  try {
    let sink:FrameSink, sourceDuration:number, hasAudio:boolean;
    try {
      if(typeof VideoDecoder!=='function')throw new Error('Native decoding is unavailable');
      const video = await input.getPrimaryVideoTrack();
      if (!video || !await video.canDecode()) throw new Error('Native source decoding unavailable');
      sourceDuration = await input.computeDuration();
      hasAudio = !!await input.getPrimaryAudioTrack();
      sink = new CanvasSink(video, { poolSize: 3 });
    } catch(error) {
      if(!options.decoderFallback)throw error;
      input.dispose();input=null;
      const fallback=await options.decoderFallback(options.videoSourceUrl);
      sink=fallback.sink;sourceDuration=fallback.duration;hasAudio=fallback.hasAudio;
    }
    const start = options.startTime ?? 0;
    const duration = Math.min(options.endTime ?? sourceDuration, sourceDuration)-start;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid clip duration');
    const settings = defaultSettings(options);
    const frames: {time: number; jpeg: string}[] = [];
    if (settings.enableFaceTracking || settings.streamerPreset !== 'none') {
      options.onProgress?.(4, 'Tracking faces and scene changes...');
      const sample = document.createElement('canvas'); sample.width = 640; sample.height = 360;
      const context = sample.getContext('2d')!;
      const interval = Math.max(.5, duration/239);
      for (let time=0; time<duration; time+=interval) {
        options.signal?.throwIfAborted();
        const frame = await sink.getCanvas(start+time);
        if (frame) {
          context.drawImage(frame.canvas, 0, 0, 640, 360);
          frames.push({ time, jpeg: sample.toDataURL('image/jpeg', .65) });
        }
      }
    }
    const response = await fetch('/api/client-render-plan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: options.signal,
      body: JSON.stringify({ frames, audio_source: options.audioSource || options.videoSourceUrl,
        start_time: options.timelineStart ?? start, audio_start_time: options.audioSourceStart, end_time: (options.timelineStart ?? start)+duration,
        caption_words: options.clip?.caption_words, transcript: options.transcript || [], text_case: settings.textCase, caption_style: settings.subtitlesEnabled === false ? 'none' : settings.captionStyle,
        facecam_position: settings.facecamPosition || 'auto', streamer_preset: settings.streamerPreset }),
    });
    if (!response.ok) throw new Error((await response.json()).detail || 'Could not prepare browser rendering');
    const data: { words: CaptionWord[]; caption_events:CaptionEvent[]; caption_style:CaptionStyle; trajectory: CropPoint[]; fonts: {name: string; url: string}[] } = await response.json();
    for (const name of new Set([settings.captionFont, settings.titleFont || settings.captionFont])) {
      const font = data.fonts.find(f => f.name.toLowerCase() === name.toLowerCase());
      if (font) { const face = new FontFace(name, `url("${font.url}")`); document.fonts.add(await face.load()); }
      await document.fonts.load(`bold 72px "${name}"`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = settings.aspectRatio === '16:9_landscape' ? 1920 : 1080;
    canvas.height = settings.aspectRatio === '16:9_landscape' ? 1080 : 1920;
    const context = canvas.getContext('2d', { alpha: false })!;
    let watermark: HTMLImageElement | undefined;
    if (settings.watermarkEnabled && settings.watermarkType !== 'text') {
      const url = settings.watermarkUrl || mediaAssetUrl(settings.watermarkFilePath, 'watermark');
      if (!url) throw new Error('Watermark image is missing');
      watermark = new Image(); watermark.crossOrigin = 'anonymous'; watermark.src = url; await watermark.decode();
    }
    const clipTitle = options.clip?.title_suggestion || options.clip?.title || settings.titleText || '';
    const title = `${settings.titlePrefix || ''}${clipTitle}${settings.titleSuffix || ''}`;
    return { dispose, input, sink, hasAudio, canvas, context, duration, start, words: data.words, captionEvents:data.caption_events, captionStyle:data.caption_style, trajectory: data.trajectory, settings, title, watermark };
  } catch (error) { dispose(); throw error; }
}

function textCase(text: string, mode: string | undefined): string {
  if (mode === 'lowercase') return text.toLowerCase();
  if (mode === 'capitalize') return text.replace(/\b\p{L}/gu, letter => letter.toUpperCase());
  return text.toUpperCase();
}

function drawCrop(ctx: CanvasRenderingContext2D, source: CanvasImageSource, sw: number, sh: number,
  rect: [number, number, number, number], point: CropPoint, tight=false) {
  const [x,y,w,h] = rect;
  let cw = Math.min(sw, sh*w/h), ch = cw*h/w;
  if (tight) { ch = Math.min(sh, Math.max(sh*.3, point.h*sh*1.9)); cw = Math.min(sw, ch*w/h); ch = cw*h/w; }
  const sx = Math.max(0, Math.min(sw-cw, point.cx*sw-cw/2));
  const sy = Math.max(0, Math.min(sh-ch, point.cy*sh-ch/2));
  ctx.drawImage(source, sx, sy, cw, ch, x, y, w, h);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, font: string, color='white', outline=5, outlineColor='black') {
  ctx.font = `900 ${size}px "${font}", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = outline; ctx.strokeStyle = outlineColor; ctx.fillStyle = color;
  ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}

export function compositeFrame(plan: BrowserPlan, source: CanvasImageSource, sourceWidth: number, sourceHeight: number, time: number) {
  const { context: ctx, canvas, settings: s } = plan;
  const w=canvas.width, h=canvas.height;
  ctx.clearRect(0,0,w,h); ctx.fillStyle='black'; ctx.fillRect(0,0,w,h);
  if (s.backgroundStyle === 'blurred') {
    ctx.save(); ctx.filter='blur(24px)';
    drawCrop(ctx, source, sourceWidth, sourceHeight, [-25,-25,w+50,h+50], {time,cx:.5,cy:.5,w:1,h:1});
    ctx.restore();
  }
  const tracked = cropAt(plan.trajectory,time);
  const point = s.enableFaceTracking ? tracked : { ...tracked, cx:.5, cy:.5 };
  const ratios: Record<string, number> = { '1:1':1, '4:3':4/3, '16:9':16/9, '4:5':4/5 };
  const contentHeight = s.aspectRatio === '16:9_landscape' ? h : s.aspectRatio === '9:16' ? h : w/(ratios[s.aspectRatio] || 1);
  if (s.streamerPreset === 'split_top_cam') {
    const totalHeight=s.aspectRatio === '1:1' ? 1920 : s.aspectRatio === '4:3' ? 1620 : s.aspectRatio === '16:9' ? 1216 : h;
    const camHeight=totalHeight/2, y=(h-totalHeight)/2;
    drawCrop(ctx,source,sourceWidth,sourceHeight,[0,y,w,camHeight],tracked,true);
    drawCrop(ctx,source,sourceWidth,sourceHeight,[0,y+camHeight,w,camHeight],{...point,cx:.5,cy:.5});
  } else {
    drawCrop(ctx,source,sourceWidth,sourceHeight,[0,(h-contentHeight)/2,w,contentHeight],point);
    if (s.streamerPreset === 'pip_corner') drawCrop(ctx,source,sourceWidth,sourceHeight,[w-344,120,320,240],tracked,true);
  }
  const titleEnd = s.titleDuration === '5s' ? 5 : s.titleDuration === '10s' ? 10 : Infinity;
  if (s.titlePosition !== 'none' && plan.title && time+(plan.titleTimeOffset || 0) < titleEnd) {
    let size = s.titleFontSizePx ? s.titleFontSizePx*1.3 : s.titleFontSize === 'small' ? 68 : s.titleFontSize === 'big' ? 124 : 94;
    if (s.aspectRatio === '16:9_landscape') size *= .5625;
    const text = textCase(plan.title,s.titleTextCase || s.textCase);
    const lines: string[]=[]; let line='';
    ctx.font=`900 ${size}px "${s.titleFont || s.captionFont}", sans-serif`;
    for (const word of text.split(/\s+/)) { const next=(line+' '+word).trim(); if (line && ctx.measureText(next).width>w-70) {lines.push(line);line=word;} else line=next; }
    if (line) lines.push(line);
    const widest=Math.max(...lines.map(line=>ctx.measureText(line).width),1);
    size*=Math.min(1,(w-70)/widest);
    const defaultY = s.titlePosition === 'middle' ? 45 : s.streamerPreset === 'split_top_cam' ? 4.5 : s.aspectRatio === '1:1' ? 17 : s.aspectRatio === '4:3' ? 23.6 : s.aspectRatio === '16:9' ? 28.8 : s.aspectRatio === '16:9_landscape' ? 8 : 17;
    const y=h*(s.titleYPercent ?? defaultY)/100;
    lines.forEach((text,index)=>drawText(ctx,text,w/2,y+index*size*1.08+size/2,size,s.titleFont || s.captionFont));
  }
  if (s.captionStyle !== 'none' && s.subtitlesEnabled !== false) {
    const event = plan.captionEvents.find(event=>event.start<=time && event.end>time);
    if (event) {
      let size=s.fontSizePx ? s.fontSizePx : s.fontSize === 'small' ? 65 : s.fontSize === 'big' ? 94 : 78;
      if (w===1920 && !s.fontSizePx) size=s.fontSize==='small'?40:s.fontSize==='big'?58:48;
      ctx.font=`900 ${size}px "${s.captionFont}", sans-serif`;
      const labels=event.words.map(word=>word.word_text || textCase(word.word,s.textCase));
      const widths=labels.map(text=>ctx.measureText(text).width), gap=ctx.measureText(' ').width;
      const total=widths.reduce((a,b)=>a+b,0)+gap*(labels.length-1);
      const scale=Math.min(1,(w-80)/total);
      const contentTop=(h-contentHeight)/2, contentBottom=contentTop+contentHeight;
      let y:number;
      if(s.subtitlePositionMode==='center') {
        y=Math.max(contentTop+40,Math.min(contentBottom-40,h*(s.subtitleCenterYPercent ?? 50)/100));
      } else {
        y=s.subtitleYPercent!==undefined ? h*(1-s.subtitleYPercent/100)
          : w===1920 ? h*.9 : s.streamerPreset==='split_top_cam' ? h*.82 : contentBottom+size*1.08+12;
        y=s.streamerPreset!=='none' || s.aspectRatio==='9:16' ? Math.max(60,Math.min(h-40,y)) : Math.max(y,contentBottom+size*1.08+8);
        if(w===1920)y=Math.max(40,Math.min(1040,y));
        y-=size*.5;
      }
      let x=(w-total*scale)/2;
      labels.forEach((text,index)=>{
        ctx.save();ctx.translate(x+widths[index]*scale/2,y);ctx.scale(scale,scale);
        ctx.shadowColor=plan.captionStyle.outline;ctx.shadowBlur=plan.captionStyle.shadowWidth;
        drawText(ctx,text,0,0,size,s.captionFont,index===event.active_index?plan.captionStyle.highlight:'white',plan.captionStyle.outlineWidth*2,plan.captionStyle.outline);
        ctx.restore();x+=(widths[index]+gap)*scale;
      });
    }
  }
  if (s.watermarkEnabled) {
    ctx.save();ctx.globalAlpha=(s.watermarkOpacity ?? 80)/100;
    const x=w*(s.watermarkX ?? 90)/100,y=h*(s.watermarkY ?? 8)/100;
    if (s.watermarkType==='text') drawText(ctx,s.watermarkText || '',x,y,Math.max(14,180*(s.watermarkSize ?? 20)/100),'Montserrat');
    else if (plan.watermark) {const width=w*(s.watermarkSize ?? 20)/100;const height=width*plan.watermark.height/plan.watermark.width;ctx.drawImage(plan.watermark,x-width/2,y-height/2,width,height);}
    ctx.restore();
  }
}

export async function* composedFrames(plan: BrowserPlan, options: BrowserRenderOptions, fps=30) {
  const count=Math.ceil(plan.duration*fps);
  function* times() { for(let i=0;i<count;i++) yield plan.start+i/fps; }
  let index=0;
  for await (const frame of plan.sink.canvasesAtTimestamps(times())) {
    options.signal?.throwIfAborted();
    if (!frame) throw new Error('A video frame could not be decoded');
    compositeFrame(plan,frame.canvas,frame.canvas.width,frame.canvas.height,index/fps);
    yield {time:index/fps,duration:Math.min(1/fps,plan.duration-index/fps),index,count};
    index++;
  }
}
