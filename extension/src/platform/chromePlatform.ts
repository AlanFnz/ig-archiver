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

    const urls = results?.[0]?.result ?? [];
    return { urls };
  },
};
