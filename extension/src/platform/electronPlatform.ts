import type { Platform, ScrapeResult } from './types';

export const electronPlatform: Platform = {
  async isConversationPage(): Promise<boolean> {
    return false;
  },

  async scrollOnce(): Promise<boolean> {
    throw new Error('electronPlatform: not yet implemented');
  },

  async scrapeLinks(): Promise<ScrapeResult> {
    throw new Error('electronPlatform: not yet implemented');
  },
};
