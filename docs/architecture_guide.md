# Vashisht Second Brain — Completed Cloud Backup & Migration Guide

## 1. Verified Cloud Backup Status

All 5 core components of Vashisht Second Brain have been exported and backed up to **iCloud Drive**:
`~/Library/Mobile Documents/com~apple~CloudDocs/PersonalAI_Cloud_Backup`

### Backup Contents:
- `00_inbox/` & `10_raw_immutable/` & `20_normalized/`: Raw knowledge vault, transcripts, and personal notes.
- `05_private_pii/`: Hardware-encrypted PII vault (AES-256-GCM encrypted facts and documents).
- `40_models/adapters/`: Fine-tuned **Gemma 4-bit LoRA adapter** (`vasisht-2nd-brain`).
- `95_tools/`: Indexer, search engine scripts, and RRF logic.
- `Apps/Vasisht2ndBrain/`: Full Electron HUD codebase.
- `30_training/` & `90_manifests/`: Training examples, style manifests, and model parameters.

---

## 2. Model & Component Specifications

### A. Fine-Tuned Gemma 4-Bit Model (`Vashisht_Devasani_Brain`)
- **Base Model**: `mlx-community/gemma-4-e4b-it-4bit` (Apple Silicon 4-bit quantized model).
- **LoRA Adapter**: `vasisht-2nd-brain` (3.47M trainable parameters, trained on 2026-08-02).
- **What it does**: Custom fine-tuned on Vashisht's writing style, Telugu-English grammar, and personal tone.
- **Portability**: On any new Mac, `server.py` auto-loads `mlx-community/gemma-4-e4b-it-4bit` from Hugging Face and applies your backed-up `vasisht-2nd-brain` LoRA adapter from `40_models/adapters/`.

### B. Speech Engine (MLX Whisper Turbo)
- **Model**: `mlx-community/whisper-large-v3-turbo`
- **Portability**: Auto-downloads from HuggingFace on first run on any Mac. No manual upload needed.

### C. Encrypted PII Vault
- **Encryption**: AES-256-GCM with Keychain password (`com.vashisht.personal-ai.pii-vault`).
- **Portability**: Safe to store on iCloud/Google Drive because files are encrypted.

---

## 3. How to Restore on Any New Mac

Run this single command on your new Mac terminal to restore everything from your cloud backup:

```bash
#!/bin/bash
set -e

CLOUD="$HOME/Library/Mobile Documents/com~apple~CloudDocs/PersonalAI_Cloud_Backup"
DEST="$HOME/PersonalAIData"

echo "🚀 Restoring Vashisht Second Brain from iCloud..."
mkdir -p "$DEST"
cp -R "$CLOUD/"* "$DEST/"

echo "🔑 Registering PII Vault Key..."
read -p "Enter PII Key (from 1Password): " PII_KEY
security add-generic-password -U -a "$USER" -s "com.vashisht.personal-ai.pii-vault" -w "$PII_KEY"

echo "🐍 Setting up MLX virtual environment..."
mkdir -p "$DEST/95_tools/venvs"
python3 -m venv "$DEST/95_tools/venvs/mlx_whisper"
source "$DEST/95_tools/venvs/mlx_whisper/bin/activate"
pip install --upgrade pip
pip install mlx-whisper sounddevice numpy pyyaml

echo "🏗️ Building Electron App..."
cd "$DEST/Apps/Vasisht2ndBrain"
npm install
npm run make
cp -R "out/Vashisht Devasani-darwin-arm64/Vashisht Devasani.app" /Applications/

echo "🎉 Launching Rishi..."
open "/Applications/Vashisht Devasani.app"
```
