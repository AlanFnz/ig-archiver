import { vi, describe, it, expect, beforeEach } from 'vitest'
import { archiveStream } from '../lib/archiveStream'

function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function ndjsonStream(lines: object[]): ReadableStream<Uint8Array> {
  return makeStream([lines.map(l => JSON.stringify(l)).join('\n') + '\n'])
}

describe('archiveStream', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('throws when the server returns a non-200 status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    }))
    const gen = archiveStream(['https://www.instagram.com/p/abc/'])
    await expect(gen.next()).rejects.toThrow('Server error 500')
  })

  it('yields progress and done events from a well-formed NDJSON stream', async () => {
    const url = 'https://www.instagram.com/p/abc/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: ndjsonStream([
        { type: 'progress', index: 1, total: 1, url },
        { type: 'done', url, category: 'Memes', summary: 'A meme.', screenshotPath: 'screenshots/abc.png' },
      ]),
    }))

    const events = []
    for await (const e of archiveStream([url])) events.push(e)

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: 'progress', index: 1, total: 1 })
    expect(events[1]).toMatchObject({ type: 'done', category: 'Memes' })
  })

  it('yields error events', async () => {
    const url = 'https://www.instagram.com/p/abc/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: ndjsonStream([{ type: 'error', url, message: 'Navigation failed' }]),
    }))

    const events = []
    for await (const e of archiveStream([url])) events.push(e)

    expect(events[0]).toMatchObject({ type: 'error', message: 'Navigation failed' })
  })

  it('silently skips malformed NDJSON lines', async () => {
    const url = 'https://www.instagram.com/p/abc/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeStream([
        'not valid json\n',
        JSON.stringify({ type: 'done', url, category: 'Memes', summary: 'S', screenshotPath: '' }) + '\n',
      ]),
    }))

    const events = []
    for await (const e of archiveStream([url])) events.push(e)

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('done')
  })

  it('handles an event split across multiple chunks', async () => {
    const url = 'https://www.instagram.com/p/abc/'
    const json = JSON.stringify({ type: 'progress', index: 1, total: 1, url })
    const mid = Math.floor(json.length / 2)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      body: makeStream([json.slice(0, mid), json.slice(mid) + '\n']),
    }))

    const events = []
    for await (const e of archiveStream([url])) events.push(e)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'progress' })
  })

  it('sends urls and urlMessages in the POST body', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: makeStream([]) })
    vi.stubGlobal('fetch', mockFetch)

    const urls = ['https://www.instagram.com/p/abc/']
    const urlMessages = { 'https://www.instagram.com/p/abc/': 'nice post' }
    for await (const _ of archiveStream(urls, urlMessages)) { /* drain */ }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.urls).toEqual(urls)
    expect(body.urlMessages).toEqual(urlMessages)
  })

  it('sends an empty urlMessages object when the argument is omitted', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: makeStream([]) })
    vi.stubGlobal('fetch', mockFetch)

    for await (const _ of archiveStream(['https://www.instagram.com/p/abc/'])) { /* drain */ }

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.urlMessages).toEqual({})
  })

  it('returns an empty stream when the server sends no lines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: makeStream([]) }))
    const events = []
    for await (const e of archiveStream([])) events.push(e)
    expect(events).toHaveLength(0)
  })
})
