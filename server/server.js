// server.js — ig-archiver backend
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import OpenAI from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

// ── config ────────────────────────────────────────────────────────────────────

const __dirname        = path.dirname(fileURLToPath(import.meta.url));
const PORT             = parseInt(process.env.PORT ?? '3000', 10);
const SCREENSHOTS      = path.join(__dirname, 'screenshots');
const DB_PATH          = path.join(__dirname, 'database.json');
const VIEWPORT_W       = parseInt(process.env.SCREENSHOT_WIDTH  ?? '1280', 10);
const VIEWPORT_H       = parseInt(process.env.SCREENSHOT_HEIGHT ?? '720',  10);
const TIMEOUT_MS       = 30_000; // per-page navigation timeout
const SESSION_FILE     = path.join(__dirname, 'session.json');
const VALID_CATEGORIES = ['Work', 'Leisure', 'Inspiration', 'Learning', 'News'];

if (!process.env.OPENAI_API_KEY && process.env.MOCK !== 'true') {
  console.error('[ig-archiver] ERROR: OPENAI_API_KEY is not set. Please create a .env file.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── database helpers ──────────────────────────────────────────────────────────

async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function writeDb(entries) {
  await fs.writeFile(DB_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

// ── screenshot helper ─────────────────────────────────────────────────────────

/**
 * visit a URL using an existing Playwright browser instance, capture a
 * screenshot, and extract the page title, meta description, and caption.
 * each call opens its own browser context for isolation, then closes it.
 *
 * @param {import('playwright').Browser} browser - shared browser instance
 * @returns {{ screenshotPath: string, absoluteScreenshotPath: string, title: string, description: string, caption: string }}
 */
async function capturePageInfo(browser, url) {
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36',
    storageState: SESSION_FILE,
  });

  const page = await context.newPage();

  try {
    // instagram keeps persistent connections so networkidle never fires;
    // 'load' waits for the window load event which is sufficient for screenshots.
    try {
      await page.goto(url, { waitUntil: 'load', timeout: TIMEOUT_MS });
    } catch (loadErr) {
      // fall back to domcontentloaded if load itself times out
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
      } catch (fallbackErr) {
        throw new Error(
          `Navigation failed (load: ${loadErr.message}; domcontentloaded: ${fallbackErr.message})`
        );
      }
    }

    // extract metadata
    const title = await page.title().catch(() => '');
    const metaDesc = await page
      .$eval('meta[name="description"]', el => el.getAttribute('content') ?? '')
      .catch(() => '');

    // extract visible caption text — tries selectors from most to least specific
    const caption = await page.evaluate(() => {
      const selectors = ['article h1', 'main h1', 'h1'];
      for (const sel of selectors) {
        const text = document.querySelector(sel)?.textContent?.trim();
        if (text) return text;
      }
      return '';
    }).catch(() => '');

    // generate a stable filename from the URL
    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
    const absoluteScreenshotPath = path.join(SCREENSHOTS, `${hash}.png`);

    await page.screenshot({
      path: absoluteScreenshotPath,
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
    });

    return {
      screenshotPath:         path.relative(__dirname, absoluteScreenshotPath),
      absoluteScreenshotPath,
      title:                  title.trim(),
      description:            metaDesc.trim(),
      caption:                caption.trim(),
    };
  } finally {
    await context.close();
  }
}

// ── openAI summarization ──────────────────────────────────────────────────────

/**
 * send page content to GPT-4o vision and get back a structured summary.
 * uses the screenshot image + caption + title for richer context.
 *
 * @returns {{ summary: string, category: string }}
 */
async function summarize(url, title, caption, description, absoluteScreenshotPath) {
  if (process.env.MOCK === 'true') {
    return { summary: `mock summary for ${new URL(url).hostname}`, category: 'Leisure' };
  }

  const imageData = await fs.readFile(absoluteScreenshotPath);
  const base64 = imageData.toString('base64');

  const prompt = `You are a personal web archiver assistant. Analyze the screenshot and metadata below, then return a JSON object with exactly two fields:
- "summary": a single concise sentence (max 30 words) describing what the page is about.
- "category": exactly one of these categories: ${VALID_CATEGORIES.join(', ')}.

URL: ${url}
Page Title: ${title || '(not available)'}
Caption: ${caption || description || '(not available)'}

Respond with only the raw JSON object, no markdown fences.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' } },
        { type: 'text', text: prompt },
      ],
    }],
    max_tokens: 120,
    temperature: 0.3,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? '{}';

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // try to extract JSON if the model wrapped it in a code block
    const match = raw.match(/\{[\s\S]*\}/);
    parsed = match ? JSON.parse(match[0]) : {};
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : 'No summary available.';

  if (!VALID_CATEGORIES.includes(parsed.category)) {
    console.warn(`[ig-archiver] Unexpected category "${parsed.category}" from model, defaulting to Leisure`);
  }
  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'Leisure';

  return { summary, category };
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

  // stream NDJSON back to the client
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
        // validate URL before processing
        new URL(url);

        const { screenshotPath, absoluteScreenshotPath, title, description, caption } = await capturePageInfo(browser, url);
        const { summary, category } = await summarize(url, title, caption, description, absoluteScreenshotPath);

        const entry = {
          url,
          title,
          metaDescription: description,
          summary,
          category,
          screenshotPath,
          archivedAt: now,
        };

        // upsert into the in-memory DB array
        const idx = byUrl.get(url);
        if (idx !== undefined) {
          db[idx] = { ...db[idx], ...entry, updatedAt: now };
        } else {
          byUrl.set(url, db.length);
          db.push({ ...entry, createdAt: now });
        }

        const logPrefix = `[ig-archiver] [${index}/${urls.length}] ${url}`;
        console.log(`${logPrefix} → ${category}`);
        send({ type: 'done', url, category, summary, screenshotPath });
      } catch (err) {
        const message = err.message ?? String(err);
        const logPrefix = `[ig-archiver] [${index}/${urls.length}] ${url}`;
        console.error(`${logPrefix} — ERROR:`, message);
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
    console.error('[ig-archiver] No session.json found. Run `npm run login` first.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    console.log(`\n[ig-archiver] Web Archiver server running on http://localhost:${PORT}`);
    console.log(`[ig-archiver] Screenshots → ${SCREENSHOTS}`);
    console.log(`[ig-archiver] Database    → ${DB_PATH}\n`);
  });
}

init().catch(err => {
  console.error('[ig-archiver] Startup failed:', err);
  process.exit(1);
});
