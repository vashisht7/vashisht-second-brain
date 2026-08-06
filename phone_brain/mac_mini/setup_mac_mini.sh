#!/bin/bash
# phone_brain/mac_mini/setup_mac_mini.sh
# Run this script on the Mac Mini to set up your fine-tuned Gemma model, Ollama embeddings, Python venv, and background services.

set -e

echo "🚀 Setting up Phone Brain Server with Fine-Tuned Gemma on Mac Mini..."

USER_HOME="/Users/brainbot"
SERVER_DIR="$USER_HOME/server"
INCOMING_DIR="$USER_HOME/index_incoming"
CHROMA_DIR="$USER_HOME/chroma_db"

mkdir -p "$SERVER_DIR" "$INCOMING_DIR" "$CHROMA_DIR"

# 1. Install Ollama for nomic-embed-text embeddings
if ! command -v ollama &>/dev/null; then
    echo "📥 Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
fi

echo "🧠 Pulling nomic-embed-text for embeddings..."
ollama pull nomic-embed-text

# 2. Setup Python environment with MLX for Fine-Tuned Gemma 4-Bit model
echo "🐍 Setting up Python environment with MLX..."
python3 -m venv "$SERVER_DIR/venv"
source "$SERVER_DIR/venv/bin/activate"
pip install --upgrade pip
pip install mlx-lm fastapi uvicorn chromadb requests cryptography pydantic huggingface_hub

echo "📥 Downloading Fine-Tuned Gemma 4-Bit Model from Hugging Face..."
python3 -c "import mlx_lm; mlx_lm.load('mlx-community/gemma-4-e4b-it-4bit')"

# 3. Create start script
cat << 'EOF' > "$SERVER_DIR/start_server.sh"
#!/bin/bash
source /Users/brainbot/server/venv/bin/activate
export BRAIN_API_KEY="YOUR_API_KEY_HERE"
export HF_MODEL="mlx-community/gemma-4-e4b-it-4bit"

# Start receiver in background
python3 /Users/brainbot/server/receiver.py &

# Start API server with Fine-Tuned Gemma
python3 /Users/brainbot/server/api_server.py
EOF
chmod +x "$SERVER_DIR/start_server.sh"

echo "✅ Mac Mini environment ready with Fine-Tuned Gemma Model!"
echo "Next: Paste your encryption key into $SERVER_DIR/.enc_key and set your BRAIN_API_KEY in start_server.sh"
