import {useEffect,useRef,useState} from 'react';
import type {AnalyzeResponse,NewRecommendations} from '../types';
import {findNewRecommendations,type RecommendationSettings} from '../services/recommendations';
import {errorName,getErrorMessage} from '../utils/errors';

export function useReanalysis(result:AnalyzeResponse|null,settings:RecommendationSettings,onComplete:(value:NewRecommendations)=>void) {
  const abort=useRef<AbortController|null>(null);
  const [state,setState]=useState<{videoId:string;busy:boolean;current:number;total:number;outcome?:NewRecommendations;error?:string;cancelled?:boolean}>({videoId:'',busy:false,current:0,total:0});
  const videoId=result?.video_id;
  useEffect(()=>()=>{abort.current?.abort();},[videoId]);
  const start=async()=>{
    if(!result?.transcript?.length||abort.current)return;
    const controller=new AbortController();abort.current=controller;
    const videoId=result.video_id;
    setState({videoId,busy:true,current:0,total:0});
    try {
      const outcome=await findNewRecommendations(result,settings,controller.signal,event=>{
        if(!controller.signal.aborted)setState({videoId,busy:true,current:event.current || 0,total:event.total || 0});
      });
      controller.signal.throwIfAborted();onComplete(outcome);
      setState({videoId,busy:false,current:0,total:0,outcome});
    } catch(error) {
      setState({videoId,busy:false,current:0,total:0,...(errorName(error)==='AbortError'?{cancelled:true}:{error:getErrorMessage(error)})});
    } finally {if(abort.current===controller)abort.current=null;}
  };
  return {state:state.videoId===videoId?state:undefined,start,cancel:()=>abort.current?.abort()};
}
