import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearActiveArchiveJob,
  controlArchiveJob,
  createArchiveJob,
  getActiveArchiveJob,
  getArchiveJob,
  isTerminalJob,
  saveActiveArchiveJob,
} from '../lib/archiveJobs';

const job = {
  id: 'job-1',
  status: 'running',
  total: 2,
  processed: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  error: null,
  events: [],
};

describe('archive job client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a persistent job with URLs and messages', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => job });
    vi.stubGlobal('fetch', fetchMock);

    await createArchiveJob('http://localhost:3000', ['url'], { url: 'note' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/jobs',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ urls: ['url'], urlMessages: { url: 'note' } }) }),
    );
  });

  it('gets and controls an existing job', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => job });
    vi.stubGlobal('fetch', fetchMock);

    await getArchiveJob('http://localhost:3000', 'job-1');
    await controlArchiveJob('http://localhost:3000', 'job-1', 'pause');
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/jobs/job-1');
    expect(fetchMock.mock.calls[1]).toEqual([
      'http://localhost:3000/api/jobs/job-1/pause',
      { method: 'POST' },
    ]);
  });

  it('exposes an active job returned with a conflict response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Already active', job }),
    }));

    await expect(createArchiveJob('http://localhost:3000', ['url'], {}))
      .rejects.toMatchObject({ message: 'Already active', status: 409, job });
  });

  it('identifies terminal states', () => {
    expect(isTerminalJob('completed')).toBe(true);
    expect(isTerminalJob('cancelled')).toBe(true);
    expect(isTerminalJob('failed')).toBe(true);
    expect(isTerminalJob('paused')).toBe(false);
  });

  it('persists and clears the active job in Chrome storage', async () => {
    let stored: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          set: vi.fn(async value => { stored = { ...stored, ...value }; }),
          get: vi.fn(async key => ({ [key]: stored[key] })),
          remove: vi.fn(async key => { delete stored[key]; }),
        },
      },
    });

    await saveActiveArchiveJob({ id: 'job-1', serverUrl: 'http://localhost:3000' });
    expect(await getActiveArchiveJob()).toEqual({ id: 'job-1', serverUrl: 'http://localhost:3000' });
    await clearActiveArchiveJob('job-1');
    expect(await getActiveArchiveJob()).toBeNull();
  });
});
