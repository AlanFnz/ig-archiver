export interface ScrapeResult {
  urls: string[];
}

export interface Platform {
  scrollOnce(): Promise<boolean>;
  scrapeLinks(): Promise<ScrapeResult>;
}
