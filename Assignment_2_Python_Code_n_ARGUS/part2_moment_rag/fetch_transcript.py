"""Fetch the manual English captions for the McRaven talk -> data/transcript.json."""
import json, sys
from pathlib import Path
from youtube_transcript_api import YouTubeTranscriptApi

VIDEO_ID = "yaQZFhrW0fU"
TITLE = "Adm. William H. McRaven — University of Texas at Austin 2014 Commencement Address"
OUT = Path(__file__).parent / "data" / "transcript.json"

def main(video_id: str = VIDEO_ID) -> None:
    tl = YouTubeTranscriptApi().list(video_id)
    track = None
    for t in tl:  # prefer the manual English track
        if t.language_code.startswith("en") and not t.is_generated:
            track = t; break
    if track is None:
        track = tl.find_transcript(["en"])
    segs = [{"start": round(s.start, 2), "duration": round(s.duration, 2),
             "text": " ".join(s.text.split())} for s in track.fetch()]
    last = segs[-1]
    doc = {"video_id": video_id, "title": TITLE, "manual_captions": not track.is_generated,
           "duration_s": round(last["start"] + last["duration"], 2), "segments": segs}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1))
    words = sum(len(s["text"].split()) for s in segs)
    print(f"wrote {OUT} — {len(segs)} segments, {doc['duration_s']/60:.1f} min, {words} words, manual={doc['manual_captions']}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else VIDEO_ID)
