# Changelog

All notable changes to ig-archiver are documented here.

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
