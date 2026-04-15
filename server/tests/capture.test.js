import { vi, describe, it, expect, beforeEach } from 'vitest'
import crypto from 'crypto'

vi.mock('../lib/config.js', () => ({
  SCREENSHOTS: '/fake/screenshots',
  SESSION_FILE: '/fake/session.json',
  VIEWPORT_W: 1280,
  VIEWPORT_H: 720,
  TIMEOUT_MS: 30_000,
}))

import { capturePageInfo } from '../lib/capture.js'

function makeMockBrowser({
  failFirstGoto = false,
  failBothGotos = false,
  title = 'Page Title',
  metaDesc = 'Meta description',
  caption = 'Caption text',
} = {}) {
  let gotoCount = 0
  const page = {
    goto: vi.fn(async (_url, { waitUntil } = {}) => {
      gotoCount++
      if (failBothGotos) throw new Error(`${waitUntil} failed`)
      if (failFirstGoto && waitUntil === 'load') throw new Error('load timed out')
    }),
    title: vi.fn().mockResolvedValue(title),
    $eval: vi.fn().mockResolvedValue(metaDesc),
    evaluate: vi.fn().mockResolvedValue(caption),
    screenshot: vi.fn().mockResolvedValue(undefined),
  }
  const context = {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  }
  const browser = { newContext: vi.fn().mockResolvedValue(context) }
  return { browser, context, page }
}

describe('capturePageInfo', () => {
  const url = 'https://www.instagram.com/p/TestPost123/'

  it('returns title, description, and caption from the page', async () => {
    const { browser } = makeMockBrowser({
      title: 'My Post',
      metaDesc: 'A great post',
      caption: 'The caption',
    })
    const result = await capturePageInfo(browser, url)
    expect(result.title).toBe('My Post')
    expect(result.description).toBe('A great post')
    expect(result.caption).toBe('The caption')
  })

  it('uses a 12-character SHA1 hash of the URL as the screenshot filename', async () => {
    const { browser, page } = makeMockBrowser()
    await capturePageInfo(browser, url)

    const expectedHash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: `/fake/screenshots/${expectedHash}.png` }),
    )
  })

  it('falls back to domcontentloaded when the load event times out', async () => {
    const { browser, page } = makeMockBrowser({ failFirstGoto: true })
    await capturePageInfo(browser, url)

    expect(page.goto).toHaveBeenCalledTimes(2)
    expect(page.goto).toHaveBeenNthCalledWith(2, url, expect.objectContaining({ waitUntil: 'domcontentloaded' }))
  })

  it('throws a combined error message when both navigation strategies fail', async () => {
    const { browser } = makeMockBrowser({ failBothGotos: true })
    await expect(capturePageInfo(browser, url)).rejects.toThrow('Navigation failed')
  })

  it('closes the browser context even when an error is thrown', async () => {
    const { browser, context } = makeMockBrowser({ failBothGotos: true })
    await capturePageInfo(browser, url).catch(() => {})
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('closes the browser context on success', async () => {
    const { browser, context } = makeMockBrowser()
    await capturePageInfo(browser, url)
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('returns an empty string for title when page.title() rejects', async () => {
    const { browser, page } = makeMockBrowser()
    page.title.mockRejectedValueOnce(new Error('not available'))
    const result = await capturePageInfo(browser, url)
    expect(result.title).toBe('')
  })

  it('produces a deterministic screenshotPath relative to the screenshots directory', async () => {
    const { browser } = makeMockBrowser()
    const result = await capturePageInfo(browser, url)
    expect(result.screenshotPath).toMatch(/^screenshots\/[a-f0-9]{12}\.png$/)
  })
})
