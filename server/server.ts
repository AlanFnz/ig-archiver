// server.js — ig-archiver backend
import 'dotenv/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { Server } from 'http';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  closeDatabase,
  deleteArchives,
  exportArchive,
  getQueueCounts,
  importArchive,
  readDb,
  updateArchive,
  updateArchives,
  ArchiveQueueConflictError,
} from './lib/db.js';
import { runArchiveBatch } from './lib/archive-runner.js';
import { analyzeBacklog } from './lib/backlog.js';
import { HOST, PORT, PUBLIC_DIR, SCREENSHOTS, SESSION_FILE, getConfig, getPublicConfig, setConfig } from './lib/config.js';
import { createJobManager } from './lib/jobs.js';
import { logger } from './lib/logger.js';
import { ARCHIVE_INTENTS, DIFFICULTIES, WORKFLOW_STATES, type ArchiveEntry, type ArchivePatch } from './lib/types.js';

// ── express app ───────────────────────────────────────────────────────────────

export const app = express();
export const jobs = createJobManager({ runner: runArchiveBatch });
let httpServer: Server | undefined;

app.use(cors({
  origin(origin, callback) {
    const allowed = !origin
      || origin.startsWith('chrome-extension://')
      || origin === `http://localhost:${PORT}`
      || origin === `http://127.0.0.1:${PORT}`;
    callback(allowed ? null : new Error('Origin is not allowed.'), allowed);
  },
}));
app.use(express.json({ limit: '1mb' }));

// health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// serve screenshots statically so the UI can preview them
app.use('/screenshots', express.static(SCREENSHOTS));
app.use(express.static(PUBLIC_DIR));

// API: get all archived entries
app.get('/api/archive', async (req, res) => {
  try {
    const db = await readDb();
    res.json(db);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read database.' });
  }
});

app.get('/api/archive/backlog-analysis', async (_req, res) => {
  try {
    res.json(analyzeBacklog(await readDb()));
  } catch {
    res.status(500).json({ error: 'Failed to analyze the archive backlog.' });
  }
});

const EDITABLE_ARCHIVE_FIELDS: Record<string, number> = {
  title: 300,
  summary: 1_000,
  category: 100,
  keywords: 300,
  notes: 2_000,
  nextAction: 500,
};

const WORKFLOW_FIELDS = new Set([
  'intent', 'workflowState', 'difficulty', 'estimatedMinutes', 'priority',
  'nextAction', 'mediums', 'tools', 'skills',
]);
const BULK_WORKFLOW_FIELDS = new Set(['intent', 'workflowState', 'priority', 'mediums', 'tools', 'skills']);

function validateTags(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new TypeError(`"${field}" must be an array of at most 20 tags.`);
  }
  const tags = value.map(tag => typeof tag === 'string' ? tag.trim() : '');
  if (tags.some(tag => !tag || tag.length > 60)) {
    throw new TypeError(`Every "${field}" tag must contain between 1 and 60 characters.`);
  }
  const seen = new Set<string>();
  return tags.filter(tag => {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validateArchivePatch(candidate: unknown, { bulk = false } = {}): Partial<ArchivePatch> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('A valid patch object is required.');
  }
  const input = candidate as Record<string, unknown>;
  const fields = Object.keys(input);
  if (fields.length === 0) throw new TypeError('At least one editable field is required.');
  const allowed = bulk
    ? BULK_WORKFLOW_FIELDS
    : new Set([...Object.keys(EDITABLE_ARCHIVE_FIELDS), ...WORKFLOW_FIELDS]);
  if (fields.some(field => !allowed.has(field))) {
    throw new TypeError(bulk
      ? 'Bulk edits support only intent, workflow state, priority, and structured tags.'
      : 'The patch contains a field that cannot be edited.');
  }

  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const value = input[field];
    if (field in EDITABLE_ARCHIVE_FIELDS) {
      if (typeof value !== 'string') throw new TypeError(`"${field}" must be a string.`);
      patch[field] = value.trim();
      if ((patch[field] as string).length > EDITABLE_ARCHIVE_FIELDS[field]) {
        throw new TypeError(`"${field}" may contain at most ${EDITABLE_ARCHIVE_FIELDS[field]} characters.`);
      }
    } else if (field === 'intent') {
      if (value !== null && !ARCHIVE_INTENTS.includes(value as typeof ARCHIVE_INTENTS[number])) {
        throw new TypeError('"intent" must be learn, make, reference, dismiss, or null.');
      }
      patch.intent = value;
    } else if (field === 'workflowState') {
      if (!WORKFLOW_STATES.includes(value as typeof WORKFLOW_STATES[number])) {
        throw new TypeError('"workflowState" is invalid.');
      }
      patch.workflowState = value;
    } else if (field === 'difficulty') {
      if (value !== null && !DIFFICULTIES.includes(value as typeof DIFFICULTIES[number])) {
        throw new TypeError('"difficulty" must be easy, intermediate, advanced, or null.');
      }
      patch.difficulty = value;
    } else if (field === 'estimatedMinutes') {
      if (value !== null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1_440)) {
        throw new TypeError('"estimatedMinutes" must be an integer from 1 through 1440, or null.');
      }
      patch.estimatedMinutes = value;
    } else if (field === 'priority') {
      if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 5) {
        throw new TypeError('"priority" must be an integer from 0 through 5.');
      }
      patch.priority = value;
    } else if (field === 'mediums' || field === 'tools' || field === 'skills') {
      patch[field] = validateTags(value, field);
    }
  }
  if ('category' in patch && !patch.category) throw new TypeError('Category cannot be empty.');
  return patch as Partial<ArchivePatch>;
}

