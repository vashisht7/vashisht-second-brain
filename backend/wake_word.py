#!/usr/bin/env python3
"""
Hey Rishi wake-word detector — Vashisht Second Brain (v3)
"""
# ── Force unbuffered stdout IMMEDIATELY ─────────────────────────────────────
# Without this, Python buffers stdout when piped to Electron/subprocess,
# causing WAKE_WORD_DETECTED to never reach the parent process.
import sys, os
os.environ["PYTHONUNBUFFERED"] = "1"
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
else:
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, line_buffering=True)
"""

Two-phase approach:
  1. CALIBRATE  — 2s of silence to learn the ambient noise floor
  2. LISTEN     — detect speech as energy > (noise_floor * multiplier),
                  then transcribe when speech ends (energy drops back down)

Uses locally-cached mlx-community/whisper-large-v3-turbo.

Protocol (stdout → Electron):
  WAKE_WORD_LISTENING           → ready
  WAKE_WORD_DETECTED            → wake word heard
  WAKE_WORD_STATUS:<msg>        → log
  WAKE_WORD_ERROR:<msg>         → fatal
"""
import time, threading, queue as _queue


SAMPLE_RATE    = 16000
CHUNK_MS       = 80                                      # 80ms per chunk
CHUNK_SAMPLES  = int(SAMPLE_RATE * CHUNK_MS / 1000)      # 1280
WINDOW_SEC     = 2.5                                     # ring buffer length
WINDOW_SAMPLES = int(SAMPLE_RATE * WINDOW_SEC)           # 40000

# Adaptive VAD parameters — tuned for high far-field & soft voice sensitivity
NOISE_MULTIPLIER = 1.3   # speech only needs to be 30% louder than ambient floor
MIN_ENERGY       = 0.0012 # capture soft whispers and faraway voices
MIN_SPEECH       = 2     # 2 voiced chunks (~160ms) to catch quiet utterances
MAX_SILENCE      = 6     # 6 silent chunks (~480ms) to transcribe quickly
CALIBRATION_SEC  = 2.0   # calibrate ambient noise floor at startup
COOLDOWN_SEC     = 2.0   # 2s cooldown after trigger

# Periodic fallback: transcribe every PERIODIC_SEC seconds if there's speech
PERIODIC_SEC     = 3.0

WAKE_PHRASES = [
    "hey rishi", "hi rishi", "hey reeshi", "hey richi", "hay rishi",
    "hey rishie", "hey rish", "a rishi", "ey rishi", "hey richy",
    "hey richie", "hey rishee", "hei rishi", "hey rushi", "he rishi",
    "hey reche", "hey rachy", "hey reishi", "hey reesha", "hey reshi",
    "hey rishi.", "hey, rishi", "hey rishi!", "hey-rishi",
    "hi rish", "hey receive", "hey reach", "hey rachel",
    "rishi", "reeshi", "richi", "rishie", "richy", "richie", "reshi",
]

_paused = False


def _log(msg: str):
    print(msg, flush=True)


def _find_transcribe():
    """Return a transcribe(float32_ndarray) → str callable."""
    try:
        import mlx_whisper

        for repo in [
            "mlx-community/whisper-large-v3-turbo",
            "mlx-community/whisper-tiny-en-mlx",
        ]:
            try:
                import numpy as np
                _log(f"WAKE_WORD_STATUS:Loading model {repo}…")
                test = np.zeros(8000, dtype=np.float32)
                mlx_whisper.transcribe(test, path_or_hf_repo=repo, verbose=False)
                _log(f"WAKE_WORD_STATUS:Model loaded: {repo} ✓")

                def _t(audio, _repo=repo):
                    r = mlx_whisper.transcribe(
                        audio, path_or_hf_repo=_repo,
                        verbose=False, language="en",
                    )
                    return r.get("text", "").lower().strip()
                return _t
            except Exception as e:
                _log(f"WAKE_WORD_STATUS:Model {repo} failed: {e}")
                continue
    except ImportError:
        pass

    try:
        import whisper as _ow
        _m = _ow.load_model("tiny.en")
        _log("WAKE_WORD_STATUS:Whisper backend = OpenAI tiny.en ✓")

        def _t(audio):
            return _m.transcribe(audio, language="en", fp16=False).get("text", "").lower().strip()
        return _t
    except ImportError:
        pass

    return None


def _stdin_watcher():
    global _paused
    try:
        for line in sys.stdin:
            cmd = line.strip().upper()
            if cmd == "PAUSE":
                _paused = True
                _log("WAKE_WORD_STATUS:Paused")
            elif cmd == "RESUME":
                _paused = False
                _log("WAKE_WORD_STATUS:Resumed")
    except Exception:
        pass


