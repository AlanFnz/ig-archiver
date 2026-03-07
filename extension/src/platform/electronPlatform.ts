import type { Platform, ScrapeResult } from './types';

/**
 * stub for future Electron support.
 * will delegate to ipcRenderer.invoke('scrape-links') when implemented.
 */
export const electronPlatform: Platform = {
  async scrapeLinks(): Promise<ScrapeResult> {
    throw new Error('electronPlatform: not yet implemented');
  },
};
