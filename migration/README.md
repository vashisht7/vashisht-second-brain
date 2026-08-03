# Encrypted backup and migration

The scripts back up `SECOND_BRAIN_DATA_ROOT` (default `~/SecondBrainData`) into an AES-256 encrypted archive. They include approved documents, indexes, graph state, conversation memory, style datasets, adapters, and encrypted vault files. If the configured vault key exists in macOS Keychain, it is placed only inside the encrypted stream.

Base-model downloads, virtual environments, dependency folders, caches, and application builds are excluded because they are reproducible.

Run `create_backup.command`, keep the `.enc` file and `.sha256` file together, and store the password separately. On another Mac, run `restore_backup.command`, reinstall dependencies and base models, then rebuild the index once to update source paths.

Never commit or publicly upload an encrypted backup unless its password is strong and unique. Prefer a private storage destination with its own account security.
