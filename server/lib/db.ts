import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import initSqlJs from 'sql.js';
import type { BindParams, Database } from 'sql.js';

import { DB_PATH, LEGACY_DB_PATH } from './config.js';
import type { ArchiveEntry, ArchiveEntryInput, ArchivePatch, JobStatus, SequencedArchiveEvent, StoredJob } from './types.js';
export { DB_PATH, LEGACY_DB_PATH };

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
const SCHEMA_VERSION = 2;

let databasePromise: ReturnType<typeof openDatabase> | undefined;
let writeQueue: Promise<unknown> = Promise.resolve();

type SqlRow = Record<string, string | number | Uint8Array | null>;
interface ArchiveRow extends SqlRow { url: string; title: string; meta_description: string; user_message: string | null; summary: string; category: string; keywords: string; notes: string; screenshot_path: string; ai_confidence: number | null; ai_confidence_reason: string; archived_at: string; created_at: string; updated_at: string | null; manually_edited_at: string | null }
interface JobRow extends SqlRow { id: string; status: string; urls_json: string; url_messages_json: string; total: number; processed: number; succeeded: number; failed: number; skipped: number; sequence: number; error: string | null; created_at: string; updated_at: string; finished_at: string | null }
interface EventRow extends SqlRow { event_json: string }

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

function archiveFromRow(row: ArchiveRow): ArchiveEntry {
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
  };
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
  db.run(
    'INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    [SCHEMA_VERSION, new Date().toISOString()],
  );
}

function insertArchive(db: Database, entry: ArchiveEntryInput) {
  const now = new Date().toISOString();
  db.run(`
    INSERT INTO archive_entries (
      url, title, meta_description, user_message, summary, category, keywords,
      notes, screenshot_path, ai_confidence, ai_confidence_reason,
      archived_at, created_at, updated_at, manually_edited_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title = excluded.title,
      meta_description = excluded.meta_description,
      user_message = excluded.user_message,
      summary = excluded.summary,
      category = excluded.category,
      keywords = excluded.keywords,
      notes = excluded.notes,
      screenshot_path = excluded.screenshot_path,
      ai_confidence = excluded.ai_confidence,
      ai_confidence_reason = excluded.ai_confidence_reason,
      archived_at = excluded.archived_at,
      updated_at = excluded.updated_at,
      manually_edited_at = excluded.manually_edited_at
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
  ]);
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
  return rows<ArchiveRow>(db, 'SELECT * FROM archive_entries ORDER BY created_at DESC').map(archiveFromRow);
}

export async function findArchiveByUrl(url: string): Promise<ArchiveEntry | null> {
  const db = await initializeDatabase();
  await writeQueue;
  const [row] = rows<ArchiveRow>(db, 'SELECT * FROM archive_entries WHERE url = ?', [url]);
  return row ? archiveFromRow(row) : null;
}

export function upsertArchive(entry: ArchiveEntryInput) {
  return withWrite(db => insertArchive(db, entry));
}

export function updateArchive(url: string, patch: Partial<ArchivePatch>) {
  return withWrite(db => {
    const [row] = rows<ArchiveRow>(db, 'SELECT * FROM archive_entries WHERE url = ?', [url]);
    if (!row) return null;
    const current = archiveFromRow(row);
    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      manuallyEditedAt: new Date().toISOString(),
    };
    insertArchive(db, updated);
    const [saved] = rows<ArchiveRow>(db, 'SELECT * FROM archive_entries WHERE url = ?', [url]);
    return archiveFromRow(saved);
  });
}

export function writeDb(entries: ArchiveEntryInput[]) {
  return withWrite(db => {
    db.run('DELETE FROM archive_entries');
    for (const entry of entries) insertArchive(db, entry);
  });
}

export function deleteArchives(urls: string[]) {
  return withWrite(db => {
    const unique = [...new Set(urls)];
    const found = unique.flatMap(url => rows<ArchiveRow>(db, 'SELECT * FROM archive_entries WHERE url = ?', [url]));
    for (const url of unique) db.run('DELETE FROM archive_entries WHERE url = ?', [url]);
    return found.map(archiveFromRow);
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
      insertArchive(db, entry);
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
