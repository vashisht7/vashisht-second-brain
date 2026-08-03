# Vashisht Second Brain

A local-first macOS personal AI application built with Electron, MLX, Gemma, local embeddings and retrieval-augmented generation.

This repository contains only the reusable application architecture. It intentionally excludes personal documents, messages, indexes, model adapters, conversation history, credentials and protected-vault data.

## Highlights

- Local Gemma inference through MLX, with optional LoRA adapter support
- Qwen embedding-based retrieval over approved local documents
- Automatic routing between general reasoning, personal retrieval, protected facts and live public-web evidence
- Local MLX Whisper voice transcription and macOS speech output
- Jarvis-style Quick Chat: tap Option-Space for chat, or hold and release to speak
- Conversation context, correction memory and privacy-separated shared profiles
- Read-only Apple Messages normalization with anonymized unresolved contacts
- Protected information kept outside embeddings and training

## Architecture

```text
Electron UI
  ├── Main chat and Quick Chat overlay
  ├── Local Python API
  │   ├── Conversation memory
  │   ├── Retrieval router
  │   └── Optional private-vault interface
  ├── MLX Gemma model
  ├── Ollama/Qwen embedding index
  └── MLX Whisper + macOS speech
```

## Privacy boundary

Do not put personal data inside this repository. Runtime data should live in a separate directory such as `~/SecondBrainData`.

The included `.gitignore` rejects common personal-data, model, index, credential and build formats. Treat that as a final safety net—not as a replacement for reviewing every staged file.

## Setup

Requirements:

- Apple Silicon Mac with 16 GB memory recommended
- Node.js and npm
- Python 3
- Ollama with a local embedding model
- MLX-LM and MLX Whisper environments

```bash
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdir -p ~/SecondBrainData
cp config.example.json ~/SecondBrainData/config.json
```

Copy `.env.example` to a local `.env` or export the variables in your shell. Update all example paths for your Mac. Never commit `.env` or `config.json`.

Run in development:

```bash
npm start
```

Package for macOS:

```bash
npm run make
```

## Personal model adapter

Set `MLX_ADAPTER_PATH` to a local adapter directory. The adapter is not included because fine-tuned weights can memorize private writing or personal data. Keep adapters in private storage or a private model repository.

## Protected information

The public project exposes only an optional command interface through `PII_VAULT_TOOL`. A real protected vault, encryption keys and authoritative documents must remain outside the repository. When no vault tool is configured, protected queries return no facts rather than guessing.

## Security notes

- The Python API binds to localhost and uses a random per-launch token.
- Personal and protected context is never included in the repository.
- Web retrieval receives only the current public query, not local personal context.
- Exact identifiers should be returned deterministically from verified local records, never rewritten by the language model.

## Status

This is a personal engineering project and reference implementation, not a hosted service. You are responsible for reviewing privacy boundaries, model licenses and macOS permissions before using it with real data.

No license is granted yet; all rights are reserved by the author.
