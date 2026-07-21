export interface ScrapeResult {
  urls: string[];
  urlMessages: Record<string, string>;
}

export interface Platform {
  isConversationPage(): Promise<boolean>;
  scrollOnce(): Promise<boolean>;
  scrapeLinks(): Promise<ScrapeResult>;
}
