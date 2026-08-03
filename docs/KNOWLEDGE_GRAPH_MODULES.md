# Local knowledge graph modules

The knowledge graph is deliberately separated from the model, protected vault, source documents, and Electron interface.

## Components

- `backend/knowledge_graph.py` — portable graph engine; standard-library Python only.
- `80_runtime/index/*.sqlite` — replaceable local document/chunk index and Qwen embeddings.
- `80_runtime/knowledge_graph/graph_state.sqlite` — small portable state containing contact aliases, cached local summaries, preferences, and a schema version.
- `backend/server.py` — loopback-only API adapter between the engine and the app.
- `renderer/app.js` — graph visualization, search, timelines, previews, and controls.
- `main.js` / `preload.js` — macOS file pickers for `.vashishtgraph` export and merge.

## Portability contract

Document IDs normalize the macOS home directory, so graph state can follow a user whose account name changes. The exported `.vashishtgraph` file never contains source documents, the model, embeddings, or the protected vault. It is safe only as a private metadata file and should not be published.

For a complete move, use the encrypted migration kit. After restoring on a different account, rebuild the replaceable search index so its source paths point at the new home directory. For graph-only continuation, export in Settings and import on the other device; records are merged by modified time.

## Reuse from another local application

Create `LocalKnowledgeGraph(config_path, state_path)`. The configuration needs an `index_path` pointing to a SQLite `chunks` table with `id`, `path`, `title`, `text`, and float32 `embedding` columns. Public methods are `overview`, `topic_files`, `search`, `document`, `save_alias`, `save_summary`, `export_state`, and `merge_state`.

No method calls a cloud service. Summary text is supplied by the local server's Gemma runtime and cached through `save_summary`.
