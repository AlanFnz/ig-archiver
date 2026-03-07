/**
 * scrapeExternalLinks — injected into the page via chrome.scripting.executeScript
 * with world: 'MAIN', sharing window with the content-script.js interceptor.
 *
 * serialization constraint: self-contained, no module-level closures,
 * TypeScript annotations are stripped so they're fine at runtime.
 *
 * strategy:
 *  1. find the current thread's data in window.__igSlideThreads (populated by the
 *     content script intercepting instagram's get_slide_thread_nullable graphql calls).
 *     thread_key → thread_fbid lookup is done via window.__igThreadKeyMap.
 *  2. extract target_url from SlideMessagePortraitXMA / SlideMessageStandardXMA nodes.
 *  3. fall back to DOM collection if no intercepted data is available.
 */
export async function scrapeExternalLinks(): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];

  function addUrl(rawUrl: string): void {
    try {
      const clean = new URL(rawUrl);
      const path = clean.origin + clean.pathname;
      if (!seen.has(path)) {
        seen.add(path);
        urls.push(path);
      }
    } catch {
      // skip malformed URLs
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function extractUrlsFromEdges(edges: any[]): void {
    for (const edge of edges) {
      const xma = edge?.node?.content?.xma;
      if (!xma?.target_url) continue;
      const url: string = xma.target_url;
      if (url.includes('instagram.com/p/') || url.includes('instagram.com/reel/')) {
        addUrl(url);
      }
    }
  }

  // --- primary path: use content-script interceptor data ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slideThreads: any = (window as any).__igSlideThreads ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadKeyMap: any = (window as any).__igThreadKeyMap ?? {};
  const lastFbid: string | null = (window as any).__igLastThreadFbid ?? null;

  const threadMatch = window.location.pathname.match(/\/direct\/t\/(\d+)\//);
  const urlThreadId = threadMatch?.[1] ?? null;

  const fbid: string | null =
    (urlThreadId && threadKeyMap[urlThreadId]) ||
    (urlThreadId && slideThreads[urlThreadId] ? urlThreadId : null) ||
    lastFbid;

  if (fbid && slideThreads[fbid]) {
    extractUrlsFromEdges(slideThreads[fbid].edges);
    if (urls.length > 0) return urls;
  }

  // --- fallback: DOM collection for currently visible items ---
  function mediaIdToShortcode(mediaId: string): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let id = BigInt(mediaId);
    let shortcode = '';
    while (id > 0n) {
      shortcode = alphabet[Number(id % 64n)] + shortcode;
      id = id / 64n;
    }
    return shortcode;
  }

  document.querySelectorAll<HTMLElement>('div[role="button"]').forEach(btn => {
    const img = btn.querySelector<HTMLImageElement>('img[src*="ig_cache_key"]');
    if (!img) return;
    try {
      const cacheKey = new URL(img.src).searchParams.get('ig_cache_key');
      if (!cacheKey) return;
      const base64Part = decodeURIComponent(cacheKey).split('.')[0];
      const mediaId = atob(base64Part).split('_')[0];
      const shortcode = mediaIdToShortcode(mediaId);
      const isReel = !!btn.querySelector('svg[aria-label="Clip"]');
      const url = `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${shortcode}/`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    } catch {
      // skip if URL parsing or base64 decode fails
    }
  });

  return urls;
}
