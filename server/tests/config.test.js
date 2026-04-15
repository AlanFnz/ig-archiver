import { vi, describe, it, expect, beforeEach } from 'vitest'

describe('config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('defaults PORT to 3000', async () => {
    const { PORT } = await import('../lib/config.js')
    expect(PORT).toBe(3000)
  })

  it('reads PORT from the environment', async () => {
    vi.stubEnv('PORT', '8080')
    const { PORT } = await import('../lib/config.js')
    expect(PORT).toBe(8080)
  })

  it('defaults VIEWPORT_W to 1280', async () => {
    const { VIEWPORT_W } = await import('../lib/config.js')
    expect(VIEWPORT_W).toBe(1280)
  })

  it('defaults VIEWPORT_H to 720', async () => {
    const { VIEWPORT_H } = await import('../lib/config.js')
    expect(VIEWPORT_H).toBe(720)
  })

  it('reads SCREENSHOT_WIDTH from the environment', async () => {
    vi.stubEnv('SCREENSHOT_WIDTH', '1920')
    const { VIEWPORT_W } = await import('../lib/config.js')
    expect(VIEWPORT_W).toBe(1920)
  })

  it('reads SCREENSHOT_HEIGHT from the environment', async () => {
    vi.stubEnv('SCREENSHOT_HEIGHT', '1080')
    const { VIEWPORT_H } = await import('../lib/config.js')
    expect(VIEWPORT_H).toBe(1080)
  })

  it('sets TIMEOUT_MS to 30 000', async () => {
    const { TIMEOUT_MS } = await import('../lib/config.js')
    expect(TIMEOUT_MS).toBe(30_000)
  })

  it('exports a non-empty VALID_CATEGORIES array', async () => {
    const { VALID_CATEGORIES } = await import('../lib/config.js')
    expect(Array.isArray(VALID_CATEGORIES)).toBe(true)
    expect(VALID_CATEGORIES.length).toBeGreaterThan(0)
  })

  it('VALID_CATEGORIES contains the expected values', async () => {
    const { VALID_CATEGORIES } = await import('../lib/config.js')
    for (const cat of ['Memes', 'Music', 'Design', 'Tutorials', 'Inspiration']) {
      expect(VALID_CATEGORIES).toContain(cat)
    }
  })
})
