#!/bin/bash
set -euo pipefail

read -r -p "Path to the encrypted second-brain backup: " BACKUP
BACKUP="${BACKUP/#\~/$HOME}"
if [[ ! -f "$BACKUP" ]]; then
  echo "Backup file was not found."
  read -r -p "Press Return to close."
  exit 1
fi
if [[ -f "$BACKUP.sha256" ]]; then
  (cd "$(dirname "$BACKUP")" && /usr/bin/shasum -a 256 -c "$(basename "$BACKUP").sha256")
fi
if [[ -e "$HOME/SecondBrainData" ]]; then
  echo "Refusing to overwrite $HOME/SecondBrainData. Move or rename it first."
  read -r -p "Press Return to close."
  exit 1
fi

read -r -s -p "Backup password: " PASSWORD
echo
/usr/bin/openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass fd:3 3<<<"$PASSWORD" -in "$BACKUP" \
  | /usr/bin/python3 "$(dirname "$0")/restore_backup_stream.py"
unset PASSWORD
echo "Restore completed at $HOME/SecondBrainData"
echo "Rebuild the local index once so source paths match this device."
read -r -p "Press Return to close."
