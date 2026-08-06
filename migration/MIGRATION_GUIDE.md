# Vashisht Devasani backup and migration

## What the encrypted backup includes

- Raw and normalized personal data
- Search indexes and application history
- Style datasets and the trained MLX adapter
- Encrypted private vault, fact index, and its Keychain key inside the encrypted stream
- Application source, privacy policies, tools, and manifests
- Modular knowledge-graph state, including contact aliases and locally generated summaries

The backup deliberately excludes large model downloads, Python virtual environments, `node_modules`, and packaged build output. These are reproducible and should be installed fresh on a new Mac.

## Create a backup

1. Double-click `create_backup.command`.
2. Choose a destination and create a strong, unique password.
3. Keep both the encrypted `.enc` file and its `.sha256` checksum.
4. Store the password separately. It cannot be recovered from the backup.

The encrypted file can be uploaded to a private Hugging Face dataset repository, iCloud Drive, Google Drive, Backblaze, or another storage provider. Never upload the unencrypted `PersonalAIData` directory or use a public repository.

## Restore on another Apple-silicon Mac

1. Download the encrypted backup, checksum, migration kit, and app installer.
2. Double-click `restore_backup.command` and enter the backup password.
3. Install Ollama and pull `qwen3-embedding:0.6b`.
4. Install the MLX runtime and download `mlx-community/gemma-4-e4b-it-4bit`.
5. Install `Vashisht Devasani.dmg`.
6. Open the application and verify a protected-vault lookup before erasing the old Mac.
7. If the macOS account name changed, run the local incremental index once so source-file paths are rebuilt for the new home directory. Graph aliases and summaries use portable IDs and remain attached.

For a graph-only move, export a `.vashishtgraph` file from **Settings → Portable knowledge graph**. It contains aliases, summaries, and graph preferences—not your source documents, protected vault, search index, or model. Importing merges newer records and leaves existing documents untouched.

## Important

The vault key exists only inside the password-encrypted backup stream and is imported directly into the new Mac's login Keychain during restore. Test both ordinary search and protected-vault retrieval before erasing the old laptop.
