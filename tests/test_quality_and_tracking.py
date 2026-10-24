import math

import pytest

from backend.services.clip_quality import assess_clip, validate_and_rank
from backend.services.face_tracking import smooth_trajectory, tracking_expression
from backend.utils.captions import caption_events, CAPTION_STYLES, ass_color


def test_caption_chunks_do_not_bridge_pauses_and_have_shared_style_colors():
    events=caption_events([{"word":"WHY","start":0,"end":.2},{"word":"THIS","start":.2,"end":.4},
                           {"word":"WORKS","start":2,"end":2.5}])
    assert [word["word"] for word in events[0]["words"]]==["WHY","THIS"]
    assert events[-1]["words"][0]["word"]=="WORKS"
    assert events[0]["end"]<=events[1]["start"]
    assert events[1]["end"]<events[-1]["start"]
    assert ass_color(CAPTION_STYLES["viral_pop"]["highlight"])=="&H0000E6FF"


def test_acoustic_loudness_does_not_inflate_selection_score():
    clip={"start_time":0,"end_time":20,"transcript":"Why does this happen? Because the source has changed. So this is the result."}
    low=assess_clip(clip,[{"start_time":0,"end_time":20,"value":0}],"acoustic_energy")
    high=assess_clip(clip,[{"start_time":0,"end_time":20,"value":1}],"acoustic_energy")
    assert low["virality_score"]==high["virality_score"]
    assert high["quality_scores"]["signal"]==100
    assert high["score_source"]=="transcript_heuristic"


def test_fallback_scores_depend_on_content_not_candidate_order():
    weak={"start_time":0,"end_time":10,"transcript":"and then"}
    strong={"start_time":0,"end_time":10,"transcript":"Why does this fail? Because one file was counted twice, the cleanup thought the disk was full. So counting each physical file once fixes the problem."}
    a=assess_clip(weak,[],"none",fallback=True)
    b=assess_clip(strong,[],"none",fallback=True)
    assert b["virality_score"]>a["virality_score"]
    assert b["selection_reason"] and b["score_note"]


def test_invalid_and_overlapping_intervals_are_removed_after_alignment():
    clips=[{"start_time":-5,"end_time":10}, {"start_time":8,"end_time":20},
           {"start_time":float('nan'),"end_time":25},{"start_time":40,"end_time":30},
           {"start_time":22,"end_time":1000}]
    selected=validate_and_rank(clips,[],[],"none",0,30)
    assert len(selected)==2
    assert all(0<=c["start_time"]<c["end_time"]<=30 for c in selected)


def test_tracking_smooths_motion_but_does_not_pan_across_scene_cuts():
    points=smooth_trajectory([{"time":0,"cx":.2,"cy":.4}, {"time":.5,"cx":.8,"cy":.4},
                              {"time":1,"cx":.85,"cy":.4,"cut":True}])
    assert .2<points[1]["cx"]<.4
    assert points[2]["cx"]==.85
    assert 'lt(t,1.0000)' in tracking_expression(points)


@pytest.mark.parametrize("aspect",["9:16","1:1","4:3","16:9","16:9_landscape"])
def test_shared_server_layout_accepts_time_dependent_framing(aspect):
    from backend.video_engine import build_ffmpeg_filtergraph
    points=[{"time":0,"cx":.3,"cy":.4},{"time":1,"cx":.7,"cy":.4}]
    graph, output=build_ffmpeg_filtergraph(aspect,"black",crop_trajectory=points)
    assert output and graph
    assert 'lt(t,' in graph
