"""Shared helpers: transcript load, sentence split, embeddings, chroma, claude().

Fixed choices (see DESIGN.md, do not re-decide):
- embeddings: sentence-transformers all-MiniLM-L6-v2, local, normalized
- vector store: chromadb persistent client at ./chroma_db
- LLM: Anthropic, answers on ANSWER_MODEL, cheap passes on CHEAP_MODEL
"""
import json
import os
import re
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
TRANSCRIPT_PATH = HERE / "data" / "transcript.json"
CHROMA_PATH = HERE / "chroma_db"

ANSWER_MODEL = "claude-sonnet-5"
CHEAP_MODEL = "claude-haiku-4-5-20251001"

# USD per 1M tokens (input, output). Source: claude-api skill, "Current Models
# (cached: 2026-06-24)" rate card -- Sonnet 5 $2/$10, Haiku 4.5 $1/$5. Anthropic
# first-party API rates; not quoted from memory.
PRICES = {
    ANSWER_MODEL: (2.00, 10.00),
    CHEAP_MODEL: (1.00, 5.00),
}


def usd(model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = PRICES[model]
    return (input_tokens * pin + output_tokens * pout) / 1_000_000

# --- dotenv (folder-local .env, never printed/read for its value) ---
from dotenv import load_dotenv
load_dotenv(HERE / ".env")


def load_transcript() -> dict:
    return json.loads(TRANSCRIPT_PATH.read_text())


def sentences(transcript: dict) -> list[dict]:
    """Join caption text (newlines -> spaces), split into sentences, and map each
    sentence's start to the caption in which it begins and end to the caption in
    which it ends. Returns [{"i", "start", "end", "text"}]."""
    segs = transcript["segments"]
    full_parts = []
    offsets = []  # (char_start, char_end, seg) in the joined string
    full_len = 0
    for seg in segs:
        text = " ".join(seg["text"].split())  # newlines/extra ws -> single spaces
        if full_len:
            full_parts.append(" ")
            full_len += 1
        char_start = full_len
        full_parts.append(text)
        full_len += len(text)
        offsets.append((char_start, full_len, seg))
    full = "".join(full_parts)

    def seg_for(char_idx: int) -> dict:
        for cs, ce, seg in offsets:
            if cs <= char_idx < ce:
                return seg
        return offsets[-1][2]

    out = []
    pos = 0
    i = 0
    for m in re.finditer(r"[^.!?]+[.!?]+", full):
        raw = m.group()
        stripped = raw.strip()
        if not stripped:
            continue
        lead = len(raw) - len(raw.lstrip())
        s_char = m.start() + lead
        e_char = m.start() + len(raw.rstrip()) - 1
        start_seg = seg_for(s_char)
        end_seg = seg_for(e_char)
        out.append({
            "i": i,
            "start": start_seg["start"],
            "end": round(end_seg["start"] + end_seg["duration"], 2),
            "text": stripped,
        })
        i += 1
        pos = m.end()
    # trailing text with no terminal punctuation
    if pos < len(full) and full[pos:].strip():
        raw = full[pos:]
        stripped = raw.strip()
        lead = len(raw) - len(raw.lstrip())
        s_char = pos + lead
        e_char = pos + len(raw.rstrip()) - 1
        start_seg = seg_for(s_char)
        end_seg = seg_for(e_char)
        out.append({
            "i": i,
            "start": start_seg["start"],
            "end": round(end_seg["start"] + end_seg["duration"], 2),
            "text": stripped,
        })
    return out


def mmss(seconds: float) -> str:
    seconds = int(round(seconds))
    return f"{seconds // 60}:{seconds % 60:02d}"


# --- embeddings ---
_model = None


def embed(texts: list[str]) -> np.ndarray:
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    vecs = _model.encode(texts, normalize_embeddings=True)
    return np.asarray(vecs)


# --- chroma ---
def chroma():
    import chromadb
    return chromadb.PersistentClient(path=str(CHROMA_PATH))


# --- claude ---
_client = None


def claude(system: str, user: str, model: str, max_tokens: int = 800) -> dict:
    global _client
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()

    kwargs = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    # Current models (Sonnet 5) removed the `temperature` param from the SDK
    # entirely; run with thinking disabled instead for deterministic output.
    if model == ANSWER_MODEL:
        kwargs["thinking"] = {"type": "disabled"}

    t0 = time.time()
    resp = _client.messages.create(**kwargs)
    seconds = time.time() - t0

    text = "".join(b.text for b in resp.content if b.type == "text")
    return {
        "text": text,
        "input_tokens": resp.usage.input_tokens,
        "output_tokens": resp.usage.output_tokens,
        "seconds": seconds,
        "usd": usd(model, resp.usage.input_tokens, resp.usage.output_tokens),
    }
