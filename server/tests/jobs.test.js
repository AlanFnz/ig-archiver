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
      onEvent({ type: 'progress', index: index + 1, total: urls.length, url: urls[index] })
      onEvent({ type: 'done', url: urls[index], category: 'Test', summary: 'Done' })
      if (index === 0) await firstBarrier
    }
  })
  return { runner, releaseFirst }
}

describe('archive jobs', () => {
  it('records progress and completes independently of a client', async () => {
    const runner = vi.fn(async ({ urls, onEvent }) => {
      onEvent({ type: 'done', url: urls[0], category: 'Test', summary: 'Done' })
    })
    const manager = createJobManager({ runner })
    const job = manager.create({ urls: ['https://www.instagram.com/p/a/'], urlMessages: {} })

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
    const manager = createJobManager({ runner })
    const job = manager.create({ urls: ['a', 'b', 'c'], urlMessages: {} })

    await waitFor(() => job.processed === 1)
    job.pause()
    releaseFirst()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(job.serialize()).toMatchObject({ status: 'paused', processed: 1 })

    job.resume()
    await job.runPromise
    expect(job.serialize()).toMatchObject({ status: 'completed', processed: 3 })
  })

  it('cancels remaining work while preserving completed results', async () => {
    const { runner, releaseFirst } = createControlledRunner()
    const manager = createJobManager({ runner })
    const job = manager.create({ urls: ['a', 'b', 'c'], urlMessages: {} })

    await waitFor(() => job.processed === 1)
    job.cancel()
    releaseFirst()
    await job.runPromise

    expect(job.serialize()).toMatchObject({ status: 'cancelled', processed: 1, succeeded: 1 })
  })

  it('prevents two active jobs from mutating the archive concurrently', async () => {
    const { runner, releaseFirst } = createControlledRunner()
    const manager = createJobManager({ runner })
    const first = manager.create({ urls: ['a'], urlMessages: {} })

    expect(() => manager.create({ urls: ['b'], urlMessages: {} })).toThrow('already active')
    releaseFirst()
    await first.runPromise
    expect(() => manager.create({ urls: ['b'], urlMessages: {} })).not.toThrow()
  })

  it('returns only events after the requested sequence', async () => {
    const runner = vi.fn(async ({ onEvent }) => {
      onEvent({ type: 'done', url: 'a' })
      onEvent({ type: 'skipped', url: 'b' })
    })
    const manager = createJobManager({ runner })
    const job = manager.create({ urls: ['a', 'b'], urlMessages: {} })
    await job.runPromise

    expect(job.serialize({ after: 1 }).events).toHaveLength(1)
    expect(job.serialize({ after: 1 }).events[0]).toMatchObject({ sequence: 2, type: 'skipped' })
  })
})
