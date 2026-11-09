"""Audio/visual speaker scores from Light-ASD, with bounded video preprocessing."""
import bisect
import hashlib
import logging
import math
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import urllib.request

from filelock import FileLock
from backend.whisper_runtime import model_directory

logger = logging.getLogger(__name__)
WEIGHTS_SHA256 = "d44bc3ea7baa8e0946fa3921311714a630ed8b90a1928fab0dbe30d918909317"
WEIGHTS_URL = ("https://raw.githubusercontent.com/Junhua-Liao/Light-ASD/"
               "ed38c232de5efe0261dbd68627c0ade7cdfe14eb/weight/pretrain_AVA_CVPR.model")
_MODEL = None
_LOCK = threading.RLock()


def weights_path():
    return Path(os.environ.get("LIGHT_ASD_MODEL_PATH", model_directory() / "light-asd" / "pretrain_AVA_CVPR.model"))


def speaker_identity():
    return ["light-asd-v1", str(weights_path()), WEIGHTS_SHA256,
            os.environ.get("LIGHT_ASD_DEVICE", "auto"), "six-second-multiscale", "negative-hold-shot-layout-v1"]


def _ensure_weights():
    path = weights_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with FileLock(str(path) + ".lock"):
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == WEIGHTS_SHA256:
            return path
        temporary = path.with_suffix(".download")
        try:
            with urllib.request.urlopen(WEIGHTS_URL, timeout=60) as response, temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != WEIGHTS_SHA256:
                raise RuntimeError("Light-ASD checkpoint checksum mismatch")
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path


def _get_model():
    global _MODEL
    import torch
    if _MODEL is None:
        from backend.vendor.light_asd.Model import ASD_Model
        requested = os.environ.get("LIGHT_ASD_DEVICE", "auto").lower()
        device = ("cuda" if torch.cuda.is_available() else "cpu") if requested == "auto" else requested
        if device != "cpu" and not (device == "cuda" or device.startswith("cuda:")):
            raise ValueError("LIGHT_ASD_DEVICE must be auto, cpu, cuda, or cuda:<index>")
        model = ASD_Model().to(device).eval()
        classifier = torch.nn.Linear(128, 2).to(device).eval()
        state = torch.load(_ensure_weights(), map_location="cpu", weights_only=True)
        model.load_state_dict({key[6:]: value for key, value in state.items() if key.startswith("model.")}, strict=True)
        classifier.load_state_dict({key[10:]: value for key, value in state.items() if key.startswith("lossAV.FC.")}, strict=True)
        _MODEL = model, classifier, device
        logger.info("Light-ASD ready: device=%s", device)
    return _MODEL


def _distance(first, second):
    return math.hypot(first["cx"] - second["cx"], first["cy"] - second["cy"])


