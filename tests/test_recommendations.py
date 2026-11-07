import asyncio
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.schemas.analyze import AnalyzeResponse,ReanalyzeRequest,TranscriptLine,ClipInterval
from backend.services import recommendations as service
from backend.services.conversation_context import format_dialogue_line


def clip(start,end,title="Question and response"):
    return {"title":title,"start_time":start,"end_time":end,"hook_time":start,"virality_score":90,
        "key_quotes":["Why?"],"transcript":"Why? Because this is the explanation.","quality_scores":{"hook":80,"context":85,"payoff":90}}


def request(**changes):
    result={"video_id":"abcdefghijk","title":"A discussion","duration":160,"heatmap":[],"summary":"A debate",
        "clips":[clip(20,40)],"transcript":[{"start":i,"end":i+5,"text":"Why?" if i%10==0 else "Because this is the explanation.",
        "speaker":"SPEAKER_00" if i%10==0 else "SPEAKER_01"} for i in range(0,160,5)]}
    return ReanalyzeRequest(analysis=AnalyzeResponse.model_validate(result),duration="auto",**changes)


def test_strict_overlap_and_sentence_expansion_cannot_reuse_previous_timestamps():
    req=request();window=[item.model_dump() for item in req.analysis.transcript]
    proposed=[clip(10,30),clip(20,40),clip(25,35),clip(0,160),clip(38,60),clip(40,65),clip(65,90)]
    result=service.verified_candidates(proposed,req,window,service.exclusion_ranges(req))
    assert {(item["start_time"],item["end_time"]) for item in result}=={(40,65),(65,90)}
    # A seemingly safe timestamp can expand into an excluded spoken sentence.
    exclusions=[{"start_time":40,"end_time":42}]
    assert not service.verified_candidates([clip(42.2,67)],req,window,exclusions)
    assert not service.verified_candidates([clip(-3,25),clip(150,190),clip(float('nan'),90)],req,window,[])
    req.analysis.duration=30
    assert len(service.verified_candidates([clip(80,105)],req,window,[]))==1


def test_speaker_and_overlap_evidence_survives_schema_and_enters_prompt():
    req=request();req.analysis.transcript[1]=TranscriptLine(start=5,end=10,text="An objection",speaker="SPEAKER_01",speakers=["SPEAKER_00","SPEAKER_01"],overlap=True)
    stored=AnalyzeResponse.model_validate_json(req.analysis.model_dump_json())
    assert stored.transcript[1].speakers==["SPEAKER_00","SPEAKER_01"]
    prompt=service.build_prompt(req,[line.model_dump() for line in req.analysis.transcript],service.exclusion_ranges(req),3)
    assert "SPEAKER_00, SPEAKER_01; overlapping speech" in prompt
    assert "questions, answers" in prompt and "do not invent" in prompt
    assert "20.000–40.000" in prompt
    assert "UNKNOWN" in format_dialogue_line({"start":0,"end":1,"text":"Hello"})


def test_long_transcript_windows_cover_late_audio_and_keep_bounded_context():
    lines=[{"start":i*5.,"end":i*5.+5,"text":"long dialogue "*30} for i in range(90)]
    windows=service.transcript_windows(lines,[],max_chars=2500)
    assert len(windows)>3
    assert windows[0][0]["start"]==0 and windows[-1][-1]["end"]==450
    assert all(sum(len(format_dialogue_line(line))+1 for line in window)<=2500 for window in windows)
    assert not service.transcript_windows(lines,[{"start_time":0,"end_time":450}],2500)
    first=service.search_windows(windows,0)
    second=service.search_windows(windows,1)
    assert first[0] is windows[0] and first[-1] is windows[-1]
    assert second[0] is windows[1]
    assert len({id(window) for window in first})==3


def test_reanalysis_is_fresh_reuses_saved_text_and_drops_old_ranges(monkeypatch):
    req=request();calls=[]
    async def model(req,prompt):
        calls.append(prompt);return {"clips":[clip(20,40),clip(50,75)]}
    monkeypatch.setattr(service,"call_model",model)
    async def connected():return False
    async def run():return [event async for event in service.recommendation_events(req,connected)]
    result=asyncio.run(run())[-1]
    assert result["done"] and [(c["start_time"],c["end_time"]) for c in result["clips"]]==[(50,75)]
    assert result["recommendation_round"]==1
    assert len(calls)==1
    # A second explicit search includes all old and newly accepted intervals.
    from backend.schemas.analyze import ViralClip
    req.analysis.clips += [ViralClip.model_validate(item) for item in result["clips"]]
    assert asyncio.run(run())[-1]["clips"]==[]
    assert len(calls)==2


def test_cancel_stops_outbound_model_task(monkeypatch):
    cancelled=[]
    async def model(*args):
        try:await asyncio.sleep(30)
        finally:cancelled.append(True)
    monkeypatch.setattr(service,"call_model",model)
    checks=0
    async def disconnected():
        nonlocal checks
        checks+=1;return checks>1
    async def run():return [event async for event in service.recommendation_events(request(),disconnected)]
    events=asyncio.run(run())
    assert cancelled==[True]
    assert not any(event.get("done") for event in events)


def test_short_remaining_gaps_do_not_spend_another_ai_call(monkeypatch):
    req=request();req.excluded_ranges=[ClipInterval(start_time=0,end_time=50),ClipInterval(start_time=55,end_time=160)]
    async def model(*args):pytest.fail("A five-second gap cannot fit an 18-second clip")
    async def connected():return False
    monkeypatch.setattr(service,"call_model",model)
    async def run():return [event async for event in service.recommendation_events(req,connected)]
    result=asyncio.run(run())[-1]
    assert result["done"] and result["exhausted"] and result["clips"]==[]


def test_endpoint_uses_saved_transcript_without_downloading_or_transcribing(monkeypatch):
    from backend.routers.recommendations import router
    import backend.config as config
    monkeypatch.setattr(config,"transcribe_local_video_file",lambda *args:pytest.fail("Reanalysis must not transcribe"))
    monkeypatch.setattr("backend.services.youtube_service.fetch_transcript",lambda *args:pytest.fail("Reanalysis must not retrieve subtitles"))
    async def model(req,prompt):return {"clips":[clip(80,105)]}
    monkeypatch.setattr(service,"call_model",model)
    app=FastAPI();app.include_router(router)
    with TestClient(app) as client:
        response=client.post("/api/reanalyze",json=request().model_dump())
        assert response.status_code==200
        events=[json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
        assert events[-1]["done"] and len(events[-1]["clips"])==1
        payload=request().model_dump();payload["analysis"]["transcript"]=[]
        assert client.post("/api/reanalyze",json=payload).status_code==422
