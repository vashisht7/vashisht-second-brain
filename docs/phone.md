# Phone Second Brain — Implementation & Deployment Guide (phone.md)

This document provides the complete, production-grade deployment and operation instructions for querying your personal files from your phone 24/7 using your **fine-tuned Gemma 4-bit model on HuggingFace**, even when your laptop is powered off.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                     YOUR LAPTOP                          │
│                                                          │
│  Folders indexed:                                        │
│    • 00_inbox/                                           │
│    • 10_raw_immutable/                                   │
│    • 20_normalized/                                      │
│    • 05_private_pii/10_encrypted_documents/              │
│                                                          │
│  Daily Job at 2:00 AM (launchd background daemon):        │
│    1. Incremental scan & text extraction                 │
│    2. Embed via local nomic-embed-text (Ollama)          │
│    3. Privacy filter: Hash IDs, strip paths & filenames  │
│    4. AES-256 Fernet encryption via macOS Keychain key   │
│    5. rsync package to Mac Mini over SSH                 │
│                                                          │
│  ⚠️ Laptop shuts down after sync. Raw files STAY HERE.   │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼ Encrypted .pkg over SSH / Tailscale
┌──────────────────────────────────────────────────────────┐
│                  FRIEND'S MAC MINI                       │
│                                                          │
│  User: brainbot (restricted user account)                │
│                                                          │
│  Models & Services (auto-start on boot via launchd):     │
│    • LLM Engine : Fine-Tuned Gemma 4-Bit Model           │
│                    (mlx-community/gemma-4-e4b-it-4bit)   │
│                    + vasisht-2nd-brain LoRA Adapter      │
│                    via Apple Silicon MLX GPU             │
│    • Embeddings : nomic-embed-text via Ollama            │
│    • receiver.py   — Decrypts & merges into ChromaDB     │
│    • api_server.py — FastAPI RAG server (Port 8080)       │
│                                                          │
│  Privacy Guarantees:                                     │
│    • Friend cannot see file structure or readable names  │
│    • Vector DB contains only hashed chunk IDs            │
│    • Protected with X-API-Key authentication             │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼ HTTPS over Tailscale
┌──────────────────────────────────────────────────────────┐
│                     YOUR PHONE                           │
│  PWA Web App (Safari / Chrome → Add to Home Screen)      │
│  Url: http://macmini.tail123.ts.net:8080                 │
│  Query personal notes 24/7 with zero cloud subscription  │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Model & Tech Stack Specifications

| Component | Model / Tool | Source / Details |
|---|---|---|
| **LLM Inference Engine** | **Fine-Tuned Gemma 4-Bit** (`mlx-community/gemma-4-e4b-it-4bit` + `vasisht-2nd-brain` adapter) | HuggingFace Hub / MLX native Apple Silicon GPU acceleration |
| **Embedding Model** | `nomic-embed-text` | Ollama local endpoint |
| **Vector DB** | `ChromaDB` (Persistent) | Embedded Python vector database |
| **API Framework** | `FastAPI` + `uvicorn` | Async Python server |
| **Networking** | `Tailscale` (Personal Free Tier) | Encrypted mesh VPN |
| **Scheduler** | macOS native `launchd` | Daily 2:00 AM job |
| **Encryption** | `Fernet` (AES-256) + macOS Keychain | Key stored in Keychain (`com.vashisht.phonebrain.enckey`) |
| **Total Monthly Cost** | | **$0 / month** |

---

## 3. Step-by-Step Deployment Instructions

### STEP 1: Laptop Setup (Run on Your Mac)

1. **Run the Automated Laptop Setup Script**:
   ```bash
   bash /Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/laptop/setup_laptop.sh
   ```

2. **Generate SSH Keypair for Passwordless Mac Mini Sync**:
   ```bash
   ssh-keygen -t rsa -f ~/.ssh/phone_brain_rsa -N ""
   ```

3. **Verify Encryption Key in Keychain**:
   ```bash
   security find-generic-password -a "$USER" -s "com.vashisht.phonebrain.enckey" -w
   ```
   *(Copy this key output — you will need to paste it into the Mac Mini setup)*

---

### STEP 2: Mac Mini Setup (Run on Friend's Mac Mini)

