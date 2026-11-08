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
    events=[]
    for index,chunk in enumerate(chunks):
        # Styling may extend the last word into a pause, but must never move
        # speech timestamps or push a following phrase later in the clip.
        end=max(chunk[-1]["start"]+.001,chunk[-1]["end"])+.12
        if index+1<len(chunks):end=min(end,chunks[index+1][0]["start"])
        for i,word in enumerate(chunk):
            start=word["start"]
            stop=chunk[i+1]["start"] if i+1<len(chunk) else end
            if stop>start:
                events.append({"start":start,"end":stop,"words":chunk,"active_index":i})
    return events
