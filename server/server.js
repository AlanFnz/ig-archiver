// server.js — ig-archiver backend
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';
import path from 'path';

import { readDb, writeDb } from './lib/db.js';
import { capturePageInfo } from './lib/capture.js';
import { summarize } from './lib/summarize.js';
import { runConcurrent } from './lib/concurrency.js';
import { PORT, SCREENSHOTS, SESSION_FILE, getConfig, getPublicConfig, setConfig } from './lib/config.js';

// ── express app ───────────────────────────────────────────────────────────────

const app = express();

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
    if (entry.screenshotPath) {
      const screenshotFile = path.join(SCREENSHOTS, path.basename(entry.screenshotPath));
      await fs.unlink(screenshotFile).catch(err => {
        if (err.code !== 'ENOENT') console.warn(`[ig-archiver] Could not delete screenshot: ${err.message}`);
      });
    }
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

/**
 * post /archive
 * body: { urls: string[] }
 *
 * streams NDJSON progress events back to the client:
 *   { type: 'progress', index: number, total: number, url: string }
 *   { type: 'done',     url: string, category: string, summary: string }
 *   { type: 'error',    url: string, message: string }
 */
app.post('/archive', async (req, res) => {
  const { urls, urlMessages = {} } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a non-empty "urls" array.' });
  }
  if (urls.length > 250 || urls.some(url => typeof url !== 'string' || url.length > 2_000)) {
    return res.status(400).json({ error: 'Archive batches may contain at most 250 valid URL strings.' });
  }
  if (!urlMessages || typeof urlMessages !== 'object' || Array.isArray(urlMessages)) {
    return res.status(400).json({ error: '"urlMessages" must be an object when provided.' });
  }

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  const send = obj => res.write(JSON.stringify(obj) + '\n');

  // load the DB once up-front and accumulate changes in memory.
  // a single write after the loop replaces N reads + N writes.
  const db    = await readDb();
  const byUrl = new Map(db.map((e, i) => [e.url, i]));
  const now   = new Date().toISOString();

  // launch one browser for the entire batch; each URL gets its own context.
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    await runConcurrent(urls, getConfig().concurrency, async (url, itemIndex) => {
      const displayIndex = itemIndex + 1;
      send({ type: 'progress', index: displayIndex, total: urls.length, url });

      try {
        const parsedUrl = new URL(url);
        const validHost = parsedUrl.hostname === 'instagram.com' || parsedUrl.hostname === 'www.instagram.com';
        const validPath = /^\/(?:p|reel)\//.test(parsedUrl.pathname);
        if (parsedUrl.protocol !== 'https:' || !validHost || !validPath) {
          throw new Error('Only HTTPS Instagram post and reel URLs can be archived.');
        }

        const { screenshotPath, absoluteScreenshotPath, title, description, caption } =
          await capturePageInfo(browser, url);
        const userMessage = urlMessages[url] || undefined;
        const { summary, category, keywords } =
          await summarize(url, title, caption, description, absoluteScreenshotPath, userMessage);

        const entry = { url, title, metaDescription: description, userMessage, summary, category, keywords, screenshotPath, archivedAt: now };

        const idx = byUrl.get(url);
        if (idx !== undefined) {
          db[idx] = { ...db[idx], ...entry, updatedAt: now };
        } else {
          byUrl.set(url, db.length);
          db.push({ ...entry, createdAt: now });
        }

        console.log(`[ig-archiver] [${displayIndex}/${urls.length}] ${url} → ${category}`);
        send({ type: 'done', url, category, summary, screenshotPath });
      } catch (err) {
        const message = err.message ?? String(err);
        console.error(`[ig-archiver] [${displayIndex}/${urls.length}] ${url} — ERROR:`, message);
        send({ type: 'error', url, message });
      }
    });
  } catch (err) {
    const message = err.message ?? String(err);
    console.error('[ig-archiver] Archive batch failed:', message);
    send({ type: 'error', url: '', message: `Archive batch failed: ${message}` });
  } finally {
    // always close the browser and persist whatever was successfully archived,
    // even if the loop exited early due to an unexpected error.
    if (browser) await browser.close().catch(err => console.warn(`[ig-archiver] Browser close failed: ${err.message}`));
    await writeDb(db).catch(err => console.error(`[ig-archiver] Database write failed: ${err.message}`));
    res.end();
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
