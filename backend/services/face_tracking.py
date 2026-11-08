"""Time-dependent framing with speaker hysteresis and smoothing inside each shot."""
import math
from pathlib import Path


def smooth_trajectory(points, max_speed=0.14):
    result = []
    velocity={"cx":0.0,"cy":0.0}
    switching_until=-1.0
    for point in sorted(points, key=lambda p: p["time"]):
        current = dict(point)
        if result and not current.get("cut"):
            previous = result[-1]
            dt = max(0.001, current["time"] - previous["time"])
            if current.get("speaker_switch"):switching_until=current["time"]+1.2
            switching=current["time"]<=switching_until
            smooth_time=.45 if switching else .8
            speed=.32 if switching else max_speed
            for key in ("cx", "cy"):
                delta = current[key] - previous[key]
                dead_zone=.035 if key=="cx" else .025
                if abs(delta)<=dead_zone:
                    current[key]=previous[key];velocity[key]=0.0;continue
                # Keep the subject inside a stable framing region, then use a
                # critically damped move instead of chasing detector jitter.
                target=current[key]-math.copysign(dead_zone,delta)
                change=max(-speed*smooth_time,min(speed*smooth_time,previous[key]-target))
                target=previous[key]-change
                omega=2/smooth_time;x=omega*dt
                decay=1/(1+x+.48*x*x+.235*x*x*x)
                temp=(velocity[key]+omega*change)*dt
                velocity[key]=(velocity[key]-omega*temp)*decay
                current[key]=target+(change+temp)*decay
        else:
            velocity={"cx":0.0,"cy":0.0};switching_until=-1.0
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
        keep=set(range(0,len(points),stride))|{len(points)-1}
        # Never discard an actual cut when reducing expression size.
        for index,point in enumerate(points):
            if point.get("cut") or point.get("speaker_switch"):keep.update((max(0,index-1),index))
        points=[points[index] for index in sorted(keep)]
    # A balanced decision tree keeps FFmpeg parser depth logarithmic even
    # when long clips contain hundreds of cuts that must be preserved.
    intervals = []
    for previous, current in zip(points, points[1:]):
        t0, t1 = previous["time"], current["time"]
        if t1 <= t0:
            continue
        value = f"{previous[axis]:.5f}" if current.get("cut") else f"({previous[axis]:.5f}+({current[axis]-previous[axis]:.5f})*(t-{t0:.4f})/{t1-t0:.4f})"
        intervals.append((t1, value))
    intervals.append((None, f"{points[-1][axis]:.5f}"))

    def decision(begin, end):
        if end-begin == 1:
            return intervals[begin][1]
        middle = (begin+end)//2
        boundary = intervals[middle-1][0]
        return f"if(lt(t,{boundary:.4f}),{decision(begin,middle)},{decision(middle,end)})"

    return decision(0, len(intervals))



