import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
}))

describe('config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
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

  it('defaults CONCURRENCY to 3', async () => {
    const { CONCURRENCY } = await import('../lib/config.js')
    expect(CONCURRENCY).toBe(3)
  })

  it('skips previously archived URLs by default', async () => {
    const { getConfig } = await import('../lib/config.js')
    expect(getConfig().skipExisting).toBe(true)
  })

  it('reads CONCURRENCY from the environment', async () => {
    vi.stubEnv('CONCURRENCY', '5')
    const { CONCURRENCY } = await import('../lib/config.js')
    expect(CONCURRENCY).toBe(5)
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

  it('persists and returns validated user configuration', async () => {
    const { setConfig, getConfig } = await import('../lib/config.js')
    setConfig({ concurrency: 5, categories: ['Research', 'Ideas'] })

    expect(getConfig()).toMatchObject({ concurrency: 5, categories: ['Research', 'Ideas'] })
    expect(mockWriteFileSync).toHaveBeenCalledOnce()
  })

  it.each([
    [{ concurrency: 0 }, 'concurrency'],
    [{ timeoutMs: 100 }, 'timeoutMs'],
    [{ viewportW: -1 }, 'viewportW'],
    [{ skipExisting: 'yes' }, 'skipExisting'],
    [{ categories: [] }, 'categories'],
    [{ categories: ['Ideas', 'ideas'] }, 'unique'],
    [{ openaiBaseUrl: 'file:///tmp/api' }, 'HTTP'],
    [{ unknown: true }, 'Unknown'],
  ])('rejects invalid configuration %#', async (patch, message) => {
    const { setConfig } = await import('../lib/config.js')
    expect(() => setConfig(patch)).toThrow(message)
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })

  it('never exposes the API key through public configuration', async () => {
    const { setConfig, getPublicConfig } = await import('../lib/config.js')
    setConfig({ openaiApiKey: 'sk-secret' })

    expect(getPublicConfig()).toMatchObject({ hasOpenaiApiKey: true })
    expect(getPublicConfig()).not.toHaveProperty('openaiApiKey')
  })

  it('does not change runtime configuration when persistence fails', async () => {
    mockWriteFileSync.mockImplementationOnce(() => { throw new Error('disk full') })
    const { setConfig, getConfig } = await import('../lib/config.js')

    expect(() => setConfig({ concurrency: 6 })).toThrow('disk full')
    expect(getConfig().concurrency).toBe(3)
  })

  it('falls back to safe defaults for out-of-range environment values', async () => {
    vi.stubEnv('CONCURRENCY', '0')
    vi.stubEnv('SCREENSHOT_WIDTH', '99999')
    const { CONCURRENCY, VIEWPORT_W } = await import('../lib/config.js')

    expect(CONCURRENCY).toBe(3)
    expect(VIEWPORT_W).toBe(1280)
  })

  it('loads stored configuration over defaults', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ concurrency: 4, categories: ['Saved'] }))
    const { getConfig } = await import('../lib/config.js')

    expect(getConfig()).toMatchObject({ concurrency: 4, categories: ['Saved'] })
  })
})
