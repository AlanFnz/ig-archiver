// server.js — ig-archiver backend
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { promises as fs } from 'fs';

import { readDb, writeDb } from './lib/db.js';
import { capturePageInfo } from './lib/capture.js';
import { summarize } from './lib/summarize.js';
import { PORT, SCREENSHOTS, SESSION_FILE } from './lib/config.js';

if (!process.env.OPENAI_API_KEY && process.env.MOCK !== 'true') {
  console.error('[ig-archiver] ERROR: OPENAI_API_KEY is not set. Please create a .env file.');
  process.exit(1);
}

// ── express app ───────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

// health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// serve screenshots statically so the UI can preview them
app.use('/screenshots', express.static(SCREENSHOTS));

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
  const { urls } = req.body;

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Request body must contain a non-empty "urls" array.' });
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
  const browser = await chromium.launch({ headless: true });

  try {
    let index = 0;
    for (const url of urls) {
      index++;
      send({ type: 'progress', index, total: urls.length, url });

      try {
        new URL(url); // validate

        const { screenshotPath, absoluteScreenshotPath, title, description, caption } =
          await capturePageInfo(browser, url);
        const { summary, category } =
          await summarize(url, title, caption, description, absoluteScreenshotPath);

        const entry = { url, title, metaDescription: description, summary, category, screenshotPath, archivedAt: now };

        const idx = byUrl.get(url);
        if (idx !== undefined) {
          db[idx] = { ...db[idx], ...entry, updatedAt: now };
        } else {
          byUrl.set(url, db.length);
          db.push({ ...entry, createdAt: now });
        }

        console.log(`[ig-archiver] [${index}/${urls.length}] ${url} → ${category}`);
        send({ type: 'done', url, category, summary, screenshotPath });
      } catch (err) {
        const message = err.message ?? String(err);
        console.error(`[ig-archiver] [${index}/${urls.length}] ${url} — ERROR:`, message);
        send({ type: 'error', url, message });
      }
    }
  } finally {
    // always close the browser and persist whatever was successfully archived,
    // even if the loop exited early due to an unexpected error.
    await browser.close();
    await writeDb(db);
    res.end();
  }
});

// ── start ─────────────────────────────────────────────────────────────────────

async function init() {
  await fs.mkdir(SCREENSHOTS, { recursive: true });

  try {
    await fs.access(SESSION_FILE);
  } catch {
    console.error('[ig-archiver] No session.json found. Run `yarn run login` first.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n[ig-archiver] server running on http://localhost:${PORT}`);
    console.log(`[ig-archiver] Screenshots → ${SCREENSHOTS}\n`);
  });
}

init().catch(err => {
  console.error('[ig-archiver] Startup failed:', err);
  process.exit(1);
});
