import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs from 'sql.js';
import type { BindParams, Database } from 'sql.js';

import { DB_PATH, LEGACY_DB_PATH } from './config.js';
import type { ArchiveEntry, ArchiveEntryInput, ArchivePatch, JobStatus, SequencedArchiveEvent, StoredJob, TagDimension, WorkflowState } from './types.js';
export { DB_PATH, LEGACY_DB_PATH };

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SCHEMA_VERSION = 3;

let databasePromise: ReturnType<typeof openDatabase> | undefined;
let writeQueue: Promise<unknown> = Promise.resolve();

type SqlRow = Record<string, string | number | Uint8Array | null>;
interface ArchiveRow extends SqlRow { url: string; title: string; meta_description: string; user_message: string | null; summary: string; category: string; keywords: string; notes: string; screenshot_path: string; ai_confidence: number | null; ai_confidence_reason: string; archived_at: string; created_at: string; updated_at: string | null; manually_edited_at: string | null; intent: string | null; workflow_state: string; difficulty: string | null; estimated_minutes: number | null; priority: number; next_action: string; reviewed_at: string | null; state_changed_at: string }
interface JobRow extends SqlRow { id: string; status: string; urls_json: string; url_messages_json: string; total: number; processed: number; succeeded: number; failed: number; skipped: number; sequence: number; error: string | null; created_at: string; updated_at: string; finished_at: string | null }
interface EventRow extends SqlRow { event_json: string }
interface TagRow extends SqlRow { entry_url: string; dimension: string; value: string }

function rows<T extends SqlRow>(db: Database, sql: string, params: BindParams = []): T[] {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const result: T[] = [];
    while (statement.step()) result.push(statement.getAsObject() as T);
    return result;
  } finally {
    statement.free();
  }
}

function archiveFromRow(row: ArchiveRow, tags: TagRow[] = []): ArchiveEntry {
  const values = (dimension: TagDimension) => tags
    .filter(tag => tag.entry_url === row.url && tag.dimension === dimension)
    .map(tag => tag.value);
  return {
    url: row.url,
    title: row.title || '',
    metaDescription: row.meta_description || '',
    ...(row.user_message ? { userMessage: row.user_message } : {}),
    summary: row.summary || '',
    category: row.category || '',
    keywords: row.keywords || '',
    notes: row.notes || '',
    screenshotPath: row.screenshot_path || '',
    aiConfidence: row.ai_confidence == null ? null : row.ai_confidence,
    aiConfidenceReason: row.ai_confidence_reason || '',
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    ...(row.manually_edited_at ? { manuallyEditedAt: row.manually_edited_at } : {}),
    intent: (row.intent || null) as ArchiveEntry['intent'],
    workflowState: (row.workflow_state || 'inbox') as ArchiveEntry['workflowState'],
    difficulty: (row.difficulty || null) as ArchiveEntry['difficulty'],
    estimatedMinutes: row.estimated_minutes == null ? null : row.estimated_minutes,
    priority: row.priority || 0,
    nextAction: row.next_action || '',
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    stateChangedAt: row.state_changed_at || row.created_at,
    mediums: values('medium'),
    tools: values('tool'),
    skills: values('skill'),
  };
}

function allTags(db: Database) {
  return rows<TagRow>(db, 'SELECT entry_url, dimension, value FROM archive_entry_tags ORDER BY value COLLATE NOCASE');
}

function archiveRows(db: Database, sql: string, params: BindParams = []) {
  const result = rows<ArchiveRow>(db, sql, params);
  const tags = allTags(db);
  return result.map(row => archiveFromRow(row, tags));
}

async function persist(db: Database) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  const temporaryPath = `${DB_PATH}.tmp`;
  await fs.writeFile(temporaryPath, Buffer.from(db.export()), { mode: 0o600 });
  await fs.rename(temporaryPath, DB_PATH);
}

