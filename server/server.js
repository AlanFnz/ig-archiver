// server.js — ig-archiver backend
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';

import { partitionEntriesByUrl, readDb, writeDb } from './lib/db.js';
import { runArchiveBatch } from './lib/archive-runner.js';
import { PORT, SCREENSHOTS, SESSION_FILE, getConfig, getPublicConfig, setConfig } from './lib/config.js';
import { createJobManager } from './lib/jobs.js';

// ── express app ───────────────────────────────────────────────────────────────

const app = express();
const jobs = createJobManager({ runner: runArchiveBatch });

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
app.use(express.static(path.join(path.dirname(SCREENSHOTS), 'public')));

// API: get all archived entries
app.get('/api/archive', async (req, res) => {
  try {
    const db = await readDb();
    res.json(db);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read database.' });
  }
});

async function removeScreenshots(entries) {
  await Promise.all(entries.map(async entry => {
    if (!entry.screenshotPath) return;
    const screenshotFile = path.join(SCREENSHOTS, path.basename(entry.screenshotPath));
    await fs.unlink(screenshotFile).catch(err => {
      if (err.code !== 'ENOENT') console.warn(`[ig-archiver] Could not delete screenshot: ${err.message}`);
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
    const db = await readDb();
    const { removed, remaining } = partitionEntriesByUrl(db, urls);
    if (removed.length === 0) return res.status(404).json({ error: 'No matching entries found.' });

    await writeDb(remaining);
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
    const db = await readDb();
    const entry = db.find(e => e.url === url);
    if (!entry) {
      return res.status(404).json({ error: 'Entry not found.' });
    }
    const filtered = db.filter(e => e.url !== url);
    await writeDb(filtered);
    await removeScreenshots([entry]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update database.' });
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

function archiveRequestError(body) {
  const { urls, urlMessages = {} } = body || {};
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
app.post('/api/jobs', (req, res) => {
  const error = archiveRequestError(req.body);
  if (error) return res.status(400).json({ error });

  try {
    const job = jobs.create({ urls: req.body.urls, urlMessages: req.body.urlMessages || {} });
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
  const after = Math.max(0, Number.parseInt(req.query.after || '0', 10) || 0);
  res.json(job.serialize({ after }));
});

for (const action of ['pause', 'resume', 'cancel']) {
  app.post(`/api/jobs/:id/${action}`, (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Archive job not found.' });
    try {
      job[action]();
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

  const send = obj => {
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };

  try {
    await runArchiveBatch({ urls, urlMessages, onEvent: send });
  } catch (err) {
    const message = err.message ?? String(err);
    console.error('[ig-archiver] Archive batch failed:', message);
    send({ type: 'error', url: '', message: `Archive batch failed: ${message}` });
  } finally {
    if (!res.destroyed && !res.writableEnded) res.end();
  }
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.message === 'Origin is not allowed.') {
    return res.status(403).json({ error: err.message });
  }
  console.error('[ig-archiver] Unhandled request error:', err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

// ── start ─────────────────────────────────────────────────────────────────────

async function init() {
  await fs.mkdir(SCREENSHOTS, { recursive: true });

  if (!getConfig().openaiApiKey && process.env.MOCK !== 'true') {
    console.warn('[ig-archiver] OpenAI API key is not configured. Add it in the dashboard Settings before archiving.');
  }

  try {
    await fs.access(SESSION_FILE);
  } catch {
    console.error('[ig-archiver] No session.json found. Run `yarn run login` first.');
    process.exit(1);
  }

  await new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      console.log(`\n[ig-archiver] server running on http://localhost:${PORT}`);
      console.log(`[ig-archiver] Screenshots → ${SCREENSHOTS}\n`);
      resolve();
    });
    server.once('error', reject);
  });
}

init().catch(err => {
  console.error('[ig-archiver] Startup failed:', err);
  process.exit(1);
});
