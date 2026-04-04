import type { Platform, ScrapeResult } from './types';
import { autoScrollOnce, scrapeExternalLinks } from '../lib/scraper';

export const chromePlatform: Platform = {
  async scrollOnce(): Promise<boolean> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: autoScrollOnce,
      world: 'MAIN',
    });

    return results?.[0]?.result ?? false;
  },

  async scrapeLinks(): Promise<ScrapeResult> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab found.');

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeExternalLinks,
      world: 'MAIN',
    });

    const raw = results?.[0]?.result ?? [];
    const urls = raw.map((r: { url: string }) => r.url);
    const urlMessages: Record<string, string> = {};
    for (const { url, message } of raw) {
      if (message) urlMessages[url] = message;
    }
    return { urls, urlMessages };
  },
};
