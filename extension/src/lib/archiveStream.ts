import type { ArchiveEvent } from '../types';

const SERVER_URL = 'http://localhost:3000';

export async function* archiveStream(
  urls: string[],
  urlMessages: Record<string, string> = {},
): AsyncGenerator<ArchiveEvent> {
  const res = await fetch(`${SERVER_URL}/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, urlMessages }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Server error ${res.status}: ${text}`);
  }

  const reader = res.body!.getReader();
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
