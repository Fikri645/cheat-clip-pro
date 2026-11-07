"""Preserve real speaker evidence and avoid treating a conversation as one opinion."""

CONVERSATION_INSTRUCTION = """CONVERSATION CONTEXT (MANDATORY):
- This may be a discussion with multiple speakers. Preserve questions, answers,
  objections, corrections, quotations, irony and the response that resolves them.
- Speaker IDs are voice labels, not real names. Use supplied speaker labels when
  present. UNKNOWN means no acoustic speaker evidence is available; do not invent
  identities or assume that every segment is spoken by the same person.
- Do not attribute the guest's position to the host/channel or treat a quoted or
  hypothetical statement as the speaker's own position. Names/roles need explicit
  evidence in the transcript, not guesses based only on the video title.
- Select a coherent exchange with its setup and payoff. Include the question or
  rebuttal needed to understand the answer. Skip it if that context cannot fit.
- An overlap marker means simultaneous speech; text alone may omit one voice.
  Do not fabricate the missing words or a speaker's response.
"""


def conversation_metadata(line):
    result = {}
    if line.get("speaker"):
        result["speaker"] = str(line["speaker"])[:200]
    if line.get("speakers"):
        result["speakers"] = [str(speaker)[:200] for speaker in line["speakers"][:30]]
    if line.get("overlap"):
        result["overlap"] = True
    return result


def format_dialogue_line(line):
    labels = line.get("speakers") or ([line["speaker"]] if line.get("speaker") else [])
    speaker = ", ".join(str(value).replace("\n", " ") for value in labels) or "UNKNOWN"
    marker = f"speaker={speaker}" + ("; overlapping speech" if line.get("overlap") else "")
    return f"{line['start']:.2f}|{line['end']:.2f} [{marker}] {line['text']}"
