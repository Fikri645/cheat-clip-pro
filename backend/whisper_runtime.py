"""Device selection and real frame progress for local Whisper inference."""
import importlib
import os
from contextlib import contextmanager
from types import SimpleNamespace


def select_device(torch):
    requested = os.environ.get("WHISPER_DEVICE", "auto").strip().lower()
    if requested == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if requested == "cpu":
        return requested
    if requested == "cuda" or requested.startswith("cuda:"):
        if not torch.cuda.is_available():
            raise RuntimeError("Whisper GPU was requested, but CUDA is unavailable. Install the CUDA build of PyTorch.")
        return requested
    raise ValueError("WHISPER_DEVICE must be auto, cpu, cuda, or cuda:<index>")


def use_fp16(model):
    return getattr(getattr(model, "device", None), "type", "cpu") == "cuda"


def clock_time(seconds):
    seconds = max(0, int(seconds))
    hours, rest = divmod(seconds, 3600)
    minutes, seconds = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{seconds:02d}" if hours else f"{minutes}:{seconds:02d}"


@contextmanager
def transcription_progress(model, callback):
    """Scope the adapter to Whisper's module while the caller owns its model lock."""
    if not callback:
        yield
        return
    module = importlib.import_module("whisper.transcribe")
    original = module.tqdm
    device = "GPU" if use_fp16(model) else "CPU"

    class Progress(original.tqdm):
        def update(self, count=1):
            result = super().update(count)
            total = self.total or 0
            if total:
                percent = min(99, int(self.n / total * 100))
                rate = self.format_dict.get("rate")
                remaining = f" · ~{clock_time((total-self.n)/rate)} remaining" if rate else ""
                callback(f"Whisper {device} transcription",
                         f"{device} · {clock_time(self.n/100)} / {clock_time(total/100)} audio · {percent}%{remaining}", percent)
            return result

    module.tqdm = SimpleNamespace(tqdm=Progress)
    try:
        yield
    finally:
        module.tqdm = original
