#!/bin/bash
set -euo pipefail

SOURCE_HOME="/Users/vashishtdevasani"
SOURCE_ROOT="$SOURCE_HOME/PersonalAIData"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEFAULT_OUTPUT="$SOURCE_HOME/Desktop/Vashisht-Devasani-Backup-$STAMP.tar.gz.enc"

if [[ ! -d "$SOURCE_ROOT" ]]; then
  echo "PersonalAIData was not found at $SOURCE_ROOT"
  read -r -p "Press Return to close."
  exit 1
fi

read -r -p "Backup destination [$DEFAULT_OUTPUT]: " OUTPUT
OUTPUT="${OUTPUT:-$DEFAULT_OUTPUT}"
mkdir -p "$(dirname "$OUTPUT")"
if [[ -e "$OUTPUT" ]]; then
  echo "Refusing to overwrite: $OUTPUT"
  read -r -p "Press Return to close."
  exit 1
fi

read -r -s -p "Create a strong backup password: " PASSWORD
echo
read -r -s -p "Repeat the password: " CONFIRMATION
echo
if [[ -z "$PASSWORD" || "$PASSWORD" != "$CONFIRMATION" ]]; then
  echo "Passwords did not match. Nothing was created."
  read -r -p "Press Return to close."
  exit 1
fi

echo "Creating encrypted migration backup…"
/usr/bin/python3 "$SOURCE_ROOT/Apps/Vasisht2ndBrain/migration/build_backup_stream.py" \
  | /usr/bin/openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 -pass fd:3 3<<<"$PASSWORD" > "$OUTPUT"

unset PASSWORD CONFIRMATION
chmod 600 "$OUTPUT"
(
  cd "$(dirname "$OUTPUT")"
  /usr/bin/shasum -a 256 "$(basename "$OUTPUT")" > "$(basename "$OUTPUT").sha256"
  chmod 600 "$(basename "$OUTPUT").sha256"
)

echo
echo "Backup created: $OUTPUT"
echo "Checksum: $OUTPUT.sha256"
echo "Keep the password separately. It cannot be recovered."
read -r -p "Press Return to close."
