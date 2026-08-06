# phone.md — Task Tracker

**Config locked:**
- Laptop OS: macOS
- Mac Mini chip: M1 16GB RAM
- Connectivity: Tailscale
- Folders indexed: `00_inbox`, `10_raw_immutable`, `20_normalized`, `05_private_pii`
- PII vault: Included (encrypted, phone-only with API key)

---

## PHASE 1 — Laptop (Source of Truth) — COMPLETE ✅
- [x] L1: Created indexer project structure at `/Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/`
- [x] L2: Created `laptop/indexer.py` — incremental scan + embedding + chunking + metadata hash + AES-256 Fernet encryption
- [x] L3: Created `laptop/sync.sh` — rsync-over-SSH transfer with retry logic & 7-day log cleanup
- [x] L4: Created `laptop/laptop_job.sh` — main glue script combining indexer + sync
- [x] L5: Encryption key generated & stored in macOS Keychain (`com.vashisht.phonebrain.enckey`)
- [x] L6: Created `laptop/com.vashisht.phonebrain.plist` — daily 2:00 AM launchd background scheduler
- [x] L7: Created `laptop/setup_laptop.sh` — one-click laptop installer

---

## PHASE 2 — Mac Mini (Always-On Server) — COMPLETE ✅
- [x] M1: Created `mac_mini/setup_mac_mini.sh` — one-click installer for friend's Mac Mini
- [x] M2: Created `mac_mini/receiver.py` — incoming package watcher, AES decryption, and 500-chunk batch merger
- [x] M3: Created `mac_mini/api_server.py` — FastAPI RAG server (`/query`, `/status`, `X-API-Key` auth)
- [x] M4: Created `web_ui/index.html` — glassmorphic PWA mobile web interface with animated orb
- [x] M5: Created `web_ui/manifest.json` & `web_ui/sw.js` — PWA standalone app manifest & service worker
- [x] M6: Created `mac_mini/com.brainbot.server.plist` — macOS launchd plist for boot auto-start

---

## PHASE 3 — Setup Guide & Phone Installation — READY 🚀
- [x] Step-by-step instructions generated for laptop, Mac Mini, and phone.
