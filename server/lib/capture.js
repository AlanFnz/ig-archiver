import crypto from 'crypto';
import path from 'path';

import { SCREENSHOTS, SESSION_FILE, VIEWPORT_W, VIEWPORT_H, TIMEOUT_MS } from './config.js';
export { SCREENSHOTS };

/**
 * visit a URL using an existing Playwright browser instance, capture a
 * screenshot, and extract the page title, meta description, and caption.
 * each call opens its own browser context for isolation, then closes it.
 *
 * @param {import('playwright').Browser} browser
 * @returns {{ screenshotPath: string, absoluteScreenshotPath: string, title: string, description: string, caption: string }}
 */
export async function capturePageInfo(browser, url) {
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

    const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
    const absoluteScreenshotPath = path.join(SCREENSHOTS, `${hash}.png`);

    await page.screenshot({
      path: absoluteScreenshotPath,
      type: 'png',
      clip: { x: 0, y: 0, width: VIEWPORT_W, height: VIEWPORT_H },
    });

    return {
      screenshotPath:         path.relative(path.join(__dirname, '..'), absoluteScreenshotPath),
      absoluteScreenshotPath,
      title:                  title.trim(),
      description:            metaDesc.trim(),
      caption:                caption.trim(),
    };
  } finally {
    await context.close();
  }
}