function migrate(db: Database) {
  db.run('PRAGMA foreign_keys = ON');
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS archive_entries (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      meta_description TEXT NOT NULL DEFAULT '',
      user_message TEXT,
      summary TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      keywords TEXT NOT NULL DEFAULT '',
      screenshot_path TEXT NOT NULL DEFAULT '',
      archived_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS archive_entries_category_idx ON archive_entries(category);
    CREATE TABLE IF NOT EXISTS archive_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      urls_json TEXT NOT NULL,
      url_messages_json TEXT NOT NULL,
      total INTEGER NOT NULL,
      processed INTEGER NOT NULL DEFAULT 0,
      succeeded INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      sequence INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS archive_job_events (
      job_id TEXT NOT NULL REFERENCES archive_jobs(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(job_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS archive_job_events_job_idx ON archive_job_events(job_id, sequence);
  `);
  const columns = new Set(rows<{ name: string }>(db, 'PRAGMA table_info(archive_entries)').map(column => column.name));
  if (!columns.has('notes')) db.run("ALTER TABLE archive_entries ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  if (!columns.has('ai_confidence')) db.run('ALTER TABLE archive_entries ADD COLUMN ai_confidence INTEGER');
  if (!columns.has('ai_confidence_reason')) db.run("ALTER TABLE archive_entries ADD COLUMN ai_confidence_reason TEXT NOT NULL DEFAULT ''");
  if (!columns.has('manually_edited_at')) db.run('ALTER TABLE archive_entries ADD COLUMN manually_edited_at TEXT');
  if (!columns.has('intent')) db.run('ALTER TABLE archive_entries ADD COLUMN intent TEXT');
  if (!columns.has('workflow_state')) db.run("ALTER TABLE archive_entries ADD COLUMN workflow_state TEXT NOT NULL DEFAULT 'inbox'");
  if (!columns.has('difficulty')) db.run('ALTER TABLE archive_entries ADD COLUMN difficulty TEXT');
  if (!columns.has('estimated_minutes')) db.run('ALTER TABLE archive_entries ADD COLUMN estimated_minutes INTEGER');
  if (!columns.has('priority')) db.run('ALTER TABLE archive_entries ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
  if (!columns.has('next_action')) db.run("ALTER TABLE archive_entries ADD COLUMN next_action TEXT NOT NULL DEFAULT ''");
  if (!columns.has('reviewed_at')) db.run('ALTER TABLE archive_entries ADD COLUMN reviewed_at TEXT');
  if (!columns.has('state_changed_at')) db.run('ALTER TABLE archive_entries ADD COLUMN state_changed_at TEXT');
  db.run("UPDATE archive_entries SET state_changed_at = COALESCE(state_changed_at, created_at, datetime('now'))");
  db.run(`
    CREATE INDEX IF NOT EXISTS archive_entries_workflow_idx ON archive_entries(workflow_state, priority DESC, state_changed_at);
    CREATE INDEX IF NOT EXISTS archive_entries_intent_idx ON archive_entries(intent);
    CREATE TABLE IF NOT EXISTS archive_entry_tags (
      entry_url TEXT NOT NULL REFERENCES archive_entries(url) ON DELETE CASCADE,
      dimension TEXT NOT NULL CHECK (dimension IN ('medium', 'tool', 'skill')),
      value TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (entry_url, dimension, value)
    );
    CREATE INDEX IF NOT EXISTS archive_entry_tags_lookup_idx ON archive_entry_tags(dimension, value COLLATE NOCASE);
  `);
  db.run(
    'INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    [SCHEMA_VERSION, new Date().toISOString()],
  );
}

function replaceTags(db: Database, url: string, dimension: TagDimension, values: string[]) {
  db.run('DELETE FROM archive_entry_tags WHERE entry_url = ? AND dimension = ?', [url, dimension]);
  const now = new Date().toISOString();
  for (const value of values) {
    db.run(
      'INSERT OR IGNORE INTO archive_entry_tags(entry_url, dimension, value, created_at) VALUES (?, ?, ?, ?)',
      [url, dimension, value, now],
    );
  }
}

function insertArchive(db: Database, entry: ArchiveEntryInput, { preserveUserData = true } = {}) {
  const now = new Date().toISOString();
  const stateChangedAt = entry.stateChangedAt || entry.createdAt || now;
  db.run(`
    INSERT INTO archive_entries (
      url, title, meta_description, user_message, summary, category, keywords,
      notes, screenshot_path, ai_confidence, ai_confidence_reason,
      archived_at, created_at, updated_at, manually_edited_at, intent, workflow_state,
      difficulty, estimated_minutes, priority, next_action, reviewed_at, state_changed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = CASE WHEN ? AND archive_entries.manually_edited_at IS NOT NULL THEN archive_entries.title ELSE excluded.title END,
      meta_description = excluded.meta_description,
      user_message = excluded.user_message,
      summary = CASE WHEN ? AND archive_entries.manually_edited_at IS NOT NULL THEN archive_entries.summary ELSE excluded.summary END,
      category = CASE WHEN ? AND archive_entries.manually_edited_at IS NOT NULL THEN archive_entries.category ELSE excluded.category END,
      keywords = CASE WHEN ? AND archive_entries.manually_edited_at IS NOT NULL THEN archive_entries.keywords ELSE excluded.keywords END,
      notes = excluded.notes,
      screenshot_path = excluded.screenshot_path,
      ai_confidence = excluded.ai_confidence,
      ai_confidence_reason = excluded.ai_confidence_reason,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at,
      manually_edited_at = CASE WHEN ? THEN archive_entries.manually_edited_at ELSE excluded.manually_edited_at END,
      intent = CASE WHEN ? THEN archive_entries.intent ELSE excluded.intent END,
      workflow_state = CASE WHEN ? THEN archive_entries.workflow_state ELSE excluded.workflow_state END,
      difficulty = CASE WHEN ? THEN archive_entries.difficulty ELSE excluded.difficulty END,
      estimated_minutes = CASE WHEN ? THEN archive_entries.estimated_minutes ELSE excluded.estimated_minutes END,
      priority = CASE WHEN ? THEN archive_entries.priority ELSE excluded.priority END,
      next_action = CASE WHEN ? THEN archive_entries.next_action ELSE excluded.next_action END,
      reviewed_at = CASE WHEN ? THEN archive_entries.reviewed_at ELSE excluded.reviewed_at END,
      state_changed_at = CASE WHEN ? THEN archive_entries.state_changed_at ELSE excluded.state_changed_at END,
      notes = CASE WHEN ? THEN archive_entries.notes ELSE excluded.notes END
  `, [
    entry.url,
    entry.title || '',
    entry.metaDescription || '',
    entry.userMessage || null,
    entry.summary || '',
    entry.category || '',
    Array.isArray(entry.keywords) ? entry.keywords.join(', ') : (entry.keywords || ''),
    entry.notes || '',
    entry.screenshotPath || '',
    Number.isInteger(entry.aiConfidence) ? entry.aiConfidence! : null,
    entry.aiConfidenceReason || '',
    entry.archivedAt || now,
    entry.createdAt || now,
    entry.updatedAt || now,
    entry.manuallyEditedAt || null,
    entry.intent || null,
    entry.workflowState || 'inbox',
    entry.difficulty || null,
    entry.estimatedMinutes ?? null,
    entry.priority ?? 0,
    entry.nextAction || '',
    entry.reviewedAt || null,
    stateChangedAt,
    ...Array(4).fill(preserveUserData ? 1 : 0),
    ...Array(10).fill(preserveUserData ? 1 : 0),
  ]);
  if (!preserveUserData || entry.mediums) replaceTags(db, entry.url, 'medium', entry.mediums || []);
  if (!preserveUserData || entry.tools) replaceTags(db, entry.url, 'tool', entry.tools || []);
  if (!preserveUserData || entry.skills) replaceTags(db, entry.url, 'skill', entry.skills || []);
}

async function importLegacyArchive(db: Database) {
  const [{ count = 0 } = {}] = rows<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM archive_entries');
  if (count > 0) return false;

  try {
    const raw = await fs.readFile(LEGACY_DB_PATH, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries) || entries.length === 0) return false;
    db.run('BEGIN');
    try {
      for (const entry of entries) {
        if (entry?.url) insertArchive(db, entry);
      }
      db.run('COMMIT');
      return true;
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[ig-archiver] Could not import database.json: ${err.message}`);
    return false;
  }
}

async function openDatabase() {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  let bytes;
  try {
    bytes = await fs.readFile(DB_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  migrate(db);
  const imported = await importLegacyArchive(db);
  if (!bytes || imported) await persist(db);
  return db;
}

export function initializeDatabase() {
  databasePromise ||= openDatabase();
  return databasePromise;
}

export async function closeDatabase() {
  if (!databasePromise) return;
  const db = await databasePromise;
  await writeQueue;
  db.close();
  databasePromise = undefined;
  writeQueue = Promise.resolve();
}

async function withWrite<T>(operation: (db: Database) => T | Promise<T>): Promise<T> {
  const db = await initializeDatabase();
  const pending = writeQueue.then(async () => {
    db.run('BEGIN');
    try {
      const result = await operation(db);
      db.run('COMMIT');
      await persist(db);
      return result;
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  });
  writeQueue = pending.catch(() => {});
  return pending;
}

export async function readDb() {
  const db = await initializeDatabase();
  await writeQueue;
  return archiveRows(db, 'SELECT * FROM archive_entries ORDER BY created_at DESC');
}

export async function findArchiveByUrl(url: string): Promise<ArchiveEntry | null> {
  const db = await initializeDatabase();
  await writeQueue;
  return archiveRows(db, 'SELECT * FROM archive_entries WHERE url = ?', [url])[0] || null;
}

export function upsertArchive(entry: ArchiveEntryInput) {
  return withWrite(db => insertArchive(db, entry));
}

export class ArchiveQueueConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveQueueConflictError';
  }
}

function assertQueueCapacity(db: Database, urls: string[], target: WorkflowState) {
  if (target !== 'up_next' && target !== 'in_progress') return;
  const limit = target === 'up_next' ? 5 : 1;
  const selected = new Set(urls);
  const occupied = rows<{ url: string }>(db, 'SELECT url FROM archive_entries WHERE workflow_state = ?', [target])
    .filter(row => !selected.has(row.url)).length;
  if (occupied + selected.size > limit) {
    throw new ArchiveQueueConflictError(
      target === 'up_next'
        ? 'Up Next can contain at most five items.'
        : 'Only one item can be in progress.',
    );
  }
}

export function updateArchives(urls: string[], patch: Partial<ArchivePatch>) {
  return withWrite(db => {
    const unique = [...new Set(urls)];
    const current = unique.map(url => archiveRows(db, 'SELECT * FROM archive_entries WHERE url = ?', [url])[0]);
    if (current.some(entry => !entry)) return null;

    const effectivePatch: Partial<ArchivePatch> = patch.intent === 'dismiss'
      ? { ...patch, workflowState: 'cold_storage' }
      : patch;
    if (effectivePatch.workflowState) assertQueueCapacity(db, unique, effectivePatch.workflowState);

    const now = new Date().toISOString();
    const editsCuratedCopy = ['title', 'summary', 'category', 'keywords', 'notes']
      .some(field => field in effectivePatch);
    for (const entry of current) {
      const workflowChanged = effectivePatch.workflowState !== undefined
        && effectivePatch.workflowState !== entry.workflowState;
      const updated: ArchiveEntry = {
        ...entry,
        ...effectivePatch,
        ...(workflowChanged ? { stateChangedAt: now } : {}),
        ...(!entry.reviewedAt && (effectivePatch.intent !== undefined
          || (effectivePatch.workflowState && effectivePatch.workflowState !== 'inbox'))
          ? { reviewedAt: now }
          : {}),
        ...(effectivePatch.workflowState === 'inbox' && effectivePatch.intent === null
          ? { reviewedAt: undefined }
          : {}),
        updatedAt: now,
        manuallyEditedAt: editsCuratedCopy ? now : entry.manuallyEditedAt,
      };
      insertArchive(db, updated, { preserveUserData: false });
    }
    return unique.map(url => archiveRows(db, 'SELECT * FROM archive_entries WHERE url = ?', [url])[0]);
  });
}

export async function updateArchive(url: string, patch: Partial<ArchivePatch>) {
  const updated = await updateArchives([url], patch);
  return updated?.[0] || null;
}

export async function getQueueCounts() {
  const db = await initializeDatabase();
  await writeQueue;
  const count = (state: WorkflowState) => rows<{ count: number }>(
    db,
    'SELECT COUNT(*) AS count FROM archive_entries WHERE workflow_state = ?',
    [state],
  )[0]?.count || 0;
  return { inProgress: count('in_progress'), upNext: count('up_next') };
}

export function writeDb(entries: ArchiveEntryInput[]) {
  return withWrite(db => {
    db.run('DELETE FROM archive_entries');
    for (const entry of entries) insertArchive(db, entry, { preserveUserData: false });
  });
}

export function deleteArchives(urls: string[]) {
  return withWrite(db => {
    const unique = [...new Set(urls)];
    const found = unique.flatMap(url => rows<ArchiveRow>(db, 'SELECT * FROM archive_entries WHERE url = ?', [url]));
    for (const url of unique) db.run('DELETE FROM archive_entries WHERE url = ?', [url]);
    const tags = allTags(db);
    return found.map(row => archiveFromRow(row, tags));
  });
}

export async function exportArchive() {
  return {
    format: 'ig-archiver-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: await readDb(),
  };
}

export async function importArchive(entries: ArchiveEntryInput[], { replace = false } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Backup entries must be an array.');
  return withWrite(db => {
    if (replace) db.run('DELETE FROM archive_entries');
    for (const entry of entries) {
      if (!entry?.url || typeof entry.url !== 'string') throw new TypeError('Every imported entry must have a URL.');
      const includesWorkflow = entry.workflowState !== undefined
        || entry.intent !== undefined
        || entry.nextAction !== undefined
        || entry.mediums !== undefined
        || entry.tools !== undefined
        || entry.skills !== undefined;
      insertArchive(db, entry, { preserveUserData: !replace && !includesWorkflow });
    }
    return entries.length;
  });
}

export async function listStoredJobs(): Promise<StoredJob[]> {
  const db = await initializeDatabase();
  await writeQueue;
  return rows<JobRow>(db, 'SELECT * FROM archive_jobs ORDER BY created_at').map(row => ({
    id: row.id,
    status: row.status as JobStatus,
    urls: JSON.parse(row.urls_json) as string[],
    urlMessages: JSON.parse(row.url_messages_json) as Record<string, string>,
    total: row.total,
    processed: row.processed,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    sequence: row.sequence,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    events: rows<EventRow>(db, 'SELECT event_json FROM archive_job_events WHERE job_id = ? ORDER BY sequence', [row.id])
      .map(eventRow => JSON.parse(eventRow.event_json) as SequencedArchiveEvent),
  }));
}

export function saveStoredJob(job: StoredJob) {
  return withWrite(db => {
    db.run(`
      INSERT INTO archive_jobs (
        id, status, urls_json, url_messages_json, total, processed, succeeded,
        failed, skipped, sequence, error, created_at, updated_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        processed = excluded.processed,
        succeeded = excluded.succeeded,
        failed = excluded.failed,
        skipped = excluded.skipped,
        sequence = excluded.sequence,
        error = excluded.error,
        updated_at = excluded.updated_at,
        finished_at = excluded.finished_at
    `, [
      job.id, job.status, JSON.stringify(job.urls), JSON.stringify(job.urlMessages || {}),
      job.total, job.processed, job.succeeded, job.failed, job.skipped, job.sequence,
      job.error || null, job.createdAt, job.updatedAt, job.finishedAt || null,
    ]);
    for (const event of job.events || []) {
      db.run(
        'INSERT OR IGNORE INTO archive_job_events(job_id, sequence, event_json, created_at) VALUES (?, ?, ?, ?)',
        [job.id, event.sequence, JSON.stringify(event), event.at || new Date().toISOString()],
      );
    }
  });
}

export function partitionEntriesByUrl(entries: ArchiveEntry[], urls: string[]) {
  const requested = new Set(urls);
  return {
    removed: entries.filter(entry => requested.has(entry.url)),
    remaining: entries.filter(entry => !requested.has(entry.url)),
  };
}
