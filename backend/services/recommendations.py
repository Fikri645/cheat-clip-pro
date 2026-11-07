"""Fresh, dialogue-aware recommendations from existing text; no media/GPU work."""
import asyncio
import math
import os

from fastapi import HTTPException

from backend.schemas.analyze import ReanalyzeRequest, VideoAnalysis, ViralClip
from backend.services.clip_quality import validate_and_rank
from backend.services.conversation_context import CONVERSATION_INSTRUCTION, format_dialogue_line
from backend.utils.text import detect_transcript_language, lowercase_hashtags_in_string, sanitize_first_person_title


def intervals_overlap(first, second):
    return min(first["end_time"], second["end_time"]) > max(first["start_time"], second["start_time"])


def exclusion_ranges(request):
    ranges = [item.model_dump() for item in request.excluded_ranges + request.analysis.recommendation_excluded_ranges]
    ranges += [{"start_time": clip.start_time, "end_time": clip.end_time} for clip in request.analysis.clips
               if math.isfinite(clip.start_time) and math.isfinite(clip.end_time) and clip.end_time > clip.start_time >= 0]
    merged = []
    for item in sorted(ranges, key=lambda item:item["start_time"]):
        if merged and item["start_time"] <= merged[-1]["end_time"]:
            merged[-1]["end_time"] = max(merged[-1]["end_time"], item["end_time"])
        else:
            merged.append(dict(item))
    return merged


def transcript_windows(lines, exclusions, max_chars=24000, minimum_duration=0):
    """Keep contiguous dialogue and overlapping context, covering late video too."""
    windows = []; current = []; size = 0
    for line in sorted(lines, key=lambda item:(item["start"],item["end"])):
        if not math.isfinite(line["start"]) or not math.isfinite(line["end"]) or line["end"] <= line["start"]:
            continue
        cost = len(format_dialogue_line(line)) + 1
        if current and size+cost > max_chars:
            windows.append(current)
            current = current[-2:]
            size = sum(len(format_dialogue_line(item))+1 for item in current)
            while current and size+cost > max_chars:
                current.pop(0)
                size = sum(len(format_dialogue_line(item))+1 for item in current)
        current.append(line); size += cost
    if current:
        windows.append(current)
    def has_unused(window):
        if not any(not any(intervals_overlap({"start_time":line["start"],"end_time":line["end"]}, old) for old in exclusions) for line in window):return False
        cursor=max(0,window[0]["start"]);upper=max(line["end"] for line in window)
        for old in exclusions:
            if old["end_time"]<=cursor:continue
            if min(upper,old["start_time"])-cursor>=minimum_duration:return True
            cursor=max(cursor,old["end_time"])
            if cursor>=upper:return False
        return upper-cursor>=minimum_duration
    return [window for window in windows if has_unused(window)]


def duration_bounds(value):
    if value == "auto":return 18.0,90.0
    try:
        target=float(value.rstrip("s"))
        if not math.isfinite(target) or target<=0:raise ValueError()
    except ValueError:
        raise HTTPException(422,"Invalid target clip duration")
    return max(1,target*.8),target*1.25


def search_windows(windows,round_number):
    count=min(3,len(windows))
    return [windows[(round_number+int(index*(len(windows)-1)/max(1,count-1)))%len(windows)] for index in range(count)]


def build_prompt(request, window, exclusions, count):
    language=detect_transcript_language([item.model_dump() for item in request.analysis.transcript or []],request.analysis.title)
    minimum,maximum=duration_bounds(request.duration)
    blocked="\n".join(f"{item['start_time']:.3f}–{item['end_time']:.3f}" for item in exclusions)
    prior_titles="; ".join(clip.title for clip in request.analysis.clips)[:2500]
    return f"""Find up to {count} NEW, coherent standalone clips from this video discussion.
Video: {request.analysis.title}
Language: {language.get('name','original transcript language')}. Keep ALL output, titles,
quotes and captions in that language; never translate. Titles must not use first person.
Do not guess a named speaker from the title or channel.
{CONVERSATION_INSTRUCTION}
Prior clip topics: {prior_titles}
Prefer a fresh angle, exchange or payoff over repeating the earlier recommendations.
User focus (if any): {request.custom_prompt}
Each clip must be {minimum:g}–{maximum:g} seconds and start/end at sentence boundaries.
Use exact ABSOLUTE seconds from the transcript. Keep opening context and ending payoff.
Candidate timestamps must be inside the provided transcript window.
STRICTLY EXCLUDED RANGES (seconds; any overlap, including partial overlap, is forbidden):
{blocked or '(none)'}
Do not propose any interval intersecting these ranges or another proposed clip.
The surrounding blocked dialogue is context only. Return fewer clips or [] if needed;
never fill the quota with duplicates, guessed dialogue, cut-off questions or weak filler.
Provide quality_scores (hook/context/payoff, each 0–100), selection_reason explaining
the exchange and its payoff, and 1–2 verbatim key_quotes. Scores are editorial assessments.
Transcript (start|end [speaker; overlap] text):
{chr(10).join(format_dialogue_line(item) for item in window)}
Return the requested JSON VideoAnalysis schema, sorted by quality.
"""


