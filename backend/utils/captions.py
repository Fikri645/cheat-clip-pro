"""Caption timing and styles shared by native ASS and browser composition."""
CAPTION_STYLES = {
    "viral_pop": {"highlight":"#FFE600","outline":"#000000","back":"#000000","alpha":"80","outlineWidth":4.8,"shadowWidth":2},
    "beast_punch": {"highlight":"#00FF66","outline":"#111111","back":"#000000","alpha":"A0","outlineWidth":5,"shadowWidth":2.2},
    "cyber_violet": {"highlight":"#D946EF","outline":"#330033","back":"#500050","alpha":"80","outlineWidth":4.8,"shadowWidth":2},
    "fire_red": {"highlight":"#FF2E2E","outline":"#200000","back":"#600000","alpha":"90","outlineWidth":4.8,"shadowWidth":2},
    "electric_cyan": {"highlight":"#00F0FF","outline":"#202010","back":"#302000","alpha":"90","outlineWidth":4.8,"shadowWidth":2},
    "golden_aura": {"highlight":"#FFB800","outline":"#20120A","back":"#301800","alpha":"A0","outlineWidth":4.8,"shadowWidth":2},
    "clean_minimal": {"highlight":"#E0E0E0","outline":"#111111","back":"#000000","alpha":"B0","outlineWidth":3.6,"shadowWidth":1.8},
}


def ass_color(rgb, alpha="00"):
    r,g,b=rgb[1:3],rgb[3:5],rgb[5:7]
    return f"&H{alpha}{b}{g}{r}"


def caption_events(words):
    chunks, chunk, chars = [], [], 0
    for word in sorted(words,key=lambda w:w["start"]):
        text=word.get("word_text",word.get("word",""))
        if not text:
            continue
        pause=chunk and word["start"]-chunk[-1]["end"]>=.38
        sentence=chunk and chunk[-1].get("word_text",chunk[-1].get("word","")).endswith((".","?","!"))
        if chunk and (len(chunk)>=3 or pause or sentence or chars+len(text)>22):
            chunks.append(chunk);chunk=[];chars=0
        chunk.append(word);chars+=len(text)+1
    if chunk:chunks.append(chunk)
    bounds=[]
    for chunk in chunks:
        start=chunk[0]["start"]
        end=max(start+.35,chunk[-1]["end"]+.12)
        if bounds:
            start=max(start,bounds[-1][1]);end=max(end,start+.28)
        bounds.append((start,end))
    for i in range(len(bounds)-1):
        if bounds[i][1]>bounds[i+1][0]:
            split=max(bounds[i][0]+.28,bounds[i+1][0])
            bounds[i]=(bounds[i][0],split)
            bounds[i+1]=(split,max(split+.28,bounds[i+1][1]))
    events=[]
    for chunk,(start,end) in zip(chunks,bounds):
        points=[start];count=len(chunk)
        for i in range(1,count):
            lower,upper=points[-1]+.16,end-.16*(count-i)
            point=points[-1]+(end-points[-1])/(count-i+1) if lower>upper else max(lower,min(upper,chunk[i]["start"]))
            points.append(point)
        points.append(end)
        for i in range(count):
            events.append({"start":points[i],"end":points[i+1],"words":chunk,"active_index":i})
    return events
