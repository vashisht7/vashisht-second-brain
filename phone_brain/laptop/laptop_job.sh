#!/bin/bash
# phone_brain/laptop/laptop_job.sh
# Glue script called by launchd: runs indexer, then syncs to Mac Mini.
# This is the ONLY script launchd needs to know about.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/job.log"
PYTHON="$HOME/PersonalAIData/95_tools/venvs/phone_brain/bin/python3"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [JOB] $*" | tee -a "$LOG_FILE"; }

log "=== Daily Phone Brain Job Starting ==="

# Step 1: Run indexer
log "Step 1: Indexing files..."
if "$PYTHON" "$SCRIPT_DIR/indexer.py"; then
    log "Indexer completed successfully"
else
    log "Indexer failed — aborting sync"
    exit 1
fi

# Step 2: Sync to Mac Mini
log "Step 2: Syncing encrypted index to Mac Mini..."
if bash "$SCRIPT_DIR/sync.sh"; then
    log "=== Job completed successfully ==="
else
    log "=== Sync failed — index was built but not transferred ==="
    exit 1
fi
