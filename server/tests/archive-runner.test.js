import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn(),
  summarize: vi.fn(),
  close: vi.fn(),
}))

vi.mock('playwright', () => ({
  chromium: { launch: vi.fn(async () => ({ close: mocks.close })) },
}))
vi.mock('../lib/capture.js', () => ({ capturePageInfo: mocks.capture }))
vi.mock('../lib/db.js', () => ({ findArchiveByUrl: mocks.find, upsertArchive: mocks.upsert }))
vi.mock('../lib/summarize.js', () => ({ summarize: mocks.summarize }))
vi.mock('../lib/config.js', () => ({
  getConfig: () => ({ concurrency: 2, skipExisting: true, retryAttempts: 3, retryBaseMs: 1 }),
}))
vi.mock('../lib/concurrency.js', () => ({
  runConcurrent: async (items, _limit, worker) => Promise.all(items.map(worker)),
}))

import { runArchiveBatch } from '../lib/archive-runner.js'

describe('runArchiveBatch resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.find.mockResolvedValue(null)
    mocks.capture.mockResolvedValue({
      screenshotPath: 'screenshots/a.png', absoluteScreenshotPath: '/tmp/a.png',
      title: 'Title', description: 'Description', caption: 'Caption',
    })
    mocks.summarize.mockResolvedValue({ summary: 'Summary', category: 'References', keywords: 'test' })
    mocks.upsert.mockResolvedValue(undefined)
    mocks.close.mockResolvedValue(undefined)
  })

  it('retries transient failures with backoff and persists exactly once', async () => {
    mocks.capture
      .mockRejectedValueOnce(new Error('HTTP 429'))
      .mockRejectedValueOnce(new Error('Navigation timed out'))
    const events = []
    await runArchiveBatch({
      urls: ['https://www.instagram.com/p/a/'],
      onEvent: event => events.push(event),
    })
    expect(mocks.capture).toHaveBeenCalledTimes(3)
    expect(mocks.upsert).toHaveBeenCalledOnce()
    expect(events.at(-1)).toMatchObject({ type: 'done' })
  })

  it('does not retry permanent validation failures', async () => {
    const events = []
    await runArchiveBatch({ urls: ['https://evil.example/post'], onEvent: event => events.push(event) })
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('Only HTTPS Instagram') })
  })

  it('skips existing URLs without launching a capture', async () => {
    mocks.find.mockResolvedValue({ category: 'References', summary: 'Existing' })
    const events = []
    await runArchiveBatch({
      urls: ['https://www.instagram.com/p/a/'],
      onEvent: event => events.push(event),
    })
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(events.at(-1)).toMatchObject({ type: 'skipped', summary: 'Existing' })
  })
})
