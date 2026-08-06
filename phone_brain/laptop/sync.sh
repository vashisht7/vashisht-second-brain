#!/bin/bash
# phone_brain/laptop/sync.sh
# Rsyncs the latest encrypted index package to the Mac Mini via SSH.
# Automatically picks the newest .pkg file in the output/ directory.
# Safe to run when Mac Mini is offline — will retry up to 3 times.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/output"
LOG_FILE="$SCRIPT_DIR/sync.log"

# ─── CONFIGURE THESE ─────────────────────────────────────────────────────────
MAC_MINI_USER="brainbot"
MAC_MINI_HOST="macmini"                          # Tailscale hostname or IP
MAC_MINI_DEST="/Users/brainbot/index_incoming/"
SSH_KEY="$HOME/.ssh/phone_brain_rsa"
MAX_RETRIES=3
RETRY_DELAY=30  # seconds between retries
# ─────────────────────────────────────────────────────────────────────────────

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [SYNC] $*" | tee -a "$LOG_FILE"; }

# Find latest .pkg file
LATEST_PKG=$(ls -t "$OUTPUT_DIR"/*.pkg 2>/dev/null | head -n1 || true)
LATEST_MANIFEST=$(ls -t "$OUTPUT_DIR"/*.manifest.json 2>/dev/null | head -n1 || true)

if [ -z "$LATEST_PKG" ]; then
    log "No package found in $OUTPUT_DIR — nothing to sync"
    exit 0
fi

log "Syncing: $(basename "$LATEST_PKG") to $MAC_MINI_USER@$MAC_MINI_HOST:$MAC_MINI_DEST"

for attempt in $(seq 1 $MAX_RETRIES); do
    log "Attempt $attempt/$MAX_RETRIES..."

    if rsync -avz --checksum \
        -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=10" \
        "$LATEST_PKG" "$LATEST_MANIFEST" \
        "$MAC_MINI_USER@$MAC_MINI_HOST:$MAC_MINI_DEST"; then

        log "✅ Sync successful"

        # Clean up packages older than 7 days
        find "$OUTPUT_DIR" -name "*.pkg" -mtime +7 -delete
        find "$OUTPUT_DIR" -name "*.manifest.json" -mtime +7 -delete
        log "Old packages cleaned up"

        exit 0
    else
        log "Sync attempt $attempt failed"
        if [ "$attempt" -lt "$MAX_RETRIES" ]; then
            log "Retrying in ${RETRY_DELAY}s..."
            sleep "$RETRY_DELAY"
        fi
    fi
done

log "❌ All $MAX_RETRIES sync attempts failed — will retry at next scheduled run"
exit 1