def build_tracks(records):
    """One-to-one identity association; never interpolate a track across a cut."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    tracks, assignments = [], {}
    active = []
    for row_index, record in enumerate(records):
        timestamp = record["time"]
        if record["cut"]:
            for track_id in active:
                tracks[track_id]["stop"] = timestamp
            active = []
        active = [track_id for track_id in active if timestamp - tracks[track_id]["times"][-1] <= 1.0]
        faces = [face for _, face in record["candidates"]]
        used = set()
        if active and faces:
            cost = np.full((len(active), len(faces)), 1000.)
            for i, track_id in enumerate(active):
                previous = tracks[track_id]["faces"][-1]
                for j, face in enumerate(faces):
                    scale = max(.03, (previous["w"] + face["w"]) / 2)
                    ratio = max(previous["w"], face["w"]) / max(.001, min(previous["w"], face["w"]))
                    if ratio < 2.5:
                        cost[i, j] = _distance(previous, face) / scale
            a, b = linear_sum_assignment(cost)
            for i, j in zip(a, b):
                if cost[i, j] > 1.5:
                    continue
                track_id = active[i]
                tracks[track_id]["times"].append(timestamp)
                tracks[track_id]["faces"].append(faces[j])
                assignments[row_index, j] = track_id
                used.add(j)
        for j, face in enumerate(faces):
            if j not in used:
                track_id = len(tracks)
                tracks.append({"times": [timestamp], "faces": [face], "stop": math.inf})
                active.append(track_id)
                assignments[row_index, j] = track_id
    return tracks, assignments


def interpolated_face(track, timestamp):
    times, faces = track["times"], track["faces"]
    if timestamp < times[0] or timestamp >= min(track["stop"], times[-1] + .5):
        return None
    index = bisect.bisect_right(times, timestamp) - 1
    if index == len(times) - 1:
        return faces[index]
    if times[index + 1] - times[index] > 1.0:
        return None
    fraction = (timestamp - times[index]) / (times[index + 1] - times[index])
    return {key: faces[index][key] + fraction * (faces[index + 1][key] - faces[index][key])
            for key in ("cx", "cy", "w", "h")}


def _face_crop(frame, face):
    """Match the released Light-ASD context crop and central 112x112 input."""
    import cv2
    import numpy as np
    height, width = frame.shape[:2]
    x, y = face["cx"] * width, face["cy"] * height
    size = max(face["w"] * width, face["h"] * height) / 2
    pad = max(1, int(size * 1.8))
    padded = cv2.copyMakeBorder(frame, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(110, 110, 110))
    x, y = x + pad, y + pad
    crop = padded[max(0, int(y-size)):int(y+size*1.8), max(0, int(x-size*1.4)):int(x+size*1.4)]
    if not crop.size:
        return np.full((112, 112), 110, dtype=np.uint8)
    gray = cv2.cvtColor(cv2.resize(crop, (224, 224)), cv2.COLOR_BGR2GRAY)
    return gray[56:168, 56:168]


def _infer_track(model, classifier, device, audio, visual):
    import numpy as np
    import python_speech_features
    import torch
    features = python_speech_features.mfcc(audio, 16000, numcep=13, winlen=.025, winstep=.010)
    required = len(visual) * 4
    if len(features) < required:
        features = np.pad(features, ((0, required-len(features)), (0, 0)), mode="edge")
    features = features[:required]
    outputs = []
    # Equivalent weighting to the author's multi-scale evaluation, without
    # recomputing identical durations three times.
    with torch.inference_mode():
        for duration in (1, 2, 3, 4, 5, 6):
            scores = []
            for begin in range(0, len(visual), duration * 25):
                end = min(len(visual), begin + duration * 25)
                a = torch.as_tensor(features[begin*4:end*4], dtype=torch.float32, device=device)[None]
                v = torch.as_tensor(visual[begin:end], dtype=torch.float32, device=device)[None]
                embedding = model.forward_audio_visual_backend(model.forward_audio_frontend(a), model.forward_visual_frontend(v))
                scores.extend(classifier(embedding)[:, 1].cpu().tolist())
            outputs.append(scores)
    return np.average(np.asarray(outputs), axis=0, weights=[3, 3, 2, 1, 1, 1])


def score_video_speakers(video_path, records, start_time=0., duration=None):
    """Return scores for existing detections; retain at most six seconds of crops.

    No audio or no competing visible faces returns None so visual/non-face
    footage keeps its existing behavior. Actual model failures propagate.
    """
    import cv2
    import numpy as np
    from scipy.io import wavfile
    from backend.config import TEMP_DIR
    if not any(len(row["candidates"]) > 1 for row in records):
        return None
    tracks, assignments = build_tracks(records)
    cap = cv2.VideoCapture(str(video_path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        if fps <= 0:
            raise RuntimeError("Cannot read video frame rate for Light-ASD")
        available = max(0., cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps - start_time)
        duration = available if duration is None else min(duration, available)
        count = int(math.ceil(duration * 25))
        if count <= 0:
            return None
        if start_time:
            cap.set(cv2.CAP_PROP_POS_FRAMES, round(start_time * fps))
        with tempfile.TemporaryDirectory(prefix="light_asd_", dir=str(TEMP_DIR)) as temporary:
            audio_path = Path(temporary) / "audio.wav"
            extraction = subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start_time), "-i", str(video_path),
                                        "-t", str(duration), "-map", "0:a:0?", "-vn", "-ar", "16000", "-ac", "1", str(audio_path)],
                                       capture_output=True, timeout=600)
            if extraction.returncode:
                error = extraction.stderr.decode(errors="replace")
                if "does not contain any stream" in error or "matches no streams" in error:
                    logger.info("Light-ASD: source has no audio; retaining visual focus")
                    return None
                raise RuntimeError("Could not extract audio for Light-ASD: " + error[-500:])
            sample_rate, waveform = wavfile.read(audio_path, mmap=True)
            if sample_rate != 16000:
                raise RuntimeError("Light-ASD requires 16 kHz audio")
            try:
                scores = {i: np.full(count, np.nan) for i in range(len(tracks))}
                decoded, frame = -1, None
                with _LOCK:
                    model, classifier, device = _get_model()
                    for chunk in range(0, count, 150):
                        crops = {}
                        for index in range(chunk, min(count, chunk + 150)):
                            timestamp = index / 25
                            wanted = round(timestamp * fps)
                            while decoded < wanted:
                                ok, frame = cap.read()
                                if not ok:
                                    break
                                decoded += 1
                            if frame is None or decoded < wanted:
                                break
                            for track_id, track in enumerate(tracks):
                                face = interpolated_face(track, timestamp)
                                if face is not None:
                                    crops.setdefault(track_id, []).append((index, _face_crop(frame, face)))
                        for track_id, values in crops.items():
                            # A detector dropout or a cut may split visibility inside a window.
                            boundaries = [0] + [i for i in range(1, len(values)) if values[i][0] != values[i-1][0]+1] + [len(values)]
                            for begin, end in zip(boundaries, boundaries[1:]):
                                run = values[begin:end]
                                if len(run) < 5:
                                    continue
                                first, last = run[0][0], run[-1][0] + 1
                                audio = waveform[first*640:min(len(waveform), last*640+400)]
                                if len(audio) < 400:
                                    continue
                                visual = np.asarray([crop for _, crop in run])
                                scores[track_id][first:last] = _infer_track(model, classifier, device, audio, visual)
                result = []
                for row_index, row in enumerate(records):
                    index = min(count-1, round(row["time"]*25))
                    candidates = []
                    for j, (_, face) in enumerate(row["candidates"]):
                        track_id = assignments[row_index, j]
                        score = scores[track_id][max(0, index-2):min(count, index+3)]
                        valid = score[np.isfinite(score)]
                        if len(valid):
                            candidates.append((float(np.mean(valid)), face))
                    result.append(candidates)
                logger.info("Light-ASD scored %d sample frames across %d tracks", len(records), len(tracks))
                return result
            finally:
                # Close the memory map before TemporaryDirectory removes the WAV on Windows.
                if getattr(waveform, "_mmap", None) is not None:
                    waveform._mmap.close()
    finally:
        cap.release()
