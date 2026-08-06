# Charvi Mode – Future Roadmap

> The model **already learns** from your WhatsApp/iMessage conversations with Charvi as part of the LoRA style adapter training. The training data is tagged `charvi` internally — it's just not exposed in the UI yet.

---

## What exists today (background, invisible)
- `charvi` audience value exists in `server.py` chat routing
- Training examples tagged `high_charvi` are included in every adapter training run
- The LoRA adapter learns Vashisht's exact tone, vocabulary, and rhythm when chatting with Charvi

---

## Phase 1 – Deepen the learning (no UI needed)

- [ ] **Tag more conversations** – run the indexer with `audience=charvi` filter so messages from that WhatsApp/iMessage thread get extra weight in training
- [ ] **Add Charvi-specific grammar samples** – in the language interview, add a few "how would you respond to Charvi if she said X?" prompts
- [ ] **Verify training data count** – check `counts.high_charvi` in Training Dashboard. Target ≥ 500 examples before exposing the mode

---

## Phase 2 – Sidebar persona mode (UI)

- [ ] **Add "Charvi Mode" toggle in sidebar** – a named pill button (not in conversation type dropdown) with a subtle glow, visible only in the sidebar
- [ ] **Make sidebar mode resizable** – sidebar already has resize handle; confirm it persists the Charvi section width in `localStorage`
- [ ] **Route chat to Charvi persona** when mode is active:  
  - `audience = "charvi"` sent to `/api/chat`
  - System prompt shifts to "Respond exactly as Vashisht would reply to Charvi — casual, warm, Telugu-English code-switch, minimal punctuation"
- [ ] **Show Charvi mode indicator** in the chat header (a small colored badge)
- [ ] **Prevent chat history from mixing** – Charvi-mode conversations saved with `audience=charvi` tag, shown in their own sidebar section

---

## Phase 3 – Polish

- [ ] **Vasi responds AS Vashisht** – when Charvi mode is active, Vasi produces the reply Vashisht would send (not an explanation of what to say)
- [ ] **One-tap copy** – a copy button pre-formatted for iMessage (no markdown)
- [ ] **Quick Chat shortcut in Charvi mode** – `⌘⇧Space` with mode already set to Charvi so the floating HUD immediately responds in that style

---

> **Note:** This is purely a future UI/routing layer. The model weights already encode Charvi-style data. No re-training is required to activate Phase 2 — just routing and UI changes.
