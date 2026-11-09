from types import SimpleNamespace
import pytest

from backend.whisper_runtime import FasterWhisperAdapter, transcription_progress, transcription_identity
from backend.services.active_speaker import build_tracks, interpolated_face
from backend.services.face_tracking import apply_speaker_scores


def face(cx):
    return {"cx": cx, "cy": .4, "w": .15, "h": .25}


def test_lazy_faster_decoder_preserves_acoustic_word_times_and_progress_after_error():
    adapter = FasterWhisperAdapter.__new__(FasterWhisperAdapter)
    adapter.progress_callback, adapter.source_name = None, "audio"
    options = []
    def decode(audio, **kwargs):
        options.append(kwargs)
        def segments():
            yield SimpleNamespace(start=.3, end=2., text=" hello",
                words=[SimpleNamespace(word=" hello", start=.3, end=.7, probability=.9)])
            raise RuntimeError("cancelled")
        return segments(), SimpleNamespace(duration=10, language="en")
    adapter.model = SimpleNamespace(transcribe=decode)
    events = []
    with pytest.raises(RuntimeError, match="cancelled"):
        with transcription_progress(adapter, lambda *event: events.append(event), "sample.wav"):
            adapter.transcribe("sample.wav", fp16=True, verbose=False, word_timestamps=True)
    assert events == [("Running Whisper AI", "Extracting dialogue from sample.wav with Whisper...", 20)]
    assert adapter.progress_callback is None
    assert "fp16" not in options[0] and "verbose" not in options[0]
    adapter.model.transcribe = lambda *a, **kw: (iter([SimpleNamespace(start=.3, end=2., text=" hello",
        words=[SimpleNamespace(word=" hello", start=.3, end=.7, probability=.9)])]), SimpleNamespace(duration=10, language="en"))
    result = adapter.transcribe("sample.wav", word_timestamps=True)
    assert result["segments"][0]["words"][0] == {"word": " hello", "start": .3, "end": .7, "probability": .9}


def test_cache_distinguishes_decoding_precision_beam_and_model(monkeypatch):
    first = transcription_identity()
    monkeypatch.setenv("WHISPER_COMPUTE_TYPE", "float32")
    second = transcription_identity()
    monkeypatch.setenv("WHISPER_BEAM_SIZE", "1")
    third = transcription_identity()
    monkeypatch.setenv("WHISPER_MODEL", "turbo")
    assert len({str(first), str(second), str(third), str(transcription_identity())}) == 4


def test_face_identity_survives_detection_reordering_and_resets_on_cut():
    left, right = face(.25), face(.75)
    rows = [dict(time=0., cut=False, candidates=[(1., left), (1., right)]),
            dict(time=.5, cut=False, candidates=[(1., right), (1., left)]),
            dict(time=1., cut=True, candidates=[(1., left)])]
    tracks, association = build_tracks(rows)
    assert association[0, 0] == association[1, 1]
    assert association[0, 1] == association[1, 0]
    assert association[2, 0] != association[0, 0]
    assert interpolated_face(tracks[0], 1.) is None
    assert interpolated_face(tracks[0], .25)["cx"] == .25


def test_negative_asd_scores_hold_identity_and_positive_evidence_can_switch():
    left, right = face(.25), face(.75)
    rows = [dict(time=i*.5, cut=False, candidates=[(1., left), (.1, right)]) for i in range(14)]
    visual = [dict(time=r["time"], **left, cut=False, speaker_switch=False) for r in rows]
    scores = [[(1., left), (-1., right)]]
    scores += [[(-2., left), (-.01, right)] for _ in range(5)]
    scores += [[(-2., left), (1., right)] for _ in range(8)]
    points = apply_speaker_scores(rows, scores, visual)
    assert all(not p["speaker_switch"] for p in points[:6])
    assert not points[5]["speaker_confident"]
    assert any(p["speaker_switch"] for p in points[6:])
    assert points[-1]["cx"] > .5


def test_light_asd_skips_audio_work_for_single_face(monkeypatch):
    from backend.services.active_speaker import score_video_speakers
    monkeypatch.setattr("backend.services.active_speaker.subprocess.run", lambda *a, **kw: pytest.fail("No audio decoding needed"))
    assert score_video_speakers("unused.mp4", [dict(time=0, cut=False, candidates=[(1., face(.5))])]) is None


def test_manual_focus_never_invokes_light_asd(monkeypatch):
    from backend.services import face_tracking as tracking
    import cv2
    import numpy as np
    class Capture:
        def get(self, prop):
            return 25 if prop == cv2.CAP_PROP_FPS else 25
        def set(self, *args):
            pass
        def read(self):
            return True, np.zeros((360, 640, 3), dtype=np.uint8)
        def release(self):
            pass
    monkeypatch.setattr(cv2, "VideoCapture", lambda *args: Capture())
    monkeypatch.setattr(tracking, "track_frames", lambda frames, position, preset, records: [{"time": 0, "cx": .25}])
    monkeypatch.setattr("backend.services.active_speaker.score_video_speakers", lambda *a: pytest.fail("Manual focus must not be overridden"))
    assert tracking._detect_crop_trajectory_uncached("unused.mp4", "left") == [{"time": 0, "cx": .25}]


def test_same_studio_camera_cuts_reset_tracks_despite_similar_histograms():
    from backend.services.face_tracking import is_scene_cut
    # Measured closeup -> wide and wide -> closeup transitions in original video.
    assert is_scene_cut(.154, .247, 2, 10)
    assert is_scene_cut(.154, .264, 9, 2)
    assert not is_scene_cut(.154, .247, 2, 2)
    assert not is_scene_cut(.02, .1, 2, 10)
    assert not is_scene_cut(.15, .1, 2, 1)


def test_browser_plan_uses_original_video_and_local_offset_without_touching_edits(tmp_path, monkeypatch):
    from backend.routers.client_render import ClientPlanRequest, prepare_plan
    from backend.routers import media
    from backend.services import face_tracking
    video = tmp_path / "source.mp4"
    video.write_bytes(b"original-video")
    monkeypatch.setattr(media, "_find_video_file_on_disk", lambda name: video)
    monkeypatch.setattr(media, "_is_safe_path", lambda path: True)
    calls = []
    def track(path, position, preset, **kwargs):
        calls.append((path, kwargs))
        return [{"time": 0, "cx": .7, "cy": .4, "speaker_source": "light-asd"}]
    monkeypatch.setattr(face_tracking, "detect_crop_trajectory", track)
    request = ClientPlanRequest(video_source="/api/video/source.mp4", video_start_time=7,
        audio_source="/api/video/other.mp4", audio_start_time=0, start_time=100, end_time=110,
        frames=[{"time": 0, "jpeg": ""}], caption_words=[{"word": "Edited", "start": .1, "end": .5}])
    result = prepare_plan(request)
    assert calls == [(video, {"start_time": 7., "end_time": 17.})]
    assert result["trajectory"][0]["speaker_source"] == "light-asd"
    assert result["words"] == [{"word": "Edited", "start": .1, "end": .5}]
