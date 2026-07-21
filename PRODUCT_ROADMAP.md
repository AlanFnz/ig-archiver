# IG Archiver product roadmap

## Product direction

IG Archiver turns saved Instagram inspiration into deliberate creative practice and finished work.

The archive remains searchable, but archive size is not the measure of success. The product should help answer:

- What should I work on next?
- Why did I save this?
- What is the smallest useful action I can take now?
- Which references have influenced something I practiced, made, or published?

The core loop is:

```text
Capture → understand → choose → practice → create → publish → reflect
```

## Product principles

1. **Making comes before cataloguing.** The default experience should offer a focused action, not an infinite library.
2. **Saving is not a commitment.** New and historical captures begin outside the active queue.
3. **Small queues create focus.** At most one item may be in progress and five may be up next.
4. **AI proposes; the user decides.** Generated metadata, exercises, clusters, and priorities remain explainable and editable.
5. **Original intent is provenance.** The message accompanying a link is preserved separately from AI interpretation and later notes.
6. **Old material creates no obligation.** Historical captures can remain searchable in cold storage without demanding review.
7. **Progress is non-punitive.** Measure practice and outcomes without resettable streaks or guilt-driven notifications.

## Information model

An archive entry will progressively gain these dimensions:

| Dimension | Examples |
| --- | --- |
| Intent | Learn, Make, Reference, Dismiss |
| Workflow state | Inbox, Up Next, In Progress, Practiced, Applied, Published, Cold Storage |
| Medium | Visual art, motion, music, audio, typography |
| Tool | Photoshop, After Effects, Blender, Ableton Live |
| Skill | Masking, compositing, kinetic type, sound design |
| Difficulty | Easy, intermediate, advanced |
| Effort | Estimated focused minutes |
| Next action | “Recreate only the background texture” |
| Project | Poster series, audiovisual loop, album artwork |
| Provenance | Original message, AI interpretation, manual notes |

The existing category and keywords remain supported during migration. They are useful broad descriptors, but they are not substitutes for intent or workflow state.

## Phase 1 — Workflow foundation

**Outcome:** captures become editable, actionable objects.

- Add intent, workflow state, difficulty, estimated duration, priority, and next action.
- Add structured tags for medium, tool, and skill.
- Add reviewed and workflow-state timestamps.
- Extend single-item editing and add validated bulk workflow actions.
- Add dashboard filters and editors for the new metadata.
- Enforce one In Progress item and at most five Up Next items.
- Keep all existing entries in Inbox; do not automatically promote them.

The detailed design and acceptance criteria are in [PHASE_1_DESIGN.md](PHASE_1_DESIGN.md).

## Phase 2 — Inbox and backlog recovery

**Outcome:** hundreds of existing captures can be made manageable without reviewing each one.

- Distinguish unreviewed historical entries from reviewed captures.
- Add fast individual triage and batch actions.
- Detect unavailable posts and exact duplicates.
- Propose clusters by topic, tool, skill, and visual similarity.
- Detect likely overlap between tutorials and recommend a representative item.
- Add “Review three old saves” as a bounded interaction.
- Add Cold Storage, excluded from recommendations and queue counts but still searchable.
- Let current interests determine which historical clusters are resurfaced first.

AI batch decisions must be previews. Nothing is deleted, dismissed, or promoted without confirmation.

## Phase 3 — Up Next

**Outcome:** opening the dashboard produces a clear recommendation.

- Add a Today view with one primary creative action.
- Add a manually reorderable Up Next queue.
- Recommend work based on priority, project relevance, actionability, available time, difficulty, prerequisites, and waiting time.
- Explain why an item is recommended.
- Allow recommendations to be replaced, postponed, or reduced in scope.
- Surface saved-versus-practiced imbalance without blocking capture.

The first recommendation model should be deterministic and testable. AI can enrich its inputs later.

## Phase 4 — Focus sessions

**Outcome:** a selected reference becomes a small, resumable practice session.

- Add a distraction-free session view.
- Show the reference, original message, desired outcome, and one current step.
- Add an optional timer and lightweight checkpoints.
- Support Done, Stuck, and Stop for Today.
- Preserve the exact resume point.
- Record a completion level: Explored, Practiced, Adapted, or Published.
- When stuck, offer a smaller exercise, prerequisite, or easier related item.

## Phase 5 — Projects and outcomes

**Outcome:** references and techniques connect to original creative work.

- Add projects with goals and short creative briefs.
- Attach references, techniques, tasks, and sessions to a project.
- Record output files or external URLs.
- Link published work back to its source references.
- Add short retrospectives and learned techniques.

## Phase 6 — Creative coach

**Outcome:** recommendations improve from real practice history.

- Generate editable learning paths from related captures.
- Order tutorials by prerequisites and difficulty.
- Propose small original exercises rather than passive viewing.
- Suggest weekly practice plans that fit available time.
- Identify redundant saved material.
- Recommend the next item using completed sessions and active projects.
- Report confidence in classifications and recommendations, never artistic quality.

## Success measures

Primary measures:

- Practice sessions started and completed
- Captures reaching Practiced, Applied, or Published
- Original outputs connected to references
- Time between capture and first action
- Actionable captures converted into completed sessions

Supporting measures:

- Backlog items triaged or intentionally moved to Cold Storage
- Duplicate or unavailable captures resolved
- Saved-versus-practiced ratio
- Recommendations accepted, postponed, or replaced

Archive size and daily streaks are deliberately not success measures.

## Delivery order

Work should remain independently testable and reviewable:

1. Product roadmap and Phase 1 design
2. Workflow domain types and SQLite migration
3. Single-entry workflow API and validation
4. Bulk workflow API and queue-limit enforcement
5. Dashboard metadata editing and filters
6. Inbox and Cold Storage views
7. Up Next queue and deterministic recommendation scoring
8. Backlog analysis and batch-triage proposals
9. Focus sessions
10. Projects, outcomes, and creative-coach features

Each unit should be an atomic commit made only after validation.
