# Phone Second Brain — Implementation Plan

> **Status**: Planning only. Say **"phone.md"** to begin implementation.

---

## Proposed Tech Stack

| Layer | Tool | Why |
|---|---|---|
| **Embedding Model** | `nomic-embed-text` via Ollama | Free, local, 768-dim, fast on Mac |
| **Vector Database** | `ChromaDB` (persistent mode) | File-based, zero config, Python-native |
| **LLM (Mac Mini)** | `llama3.2:3b` via Ollama | 3B params, fast on M1/M2 Mac Mini, private |
| **API Server** | `FastAPI` + `uvicorn` | Lightweight, async, Python |
| **Web UI / PWA** | Vanilla HTML + JS (PWA manifest) | Works on any phone, no app store needed |
| **Daily Scheduler (Laptop)** | `launchd` plist (macOS native) | Runs even when not logged in |
| **Sync Method** | `rsync` over `SSH` | Battle-tested, resumable, compressed |
| **Index Encryption** | `cryptography` (Fernet/AES-256) | Simple, Python-native, key stays on laptop |
| **Auth** | Static API key in HTTP header (`X-API-Key`) | Simple and sufficient |
| **Process Manager (Mac Mini)** | `launchd` plist | macOS native, auto-start on boot |

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────┐
│                     YOUR LAPTOP                          │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │  /PersonalAIData/                               │    │
│  │    00_inbox/   10_raw_immutable/   05_private/  │    │
│  │         ↓ (daily launchd job at 2 AM)           │    │
│  │  indexer.py                                     │    │
│  │    1. Scan changed files                        │    │
│  │    2. Embed with nomic-embed-text               │    │
│  │    3. Produce encrypted_index.tar.gz            │    │
│  │         └── ChromaDB snapshot (encrypted)       │    │
│  │             └── metadata: hash-only, no paths   │    │
│  │    4. rsync → Mac Mini over SSH                 │    │
│  └─────────────────────────────────────────────────┘    │
│                         ↕ SSH (port 22)                  │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼  Encrypted index package only
┌──────────────────────────────────────────────────────────┐
│                  FRIEND'S MAC MINI                       │
│                                                          │
│  User: brainbot (restricted, no GUI login needed)        │
│                                                          │
│  /home/brainbot/                                         │
│    index_incoming/    ← rsync drops encrypted packages   │
│    chroma_db/         ← decrypted, runtime only          │
│    server/                                               │
│      api_server.py    ← FastAPI (port 8080)              │
│      web_ui/          ← PWA served at /                  │
│    ollama/            ← llama3.2:3b + nomic-embed-text   │
│                                                          │
│  launchd plist → auto-start api_server.py on boot        │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼  HTTPS (Tailscale or port forward)
┌──────────────────────────────────────────────────────────┐
│                     YOUR PHONE                           │
│  Browser → https://macmini.local:8080                    │
│  PWA (Add to Home Screen)                                │
│  Sends: { question: "...", api_key: "..." }              │
│  Receives: { answer: "...", sources: [...] }             │
└──────────────────────────────────────────────────────────┘
```

---

## Index Structure (Privacy-Safe)

What is pushed to Mac Mini — **no file paths, no readable content**:

```json
{
  "chunk_id": "sha256:a3f9c2...",
  "embedding": [0.123, -0.456, ...],
  "metadata": {
    "doc_hash": "sha256:9b21f0...",
    "chunk_index": 3,
    "approx_date": "2026-07",
    "type": "note"
  }
}
```

- ❌ No file paths
- ❌ No file names
- ❌ No readable content (only embeddings)
- ❌ No folder hierarchy
- ✅ Only: SHA256 doc hash, chunk index, approximate month, content type tag

---

## API Design (Mac Mini)

```
POST /query
Headers: X-API-Key: <your_key>
Body: { "question": "What is my US visa expiry?" }
Response: { "answer": "...", "confidence": 0.91 }

