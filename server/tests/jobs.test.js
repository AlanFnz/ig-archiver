import { describe, expect, it, vi } from 'vitest'

import { createJobManager } from '../lib/jobs.js'

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('Timed out waiting for job state')
}

function createControlledRunner() {
  let releaseFirst
  const firstBarrier = new Promise(resolve => { releaseFirst = resolve })
  const runner = vi.fn(async ({ urls, onEvent, control }) => {
    for (let index = 0; index < urls.length; index++) {
      await control.waitUntilRunnable()
      if (control.isCancelled()) return
      await onEvent({ type: 'progress', index: index + 1, total: urls.length, url: urls[index] })
      await onEvent({ type: 'done', url: urls[index], category: 'Test', summary: 'Done' })
      if (index === 0) await firstBarrier
    }
  })
  return { runner, releaseFirst }
}

function createStore(restored = []) {
  const snapshots = new Map(restored.map(job => [job.id, job]))
  return {
    snapshots,
    listStoredJobs: vi.fn(async () => [...snapshots.values()]),
    saveStoredJob: vi.fn(async job => snapshots.set(job.id, structuredClone(job))),
  }
}

describe('archive jobs', () => {
  it('records progress and completes independently of a client', async () => {
    const runner = vi.fn(async ({ urls, onEvent }) => {
      onEvent({ type: 'done', url: urls[0], category: 'Test', summary: 'Done' })
    })
    const manager = createJobManager({ runner, store: createStore() })
    const job = await manager.create({ urls: ['https://www.instagram.com/p/a/'], urlMessages: {} })

    await job.runPromise
    expect(job.serialize()).toMatchObject({
      status: 'completed',
      total: 1,
      processed: 1,
      succeeded: 1,
    })
  })

  it('pauses before assigning more work and resumes later', async () => {
    const { runner, releaseFirst } = createControlledRunner()
    const manager = createJobManager({ runner, store: createStore() })
    const job = await manager.create({ urls: ['a', 'b', 'c'], urlMessages: {} })

    await waitFor(() => job.processed === 1)
    await job.pause()
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(job.serialize()).toMatchObject({ status: 'paused', processed: 1 })

    await job.resume()
    await job.runPromise
    expect(job.serialize()).toMatchObject({ status: 'completed', processed: 3 })
  })

  it('cancels remaining work while preserving completed results', async () => {
    const { runner, releaseFirst } = createControlledRunner()
    const manager = createJobManager({ runner, store: createStore() })
    const job = await manager.create({ urls: ['a', 'b', 'c'], urlMessages: {} })

    await waitFor(() => job.processed === 1)
    await job.cancel()
    releaseFirst()
    await job.runPromise

    expect(job.serialize()).toMatchObject({ status: 'cancelled', processed: 1, succeeded: 1 })
  })

  it('prevents two active jobs from mutating the archive concurrently', async () => {
    const { runner, releaseFirst } = createControlledRunner()
    const manager = createJobManager({ runner, store: createStore() })
    const first = await manager.create({ urls: ['a'], urlMessages: {} })

    await expect(manager.create({ urls: ['b'], urlMessages: {} })).rejects.toThrow('already active')
    releaseFirst()
    await first.runPromise
    await expect(manager.create({ urls: ['b'], urlMessages: {} })).resolves.toBeTruthy()
  })

  it('returns only events after the requested sequence', async () => {
    const runner = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'done', url: 'a' })
      onEvent({ type: 'skipped', url: 'b' })
    })
    const manager = createJobManager({ runner, store: createStore() })
    const job = await manager.create({ urls: ['a', 'b'], urlMessages: {} })
    await job.runPromise

    expect(job.serialize({ after: 1 }).events).toHaveLength(1)
    expect(job.serialize({ after: 1 }).events[0]).toMatchObject({ sequence: 2, type: 'skipped' })
  })

  it('recovers an interrupted job and only runs unfinished URLs', async () => {
    const restored = {
      id: 'restored', status: 'running', urls: ['a', 'b'], urlMessages: {}, total: 2,
      processed: 1, succeeded: 1, failed: 0, skipped: 0, sequence: 1, error: null,
      createdAt: '2026-07-14T10:00:00.000Z', updatedAt: '2026-07-14T10:01:00.000Z', finishedAt: null,
      events: [{ type: 'done', url: 'a', sequence: 1, at: '2026-07-14T10:01:00.000Z' }],
    }
    const store = createStore([restored])
    const runner = vi.fn(async ({ urls, onEvent }) => {
      expect(urls).toEqual(['b'])
      await onEvent({ type: 'done', url: 'b' })
    })
    const manager = createJobManager({ runner, store })
    await manager.init()
    const job = manager.get('restored')
    await job.runPromise
    expect(job.serialize()).toMatchObject({ status: 'completed', processed: 2, succeeded: 2 })
  })

  it('keeps restored paused jobs paused until explicitly resumed', async () => {
    const restored = {
      id: 'paused', status: 'paused', urls: ['a'], urlMessages: {}, total: 1,
      processed: 0, succeeded: 0, failed: 0, skipped: 0, sequence: 0, error: null,
      createdAt: '2026-07-14T10:00:00.000Z', updatedAt: '2026-07-14T10:01:00.000Z', finishedAt: null, events: [],
    }
    const runner = vi.fn(async ({ onEvent }) => onEvent({ type: 'done', url: 'a' }))
    const manager = createJobManager({ runner, store: createStore([restored]) })
    await manager.init()
    const job = manager.get('paused')
    expect(runner).not.toHaveBeenCalled()
    await job.resume()
    await job.runPromise
    expect(job.serialize()).toMatchObject({ status: 'completed', processed: 1 })
  })
})
