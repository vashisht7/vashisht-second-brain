# v5.2 Implementation Plan

## 1. server.py – System prompt fix (Telugu style leaking into factual answers)
- Add "When answering factual questions (numbers, dates, identifiers), respond ONLY with the fact. Do NOT apply Telugu-English style to factual answers." to self persona system prompt
- Force `privateSession=true` for all voice-mode queries so vault returns full unredacted values
- When `responseMode=voice` AND `privateVault=true`, still use `format_protected_answer` (deterministic, no LLM style rewrite)

## 2. server.py – Human-readable timestamps  
- `format_human_date()` helper: "July 4th" style using strftime

## 3. renderer/styles.css – Knowledge section layout
- `.knowledge-explorer` → make graph-panel dominant (flex: 1, min-height: 500px)
- Minimise `#knowledgeDashboard` metric cards: small 2-col compact strip, not full cards
- Fix node overlap: in renderKnowledgeGraph() use force-spread layout or larger ring radius

## 4. renderer/app.js – Knowledge graph node layout
- Increase outer ring radius significantly (ring * 2.2 instead of 1.75)
- Add label background rect behind SVG text for readability
- Compact knowledge dashboard (smaller card HTML)

## 5. renderer/app.js – Training timestamps human format
- Parse "2026-07-04 18:07" → "July 4th, 2026 · 6:07 PM"

## 6. renderer/quick.html + quick.css – Ultra-minimal HUD
- Remove header, mark, strong/span title row, footer
- Keep ONLY: textarea + mic button + plus/attach button + send button
- Very small window: 420×90 default, expands to show answer

## 7. main.js – Quick window size update
- width: 460, height: 90 (collapsed), expandable

## 8. renderer/quick.js – 5-second silence timeout
- Add silenceTimer that auto-stops recording after 5s of no audio energy
- If user speaks (audio energy detected), reset the timer

## 9. renderer/index.html + styles.css – Plus icon fix
- Check plusButton styling in composer

## 10. Version bump: 5.2.0 everywhere

## 11. Build + install