GET /status
Headers: X-API-Key: <your_key>
Response: { "chunks": 4821, "last_updated": "2026-08-05T02:00:00Z" }
```

---

## Full Task List

> These are the tasks that will be executed when you say **"phone.md"**

### PHASE 1 — Laptop Setup
- [ ] **L1**: Confirm laptop OS (macOS or Windows) and Python version
- [ ] **L2**: Install `ollama` on laptop for embedding generation
- [ ] **L3**: Pull `nomic-embed-text` model on laptop: `ollama pull nomic-embed-text`
- [ ] **L4**: Write `indexer.py`:
  - Scans configured source folders (`00_inbox`, `10_raw_immutable`, etc.)
  - Chunks text files into ~512-token segments
  - Embeds each chunk using `nomic-embed-text`
  - Stores embeddings in a local ChromaDB snapshot
  - Hashes all doc IDs and strips readable metadata
  - Encrypts the ChromaDB snapshot with AES-256 Fernet key
  - Packages into `encrypted_index_<date>.tar.gz`
- [ ] **L5**: Write `sync.sh` — rsyncs package to Mac Mini over SSH
- [ ] **L6**: Write `laptop_job.sh` — combines indexer.py + sync.sh
- [ ] **L7**: Create `com.vashisht.brain.indexer.plist` launchd job:
  - Runs `laptop_job.sh` at 2:00 AM daily
  - Runs even when user is not logged in (`RunAtLoad = false`)
  - Logs to `/var/log/brain_indexer.log`
- [ ] **L8**: Load and test launchd job manually
- [ ] **L9**: Store Fernet encryption key securely in macOS Keychain
- [ ] **L10**: Add SSH key for passwordless sync to Mac Mini

---

### PHASE 2 — Mac Mini Setup
- [ ] **M1**: Create restricted user `brainbot` on Mac Mini (no admin, no GUI login)
- [ ] **M2**: Generate SSH keypair on laptop; add public key to `brainbot@mac-mini:~/.ssh/authorized_keys`
- [ ] **M3**: Install Ollama on Mac Mini
- [ ] **M4**: Pull models: `ollama pull llama3.2:3b` and `ollama pull nomic-embed-text`
- [ ] **M5**: Set up folder structure: `~/index_incoming/`, `~/chroma_db/`, `~/server/`
- [ ] **M6**: Write `receiver.py`:
  - Watches `index_incoming/` for new encrypted packages
  - Decrypts and unpacks them
  - Merges with existing `chroma_db/`
  - Cleans up old packages
- [ ] **M7**: Write `api_server.py` (FastAPI):
  - `POST /query` — RAG pipeline: embed question → ChromaDB search → LLM answer
  - `GET /status` — return chunk count and last update time
  - API key middleware (read from env var `BRAIN_API_KEY`)
- [ ] **M8**: Build `web_ui/`:
  - Single `index.html` PWA
  - Input field + submit button
  - Answer panel with subtle source confidence
  - `manifest.json` for "Add to Home Screen"
  - Mobile-first CSS
- [ ] **M9**: Create `com.brainbot.server.plist` launchd job:
  - Starts `api_server.py` on Mac Mini boot
  - Auto-restarts if it crashes
- [ ] **M10**: Set up TLS or Tailscale for secure phone access
- [ ] **M11**: Encrypt `chroma_db/` at rest (SQLite encryption wrapper or encrypted volume)
- [ ] **M12**: Test full flow: query from browser → get answer

---

### PHASE 3 — Phone Setup
- [ ] **P1**: Open browser on phone → `http://<macmini-tailscale-ip>:8080`
- [ ] **P2**: Add to Home Screen (iOS Safari: Share → Add to Home Screen)
- [ ] **P3**: Enter API key once (stored in PWA localStorage)
- [ ] **P4**: Test question → answer roundtrip

---

### PHASE 4 — Production Hardening
- [ ] **H1**: Add incremental indexing (skip unchanged files using content hash)
- [ ] **H2**: Add retry logic in `sync.sh` for offline Mac Mini
- [ ] **H3**: Add log rotation for `brain_indexer.log`
- [ ] **H4**: Test: simulate Mac Mini offline → sync resumes next day automatically
- [ ] **H5**: Document API key rotation procedure

---

## Costs

### Software / Operational Costs

| Item | Cost |
|---|---|
| Ollama (llama3.2:3b + nomic-embed-text) | **Free** |
| ChromaDB | **Free** |
| FastAPI / Python | **Free** |
| Tailscale (personal plan, 1 user, 3 devices) | **Free** (up to 100 devices) |
| macOS launchd scheduler | **Free** (built-in) |
| **Total Monthly Cost** | **$0** |

> Only cost would be electricity on the Mac Mini (~$3–6/month).

---

### Hardware Costs

| Item | Minimum | Recommended |
|---|---|---|
| **Mac Mini** (friend's, already have) | M1 (8GB RAM) | M2 (16GB RAM) |
| **Networking** | Home router port-forward | Tailscale (free, easier) |

#### If you need to buy a Mac Mini:
| Model | RAM | Price (New) | Price (Refurbished) |
|---|---|---|---|
| Mac Mini M2 | 8GB | ~$599 | ~$400–450 |
| Mac Mini M2 Pro | 16GB | ~$1,299 | ~$800–900 |
| Mac Mini M4 | 16GB | ~$799 | ~$700 |

> **Recommendation**: M2 16GB (~$800 new) is ideal. `llama3.2:3b` runs comfortably on 8GB, but 16GB gives headroom for a larger model like `llama3.2:7b` if you want better answers.

---

## What You Need to Do (Manual Steps Before Implementation)

These steps require your input — I cannot do these for you:

1. **Ask your friend** to:
   - Keep Mac Mini powered on 24/7
   - Create user account `brainbot` (no admin privileges)
   - Enable SSH: System Settings → General → Sharing → Remote Login
   - Share the Mac Mini's local IP or set a static IP

2. **Install Tailscale** on your phone, laptop, and Mac Mini (free):
   - This gives a stable `macmini.tail123.ts.net` hostname for your phone to always reach the Mac Mini, even if your friend's router IP changes.
   - Link: [tailscale.com](https://tailscale.com)

3. **Decide which folders to index** (e.g., `00_inbox`, `10_raw_immutable`, etc.)

4. **Create a strong API key** (e.g., a 32-char random string) — you'll use this on your phone to authenticate.

---

## Open Questions (Answer Before Saying "phone.md")

1. **What OS is your laptop?** (macOS or Windows) → Affects launchd vs Task Scheduler.
2. **Does your friend's Mac Mini have M1, M2, or M4 chip?** → Affects model selection.
3. **Do you want Tailscale (easiest) or port forwarding on your friend's router?** → Affects connectivity.
4. **Which folders on your laptop should be indexed?** → Currently guessing `00_inbox`, `10_raw_immutable`, `20_normalized` based on your existing setup.
5. **Should the PII vault be included in the phone index?** → Recommend NO for security — keep PII queries only on your local Rishi app.
