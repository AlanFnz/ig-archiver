import { chromium } from 'playwright';

import { capturePageInfo } from './capture.js';
import { getConfig } from './config.js';
import { findArchiveByUrl, upsertArchive } from './db.js';
import { runConcurrent } from './concurrency.js';
import { logger } from './logger.js';
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

function isRetryable(error) {
  const message = (error?.message || String(error)).toLocaleLowerCase();
  return ['429', 'timeout', 'timed out', 'navigation failed', 'blank page', 'econnreset', 'socket hang up']
    .some(fragment => message.includes(fragment));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function runArchiveBatch({
  urls,
  urlMessages = {},
  onEvent = () => {},
  control = DEFAULT_CONTROL,
}) {
  const config = getConfig();
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    await runConcurrent(urls, config.concurrency, async (url, itemIndex) => {
      await control.waitUntilRunnable();
      if (control.isCancelled()) return;

      const displayIndex = itemIndex + 1;
      await onEvent({ type: 'progress', index: displayIndex, total: urls.length, url });

      try {
        validateInstagramUrl(url);

        const existing = await findArchiveByUrl(url);
        if (config.skipExisting && existing) {
          await onEvent({
            type: 'skipped',
            url,
            category: existing.category || 'Uncategorized',
            summary: existing.summary || '',
          });
          return;
        }

        let captured;
        let lastError;
        for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
          try {
            captured = await capturePageInfo(browser, url);
            break;
          } catch (err) {
            lastError = err;
            if (attempt === config.retryAttempts || !isRetryable(err) || control.isCancelled()) throw err;
            const delayMs = config.retryBaseMs * (2 ** (attempt - 1));
            logger.warn('capture.retry', 'Retrying transient Instagram capture failure.', {
              url,
              attempt,
              nextAttempt: attempt + 1,
              delayMs,
              error: err.message ?? String(err),
            });
            await wait(delayMs);
          }
        }
        if (!captured) throw lastError || new Error('Capture failed without an error.');

        const { screenshotPath, absoluteScreenshotPath, title, description, caption } = captured;
        const userMessage = urlMessages[url] || undefined;
        const { summary, category, keywords, aiConfidence, aiConfidenceReason } =
          await summarize(url, title, caption, description, absoluteScreenshotPath, userMessage);

        const now = new Date().toISOString();

        const entry = {
          url,
          title,
          metaDescription: description,
          userMessage,
          summary,
          category,
          keywords,
          aiConfidence,
          aiConfidenceReason,
          screenshotPath,
          archivedAt: now,
        };

        await upsertArchive({
          ...entry,
          createdAt: existing?.createdAt || now,
          updatedAt: existing ? now : undefined,
        });

        logger.info('capture.completed', 'Archived Instagram URL.', {
          url,
          category,
          index: displayIndex,
          total: urls.length,
        });
        await onEvent({ type: 'done', url, category, summary, screenshotPath });
      } catch (err) {
        const message = err.message ?? String(err);
        logger.error('capture.failed', 'Failed to archive Instagram URL.', {
          url,
          index: displayIndex,
          total: urls.length,
          error: message,
        });
        await onEvent({ type: 'error', url, message });
      }
    });
  } finally {
    if (browser) {
      await browser.close().catch(err => console.warn(`[ig-archiver] Browser close failed: ${err.message}`));
    }
  }
}
