# Implementation Plan: Sensitive Wake Word, Multi-Turn Voice Loop & Unmasked PII

## Goals
1. **Ultra-Sensitive Wake Word Detection ("Hey Rishi")**:
   - Lower energy threshold & multiplier so soft speech / whispers / far-away voices trigger wake word detection reliably from across the room.
2. **Continuous Multi-Turn Voice Dialogue Loop**:
   - After answering any question, Rishi automatically asks "Anything else?" and re-arms the microphone for follow-up questions.
   - Preserves conversation history context across turns.
   - Stops cleanly when the user says "that's it", "no", "stop", "bye", "that's all", etc.
3. **Unmasked License & PII Numbers**:
   - Return full, exact driver's license numbers and PII without masking (`••••`) or asking the user to say "exact number".

---

## Proposed Changes

### Backend

#### [MODIFY] [`wake_word.py`](file:///Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/backend/wake_word.py)
- Change `NOISE_MULTIPLIER` from `3.0` to `1.3` (triggers on soft/faraway voice 30% above noise floor).
- Lower `MIN_ENERGY` from `0.005` to `0.0012` (captures low-volume audio).
- Lower `MIN_SPEECH` to `2` chunks and `MAX_SILENCE` to `6` chunks.
- Expand `WAKE_PHRASES` to cover single-word and phonetic variants (`"rishi"`, `"hey rishi"`, `"reeshi"`, `"hi rishi"`, etc.).

#### [MODIFY] [`server.py`](file:///Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/backend/server.py)
- Update `pii_lookup(query)` to always pass `--reveal` so full unmasked numbers are returned.
- Remove redaction prompt ("Ask for full or exact number...") from `format_protected_answer`.

---

### Renderer HUD

#### [MODIFY] [`quick.js`](file:///Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/renderer/quick.js)
- Implement continuous follow-up dialogue state (`state.inVoiceDialogue`).
- After completing `speakText()` in `ask()`:
  - Check if exit phrase was spoken ("that's it", "no", "that's all", "bye", etc.).
  - If exit phrase: say brief sign-off ("Alright, let me know if you need anything else!"), stop loop, return to `idle`.
  - Otherwise, auto-trigger `startRecording()` to listen for the user's next question!

---

## Verification Plan

### Automated / Local Verification
1. Run syntax checks on `wake_word.py` and `server.py`.
2. Test `wake_word.py` with soft audio / whisper inputs.
3. Package application using `npm run make`.
4. Install to `/Applications` and launch.
