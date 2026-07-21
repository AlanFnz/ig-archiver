# Phase 1 technical design: workflow foundation

## Scope

Phase 1 introduces the durable metadata and constraints needed for inbox triage, a small active queue, and future recommendations. It does not generate learning paths, run practice sessions, create projects, or automatically reorganize historical entries.

## Domain model

### Archive entry additions

```ts
type ArchiveIntent = 'learn' | 'make' | 'reference' | 'dismiss';

type WorkflowState =
  | 'inbox'
  | 'up_next'
  | 'in_progress'
  | 'practiced'
  | 'applied'
  | 'published'
  | 'cold_storage';

type Difficulty = 'easy' | 'intermediate' | 'advanced';

interface WorkflowMetadata {
  intent: ArchiveIntent | null;
  workflowState: WorkflowState;
  difficulty: Difficulty | null;
  estimatedMinutes: number | null;
  priority: number;
  nextAction: string;
  reviewedAt?: string;
  stateChangedAt: string;
}
```

Rules:

- New captures and migrated entries begin in `inbox` with no intent.
- `priority` is an integer from 0 through 5; the default is 0.
- `estimatedMinutes` is either null or an integer from 1 through 1,440.
- `nextAction` is optional and limited to 500 characters.
- Selecting Dismiss moves the entry to `cold_storage` while retaining `intent: 'dismiss'`.
- Restoring a dismissed item to Inbox clears neither its notes nor its provenance. The user may choose a new intent during review.
- Entering any state other than Inbox sets `reviewedAt` if it is not already set.
- Every workflow transition updates `stateChangedAt`.

### Structured tags

Use a normalized table rather than encoding filterable values as comma-separated strings or JSON:

```text
archive_entry_tags
  entry_url   TEXT NOT NULL REFERENCES archive_entries(url) ON DELETE CASCADE
  dimension   TEXT NOT NULL CHECK (dimension IN ('medium', 'tool', 'skill'))
  value       TEXT NOT NULL
  created_at  TEXT NOT NULL
  PRIMARY KEY (entry_url, dimension, value)
```

Values are user-controlled strings, trimmed, limited to 60 characters, and compared case-insensitively for duplicate prevention. Phase 1 does not introduce a global taxonomy manager.

The existing `category` and `keywords` columns remain unchanged for API and backup compatibility.

## SQLite migration

Bump the schema version and add these columns to `archive_entries`:

```text
intent             TEXT
workflow_state     TEXT NOT NULL DEFAULT 'inbox'
difficulty         TEXT
estimated_minutes  INTEGER
priority           INTEGER NOT NULL DEFAULT 0
next_action        TEXT NOT NULL DEFAULT ''
reviewed_at        TEXT
state_changed_at   TEXT NOT NULL
```

Add indexes for `workflow_state`, `intent`, and queue ordering. Create `archive_entry_tags` and an index on `(dimension, value)`.

Migration behavior:

- Existing records receive `workflow_state = 'inbox'`.
- Existing records remain unreviewed with `intent = NULL` and `reviewed_at = NULL`.
- `state_changed_at` uses `created_at`, falling back to migration time.
- No existing category, keyword, note, AI metadata, or timestamp is overwritten.
- JSON backup import accepts archives with or without the new fields.
- Export includes the new fields and structured tags.

Before implementation, storage tests must cover migration from the current schema and import of a pre-Phase-1 backup.

## Queue invariants

The server owns these constraints:

- At most one entry may be `in_progress`.
- At most five entries may be `up_next`.
- Moving an additional item into a full queue returns HTTP `409` with a clear message.
- Bulk mutations are transactional: either every requested transition succeeds or none does.
- Cold Storage entries are excluded from the default library view and future recommendations, but remain searchable when that view is selected.

The dashboard may disable invalid actions proactively, but server validation remains authoritative.

## API changes

### Read archive

`GET /api/archive` continues returning an array for compatibility. Each entry gains workflow fields and arrays named `mediums`, `tools`, and `skills`.

Future pagination is intentionally out of Phase 1, but the UI should avoid assumptions that require all entries to remain permanently client-side.

### Edit one entry

Extend `PATCH /api/archive` to accept:

```json
{
  "url": "https://www.instagram.com/reel/ABC123/",
  "intent": "learn",
  "workflowState": "up_next",
  "difficulty": "intermediate",
  "estimatedMinutes": 30,
  "priority": 4,
  "nextAction": "Recreate the texture treatment with my own lettering.",
  "mediums": ["Visual art"],
  "tools": ["Photoshop"],
  "skills": ["Texture", "Compositing"]
}
```

