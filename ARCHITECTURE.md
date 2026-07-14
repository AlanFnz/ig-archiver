# Architecture

## System boundary

IG Archiver is a single-user, local-first system with three runtime boundaries:

1. The Chrome extension discovers Instagram post and reel URLs from the active DM conversation.
2. The Node.js service owns capture jobs, browser automation, AI summarization, and durable state.
3. The server-rendered dashboard reads and manages the local archive through the same HTTP API.

The extension is intentionally a thin client. Once it creates a job, the server owns its lifecycle, so popup closure and browser-tab changes do not affect processing.

## Archive flow

```text
Instagram conversation
  → extension scraper
  → POST /api/jobs
  → durable job snapshot
  → bounded capture workers
  → Playwright page or /embed/ fallback
  → AI summary and categorization
  → idempotent archive upsert
  → durable job event
  → extension polling and dashboard reads
```

Every URL reaches a terminal `done`, `skipped`, or `error` event. Archive identity is the canonical Instagram URL, which is also the SQLite primary key.

## SQLite storage

`archive.sqlite` contains four tables:

- `schema_migrations` records applied schema versions.
- `archive_entries` stores captured metadata and screenshot references, keyed by URL.
- `archive_jobs` stores immutable inputs and current lifecycle counters.
- `archive_job_events` stores sequenced progress and terminal events for popup reconnection and restart recovery.

The service uses `sql.js`, a portable SQLite WebAssembly build. This avoids native compilation and makes local and container installation deterministic. Because the application is deliberately single-process, mutations are serialized in memory and the SQLite image is persisted with a temporary-file rename after each transaction. A multi-process deployment would require a native SQLite driver or an external database.

## Migration and compatibility

At startup the storage layer creates missing schema objects. If SQLite contains no archive entries and a legacy `database.json` exists, its entries are imported transactionally. The legacy file is never modified or removed.

The original `GET /api/archive`, deletion endpoints, and streaming `/archive` endpoint remain available. The extension uses the durable `/api/jobs` interface.

## Job lifecycle and recovery

Jobs transition through:

```text
queued → running ⇄ paused → completed
                    └─────→ cancelling → cancelled
             failures ───→ failed
```

State changes and events are persisted before clients observe them. After an unclean restart:

- `running` and `cancelling` jobs become queued and resume automatically.
- URLs with persisted terminal events are removed from the pending work set.
- `paused` jobs remain paused until an explicit resume request.
- Completed, cancelled, and failed jobs remain queryable.

Archive upserts provide a second idempotency boundary if a crash occurs between writing an archive record and persisting its terminal job event.

## Failure handling

- Transient navigation, timeout, blank-page, connection-reset, and HTTP 429 failures receive bounded exponential-backoff retries.
- Instagram HTTP 429 responses first use the official embed view before the retry policy is invoked.
- Permanent validation failures are recorded immediately and do not consume retries.
- A job cancellation prevents new URLs from starting; already active workers are allowed to settle safely.
- Graceful SIGINT and SIGTERM handling flushes queued database writes before process exit.

## Security and deployment

- The API accepts browser cross-origin requests only from Chrome extensions and its own localhost origin.
- API keys are write-only through the public configuration API and stored in a mode-`0600` local file.
- Imported screenshot paths are never trusted as filesystem paths; deletion uses only their basename.
- Runtime data can be isolated with `DATA_DIR` and mounted as a Docker volume.
- The service is not designed for public internet exposure or multiple concurrent server processes.

## Verification

The server suite covers storage migration, idempotent upserts, persisted events, restart recovery, pause/resume/cancel semantics, retry behavior, and HTTP contracts. The extension suite covers scraping, configuration, job APIs, storage reconnection, and streamed-event compatibility. CI runs both suites plus TypeScript checking and the production extension build.
