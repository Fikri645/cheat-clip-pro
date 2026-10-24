"""Explainable selection scores, not predictions of social-media performance."""
import math
import re


def normalize_scores(value):
    if not isinstance(value, dict):
        return None
    if not all(isinstance(value.get(k), (int, float)) and math.isfinite(value[k]) for k in ("hook", "context", "payoff")):
        return None
    return {k: max(0, min(100, round(value[k]))) for k in ("hook", "context", "payoff")}


def assess_clip(clip, heatmap, signal_source, lang="en", fallback=False):
    text = clip.get("transcript", "").strip()
    tokens = text.split()
    first = " ".join(tokens[:18]).lower()
    last = " ".join(tokens[-20:]).lower()
    hook = min(85, 35 + (20 if re.search(r"\b(why|how|never|secret|mistake|kenapa|mengapa|ternyata|jangan|rahasia|kesalahan)\b|\?", first) else 0) + min(20, len(tokens)//5))
    context = min(90, 25 + min(55, len(tokens)) + (10 if re.search(r"\b(because|when|for example|karena|ketika|misalnya)\b", text.lower()) else 0))
    payoff = min(85, 30 + (25 if re.search(r"[.!?][\"'”’]*$", text) else 0) + (25 if re.search(r"\b(so|therefore|finally|result|jadi|akhirnya|hasil|kesimpulan)\b", last) else 0))
    supplied = clip.get("quality_scores") or {}
    if not fallback and all(isinstance(supplied.get(k), (int, float)) and math.isfinite(supplied[k]) for k in ("hook", "context", "payoff")):
        hook, context, payoff = [max(0, min(100, round(supplied[k]))) for k in ("hook", "context", "payoff")]
        source = "ai_assessment"
    else:
        source = "transcript_heuristic"
    start, end = clip["start_time"], clip["end_time"]
    weighted = total = 0.0
    for point in heatmap:
        overlap = max(0, min(end, point["end_time"]) - max(start, point["start_time"]))
        weighted += overlap * max(0, min(1, point.get("value", 0)))
        total += overlap
    signal = round(weighted/total*100) if total else None
    # Acoustic loudness must never boost a purported audience-response score.
    quality = hook*.3 + context*.35 + payoff*.35
    if signal_source == "youtube_replay" and signal is not None:
        quality = quality*.9 + signal*.1
    breakdown = {"hook": hook, "context": context, "payoff": payoff, "signal": signal}
    reason = clip.get("selection_reason", "") if source == "ai_assessment" else ""
    if not reason:
        if lang == "id":
            reason = f"Hook {hook}/100, konteks {context}/100, penutup {payoff}/100. " + ("Penilaian AI terhadap isi klip." if source == "ai_assessment" else "Perkiraan berdasarkan teks dan batas kalimat.")
        else:
            reason = f"Hook {hook}/100, context {context}/100, ending {payoff}/100. " + ("AI assessment of this clip's content." if source == "ai_assessment" else "Estimated from transcript text and sentence boundaries.")
    return {"virality_score": round(quality), "quality_scores": breakdown,
            "score_source": source, "selection_reason": reason,
            "score_note": "Skor seleksi klip, bukan peluang menjadi viral." if lang == "id" else "Selection score, not a probability of going viral."}


def validate_and_rank(clips, transcript, heatmap, signal_source, lower, upper, lang="en", fallback=False):
    candidates = []
    for clip in clips:
        try:
            start, end = float(clip.get("start_time", 0)), float(clip.get("end_time", 0))
        except (ValueError, TypeError):
            continue
        if not math.isfinite(start) or not math.isfinite(end):
            continue
        start, end = max(lower, start), min(upper, end)
        if end <= start:
            continue
        item = {**clip, "start_time": start, "end_time": end}
        hook = item.get("hook_time")
        item["hook_time"] = hook if isinstance(hook, (int, float)) and start <= hook <= end else start
        item["transcript"] = " ".join(line.get("text", "") for line in transcript if max(start,line["start"]) < min(end,line["end"]))
        item.update(assess_clip(item, heatmap, signal_source, lang, fallback))
        candidates.append(item)
    selected = []
    for candidate in sorted(candidates, key=lambda c:c["virality_score"], reverse=True):
        # Post-adjustment intervals must also be deduplicated, not just the LLM prompt.
        if any(min(candidate["end_time"], other["end_time"]) > max(candidate["start_time"], other["start_time"]) for other in selected):
            continue
        selected.append(candidate)
    return selected
