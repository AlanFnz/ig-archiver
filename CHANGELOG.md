# Changelog

All notable changes to ig-archiver are documented here.

## [0.2.0] - 2026-07-14

### Added

- SQLite storage for archive entries, durable jobs, and sequenced job events.
- Automatic one-time migration from the legacy `database.json` archive.
- Restart recovery that resumes only unfinished job URLs and preserves paused jobs.
- Bounded retries with exponential backoff for transient capture failures.
- Structured JSON logging for server, job, and capture lifecycle events.
- Portable JSON backup/export and merge-or-replace import APIs, dashboard controls, and a backup CLI.
- API integration tests, archive-runner resilience tests, GitHub Actions CI, and Docker Compose packaging.

### Changed

- Archive writes are idempotent SQLite upserts instead of whole-file JSON replacements.
- Runtime data can be relocated with `DATA_DIR` for container volumes and external backups.
- Server startup and shutdown initialize and flush durable state explicitly.

## [0.1.0] - 2026-07-13

### Added

- Responsive archive dashboard with search, dynamic category filters, detail views, and bulk deletion.
- Concurrent URL capture with configurable worker limits.
- Persistent server-side archive jobs with popup reconnection, pause, resume, and stop controls.
- Premium glassmorphic Chrome extension popup with custom typography and motion.
- Runtime settings for categories, capture behavior, custom OpenAI-compatible providers, and extension server URLs.
- Existing-URL skipping with archived, skipped, and failed progress totals.

### Changed

- Scanning now processes messages already loaded in the conversation instead of depending on automatic history loading.
- Older-message loading remains available as an explicitly experimental action with manual scrolling as the reliable fallback.
- Archive jobs continue when the popup closes or the user switches browser tabs.

### Fixed

- Bulk deletion no longer fails when selecting multiple archive entries.
- Instagram HTTP 429 responses fall back to the official embed view for screenshots.
- Rate-limited or blank Instagram responses are rejected instead of being saved as successful white screenshots.
- Existing completed results are preserved when an archive job is stopped.