All supplied fields are validated together and persisted transactionally. Existing editable fields continue to work.

### Bulk workflow update

Add `PATCH /api/archive/bulk`:

```json
{
  "urls": ["https://www.instagram.com/reel/ABC123/"],
  "patch": {
    "intent": "reference",
    "workflowState": "cold_storage"
  }
}
```

Phase 1 bulk edits support intent, workflow state, priority, and structured tags. Destructive deletion remains a separate endpoint and requires its existing confirmation flow.

Responses include the updated entries and current queue counts so the dashboard can reconcile its state without guessing.

## Allowed workflow transitions

The UI should present common transitions rather than a generic status dropdown:

| Current state | Primary actions |
| --- | --- |
| Inbox | Learn, Make, Reference, Cold Storage |
| Up Next | Start, return to Inbox, Cold Storage |
| In Progress | Practiced, Applied, Published, return to Up Next |
| Practiced | Apply, Publish, return to Up Next, Cold Storage |
| Applied | Publish, return to Up Next, Cold Storage |
| Published | return to Applied, Cold Storage |
| Cold Storage | Restore to Inbox |

The API may accept any transition between known states in Phase 1 so manual corrections remain possible. Queue invariants always apply.

## Dashboard behavior

### Navigation

Add these views:

- **Inbox:** unreviewed and newly captured entries
- **Up Next:** the five-item queue plus the active item
- **Library:** reviewed references and completed work
- **Cold Storage:** dismissed or intentionally inactive material

The default view is Inbox until an item is active; when one is active, Up Next becomes the default.

### Entry editing

Extend the existing detail editor with:

- Intent controls
- Workflow actions
- Medium, tool, and skill tag inputs
- Difficulty
- Estimated minutes
- Priority
- Next action

The original message, AI summary, AI confidence, and manual notes remain visually distinct.

### Bulk actions

Selected entries can be moved to Reference, Cold Storage, or Inbox and can receive structured tags. Bulk promotion to Up Next is allowed only when the complete selection fits the remaining queue capacity. Bulk promotion to In Progress is not offered.

### Empty and constrained states

- Inbox empty: emphasize the active or next item, not archive totals.
- Up Next empty: invite the user to choose one Learn or Make item from Inbox.
- Queue full: explain that an existing item must be completed, postponed, or removed.
- Cold Storage empty: explain that this is searchable storage, not a deletion queue.

## Recommendation boundary

Phase 1 stores inputs needed for recommendations but does not choose work automatically. Queue order is priority descending, then manual transition time ascending. A deterministic recommendation score and available-time selection belong to Phase 3.

## Testing strategy

### Storage

- Current-schema migration preserves all existing fields.
- New entries receive safe defaults.
- Workflow metadata and tags round-trip through SQLite.
- Upserts do not erase user-managed workflow metadata during recapture.
- Export/import round-trips new and legacy archives.
- Tag replacement is transactional and deduplicated case-insensitively.

### API

- Every new field accepts valid input and rejects invalid values.
- Unknown fields remain rejected.
- Queue limits return `409`.
- Single and bulk transitions are atomic.
- Missing entries return `404`.
- Existing edit and delete contracts continue to pass.

### Dashboard

- Views filter entries correctly.
- Queue counts and disabled actions reconcile after mutations.
- Editing preserves unsaved input on recoverable API errors.
- Keyboard and screen-reader labels cover intent and workflow controls.
- Responsive layouts remain usable at popup-sized and mobile widths.

## Acceptance criteria

Phase 1 is complete when:

1. Existing installations migrate without losing archive data.
2. Every capture begins in Inbox and never enters Up Next automatically.
3. A user can classify an entry, describe its next action, estimate its effort, and tag its medium/tool/skill.
4. A user can see Inbox, Up Next, Library, and Cold Storage separately.
5. A user can perform safe bulk triage.
6. The server reliably enforces one active item and five upcoming items.
7. Recapturing an existing URL does not erase workflow decisions or manual metadata.
8. Backups remain compatible in both directions documented by the release notes.
9. Server tests, extension tests, type checks, and production builds pass.

## Atomic implementation boundaries

1. `feat(domain): define creative workflow metadata`
2. `feat(storage): persist archive workflow and tags`
3. `feat(api): expose validated workflow mutations`
4. `feat(api): add atomic bulk archive triage`
5. `feat(dashboard): add workflow views and filters`
6. `feat(dashboard): edit creative workflow metadata`
7. `feat(dashboard): add bulk triage actions`
8. `docs: document creative workflow foundation`

Commit dates and messages will be chosen only when each slice has been validated and the user approves committing it.
