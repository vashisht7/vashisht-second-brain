#!/bin/bash
set -euo pipefail

read -r -p "Path to the encrypted Vashisht Devasani backup: " BACKUP
BACKUP="${BACKUP/#\~/$HOME}"
if [[ ! -f "$BACKUP" ]]; then
  echo "Backup file was not found."
  read -r -p "Press Return to close."
  exit 1
fi

if [[ -f "$BACKUP.sha256" ]]; then
  echo "Verifying checksum…"
  (cd "$(dirname "$BACKUP")" && /usr/bin/shasum -a 256 -c "$(basename "$BACKUP").sha256")
fi

if [[ -e "$HOME/PersonalAIData" ]]; then
  echo "Refusing to overwrite the existing $HOME/PersonalAIData directory."
  echo "Move or rename it first, then run this restore again."
  read -r -p "Press Return to close."
  exit 1
fi

read -r -s -p "Backup password: " PASSWORD
echo
echo "Restoring locally…"
/usr/bin/openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 -pass fd:3 3<<<"$PASSWORD" -in "$BACKUP" \
  | /usr/bin/python3 "$(dirname "$0")/restore_backup_stream.py"
unset PASSWORD

OLD_ROOT="/Users/vashishtdevasani/PersonalAIData"
NEW_ROOT="$HOME/PersonalAIData"
if [[ "$OLD_ROOT" != "$NEW_ROOT" ]]; then
  find "$NEW_ROOT" -type f \( -name '*.json' -o -name '*.py' -o -name '*.js' -o -name '*.md' -o -name '*.plist' -o -name '*.command' \) -print0 \
    | xargs -0 /usr/bin/perl -pi -e "s|\Q$OLD_ROOT\E|$NEW_ROOT|g"
fi

echo
echo "Restore completed at $NEW_ROOT"
echo "The protected-vault Keychain key was restored without writing it to disk."
echo "Next: install the app, Ollama, and MLX runtime using MIGRATION_GUIDE.md."
read -r -p "Press Return to close."
