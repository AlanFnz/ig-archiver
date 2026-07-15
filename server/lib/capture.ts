import crypto from 'crypto';
import path from 'path';

import { SCREENSHOTS, SESSION_FILE, getConfig } from './config.js';
export { SCREENSHOTS };

function instagramEmbedUrl(url) {
  const parsed = new URL(url);
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/embed/`;
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

/**
 * visit a URL using an existing Playwright browser instance, capture a
 * screenshot, and extract the page title, meta description, and caption.
 * each call opens its own browser context for isolation, then closes it.
 *
 * @param {import('playwright').Browser} browser
 * @returns {{ screenshotPath: string, absoluteScreenshotPath: string, title: string, description: string, caption: string }}
 */
export async function capturePageInfo(browser, url) {
  const config = getConfig();
  const context = await browser.newContext({
    viewport: { width: config.viewportW, height: config.viewportH },
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
    let response;
    try {
      response = await page.goto(url, { waitUntil: 'load', timeout: config.timeoutMs });
    } catch (loadErr) {
      // fall back to domcontentloaded if load itself times out
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
      } catch (fallbackErr) {
        throw new Error(
          `Navigation failed (load: ${loadErr.message}; domcontentloaded: ${fallbackErr.message})`
        );
      }
    }

    let status = response?.status();
    if (status === 429) {
      try {
        response = await page.goto(instagramEmbedUrl(url), {
          waitUntil: 'domcontentloaded',
          timeout: config.timeoutMs,
        });
        status = response?.status();
      } catch (embedErr) {
        throw new Error(`Instagram embed fallback failed after HTTP 429: ${embedErr.message}`);
      }
      if (status === 429) {
        throw new Error(
          'Instagram rate-limited both the page and embed capture (HTTP 429). Wait before retrying and consider reducing capture concurrency.'
        );
      }
    }
    if (status && status >= 400) {
      throw new Error(`Instagram returned HTTP ${status}; the page was not captured.`);
    }

    const currentUrl = page.url();
    if (currentUrl.includes('instagram.com/accounts/login') || currentUrl.includes('/login/')) {
      throw new Error('Instagram session expired or invalid. Please re-authenticate by running `yarn run login`.');
    }

    try {
      await page.waitForFunction(
        () => Boolean(
          document.body?.innerText.trim()
          || document.querySelector('main, article, img, video, [role="main"]')
        ),
        null,
        { timeout: Math.min(config.timeoutMs, 10_000) },
      );
    } catch {
      throw new Error('Instagram returned a blank page; no screenshot was saved.');
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
      clip: { x: 0, y: 0, width: config.viewportW, height: config.viewportH },
    });

    return {
      screenshotPath:         path.relative(path.dirname(SCREENSHOTS), absoluteScreenshotPath),
      absoluteScreenshotPath,
      title:                  title.trim(),
      description:            metaDesc.trim(),
      caption:                caption.trim(),
    };
  } finally {
    await context.close();
  }
}
