export interface ScrapeResult {
  urls: string[];
  urlMessages: Record<string, string>;
}

export interface Platform {
  scrollOnce(): Promise<boolean>;
  scrapeLinks(): Promise<ScrapeResult>;
}
