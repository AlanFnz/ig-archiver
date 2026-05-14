import { describe, expect, it } from 'vitest'

import { runConcurrent } from '../lib/concurrency.js'

describe('runConcurrent', () => {
  it('processes every item exactly once with its original index', async () => {
    const seen = []
    await runConcurrent(['a', 'b', 'c', 'd'], 2, async (item, index) => {
      seen.push([item, index])
    })

    expect(seen.sort((a, b) => a[1] - b[1])).toEqual([
      ['a', 0], ['b', 1], ['c', 2], ['d', 3],
    ])
  })

  it('never exceeds the requested concurrency', async () => {
    let active = 0
    let peak = 0
    const releases = []

    const running = runConcurrent([1, 2, 3, 4, 5], 3, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise(resolve => releases.push(resolve))
      active--
    })

    await Promise.resolve()
    expect(active).toBe(3)
    while (releases.length) {
      releases.shift()()
      await Promise.resolve()
      await Promise.resolve()
    }
    await running
    expect(peak).toBe(3)
  })

  it('uses only as many workers as there are items', async () => {
    let active = 0
    let peak = 0
    await runConcurrent([1, 2], 8, async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
    })
    expect(peak).toBe(2)
  })

  it('validates its arguments', async () => {
    await expect(runConcurrent([], 0, async () => {})).rejects.toThrow('positive integer')
    await expect(runConcurrent(null, 1, async () => {})).rejects.toThrow('array')
  })
})
