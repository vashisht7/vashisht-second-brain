#!/bin/bash
# phone_brain/laptop/setup_laptop.sh
# Sets up Python virtualenv, installs launchd daily plist on laptop, and tests indexing.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="/Users/vashishtdevasani/PersonalAIData/95_tools/venvs/phone_brain"

echo "🚀 Setting up Phone Brain Laptop Indexer..."

# 1. Create Virtualenv & Install dependencies
echo "🐍 Setting up Python Virtual Environment..."
mkdir -p "$(dirname "$VENV_DIR")"
python3 -m venv "$VENV_DIR"
source "$VENV_DIR/bin/activate"
pip install --upgrade pip
pip install chromadb requests cryptography

# 2. Check Ollama nomic-embed-text
echo "🧠 Checking Ollama nomic-embed-text model..."
if ! ollama list | grep -q "nomic-embed-text"; then
    echo "Downloading nomic-embed-text..."
    ollama pull nomic-embed-text
fi

# 3. Make scripts executable
chmod +x "$SCRIPT_DIR/indexer.py" "$SCRIPT_DIR/sync.sh" "$SCRIPT_DIR/laptop_job.sh"

# 4. Install Launchd Plist
PLIST_DST="$HOME/Library/LaunchAgents/com.vashisht.phonebrain.plist"
echo "⏰ Installing daily LaunchAgent to $PLIST_DST..."
cp "$SCRIPT_DIR/com.vashisht.phonebrain.plist" "$PLIST_DST"
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load -w "$PLIST_DST"

echo "✅ Laptop setup completed!"
echo "Daily job scheduled at 2:00 AM via launchd."
echo "To test manually now, run: bash $SCRIPT_DIR/laptop_job.sh"