class SpeakerLock:
    """Require sustained evidence before changing subjects in the same shot."""
    def __init__(self,confirm_seconds=1.5,min_hold=2.5,missing_grace=.8,margin=.12):
        self.confirm_seconds=confirm_seconds;self.min_hold=min_hold
        self.missing_grace=missing_grace;self.margin=margin
        self.selected=None;self.pending=None;self.pending_since=0.0
        self.last_switch=-100.0;self.last_seen=-100.0

    @staticmethod
    def distance(first,second):return math.hypot(first["cx"]-second["cx"],first["cy"]-second["cy"])

    def choose(self,candidates,timestamp,cut=False,manual=False):
        if cut:self.selected=None;self.pending=None
        if not candidates:
            self.pending=None
            return (dict(self.selected),False) if self.selected and timestamp-self.last_seen<=self.missing_grace else (None,False)
        ranked=sorted(candidates,key=lambda item:item[0],reverse=True)
        best=ranked[0]
        if self.selected is None:
            self.selected=dict(best[1]);self.last_switch=timestamp;self.last_seen=timestamp
            return dict(self.selected),False
        current=min(ranked,key=lambda item:self.distance(item[1],self.selected))
        matched=self.distance(current[1],self.selected)<=max(.08,min(.18,self.selected["w"]*.7))
        if matched:
            self.selected=dict(current[1]);self.last_seen=timestamp
            if best is current or best[0]<current[0]+(.05 if manual else self.margin):
                self.pending=None;return dict(self.selected),False
        elif timestamp-self.last_seen<=self.missing_grace:
            return dict(self.selected),False
        else:
            self.selected=dict(best[1]);self.last_seen=timestamp;self.last_switch=timestamp;self.pending=None
            return dict(self.selected),True
        if self.pending is None or self.distance(self.pending,best[1])>.12:
            self.pending=dict(best[1]);self.pending_since=timestamp
        elif timestamp-self.pending_since>=self.confirm_seconds and timestamp-self.last_switch>=self.min_hold:
            self.selected=dict(best[1]);self.last_seen=timestamp;self.last_switch=timestamp;self.pending=None
            return dict(self.selected),True
        return dict(self.selected),False


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
    selector=SpeakerLock();previous_mouths=[]
    manual = {"left": (0.25, 0.4), "right": (0.75, 0.4), "center": (0.5, 0.4),
              "top_left": (0.2, 0.2), "top_right": (0.8, 0.2),
              "bottom_left": (0.2, 0.8), "bottom_right": (0.8, 0.8)}
    for timestamp, original in frames:
        frame = cv2.resize(original, (640, 360))
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
        cv2.normalize(hist, hist)
        pixel_change=float(np.mean(cv2.absdiff(gray,previous_gray)))/255 if previous_gray is not None else 0
        cut = previous_hist is not None and (pixel_change>.32 or (pixel_change>.12 and cv2.compareHist(previous_hist,hist,cv2.HISTCMP_BHATTACHARYYA)>.55))
        faces = []
        if detector is not None:
            detector.setInputSize((640, 360))
            _, detections = detector.detect(frame)
            if detections is not None:
                faces = [tuple(map(float, f[:4])) for f in detections]
        elif not cascade.empty():
            faces = list(cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(24, 24)))
        candidates = [];mouths=[]
        for x, y, w, h in faces:
            x, y, w, h = map(int, (x, y, w, h))
            cx, cy = (x+w/2)/640, (y+h/2)/360
            mouth = gray[max(0,y+int(h*.6)):min(360,y+h), max(0,x):min(640,x+w)]
            motion = 0.0
            if mouth.size:
                normalized=cv2.resize(mouth,(32,16)).astype(np.float32)
                normalized-=normalized.mean()
                nearby=[old for old in previous_mouths if math.hypot(cx-old["cx"],cy-old["cy"])<.12]
                if nearby and not cut:
                    old=min(nearby,key=lambda item:math.hypot(cx-item["cx"],cy-item["cy"]))
                    measured=float(np.mean(np.abs(normalized-old["mouth"]))) / 255
                    motion=.65*old["motion"]+.35*measured
                mouths.append({"cx":cx,"cy":cy,"mouth":normalized,"motion":motion})
            score = math.sqrt(w*h/(640*360)) + 4*motion
            if streamer_preset != "none" and math.hypot(cx-.5,cy-.5)>.3:
                score += .7
            if position in manual:
                target_x, target_y = manual[position]
                score = -math.hypot(cx-target_x, cy-target_y)
            candidates.append((score, {"cx": cx, "cy": cy, "w": w/640, "h": h/360}))
        chosen,switched=selector.choose(candidates,timestamp,cut,position in manual)
        if chosen is None:
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
        points.append({"time": round(float(timestamp), 4), **chosen, "cut": bool(cut),"speaker_switch":switched})
        previous_gray, previous_hist = gray, hist
        previous_mouths=mouths
    return smooth_trajectory(points)


def _detect_crop_trajectory_uncached(video_path, facecam_position="auto", streamer_preset="none", interval=.5):
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


def detect_crop_trajectory(video_path, facecam_position="auto", streamer_preset="none", interval=.5):
    from backend.services.render_cache import cached, source_identity
    return cached("tracking-v2-stable", [source_identity(video_path), facecam_position, streamer_preset, interval],
        lambda: _detect_crop_trajectory_uncached(video_path, facecam_position, streamer_preset, interval))
