/**
 * autoScrollOnce — injected into the page via chrome.scripting.executeScript (world: MAIN)
 *
 * serialization constraint: self-contained, no module-level closures
 *
 * scrolls the conversation container to the top, then waits up to 2.5s for
 * instagram to fetch a new batch of messages (detected via edge count increase)
 * returns true if new content was loaded, false if nothing new arrived
 */
export async function autoScrollOnce(): Promise<boolean> {
  function totalEdges(): number {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const threads: Record<string, any> = (window as any).__igSlideThreads ?? {};
    return Object.values(threads).reduce((n: number, t: any) => n + (t?.edges?.length ?? 0), 0);
  }

  // resolve the current thread's fbid — same logic as scrapeExternalLinks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slideThreads: any  = (window as any).__igSlideThreads  ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threadKeyMap: any  = (window as any).__igThreadKeyMap  ?? {};
  const lastFbid: string | null = (window as any).__igLastThreadFbid ?? null;

  const threadMatch = window.location.pathname.match(/\/direct\/t\/(\d+)\//);
  const urlThreadId = threadMatch?.[1] ?? null;

  const fbid: string | null =
    (urlThreadId && threadKeyMap[urlThreadId]) ||
    (urlThreadId && slideThreads[urlThreadId] ? urlThreadId : null) ||
    lastFbid;

  if (!fbid || !slideThreads[fbid]) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stored: any = slideThreads[fbid];
  const pageInfo = stored.pageInfo ?? {};

  console.log('[ig-archiver] autoScrollOnce — pageInfo:', JSON.stringify(pageInfo));

  // has_next_page === false means we've reached the start of the conversation
  if (pageInfo.has_next_page === false) return false;

  const nextCursor: string = pageInfo.end_cursor;

  // prefer the fetch__SlideThread body because it supports cursor pagination
  // stored.bodyStr is often get_slide_thread_nullable (initial load) which
  // ignores the cursor and always returns the same first page
  const bodyStr: string = (window as any).__igFetchBodyStr ?? stored.bodyStr ?? '';
  const headers: Record<string, string> = (window as any).__igFetchHeaders ?? stored.headers ?? {};

  console.log('[ig-archiver] autoScrollOnce — nextCursor:', nextCursor);
  console.log('[ig-archiver] autoScrollOnce — using fetch body:', !!(window as any).__igFetchBodyStr);
  console.log('[ig-archiver] autoScrollOnce — variables:', bodyStr ? new URLSearchParams(bodyStr).get('variables') : 'none');

  if (!nextCursor || !bodyStr) return false;

  // update the cursor in the variables param and replay the XHR
  // the content script intercepts the response automatically
  let newBodyStr: string;
  try {
    const params  = new URLSearchParams(bodyStr);
    const rawVars = params.get('variables');
    if (!rawVars) return false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vars: Record<string, any> = JSON.parse(rawVars);

    // find whichever cursor field the original request used.
    // 'after' is the standard graphql relay pagination field instagram uses.
    const cursorKey = ['after', 'before', 'cursor', 'before_cursor']
      .find(k => k in vars) ?? 'after';
    vars[cursorKey] = nextCursor;
    // remove any stale after_cursor field we may have injected in prior calls
    delete vars['after_cursor'];

    params.set('variables', JSON.stringify(vars));
    newBodyStr = params.toString();
  } catch (_) {
    return false;
  }

  const before = totalEdges();

  await new Promise<void>(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/graphql', true);
    Object.entries(headers).forEach(([k, v]) => {
      try { xhr.setRequestHeader(k, v); } catch (_) {}
    });
    xhr.addEventListener('load',  () => resolve());
    xhr.addEventListener('error', () => resolve());
    xhr.send(newBodyStr);
  });

  // give the content script a moment to process the response
  await new Promise<void>(r => setTimeout(r, 300));
  console.log('[ig-archiver] autoScrollOnce — edges before:', before, '→ after:', totalEdges());
  console.log('[ig-archiver] autoScrollOnce — updated pageInfo:', JSON.stringify(stored.pageInfo));
  return totalEdges() > before;
}

/**
 * scrapeExternalLinks — injected into the page via chrome.scripting.executeScript
 * with world: 'MAIN', sharing window with the content-script.js interceptor
 *
 * serialization constraint: self-contained, no module-level closures,
 * TypeScript annotations are stripped so they're fine at runtime.
 *
 * strategy:
 *  1. find the current thread's data in window.__igSlideThreads (populated by the
 *     content script intercepting instagram's get_slide_thread_nullable graphql calls)
 *     thread_key → thread_fbid lookup is done via window.__igThreadKeyMap
 *  2. extract target_url from SlideMessagePortraitXMA / SlideMessageStandardXMA nodes
 *  3. fall back to DOM collection if no intercepted data is available
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

  // primary path: use content-script interceptor data
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
