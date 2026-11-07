import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {AnalyzeResponse,NewRecommendations,ViralClip} from '../src/types';
import {appendRecommendations,excludedRanges} from '../src/utils/recommendations';
import {readRecommendations} from '../src/services/recommendations';

const clip=(start:number,end:number):ViralClip=>({title:'Conversation',start_time:start,end_time:end,virality_score:80,key_quotes:[],transcript:'An exchange'});
const base:AnalyzeResponse={video_id:'abcdefghijk',title:'Debate',duration:200,heatmap:[],summary:'A discussion',clips:[{...clip(20,40),caption_words:[{word:'Edited',start:0,end:1}]}],transcript:[{start:20,end:40,text:'A',speaker:'SPEAKER_00'}]};
const incoming:NewRecommendations={video_id:base.video_id,recommendation_round:1,scanned_ranges:[],clips:[clip(20,40),clip(10,30),clip(30,50),clip(40,65),clip(60,85),clip(65,90)]};

test('new recommendations preserve edits and reject partial, contained and concurrent overlaps',()=>{
  const result=appendRecommendations(base,incoming);
  assert.deepEqual(result.clips.map(c=>[c.start_time,c.end_time]),[[20,40],[40,65],[65,90]]);
  assert.equal(result.clips[0],base.clips[0]);assert.equal(result.transcript,base.transcript);
  assert.equal(base.clips.length,1);
  assert.deepEqual(excludedRanges(result),[{start_time:20,end_time:90}]);
  assert.equal(appendRecommendations(result,incoming).clips.length,3);
  // Removing a clip does not forget the previously recommended range.
  assert.equal(appendRecommendations({...result,clips:[]},incoming).clips.length,0);
  assert.equal(appendRecommendations(base,{...incoming,video_id:'different'}),base);
});

test('malformed or out-of-video timestamps never enter the clip list',()=>{
  assert.equal(appendRecommendations(base,{...incoming,clips:[clip(NaN,80),clip(-1,10),clip(190,220),clip(90,90)]}).clips.length,1);
});

test('old range-limited projects keep their absolute transcript timestamps',()=>{
  const result={...base,duration:30,transcript:[{start:100,end:200,text:'Later dialogue'}]};
  assert.equal(appendRecommendations(result,{...incoming,clips:[clip(150,180)]}).clips.length,2);
});

test('recommendation stream handles split UTF-8, CRLF and a final event without newline',async()=>{
  const body='data: {"current":1,"total":2,"message":"Membaca pembicara…"}\r\n\r\ndata: '+JSON.stringify({done:true,...incoming});
  const bytes=new TextEncoder().encode(body);let index=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(index>=bytes.length){controller.close();return;}controller.enqueue(bytes.slice(index,index+3));index+=3;}});
  const progress:unknown[]=[];
  const result=await readRecommendations(new Response(stream),new AbortController().signal,event=>progress.push(event));
  assert.equal(result.clips.length,incoming.clips.length);assert.equal(progress.length,1);
  assert.match(JSON.stringify(progress),/pembicara…/);
});

test('failed or truncated recommendation streams never become successful results',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(()=>readRecommendations(new Response('data: {"error":"quota exhausted"}\n'),signal,()=>{}),/quota exhausted/);
  await assert.rejects(()=>readRecommendations(new Response('data: {"current":1}\n'),signal,()=>{}),/Connection closed/);
});
