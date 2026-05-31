import type { ArchiveEvent } from '../types';
import { getServerUrl } from './config';

export async function* archiveStream(
  urls: string[],
  urlMessages: Record<string, string> = {},
  serverUrl?: string,
): AsyncGenerator<ArchiveEvent> {
  const endpoint = serverUrl || await getServerUrl();
  const res = await fetch(`${endpoint}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, urlMessages }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }

  if (!res.body) throw new Error('Server returned an empty response stream.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          yield JSON.parse(line) as ArchiveEvent;
        } catch {
          // ignore malformed NDJSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
