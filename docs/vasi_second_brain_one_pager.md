# 🧠 Rishi — Personal Second Brain & Jarvis Assistant (System Overview & Interview One-Pager)

---

## 🎯 Executive Summary & Interview Pitch

> **"How would you describe this project in a tech interview?"**
>
> *"Rishi is an edge-native, privacy-first personal AI assistant built for macOS on Apple Silicon. It combines a **3-Layer Intelligence Architecture**: a 4-bit quantized base LLM (Gemma-4B), a custom **fine-tuned LoRA style adapter** (trained on my communication patterns and Telugu-English code-switching), and a **production-grade Hybrid RAG pipeline** using mathematical **Reciprocal Rank Fusion (RRF)** to combine dense embeddings (`nomic-embed-text-v1`) with sparse BM25 keyword matching (SQLite FTS5), alongside an encrypted deterministic PII vault. 
> 
> It features zero-latency hands-free voice interaction using a lightweight streaming MLX Whisper wake-word engine ("Hey Rishi"), an **Iron Man Jarvis-style glowing multi-color orbital HUD**, **local multi-modal image vision (Rishi Vision)** via Apple Swift Vision OCR, an **FSEvents real-time background file watcher** that continuously indexes document changes, a native **macOS Menu Bar Tray System**, a floating orb HUD triggered via `⌘+Shift+Space` or saying "Hey Rishi", and full offline operation with zero personal data transmitted to cloud servers."*

---

## 🏗️ Architecture & Request Flow

```
                                  ┌───────────────────────────┐
                                  │   Voice Wake Word ("Vasi") │
                                  │  or  ⌘ + Shift + Space    │
                                  └─────────────┬─────────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │ Floating Siri-Style   │
                                    │    HUD (Electron)     │
                                    └───────────┬───────────┘
                                                │ (REST API / JSON)
                                                ▼
                                    ┌───────────────────────┐
                                    │ Local Backend Server  │
                                    │  (Python server.py)   │
                                    └───────────┬───────────┘
                                                │
                                   ┌────────────┴────────────┐
                                   ▼                         ▼
                      ┌───────────────────────┐   ┌───────────────────────┐
                      │  Deterministic Vault  │   │  Intelligent Router   │
                      │  (PII / Secret Facts) │   │ (route_question logic)│
                      └───────────────────────┘   └───────────┬───────────┘
                                                              │
                    ┌──────────────────────┬──────────────────┴──────────────────┐
                    ▼                      ▼                                     ▼
        ┌──────────────────────┐ ┌──────────────────────┐              ┌──────────────────┐
        │  Local Vector Index  │ │  DuckDuckGo Web RAG  │              │ Base Gemma Engine│
        │(sqlite3 + Embeddings)│ │ (Real-time Web Search│              │  (Local Code/QA) │
        └───────────┬──────────┘ └──────────┬───────────┘              └─────────┬────────┘
                    │                      │                                     │
                    └──────────────────────┴──────────────────┬──────────────────┘
                                                              │
                                                              ▼
                                                 ┌────────────────────────┐
                                                 │   MLX Inference Engine │
                                                 │ (Gemma-4B + LoRA Style)│
                                                 └────────────┬───────────┘
                                                              │
                                                              ▼
                                                 ┌────────────────────────┐
                                                 │ Speech Synthesis (say) │
                                                 │  & HUD UI Response     │
                                                 └────────────────────────┘
```

---

## 🧩 Core Components & Stack