async def call_model(request, prompt):
    if request.api_provider == "openrouter":
        from backend.services.openrouter_service import analyze_with_openrouter
        key=(request.openrouter_key or request.api_key or os.environ.get("OPENROUTER_API_KEY") or "").strip()
        if not key:raise HTTPException(400,"Enter your OpenRouter API key in AI Engine Settings")
        result=await analyze_with_openrouter(key,request.model,prompt,timeout=120)
        return result.model_dump()
    from google import genai
    from google.genai import types
    key=(request.api_key or os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:raise HTTPException(400,"Enter your Gemini API key in AI Engine Settings")
    client=genai.Client(api_key=key,http_options=types.HttpOptions(timeout=120000))
    try:
        response=await client.aio.models.generate_content(model=request.model,contents=prompt,
            config=types.GenerateContentConfig(response_mime_type="application/json",response_schema=VideoAnalysis,temperature=.35,max_output_tokens=8192))
        if response.parsed is not None:return VideoAnalysis.model_validate(response.parsed).model_dump()
        return VideoAnalysis.model_validate_json(response.text).model_dump()
    finally:
        await client.aio.aclose()


def verified_candidates(raw, request, window, exclusions):
    lines=[line.model_dump() for line in request.analysis.transcript or []]
    # Older range-limited projects store a range duration while their transcript
    # uses absolute seconds. The saved dialogue defines the available timeline.
    lower=max(0,window[0]["start"]);upper=max(item["end"] for item in window)
    minimum,maximum=duration_bounds(request.duration)
    language=detect_transcript_language(lines,request.analysis.title).get("code","en")
    aligned=[]
    for item in raw:
        try:start,end=float(item["start_time"]),float(item["end_time"])
        except (KeyError,ValueError,TypeError):continue
        if not math.isfinite(start) or not math.isfinite(end) or start<lower or end>upper or end<=start:continue
        # Expand to complete spoken sentences rather than cutting a question or
        # response mid-utterance. Exclusions are checked AFTER this adjustment.
        starts=[line["start"] for line in window if line["start"]<=start<line["end"]]
        ends=[line["end"] for line in window if line["start"]<end<=line["end"]]
        if not starts or not ends:continue
        candidate={**item,"start_time":min(starts),"end_time":max(ends)}
        if not minimum-.001<=candidate["end_time"]-candidate["start_time"]<=maximum+.001:continue
        if any(intervals_overlap(candidate,old) for old in exclusions):continue
        aligned.append(candidate)
    candidates=validate_and_rank(aligned,lines,[point.model_dump() for point in request.analysis.heatmap],
        request.analysis.heatmap_source,lower,upper,language)
    selected=[]
    for item in candidates:
        if not minimum-.001<=item["end_time"]-item["start_time"]<=maximum+.001:continue
        if any(intervals_overlap(item,old) for old in exclusions+selected):continue
        item["title"]=sanitize_first_person_title(item.get("title",""),request.analysis.channel,lang=language)
        item["title_suggestion"]=sanitize_first_person_title(item.get("title_suggestion",""),request.analysis.channel,lang=language)
        for field in ("caption_suggestion","hashtag_suggestion"):item[field]=lowercase_hashtags_in_string(item.get(field,""))
        selected.append(ViralClip.model_validate(item).model_dump())
    return selected


async def recommendation_events(request:ReanalyzeRequest, disconnected):
    from backend.security import mask_sensitive_text
    if not request.analysis.transcript:raise HTTPException(422,"This project has no saved transcript. Analyze the video first.")
    exclusions=exclusion_ranges(request)
    windows=transcript_windows([line.model_dump() for line in request.analysis.transcript],exclusions,minimum_duration=duration_bounds(request.duration)[0])
    # Sample the beginning, middle and end on the first search, then rotate.
    # At most three bounded context windows/API calls per click.
    selected_windows=search_windows(windows,request.analysis.recommendation_round)
    accepted=[];scanned=[]
    try:
        for index,window in enumerate(selected_windows):
            if await disconnected():return
            remaining=request.target_clip_count-len(accepted)
            if remaining<=0:break
            yield {"message":"Finding new clips", "current":index+1,"total":len(selected_windows)}
            count=math.ceil(remaining/(len(selected_windows)-index))
            task=asyncio.create_task(call_model(request,build_prompt(request,window,exclusions+accepted,count)))
            try:
                while not task.done():
                    await asyncio.wait({task},timeout=.25)
                    if await disconnected():
                        if not task.done():task.cancel()
                        try:await task
                        except (Exception,asyncio.CancelledError):pass
                        return
                result=await task
            finally:
                if not task.done():
                    task.cancel()
                    try:await task
                    except asyncio.CancelledError:pass
            additions=verified_candidates(result.get("clips",[]),request,window,exclusions+accepted)
            accepted.extend(additions[:min(count,remaining)])
            scanned.append({"start_time":window[0]["start"],"end_time":max(line["end"] for line in window)})
        yield {"done":True,"clips":accepted,"recommendation_round":request.analysis.recommendation_round+1,
               "scanned_ranges":scanned,"exhausted":not windows}
    except Exception as exc:
        message=mask_sensitive_text(str(exc.detail if isinstance(exc,HTTPException) else exc))
        if accepted:
            yield {"done":True,"clips":accepted,"recommendation_round":request.analysis.recommendation_round+1,
                   "scanned_ranges":scanned,"warning":message}
        else:
            yield {"error":message}
