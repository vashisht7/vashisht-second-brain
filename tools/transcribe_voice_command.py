#!/usr/bin/env python3
"""Transcribe one temporary voice-command recording locally with MLX Whisper."""

import argparse
import json
import re
from pathlib import Path

import mlx_whisper


MODEL = "mlx-community/whisper-large-v3-turbo"


def rejection_reason(text, segments):
    tokens = re.findall(r"[\w']+", text.casefold(), flags=re.UNICODE)
    normalized = " ".join(tokens)
    if normalized in {
        "thank you", "thanks", "thanks for watching", "thank you for watching",
        "subscribe", "please subscribe", "bye", "you",
    }:
        return "silence_hallucination"
    if len(tokens) >= 3:
        most_common = max(tokens.count(token) for token in set(tokens))
        if most_common / len(tokens) >= 0.75 and len(set(tokens)) <= 2:
            return "repetitive_hallucination"
    if segments:
        no_speech = [float(segment.get("no_speech_prob", 0)) for segment in segments]
        logprobs = [float(segment.get("avg_logprob", 0)) for segment in segments]
        if sum(no_speech) / len(no_speech) > 0.68:
            return "no_clear_speech"
        if sum(logprobs) / len(logprobs) < -1.15:
            return "low_confidence"
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio", type=Path)
    args = parser.parse_args()
    if not args.audio.is_file():
        raise FileNotFoundError(args.audio)
    result = mlx_whisper.transcribe(
        str(args.audio),
        path_or_hf_repo=MODEL,
        word_timestamps=False,
        verbose=False,
        temperature=0.0,
        condition_on_previous_text=False,
        no_speech_threshold=0.45,
        logprob_threshold=-1.0,
        compression_ratio_threshold=2.2,
    )
    text = result.get("text", "").strip()
    rejected = rejection_reason(text, result.get("segments", []))
    print(json.dumps({
        "text": "" if rejected else text,
        "language": result.get("language"),
        "model": MODEL,
        "rejected": rejected,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