// API: edit user-owned archive metadata without changing capture provenance
app.patch('/api/archive', async (req, res) => {
  const { url, ...candidate } = req.body || {};
  if (typeof url !== 'string' || !url) return res.status(400).json({ error: 'A valid "url" is required.' });
  let patch: Partial<ArchivePatch>;
  try {
    patch = validateArchivePatch(candidate);
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid archive patch.' });
  }

  try {
    const entry = await updateArchive(url, patch);
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    res.json({ success: true, entry, queue: await getQueueCounts() });
  } catch (err) {
    if (err instanceof ArchiveQueueConflictError) return res.status(409).json({ error: err.message });
    res.status(500).json({ error: 'Failed to update archive entry.' });
  }
});

// API: triage multiple entries as one atomic workflow mutation
app.patch('/api/archive/bulk', async (req, res) => {
  const { urls, patch: candidate } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 500 || urls.some(url => typeof url !== 'string')) {
    return res.status(400).json({ error: '"urls" must contain between 1 and 500 URL strings.' });
  }
  let patch: Partial<ArchivePatch>;
  try {
    patch = validateArchivePatch(candidate, { bulk: true });
  } catch (err) {
    return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid bulk patch.' });
  }
  try {
    const entries = await updateArchives(urls, patch);
    if (!entries) return res.status(404).json({ error: 'One or more entries were not found.' });
    res.json({ success: true, updated: entries.length, entries, queue: await getQueueCounts() });
  } catch (err) {
    if (err instanceof ArchiveQueueConflictError) return res.status(409).json({ error: err.message });
    res.status(500).json({ error: 'Failed to update archive entries.' });
  }
});

async function removeScreenshots(entries: ArchiveEntry[]) {
  await Promise.all(entries.map(async entry => {
    if (!entry.screenshotPath) return;
    const screenshotFile = path.join(SCREENSHOTS, path.basename(entry.screenshotPath));
    await fs.unlink(screenshotFile).catch(err => {
      if (err.code !== 'ENOENT') logger.warn('screenshot.delete_failed', 'Could not delete screenshot.', { error: err.message, file: screenshotFile });
    });
  }));
}

// API: delete multiple entries from the archive
app.delete('/api/archive/bulk', async (req, res) => {
  const { urls } = req.body;
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 500) {
    return res.status(400).json({ error: '"urls" must contain between 1 and 500 entries.' });
  }
  if (urls.some(url => typeof url !== 'string')) {
    return res.status(400).json({ error: 'Every bulk-delete URL must be a string.' });
  }

  try {
    const removed = await deleteArchives(urls);
    if (removed.length === 0) return res.status(404).json({ error: 'No matching entries found.' });
    await removeScreenshots(removed);
    res.json({ success: true, deleted: removed.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update database.' });
  }
});

// API: delete an entry from archive
app.delete('/api/archive', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'Missing "url" parameter.' });
  }
  try {
    const [entry] = await deleteArchives([url]);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    await removeScreenshots([entry]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update database.' });
  }
});

// API: portable JSON backup and restore
app.get('/api/archive/export', async (_req, res) => {
  try {
    const backup = await exportArchive();
    res.setHeader('Content-Disposition', `attachment; filename="ig-archiver-${backup.exportedAt.slice(0, 10)}.json"`);
    res.json(backup);
  } catch {
    res.status(500).json({ error: 'Failed to export archive.' });
  }
});

app.post('/api/archive/import', async (req, res) => {
  const { format, entries, mode = 'merge' } = req.body || {};
  if (format !== 'ig-archiver-backup' || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'A valid ig-archiver backup is required.' });
  }
  if (!['merge', 'replace'].includes(mode)) {
    return res.status(400).json({ error: 'Import mode must be "merge" or "replace".' });
  }
  if (entries.length > 10_000) {
    return res.status(400).json({ error: 'Backups may contain at most 10,000 entries.' });
  }
  try {
    const imported = await importArchive(entries, { replace: mode === 'replace' });
    res.json({ success: true, imported, mode });
  } catch (err) {
    const status = err instanceof TypeError ? 400 : 500;
    res.status(status).json({ error: err.message || 'Failed to import archive.' });
  }
});

