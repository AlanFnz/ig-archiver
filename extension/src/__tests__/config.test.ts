import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SERVER_URL,
  getServerUrl,
  normalizeServerUrl,
  saveServerUrl,
} from '../lib/config';

describe('extension config', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes trailing slashes and paths', () => {
    expect(normalizeServerUrl(' https://archive.example.test/api/ '))
      .toBe('https://archive.example.test/api');
  });

  it('rejects non-HTTP server URLs', () => {
    expect(() => normalizeServerUrl('file:///tmp/server')).toThrow('HTTP or HTTPS');
  });

  it('uses localhost when extension storage is unavailable', async () => {
    expect(await getServerUrl()).toBe(DEFAULT_SERVER_URL);
  });

  it('loads the saved URL from Chrome storage', async () => {
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn().mockResolvedValue({ serverUrl: 'https://example.test/' }) } },
    });
    expect(await getServerUrl()).toBe('https://example.test');
  });

  it('requests optional host access before saving a remote server', async () => {
    const request = vi.fn().mockResolvedValue(true);
    const set = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        request,
      },
      storage: { local: { set } },
    });

    await saveServerUrl('https://archive.example.test');
    expect(request).toHaveBeenCalledWith({ origins: ['https://archive.example.test/*'] });
    expect(set).toHaveBeenCalledWith({ serverUrl: 'https://archive.example.test' });
  });

  it('does not request extra permission for localhost', async () => {
    const request = vi.fn();
    vi.stubGlobal('chrome', {
      permissions: { contains: vi.fn(), request },
      storage: { local: { set: vi.fn().mockResolvedValue(undefined) } },
    });

    await saveServerUrl(DEFAULT_SERVER_URL);
    expect(request).not.toHaveBeenCalled();
  });
});
