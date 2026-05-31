// number of scroll-to-top batches to load before scraping.
// each scroll triggers instagram to fetch an older batch of messages.
// increase for longer conversations; decrease if the popup feels slow.
export const SCROLL_LOADS = 5;

export const DEFAULT_SERVER_URL = 'http://localhost:3000';
const SERVER_URL_KEY = 'serverUrl';

export function normalizeServerUrl(value: string) {
  const parsed = new URL(value.trim());
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Server URL must use HTTP or HTTPS.');
  }
  return parsed.origin + parsed.pathname.replace(/\/$/, '');
}

export async function getServerUrl() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return DEFAULT_SERVER_URL;
  const stored = await chrome.storage.local.get(SERVER_URL_KEY);
  return typeof stored[SERVER_URL_KEY] === 'string'
    ? normalizeServerUrl(stored[SERVER_URL_KEY])
    : DEFAULT_SERVER_URL;
}

export async function saveServerUrl(value: string) {
  const serverUrl = normalizeServerUrl(value);
  const parsed = new URL(serverUrl);
  const isLocal = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (!isLocal && typeof chrome !== 'undefined' && chrome.permissions) {
    const origin = `${parsed.origin}/*`;
    const hasPermission = await chrome.permissions.contains({ origins: [origin] });
    if (!hasPermission) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error('Permission to contact this server was not granted.');
    }
  }
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [SERVER_URL_KEY]: serverUrl });
  }
  return serverUrl;
}