| Layer | Component | Technologies & Implementation |
|---|---|---|
| **UI / Desktop Shell** | Main App & HUD | **Electron**, HTML5, Vanilla CSS3 (Glassmorphic dark theme), JavaScript ES2023 |
| **Native Integration** | Hotkey / Mic Hook | Swift / Objective-C bindings (`fn_key_monitor`), IPC Context Bridge |
| **Local API Server** | Orchestrator | Python 3 (`server.py`), HTTP server, Token-based authorization |
| **Wake Word Engine** | Voice Trigger | Python (`wake_word.py`), `sounddevice`, `mlx-whisper` (Continuous RMS VAD + Streaming Whisper) |
| **Inference Engine** | Local LLM | `mlx-community/gemma-4-e4b-it-4bit` via `mlx_lm.server` |
| **Style Adaptation** | Fine-Tuned Weights | Custom **LoRA Adapter** trained on Telugu-English grammar & personal writing patterns |
| **Hybrid RAG** | Vector Index | SQLite + `nomic-embed-text-v1` (chunked passages, BM25 + cosine similarity) |
| **Knowledge Graph** | Dynamic Canvas | Interactive SVG Canvas (Dual-concentric ring layout, Brain-region color categorization) |
| **Encrypted PII Vault** | Security Layer | Isolated Python script (`pii_vault.py`) — direct deterministic retrieval without LLM hallucination |

---

## 📊 System Metrics & Disk Footprint

| Resource | Size / Metric | Description |
|---|---|---|
| **Combined Dataset Total** | **3.60 GB (2,136 files)** | All personal data (Vector index, raw docs, transcripts, PII vault) |
| **Vector Index & RAG DB** | **1.81 GB** | 710 approved files · **44,511 embedded passages** & FTS5 tables |
| **Raw Source Archives** | **1.73 GB (2,027 files)** | Technical books, Apple Notes, iMessage, WhatsApp exports |
| **Normalized Audio Transcripts** | **40.07 MB** | 37 local Whisper voice memo transcriptions |
| **Encrypted PII Vault & Facts** | **16.21 MB** | 39 protected documents & structured facts |
| **Style Training Datasets** | **4.58 MB** | Reviewed Telugu-English code-switching & grammar records |
| **Base Model (Gemma-4B)** | **~2.60 GB** | Quantized 4-bit weights optimized for Apple Silicon Metal |
| **LoRA Style Adapter** | **225.5 MB** | Fine-tuned parameter-efficient weight delta |
| **Application Codebase** | **22 files · 13,440 LOC** | JavaScript, Python, CSS, HTML, Swift |

---

## 🔒 Backup Strategy & Security Model

1. **Local Storage Root**:
   - All app state and private files live under: `/Users/vashishtdevasani/PersonalAIData/`
2. **Encrypted Migration Backup**:
   - Built-in Portable Backup Kit (`/openBackupKit`) exports user state and configuration without exposing raw credentials.
3. **Private Adapter Backup**:
   - LoRA weights backed up to a **Private HuggingFace Repository**: `vashishtdevasani/vasi-style-adapter`.
4. **Zero-Trust Cloud Policy**:
   - Raw identity documents, SSN, passport data, and private messages **never leave local disk**.

---

## 🛠️ Required Tools & Environment Setup

### 1. Runtimes & Compilers
- **macOS** Apple Silicon (M1/M2/M3/M4)
- **Node.js** v18+ & **npm**
- **Python** 3.11+
- **Xcode Command Line Tools** (`swiftc`)

### 2. Python Virtual Environments & Packages
- **`mlx_lm`**: MLX framework for running quantized LLMs on Apple Silicon GPU.
- **`mlx_whisper`**: Metal-accelerated local speech-to-text.
- **`sounddevice` & `numpy`**: Real-time microphone audio stream processing for wake-word activation.
- **`sqlite3` & `urllib`**: Standard library indexing & HTTP networking.

---

## 🌟 Top Technical Highlights for Interviews

1. **Deterministic PII Security**: Solved LLM hallucination of sensitive numbers (licenses, identifiers) by routing PII queries to a non-generative deterministic vault.
2. **Apple Silicon Hardware Acceleration**: Built entirely on Apple's unified memory architecture using MLX for sub-50ms token generation times.
3. **Streaming Edge Wake-Word Detection**: Implemented continuous background listening using a rolling 1.8s audio buffer with RMS energy gating to achieve zero cloud dependency.
4. **Modular RAG vs. Adapter Separation**: Separated factual knowledge (stored in dynamically updatable vector indices) from style/persona (encoded in the LoRA adapter), allowing dynamic knowledge updates without expensive model retraining.