1. **Create Restricted Account**: Ask your friend to create a standard user account named `brainbot` on their Mac Mini.

2. **Copy Public SSH Key to Mac Mini**:
   ```bash
   ssh-copy-id -i ~/.ssh/phone_brain_rsa.pub brainbot@<mac-mini-ip>
   ```

3. **Copy Mac Mini Server Code**:
   ```bash
   scp -r /Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/mac_mini brainbot@<mac-mini-ip>:/Users/brainbot/server
   ```

4. **SSH into Mac Mini and Run Setup Script**:
   ```bash
   ssh brainbot@<mac-mini-ip>
   bash /Users/brainbot/server/setup_mac_mini.sh
   ```
   *(This automatically installs `mlx-lm` and downloads your fine-tuned Gemma 4-bit model from Hugging Face)*

5. **Configure Encryption Key & API Secret on Mac Mini**:
   ```bash
   # Paste your Keychain encryption key from Step 1 into .enc_key:
   echo "YOUR_KEYCHAIN_KEY_HERE" > /Users/brainbot/server/.enc_key

   # Set your custom secret API key in start_server.sh:
   nano /Users/brainbot/server/start_server.sh
   # Change: export BRAIN_API_KEY="YOUR_API_KEY_HERE"
   ```

6. **Install Boot Auto-Start Service on Mac Mini**:
   ```bash
   cp /Users/brainbot/server/com.brainbot.server.plist ~/Library/LaunchAgents/
   launchctl load -w ~/Library/LaunchAgents/com.brainbot.server.plist
   ```

---

### STEP 3: Phone Setup (iOS / Android PWA)

1. **Install Tailscale**: Download Tailscale from App Store / Play Store on your phone and log in with your account.
2. **Open Browser**: Open Safari or Chrome on your phone and navigate to:
   `http://macmini.tail123.ts.net:8080`
3. **Install PWA**:
   - **iOS Safari**: Tap **Share** icon → **Add to Home Screen**.
   - **Android Chrome**: Tap **3-Dots Menu** → **Add to Home screen**.
4. **Authenticate**: Open the new "Rishi" app icon on your phone home screen and enter your `BRAIN_API_KEY`.

---

## 4. Maintenance & Operation Commands

### Manual Test Run (Laptop)
Trigger a full manual indexing and sync immediately:
```bash
bash /Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/laptop/laptop_job.sh
```

### View Live Laptop Job Logs
```bash
tail -f /Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/laptop/job.log
```

### Check Launchd Daemon Status on Laptop
```bash
launchctl list | grep phonebrain
```

### Check Server & Fine-Tuned Gemma Status from Phone or Terminal
```bash
curl -s -H "X-API-Key: YOUR_API_KEY" http://macmini.tail123.ts.net:8080/status | jq
```

Output will show:
```json
{
  "status": "ok",
  "chunks": 4821,
  "model": "mlx-community/gemma-4-e4b-it-4bit",
  "backend": "MLX (Apple Silicon GPU)"
}
```

---

## 5. Script & Codebase Directory Manifest

All project files are organized under `/Users/vashishtdevasani/PersonalAIData/95_tools/phone_brain/`:

```
phone_brain/
├── laptop/
│   ├── indexer.py                    # Scans files, embeds, hashes metadata, encrypts ChromaDB
│   ├── sync.sh                       # Retry-safe rsync over SSH to Mac Mini
│   ├── laptop_job.sh                 # Main launchd wrapper script
│   ├── setup_laptop.sh               # One-click laptop installer script
│   └── com.vashisht.phonebrain.plist # macOS launchd daily 2:00 AM daemon
├── mac_mini/
│   ├── api_server.py                 # FastAPI RAG search engine with MLX Fine-Tuned Gemma
│   ├── receiver.py                   # Watches for incoming packages & merges vectors
│   ├── setup_mac_mini.sh             # One-click Mac Mini installer script (installs MLX + Gemma)
│   └── com.brainbot.server.plist     # Mac Mini boot daemon plist
└── web_ui/
    ├── index.html                    # Glassmorphic mobile-first PWA UI
    ├── manifest.json                 # Web App Manifest for home screen app
    └── sw.js                         # Offline Service Worker
```
