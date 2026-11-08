import pytest
from backend.services.face_tracking import SpeakerLock,smooth_trajectory,tracking_expression


def face(cx):return {"cx":cx,"cy":.4,"w":.2,"h":.3}


def test_alternating_face_scores_do_not_switch_subjects_but_sustained_speech_does():
    lock=SpeakerLock();left,right=face(.25),face(.75)
    assert lock.choose([(1,left),(.1,right)],0)[0]["cx"]==.25
    for index in range(1,11):
        scores=[(.1,left),(1,right)] if index%2 else [(1,left),(.1,right)]
        selected,switched=lock.choose(scores,index*.5)
        assert selected["cx"]==.25 and not switched
    for timestamp in [5.5,6,6.5]:
        assert lock.choose([(.1,left),(1,right)],timestamp)[0]["cx"]==.25
    selected,switched=lock.choose([(.1,left),(1,right)],7)
    assert selected["cx"]==.75 and switched
    assert lock.choose([(2,left),(.1,right)],7.5)[0]["cx"]==.75


def test_short_detector_dropout_holds_the_subject_and_real_cuts_reset_immediately():
    lock=SpeakerLock();left,right=face(.25),face(.75)
    lock.choose([(1,left)],0)
    assert lock.choose([],0.5)[0]["cx"]==.25
    assert lock.choose([(1,right)],.5)[0]["cx"]==.25
    assert lock.choose([(1,right)],1)[0]["cx"]==.75
    assert lock.choose([(1,left)],1.1,cut=True)[0]["cx"]==.25
    assert lock.choose([],2.1)[0] is None


def test_confirming_a_new_speaker_does_not_add_an_extra_hold_period():
    lock=SpeakerLock();left,right=face(.25),face(.75)
    lock.choose([(1,left),(.1,right)],0)
    for timestamp in [.5,1,1.5,2]:assert lock.choose([(.1,left),(1,right)],timestamp)[0]["cx"]==.25
    assert lock.choose([(.1,left),(1,right)],2.5)[0]["cx"]==.75


def test_stationary_face_jitter_stays_locked_and_deliberate_movement_is_followed():
    jitter=[{"time":0,"cx":.5,"cy":.4}]+[{"time":index*.5,"cx":.5+(.02 if index%2 else -.02),"cy":.4+(.015 if index%2 else -.015)} for index in range(1,20)]
    stable=smooth_trajectory(jitter)
    assert all(point["cx"]==.5 and point["cy"]==.4 for point in stable)
    moving=smooth_trajectory([{"time":0,"cx":.5,"cy":.4}]+[{"time":index*.5,"cx":.7,"cy":.4} for index in range(1,20)])
    assert .5<moving[1]["cx"]<.57
    assert moving[-1]["cx"]==pytest.approx(.7,abs=.04)
    assert all(first["cx"]<=second["cx"] for first,second in zip(moving,moving[1:]))


def test_expression_simplification_preserves_cut_frames_and_their_previous_position():
    points=[{"time":index*.5,"cx":.2 if index==0 else .8,"cy":.4,"cut":index==1} for index in range(200)]
    expression=tracking_expression(points,max_points=20)
    assert 'lt(t,0.5000),0.20000' in expression