// API: get current configuration settings
app.get('/api/config', (req, res) => {
  res.json(getPublicConfig());
});

// API: update configuration settings
app.post('/api/config', (req, res) => {
  try {
    const config = setConfig(req.body);
    res.json({ success: true, config });
  } catch (err) {
    const status = err instanceof TypeError ? 400 : 500;
    res.status(status).json({ error: err.message || 'Failed to save configuration.' });
  }
});

function archiveRequestError(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Request body must be a JSON object.';
  const { urls, urlMessages = {} } = body as { urls?: unknown; urlMessages?: unknown };
  if (!Array.isArray(urls) || urls.length === 0) {
    return 'Request body must contain a non-empty "urls" array.';
  }
  if (urls.length > 250 || urls.some(url => typeof url !== 'string' || url.length > 2_000)) {
    return 'Archive batches may contain at most 250 valid URL strings.';
  }
  if (!urlMessages || typeof urlMessages !== 'object' || Array.isArray(urlMessages)) {
    return '"urlMessages" must be an object when provided.';
  }
  return null;
}

// API: create and control persistent archive jobs
app.post('/api/jobs', async (req, res) => {
  const error = archiveRequestError(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const job = await jobs.create({ urls: req.body.urls, urlMessages: req.body.urlMessages || {} });
    res.status(202).json(job.serialize());
  } catch (err) {
    if (err.code === 'JOB_ACTIVE') {
      return res.status(409).json({ error: err.message, job: err.job.serialize() });
    }
    res.status(500).json({ error: 'Failed to create archive job.' });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Archive job not found.' });
  const after = Math.max(0, Number.parseInt(typeof req.query.after === 'string' ? req.query.after : '0', 10) || 0);
  res.json(job.serialize({ after }));
});

for (const action of ['pause', 'resume', 'cancel']) {
  app.post(`/api/jobs/:id/${action}`, async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Archive job not found.' });
    try {
      if (action === 'pause') await job.pause();
      else if (action === 'resume') await job.resume();
      else await job.cancel();
      res.json(job.serialize());
    } catch (err) {
      res.status(409).json({ error: err.message, job: job.serialize() });
    }
  });
}

/**
 * post /archive
 * body: { urls: string[] }
 *
 * streams NDJSON progress events back to the client:
 *   { type: 'progress', index: number, total: number, url: string }
 *   { type: 'done',     url: string, category: string, summary: string }
 *   { type: 'skipped',  url: string, category: string, summary: string }
 *   { type: 'error',    url: string, message: string }
 */
app.post('/archive', async (req, res) => {
  const { urls, urlMessages = {} } = req.body;
  const error = archiveRequestError(req.body);
  if (error) return res.status(400).json({ error });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = (obj: unknown) => {
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };

  try {
    await runArchiveBatch({ urls, urlMessages, onEvent: send });
  } catch (err) {
    const message = err.message ?? String(err);
    logger.error('archive.batch_failed', 'Archive batch failed.', { error: message });
    send({ type: 'error', url: '', message: `Archive batch failed: ${message}` });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  if (err.message === 'Origin is not allowed.') {
    return res.status(403).json({ error: err.message });
  }
  logger.error('http.unhandled_error', 'Unhandled request error.', { error: err.message });
  res.status(500).json({ error: 'Unexpected server error.' });
});

// ── start ─────────────────────────────────────────────────────────────────────

export async function init() {
  await fs.mkdir(SCREENSHOTS, { recursive: true });

  if (!getConfig().openaiApiKey && process.env.MOCK !== 'true') {
    logger.warn('config.openai_key_missing', 'OpenAI API key is not configured. Add it in dashboard Settings before archiving.');
  }

  try {
    await fs.access(SESSION_FILE);
  } catch {
    throw new Error('No session.json found. Run `yarn run login` first.');
  }

  await jobs.init();

  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      logger.info('server.started', 'IG Archiver server started.', { host: HOST, port: PORT, screenshots: SCREENSHOTS });
      resolve(server);
    });
    server.once('error', reject);
  });
  return httpServer;
}

async function shutdown(signal: string) {
  logger.info('server.stopping', 'Stopping IG Archiver server.', { signal });
  const server = httpServer;
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await closeDatabase();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      shutdown(signal)
        .then(() => process.exit(0))
        .catch(err => {
          logger.error('server.shutdown_failed', 'Server shutdown failed.', { error: err.message });
          process.exit(1);
        });
    });
  }
  init().catch(err => {
    logger.error('server.startup_failed', 'Server startup failed.', { error: err.message });
    process.exit(1);
  });
}
