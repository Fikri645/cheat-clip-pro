"""Device selection and real frame progress for local Whisper inference."""
import importlib
import os
from pathlib import Path
from contextlib import contextmanager
from types import SimpleNamespace


def model_directory():
    """Keep downloads beside application data unless explicitly configured."""
    return Path(os.environ.get("ML_MODEL_DIR", Path(__file__).parent / "data" / "models"))


def transcription_identity():
    return ["faster-whisper-v1", os.environ.get("WHISPER_MODEL", "large-v3"),
            os.environ.get("WHISPER_MODEL_PATH", ""),
            os.environ.get("WHISPER_COMPUTE_TYPE", "auto"),
            os.environ.get("WHISPER_BEAM_SIZE", "5")]


class FasterWhisperAdapter:
    """Retain the engine's segment/word contract while decoding with CTranslate2."""

    def __init__(self):
        import torch
        from faster_whisper import WhisperModel
        device = select_device(torch)
        self.device = SimpleNamespace(type="cuda" if device.startswith("cuda") else "cpu")
        self.compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "auto")
        if self.compute_type == "auto":
            self.compute_type = "int8_float16" if self.device.type == "cuda" else "int8"
        self._dll_directories = []
        if os.name == "nt" and self.device.type == "cuda":
            # Reuse the CUDA/cuDNN DLLs from the installed CUDA PyTorch wheel.
            directory = str(Path(torch.__file__).parent / "lib")
            self._dll_directories.append(os.add_dll_directory(directory))
            os.environ["PATH"] = directory + os.pathsep + os.environ.get("PATH", "")
        name = os.environ.get("WHISPER_MODEL", "large-v3")
        source = os.environ.get("WHISPER_MODEL_PATH") or name
        self.model = WhisperModel(source, device=self.device.type,
                                  device_index=int(device.split(":")[1]) if ":" in device else 0,
                                  compute_type=self.compute_type,
                                  download_root=str(model_directory() / "faster-whisper"),
                                  cpu_threads=4)
        self.progress_callback = None
        self.source_name = "audio"

    def transcribe(self, audio, **kwargs):
        # Precision belongs to model initialization; verbose is a legacy UI option.
        kwargs.pop("fp16", None)
        kwargs.pop("verbose", None)
        kwargs.setdefault("beam_size", int(os.environ.get("WHISPER_BEAM_SIZE", "5")))
        kwargs.setdefault("vad_filter", False)
        segments, info = self.model.transcribe(audio, **kwargs)
        result = []
        for segment in segments:
            item = {"start": segment.start, "end": segment.end, "text": segment.text}
            if segment.words is not None:
                item["words"] = [{"word": word.word, "start": word.start,
                                  "end": word.end, "probability": word.probability}
                                 for word in segment.words]
            result.append(item)
            if self.progress_callback and info.duration:
                self.progress_callback("Running Whisper AI",
                    f"Extracting dialogue from {self.source_name} with Whisper...",
                    min(99, max(0, int(segment.end / info.duration * 100))))
        return {"text": " ".join(item["text"].strip() for item in result),
                "segments": result, "language": info.language}


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
def transcription_progress(model, callback, source_name="audio"):
    """Scope the adapter to Whisper's module while the caller owns its model lock."""
    if isinstance(model, FasterWhisperAdapter):
        previous = model.progress_callback, model.source_name
        model.progress_callback, model.source_name = callback, source_name
        try:
            yield
        finally:
            model.progress_callback, model.source_name = previous
        return
    if not callback:
        yield
        return
    module = importlib.import_module("whisper.transcribe")
    original = module.tqdm

    class Progress(original.tqdm):
        def update(self, count=1):
            result = super().update(count)
            total = self.total or 0
            if total:
                percent = min(99, int(self.n / total * 100))
                callback("Running Whisper AI",
                         f"Extracting dialogue from {source_name} with Whisper...", percent)
            return result

    module.tqdm = SimpleNamespace(tqdm=Progress)
    try:
        yield
    finally:
        module.tqdm = original
