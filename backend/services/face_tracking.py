"""Time-dependent framing with speaker hysteresis and smoothing inside each shot."""
import math
from pathlib import Path


def smooth_trajectory(points, max_speed=0.28):
    result = []
    for point in sorted(points, key=lambda p: p["time"]):
        current = dict(point)
        if result and not current.get("cut"):
            previous = result[-1]
            dt = max(0.001, current["time"] - previous["time"])
            for key in ("cx", "cy"):
                delta = current[key] - previous[key]
                # Small movements stay still, deliberate moves ease toward target.
                change = 0 if abs(delta) < 0.025 else max(-max_speed * dt, min(max_speed * dt, delta * 0.65))
                current[key] = previous[key] + change
        for key in ("cx", "cy"):
            current[key] = round(max(0.0, min(1.0, current[key])), 5)
        result.append(current)
    return result


def tracking_expression(points, axis="cx", max_points=80):
    """Piecewise interpolation for FFmpeg crop x/y expressions (t is in seconds)."""
    if not points:
        return "0.5"
    if len(points) > max_points:
        stride = math.ceil(len(points) / max_points)
        points = points[::stride] + ([points[-1]] if points[-1] not in points[::stride] else [])
    expression = f"{points[-1][axis]:.5f}"
    # Linear interpolation within a shot; cut directly at a scene boundary.
    for previous, current in reversed(list(zip(points, points[1:]))):
        t0, t1 = previous["time"], current["time"]
        if t1 <= t0:
            continue
        value = f"{previous[axis]:.5f}" if current.get("cut") else f"({previous[axis]:.5f}+({current[axis]-previous[axis]:.5f})*(t-{t0:.4f})/{t1-t0:.4f})"
        expression = f"if(lt(t,{t1:.4f}),{value},{expression})"
    return expression


def track_frames(frames, position="auto", streamer_preset="none"):
    """Consume (seconds, BGR frame) pairs; no full-video array is retained."""
    import cv2
    import numpy as np
    from backend.video_engine import CASCADE_PATH, YUNET_MODEL_PATH
    detector = None
    if Path(YUNET_MODEL_PATH).exists():
        detector = cv2.FaceDetectorYN.create(str(YUNET_MODEL_PATH), "", (320, 180), 0.65)
    cascade = cv2.CascadeClassifier(str(CASCADE_PATH))
    points, previous_gray, previous_hist = [], None, None
    selected_cx, last_switch = None, -100.0
    manual = {"left": (0.25, 0.4), "right": (0.75, 0.4), "center": (0.5, 0.4),
              "top_left": (0.2, 0.2), "top_right": (0.8, 0.2),
              "bottom_left": (0.2, 0.8), "bottom_right": (0.8, 0.8)}
    for timestamp, original in frames:
        frame = cv2.resize(original, (640, 360))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
        cv2.normalize(hist, hist)
        cut = previous_hist is not None and cv2.compareHist(previous_hist, hist, cv2.HISTCMP_BHATTACHARYYA) > 0.55
        faces = []
        if detector is not None:
            detector.setInputSize((640, 360))
            _, detections = detector.detect(frame)
            if detections is not None:
                faces = [tuple(map(float, f[:4])) for f in detections]
        elif not cascade.empty():
            faces = list(cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24)))
        candidates = []
        for x, y, w, h in faces:
            x, y, w, h = map(int, (x, y, w, h))
            cx, cy = (x+w/2)/640, (y+h/2)/360
            mouth = gray[max(0,y+int(h*.6)):min(360,y+h), max(0,x):min(640,x+w)]
            motion = 0.0
            if previous_gray is not None and not cut and mouth.size:
                old = previous_gray[max(0,y+int(h*.6)):min(360,y+h), max(0,x):min(640,x+w)]
                if old.shape == mouth.shape:
                    motion = float(np.mean(cv2.absdiff(old, mouth))) / 255
            continuity = 0.3 if selected_cx is not None and abs(cx-selected_cx) < .12 else 0
            score = math.sqrt(w*h/(640*360)) + 4*motion + continuity
            if streamer_preset != "none" and math.hypot(cx-.5,cy-.5)>.3:
                score += .7
            if position in manual:
                target_x, target_y = manual[position]
                score = -math.hypot(cx-target_x, cy-target_y)
            candidates.append((score, {"cx": cx, "cy": cy, "w": w/640, "h": h/360}))
        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            chosen = candidates[0][1]
            if selected_cx is not None and abs(chosen["cx"]-selected_cx) > .2 and not cut and timestamp-last_switch < 1:
                chosen = min((c[1] for c in candidates), key=lambda c: abs(c["cx"]-selected_cx))
            elif selected_cx is None or abs(chosen["cx"]-selected_cx) > .2 or cut:
                last_switch = timestamp
            selected_cx = chosen["cx"]
        else:
            weights = cv2.magnitude(cv2.Sobel(gray, cv2.CV_32F, 1, 0), cv2.Sobel(gray, cv2.CV_32F, 0, 1))
            if previous_gray is not None and not cut:
                weights += cv2.absdiff(gray, previous_gray).astype(np.float32)*4
            weights = np.maximum(0, weights-np.percentile(weights, 75))
            total = float(weights.sum())
            if total > 0:
                yy, xx = np.indices(weights.shape)
                cx, cy = float((xx*weights).sum()/total/640), float((yy*weights).sum()/total/360)
            else:
                cx, cy = .5, .35
            if position in manual:
                cx, cy = manual[position]
            chosen = {"cx": float(cx), "cy": float(cy), "w": .25, "h": .25}
        points.append({"time": round(float(timestamp), 4), **chosen, "cut": bool(cut)})
        previous_gray, previous_hist = gray, hist
    return smooth_trajectory(points)


def detect_crop_trajectory(video_path, facecam_position="auto", streamer_preset="none", interval=.5):
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        duration = cap.get(cv2.CAP_PROP_FRAME_COUNT) / fps
        def frames():
            timestamp = 0.0
            while timestamp < duration:
                cap.set(cv2.CAP_PROP_POS_MSEC, timestamp*1000)
                ok, frame = cap.read()
                if not ok:
                    break
                yield timestamp, frame
                timestamp += interval
        return track_frames(frames(), facecam_position, streamer_preset)
    finally:
        cap.release()
