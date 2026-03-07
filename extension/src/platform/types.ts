export interface ScrapeResult {
  urls: string[];
}

export interface Platform {
  scrapeLinks(): Promise<ScrapeResult>;
}
