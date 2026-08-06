#!/usr/bin/env python3
"""
phone_brain/mac_mini/api_server.py

FastAPI server — serves RAG queries from the phone using your fine-tuned Gemma model on Mac Mini.
Supports native Apple Silicon MLX (`mlx_lm`) or Ollama (`vasisht-2nd-brain` / `gemma-4-e4b-it-4bit`).

Endpoints:
  POST /query   { "question": "..." } → { "answer": "...", "sources": [...] }
  GET  /status  → { "chunks": N, "last_updated": "...", "model": "..." }
  GET  /        → PWA web UI (index.html)

Auth: X-API-Key header checked against BRAIN_API_KEY env var.
"""

import os
import json
import logging
from pathlib import Path
from datetime import datetime

import chromadb
import requests
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
SCRIPT_DIR   = Path(__file__).parent
CHROMA_DIR   = SCRIPT_DIR / "chroma_db"
WEB_UI_DIR   = SCRIPT_DIR.parent / "web_ui"
STATUS_FILE  = SCRIPT_DIR / "status.json"

OLLAMA_URL   = os.environ.get("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL  = os.environ.get("EMBED_MODEL", "nomic-embed-text")

# Fine-tuned Gemma 4-bit model on HuggingFace / MLX / Ollama
HF_MODEL     = os.environ.get("HF_MODEL", "mlx-community/gemma-4-e4b-it-4bit")
ADAPTER_PATH = os.environ.get("ADAPTER_PATH", str(SCRIPT_DIR / "adapters/vasisht-2nd-brain"))

API_KEY      = os.environ.get("BRAIN_API_KEY", "")
TOP_K        = 6           # number of chunks to retrieve
HOST         = "0.0.0.0"
PORT         = 8080

if not API_KEY:
    raise RuntimeError("BRAIN_API_KEY environment variable is not set!")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger(__name__)

# Try importing native MLX for Apple Silicon GPU acceleration
try:
    import mlx_lm
    MLX_AVAILABLE = True
    log.info("Apple Silicon MLX library detected — using native MLX model inference")
except ImportError:
    MLX_AVAILABLE = False
    log.info("mlx_lm not installed — falling back to Ollama backend")

# ─────────────────────────────────────────────────────────────────────────────
# APP
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="Vashisht Second Brain API", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

if WEB_UI_DIR.exists():
    app.mount("/ui", StaticFiles(directory=str(WEB_UI_DIR), html=True), name="ui")


# ─────────────────────────────────────────────────────────────────────────────
# AUTH
# ─────────────────────────────────────────────────────────────────────────────
def verify_api_key(request: Request):
    key = request.headers.get("X-API-Key") or request.query_params.get("key")
    if key != API_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return key


# ─────────────────────────────────────────────────────────────────────────────
# CHROMA & MLX MODEL SINGLETONS
# ─────────────────────────────────────────────────────────────────────────────
_chroma_collection = None
_mlx_model = None
_mlx_tokenizer = None

def get_collection():
    global _chroma_collection
    if _chroma_collection is None:
        CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        _chroma_collection = client.get_or_create_collection(
            "brain", metadata={"hnsw:space": "cosine"}
        )
    return _chroma_collection


def load_mlx_model():
    global _mlx_model, _mlx_tokenizer
    if _mlx_model is None and MLX_AVAILABLE:
        log.info(f"Loading fine-tuned Gemma model '{HF_MODEL}' with MLX...")
        adapter_arg = ADAPTER_PATH if Path(ADAPTER_PATH).exists() else None
        if adapter_arg:
            log.info(f"Applying LoRA adapter from: {adapter_arg}")
            _mlx_model, _mlx_tokenizer = mlx_lm.load(HF_MODEL, adapter_path=adapter_arg)
        else:
            _mlx_model, _mlx_tokenizer = mlx_lm.load(HF_MODEL)
    return _mlx_model, _mlx_tokenizer


# ─────────────────────────────────────────────────────────────────────────────
# LLM INFERENCE ENGINE
# ─────────────────────────────────────────────────────────────────────────────
def generate_answer(prompt: str) -> str:
    """Generate answer using fine-tuned Gemma model via native MLX or Ollama fallback."""
    if MLX_AVAILABLE:
        model, tokenizer = load_mlx_model()
        formatted_prompt = f"<start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n"
        response = mlx_lm.generate(
            model,
            tokenizer,
            prompt=formatted_prompt,
            max_tokens=512,
            verbose=False
        )
        return response.strip()
    else:
        # Fallback to Ollama fine-tuned model or gemma4:e4b
        resp = requests.post(f"{OLLAMA_URL}/api/generate",
                             json={"model": HF_MODEL, "prompt": prompt, "stream": False},
                             timeout=120)
        resp.raise_for_status()
        return resp.json()["response"].strip()


def ollama_embed(text: str) -> list:
    resp = requests.post(f"{OLLAMA_URL}/api/embeddings",
                         json={"model": EMBED_MODEL, "prompt": text}, timeout=30)
    resp.raise_for_status()
    return resp.json()["embedding"]


def build_rag_prompt(question: str, chunks: list) -> str:
    context = "\n\n---\n\n".join(chunks)
    return f"""You are Vashisht's personal AI assistant (Rishi). Answer the user's question using ONLY the provided context.
Be direct, accurate, and concise. Speak in Vashisht's personal tone. If the answer is not in the context, say "I don't have that information in my index."

Context:
{context}

Question: {question}

Answer:"""


# ─────────────────────────────────────────────────────────────────────────────
# ROUTES
# ─────────────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str


@app.get("/", response_class=HTMLResponse)
async def root():
    index_html = WEB_UI_DIR / "index.html"
    if index_html.exists():
        return HTMLResponse(content=index_html.read_text())
    return HTMLResponse("<h1>Vashisht Brain — Fine-Tuned Gemma API Running</h1>")


@app.get("/status")
async def status(_: str = Depends(verify_api_key)):
    try:
        col = get_collection()
        chunk_count = col.count()
    except Exception:
        chunk_count = 0

    return {
        "status":       "ok",
        "chunks":       chunk_count,
        "model":        HF_MODEL,
        "backend":      "MLX (Apple Silicon GPU)" if MLX_AVAILABLE else "Ollama",
        "last_updated": datetime.utcnow().isoformat()
    }


@app.post("/query")
async def query(req: QueryRequest, _: str = Depends(verify_api_key)):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    log.info(f"Query: {req.question[:80]}")

    try:
        # 1. Embed question via nomic-embed-text
        q_embedding = ollama_embed(req.question)

        # 2. Search ChromaDB
        col = get_collection()
        results = col.query(
            query_embeddings=[q_embedding],
            n_results=min(TOP_K, max(1, col.count())),
            include=["documents", "metadatas", "distances"]
        )

        chunks    = results["documents"][0] if results["documents"] else []
        distances = results["distances"][0]  if results["distances"] else []

        if not chunks:
            return {
                "answer":     "I don't have any information about that in my index yet.",
                "confidence": 0.0,
                "sources":    []
            }

        # 3. Generate answer using fine-tuned Gemma model
        prompt = build_rag_prompt(req.question, chunks)
        answer = generate_answer(prompt)

        confidence = round(max(0.0, 1.0 - distances[0]), 2) if distances else 0.0

        sources = []
        for meta, dist in zip(results["metadatas"][0], distances):
            sources.append({
                "type":        meta.get("type", "unknown"),
                "approx_date": meta.get("approx_date", ""),
                "relevance":   round(1.0 - dist, 2)
            })

        log.info(f"Answer generated using fine-tuned Gemma ({len(answer)} chars)")
        return {
            "answer":     answer,
            "confidence": confidence,
            "sources":    sources
        }

    except Exception as e:
        log.error(f"Query failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Query processing failed")


if __name__ == "__main__":
    log.info(f"Starting Vashisht Brain API with Fine-Tuned Gemma on {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")