def main():
    global _paused

    try:
        import sounddevice as sd
        import numpy as np
    except ImportError as e:
        _log(f"WAKE_WORD_ERROR:Missing dependency: {e}")
        sys.exit(1)

    try:
        dev = sd.query_devices(kind="input")
        _log(f"WAKE_WORD_STATUS:Mic: {dev['name']} (sr={dev['default_samplerate']})")
    except Exception:
        _log("WAKE_WORD_STATUS:Could not query input device")

    transcribe = _find_transcribe()
    if not transcribe:
        _log("WAKE_WORD_ERROR:No working Whisper backend")
        sys.exit(1)

    threading.Thread(target=_stdin_watcher, daemon=True).start()

    # ── Phase 1: Calibrate ambient noise ────────────────────────────
    _log("WAKE_WORD_STATUS:Calibrating ambient noise (2s)… stay quiet")
    cal_samples = int(SAMPLE_RATE * CALIBRATION_SEC)
    cal_audio = sd.rec(cal_samples, samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    cal_flat = cal_audio[:, 0]

    # Compute RMS per chunk, then take the 90th percentile as noise floor
    rms_values = []
    for i in range(0, len(cal_flat), CHUNK_SAMPLES):
        chunk = cal_flat[i:i + CHUNK_SAMPLES]
        if len(chunk) == CHUNK_SAMPLES:
            rms_values.append(float(np.sqrt(np.mean(chunk ** 2))))

    noise_floor = float(np.percentile(rms_values, 90)) if rms_values else 0.01
    speech_threshold = max(noise_floor * NOISE_MULTIPLIER, MIN_ENERGY)

    _log(f"WAKE_WORD_STATUS:Noise floor = {noise_floor:.6f}")
    _log(f"WAKE_WORD_STATUS:Speech threshold = {speech_threshold:.6f} "
         f"({NOISE_MULTIPLIER}x noise, min {MIN_ENERGY})")

    # ── Phase 2: Listen ──────────────────────────────────────────────
    audio_q: _queue.Queue = _queue.Queue(maxsize=1000)

    def _sd_callback(indata, frames, time_info, status):
        if status:
            _log(f"WAKE_WORD_STATUS:Audio status: {status}")
        if not _paused:
            audio_q.put(indata[:, 0].astype(np.float32).copy())

    ring       = np.zeros(WINDOW_SAMPLES, dtype=np.float32)
    ring_pos   = 0
    in_speech  = False
    sp_chunks  = 0
    si_chunks  = 0
    last_wake  = 0.0
    last_periodic = time.monotonic()
    total_voiced_since_periodic = 0

    def _check_wake(audio_segment):
        """Transcribe audio and check for wake phrase. Returns True if matched."""
        nonlocal last_wake
        now = time.monotonic()
        if now - last_wake < COOLDOWN_SEC:
            return False

        try:
            text = transcribe(audio_segment)
            # Filter out Whisper hallucinations (repetitive single-word outputs)
            words = text.split()
            if len(words) > 3 and len(set(words)) == 1:
                _log(f"WAKE_WORD_STATUS:Hallucination filtered: \"{text[:60]}…\"")
                return False

            _log(f"WAKE_WORD_STATUS:Heard → \"{text}\"")

            if any(phrase in text for phrase in WAKE_PHRASES):
                last_wake = now
                print("WAKE_WORD_DETECTED", flush=True)
                _log("WAKE_WORD_STATUS:✅ 'Hey Rishi' detected!")
                return True
            else:
                _log("WAKE_WORD_STATUS:No match — listening…")
                return False
        except Exception as exc:
            _log(f"WAKE_WORD_STATUS:Transcription error: {exc}")
            return False

    def _get_ring_audio():
        """Return the ring buffer as a contiguous array in chronological order."""
        return np.concatenate([ring[ring_pos:], ring[:ring_pos]])

    def _processor():
        nonlocal ring, ring_pos, in_speech, sp_chunks, si_chunks
        nonlocal last_periodic, total_voiced_since_periodic

        while True:
            try:
                chunk = audio_q.get(timeout=2.0)
            except _queue.Empty:
                continue

            n = len(chunk)

            # Write to ring buffer
            end = ring_pos + n
            if end <= WINDOW_SAMPLES:
                ring[ring_pos:end] = chunk
                ring_pos = end % WINDOW_SAMPLES
            else:
                first = WINDOW_SAMPLES - ring_pos
                ring[ring_pos:] = chunk[:first]
                ring[:n - first] = chunk[first:]
                ring_pos = n - first

            # Adaptive energy VAD
            rms = float(np.sqrt(np.mean(chunk ** 2)))

            if rms >= speech_threshold:
                sp_chunks += 1
                si_chunks  = 0
                in_speech  = True
                total_voiced_since_periodic += 1
            else:
                if in_speech:
                    si_chunks += 1
                    if si_chunks >= MAX_SILENCE and sp_chunks >= MIN_SPEECH:
                        # Speech ended → transcribe
                        _log(f"WAKE_WORD_STATUS:Speech ended ({sp_chunks} voiced chunks)")
                        _check_wake(_get_ring_audio())

                        in_speech  = False
                        sp_chunks  = 0
                        si_chunks  = 0
                        total_voiced_since_periodic = 0
                        last_periodic = time.monotonic()

            # Periodic fallback: if we've been in "speech" for too long
            # (no clean silence boundary), force a transcription
            now = time.monotonic()
            if (now - last_periodic >= PERIODIC_SEC
                    and total_voiced_since_periodic >= MIN_SPEECH):
                _log(f"WAKE_WORD_STATUS:Periodic check ({total_voiced_since_periodic} voiced)")
                _check_wake(_get_ring_audio())
                total_voiced_since_periodic = 0
                last_periodic = now

    threading.Thread(target=_processor, daemon=True).start()

    _log("WAKE_WORD_LISTENING")
    _log("WAKE_WORD_STATUS:🎧 Listening for 'Hey Rishi' — speak clearly into mic")

    try:
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=CHUNK_SAMPLES,
            callback=_sd_callback,
        ):
            while True:
                time.sleep(0.5)
    except Exception as exc:
        _log(f"WAKE_WORD_ERROR:Mic stream failed: {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
