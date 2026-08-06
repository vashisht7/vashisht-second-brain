# Vashisht Devasani — Second Brain 5.0

A private Mac chat application backed by a locally trained Gemma 4 E4B style adapter and a source-grounded personal index.

## Everyday use

Open **Vashisht Devasani.app** and choose the tools needed for the conversation:

- **Automatic context** decides whether a question needs the local model, approved laptop knowledge, the live web, or both, and shows source links when retrieval is used.
- **Private facts** route automatically to the encrypted vault in **Just me** mode. Shared profiles cannot access it. Exact identifiers are shown only when directly or explicitly requested.
- **Verified-document resolver** answers protected questions without sending identifiers through the language model. It selects only facts marked current and verified from the authoritative document's issue/effective date, retains older values only as encrypted audit history, refuses unresolved conflicts, and never treats download or ingestion time as the document date.
- **Protected answers are private sessions automatically** and are not saved to the ordinary plaintext conversation database.
- **Learns from your corrections**: when the assistant says it cannot find an ordinary answer, your next answer in that conversation is stored as a local correction memory and becomes immediately searchable. Repeating the correction updates the existing memory instead of duplicating it. Protected facts are excluded and still require an authoritative dated vault document.
- **Learns your phrasing from mistakes**: use **Correct my style** below an answer and type exactly how you would respond. Similar prompts use that Telugu-English correction immediately, while a privacy-screened copy waits for the next reviewed adapter training run. Corrections remain separated by conversation profile and protected-looking content is rejected.
- **Telugu-English grammar interview**: Training contains 40 controlled scenarios covering questions, tense, negation, conditionals, instructions, uncertainty, work language, friends, and Charvi. Answers immediately become local grammar demonstrations and are queued for privacy-reviewed retraining. The prompt separates grammar and transliteration from emotional tone.
- **Interactive semantic knowledge graph**: Knowledge displays local topic nodes sized by categorized indexed items. Topics expand into their most useful documents; drag to pan, scroll to zoom, search across topics, filter by meaningful subtopics, and open a readable local preview. Similar documents show the reason for their relationship using local embedding similarity, matching subtopics, and shared terms.
- **Local graph intelligence**: duplicate copies are merged, source modified dates and confidence are shown, message timelines can be filtered by date, and Gemma can create cached topic or document summaries without sending content to a cloud service.
- **Manual incremental indexing**: Training includes a Run indexer button with local progress and changed/skipped/error totals. It updates retrieval knowledge without retraining Gemma or the LoRA adapter.
- **Readable conversation nodes**: WhatsApp and Apple Messages shards are merged by conversation. Resolved contact names are shown without raw IDs; unresolved contacts receive anonymous labels and can be renamed locally. Clicking a conversation opens searchable message bubbles instead of the JSONL archive.
- **Plus menu**: Remember writes an immediately searchable local memory; Train queues a reviewed style example; Think gives the current request a larger reasoning budget; Add image reads visible text locally and attaches/indexes it; Add file copies a supported document into the managed inbox and reindexes.
- **Reliable voice stop**: microphone startup and shutdown use a single recording session. Stop clears the counter and hardware synchronously before transcription, preventing orphan timers from continuing to display “Listening.”
- **Reliable global Quick Chat**: press **Control-Shift-Space** from any application to open or hide chat through Electron's native shortcut service. Use the popup microphone for local transcription and spoken answers. Closing the main window keeps the shortcut active, and the packaged app registers as a hidden login item.
- **Conversation continuity**: the last 40 turns are retained within a bounded local context window. Protected-vault answers are still not saved, but asking one no longer disconnects the surrounding ordinary conversation.
- **Live web** is selected automatically for current or version-sensitive questions. It sends only the current query to Yahoo Search, then reads bounded excerpts from leading public results. Personal context and vault results are not included, and protected questions automatically remain local.
- **Private chat** does not write the conversation to history.
- **Voice dictation** records only while the microphone button is active, removes silence, transcribes a clean 16 kHz WAV locally with MLX Whisper, and deletes the temporary audio. In the full app it places text in the composer for review; in Quick Chat it sends the question and speaks the answer automatically.
- **With Charvi** and **With a friend** are shared profiles; the backend forcibly disables protected-vault access.

The shared profiles prepare or display local responses. They do not send messages through WhatsApp or iMessage.

Apple Messages are read locally from the macOS Messages database every five minutes, normalized without exposing raw phone numbers or email handles to the knowledge index, and then picked up by incremental indexing. This is read-only ingestion; sending is a separate explicitly confirmed action.

## Adding new knowledge

Put approved files in:

`/Users/vashishtdevasani/PersonalAIData/00_inbox/continuous_documents`

You can also use **Add files** in the app. Desktop, Downloads, and the managed inbox are checked every 15 minutes. Added or changed supported documents are indexed; unchanged files are skipped. Protected identifiers, immigration, tax, credential, and medical material must go through the separate encrypted-vault workflow and is never embedded or used for style training.

The 15-minute scan uses the local `qwen3-embedding:0.6b` model through Ollama. It consumes no paid cloud-model tokens. The former Codex Google Drive heartbeat was removed; continuous Drive ingestion can remain token-free after Google Drive for Desktop exposes Drive under macOS `Library/CloudStorage`.

## Updating the writing style

New WhatsApp or email exports should first be normalized, filtered for protected information, deduplicated, and split by conversation/date to avoid evaluation leakage. Retraining is intentionally manual: the current adapter remains available until the replacement passes held-out style and privacy checks.

## Local locations

- App data and audit log: `/Users/vashishtdevasani/PersonalAIData/80_runtime/app`
- Style adapter: `/Users/vashishtdevasani/PersonalAIData/40_models/adapters/vasisht-2nd-brain/deploy-short`
- Personal index: `/Users/vashishtdevasani/PersonalAIData/80_runtime/index`
- Protected vault: `/Users/vashishtdevasani/PersonalAIData/05_private_pii`
- Portable graph state: `/Users/vashishtdevasani/PersonalAIData/80_runtime/knowledge_graph/graph_state.sqlite`

## Modular graph portability

The graph engine is isolated in `backend/knowledge_graph.py` and uses only Python's standard library plus the existing local SQLite index. Contact names, cached summaries, and preferences are kept outside the document index in a small private state database. Use **Settings → Portable knowledge graph** to export a `.vashishtgraph` file and merge it on another device. Your full encrypted migration backup already includes this state, the app source, indexes, adapter, and approved documents.

This build is packaged for this Mac and is not code-signed for redistribution.
