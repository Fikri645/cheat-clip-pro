from types import SimpleNamespace
import pytest
from backend.whisper_runtime import select_device, use_fp16, transcription_progress


def test_automatic_and_explicit_device_selection(monkeypatch):
    monkeypatch.delenv("WHISPER_DEVICE", raising=False)
    available = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True))
    unavailable = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False))
    assert select_device(available) == "cuda"
    assert select_device(unavailable) == "cpu"
    monkeypatch.setenv("WHISPER_DEVICE", "cuda")
    with pytest.raises(RuntimeError, match="CUDA is unavailable"):
        select_device(unavailable)
    monkeypatch.setenv("WHISPER_DEVICE", "cpu")
    assert select_device(available) == "cpu"


def test_half_precision_only_on_cuda():
    assert use_fp16(SimpleNamespace(device=SimpleNamespace(type="cuda")))
    assert not use_fp16(SimpleNamespace(device=SimpleNamespace(type="cpu")))


def test_frame_progress_preserves_original_status_text_and_restores_adapter(monkeypatch):
    import backend.whisper_runtime as runtime
    class Bar:
        def __init__(self, total):
            self.total, self.n = total, 0
            self.format_dict = {"rate": 100}
        def update(self, count):
            self.n += count
    original = SimpleNamespace(tqdm=Bar)
    module = SimpleNamespace(tqdm=original)
    monkeypatch.setattr(runtime.importlib, "import_module", lambda name: module)
    events = []
    with pytest.raises(ValueError):
        with transcription_progress(SimpleNamespace(device=SimpleNamespace(type="cuda")), lambda *event: events.append(event), "sample.wav"):
            bar = module.tqdm.tqdm(total=10000)
            bar.update(2500)
            raise ValueError("cancelled")
    assert module.tqdm is original
    assert events[0][0] == "Running Whisper AI"
    assert events[0][2] == 25
    assert events[0][1] == "Extracting dialogue from sample.wav with Whisper..."


def test_full_transcript_reuses_cache_after_restart(tmp_path, monkeypatch):
    import backend.video_engine as engine
    monkeypatch.setenv("RENDER_CACHE_DIR", str(tmp_path / "cache"))
    source = tmp_path / "audio.wav"
    source.write_bytes(b"audio-content")
    calls = []
    def compute(*args):
        calls.append(1)
        return [{"start": 0, "duration": 1, "text": "Saved dialogue"}]
    monkeypatch.setattr(engine, "_transcribe_local_video_file", compute)
    first = engine.transcribe_local_video_file(source, target_language="id")
    events = []
    second = engine.transcribe_local_video_file(source, lambda *event: events.append(event), "id")
    assert second == first
    assert len(calls) == 1
    assert events[-1][0] == "Running Whisper AI"
    assert events[-1][2] == 100
