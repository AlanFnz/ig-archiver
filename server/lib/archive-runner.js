import { chromium } from 'playwright';

import { capturePageInfo } from './capture.js';
import { getConfig } from './config.js';
import { readDb, writeDb } from './db.js';
import { runConcurrent } from './concurrency.js';
import { summarize } from './summarize.js';

const DEFAULT_CONTROL = {
  isCancelled: () => false,
  waitUntilRunnable: async () => {},
};

function validateInstagramUrl(url) {
  const parsedUrl = new URL(url);
  const validHost = parsedUrl.hostname === 'instagram.com' || parsedUrl.hostname === 'www.instagram.com';
  const validPath = /^\/(?:p|reel)\//.test(parsedUrl.pathname);
  if (parsedUrl.protocol !== 'https:' || !validHost || !validPath) {
    throw new Error('Only HTTPS Instagram post and reel URLs can be archived.');
  }
}

export async function runArchiveBatch({
  urls,
  urlMessages = {},
  onEvent = () => {},
  control = DEFAULT_CONTROL,
}) {
  const db = await readDb();
  const byUrl = new Map(db.map((entry, index) => [entry.url, index]));
  const now = new Date().toISOString();
  const config = getConfig();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    await runConcurrent(urls, config.concurrency, async (url, itemIndex) => {
      await control.waitUntilRunnable();
      if (control.isCancelled()) return;

      const displayIndex = itemIndex + 1;
      onEvent({ type: 'progress', index: displayIndex, total: urls.length, url });

      try {
        validateInstagramUrl(url);

        const existingIndex = byUrl.get(url);
        if (config.skipExisting && existingIndex !== undefined) {
          const existing = db[existingIndex];
          onEvent({
            type: 'skipped',
            url,
            category: existing.category || 'Uncategorized',
            summary: existing.summary || '',
          });
          return;
        }

        const { screenshotPath, absoluteScreenshotPath, title, description, caption } =
          await capturePageInfo(browser, url);
        const userMessage = urlMessages[url] || undefined;
        const { summary, category, keywords } =
          await summarize(url, title, caption, description, absoluteScreenshotPath, userMessage);

        const entry = {
          url,
          title,
          metaDescription: description,
          userMessage,
          summary,
          category,
          keywords,
          screenshotPath,
          archivedAt: now,
        };

        const existingIndexAfterCapture = byUrl.get(url);
        if (existingIndexAfterCapture !== undefined) {
          db[existingIndexAfterCapture] = { ...db[existingIndexAfterCapture], ...entry, updatedAt: now };
        } else {
          byUrl.set(url, db.length);
          db.push({ ...entry, createdAt: now });
        }

        console.log(`[ig-archiver] [${displayIndex}/${urls.length}] ${url} → ${category}`);
        onEvent({ type: 'done', url, category, summary, screenshotPath });
      } catch (err) {
        const message = err.message ?? String(err);
        console.error(`[ig-archiver] [${displayIndex}/${urls.length}] ${url} — ERROR:`, message);
        onEvent({ type: 'error', url, message });
      }
    });
  } finally {
    if (browser) {
      await browser.close().catch(err => console.warn(`[ig-archiver] Browser close failed: ${err.message}`));
    }
    await writeDb(db);
  }
}
