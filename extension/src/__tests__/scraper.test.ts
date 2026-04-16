import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scrapeExternalLinks, autoScrollOnce } from '../lib/scraper'

// ─── helpers ──────────────────────────────────────────────────────────────────

function setThread(
  fbid: string,
  edges: unknown[],
  pageInfo: Record<string, unknown> = {},
  bodyStr = '',
  headers: Record<string, string> = {},
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  w.__igSlideThreads  = { [fbid]: { edges, pageInfo, bodyStr, headers } }
  w.__igThreadKeyMap  = { [fbid]: fbid }
  w.__igLastThreadFbid = fbid
  w.__igFetchBodyStr   = bodyStr || null
  w.__igFetchHeaders   = headers || null
}

function clearThreads() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  w.__igSlideThreads   = {}
  w.__igThreadKeyMap   = {}
  w.__igLastThreadFbid = null
  w.__igFetchBodyStr   = null
  w.__igFetchHeaders   = null
}

function edge(url: string, nodeExtra: Record<string, unknown> = {}, xmaExtra: Record<string, unknown> = {}) {
  return {
    node: {
      ...nodeExtra,
      content: { xma: { target_url: url, ...xmaExtra } },
    },
  }
}

// ─── scrapeExternalLinks ──────────────────────────────────────────────────────

describe('scrapeExternalLinks', () => {
  beforeEach(() => clearThreads())

  it('returns [] when no thread data exists', async () => {
    expect(await scrapeExternalLinks()).toEqual([])
  })

  it('extracts an Instagram post URL from thread edges', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc123/')])
    const links = await scrapeExternalLinks()
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('https://www.instagram.com/p/Abc123/')
  })

  it('extracts an Instagram reel URL from thread edges', async () => {
    setThread('t1', [edge('https://www.instagram.com/reel/Xyz456/')])
    const links = await scrapeExternalLinks()
    expect(links[0].url).toBe('https://www.instagram.com/reel/Xyz456/')
  })

  it('strips query-string parameters from extracted URLs', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc123/?igsh=abc&utm=1')])
    const links = await scrapeExternalLinks()
    expect(links[0].url).toBe('https://www.instagram.com/p/Abc123/')
  })

  it('deduplicates identical URLs', async () => {
    setThread('t1', [
      edge('https://www.instagram.com/p/Abc123/'),
      edge('https://www.instagram.com/p/Abc123/'),
    ])
    expect(await scrapeExternalLinks()).toHaveLength(1)
  })

  it('ignores edges without an xma target_url', async () => {
    setThread('t1', [{ node: { content: {} } }])
    expect(await scrapeExternalLinks()).toEqual([])
  })

  it('ignores non-Instagram URLs', async () => {
    setThread('t1', [edge('https://www.example.com/page/')])
    expect(await scrapeExternalLinks()).toEqual([])
  })

  it('ignores Instagram URLs that are not posts or reels', async () => {
    setThread('t1', [edge('https://www.instagram.com/stories/user/123/')])
    expect(await scrapeExternalLinks()).toEqual([])
  })

  it('extracts message from node.text', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc/', { text: 'check this out' })])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('check this out')
  })

  it('extracts message from node.message (string)', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc/', { message: 'hello there' })])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('hello there')
  })

  it('extracts message from node.message.text (object)', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc/', { message: { text: 'nested text' } })])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('nested text')
  })

  it('extracts message from node.content.text', async () => {
    const e = {
      node: {
        content: {
          text: 'content text field',
          xma: { target_url: 'https://www.instagram.com/p/Abc/' },
        },
      },
    }
    setThread('t1', [e])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('content text field')
  })

  it('extracts message from xma.message', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc/', {}, { message: 'xma caption' })])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('xma caption')
  })

  it('omits the message field when no text is found', async () => {
    setThread('t1', [edge('https://www.instagram.com/p/Abc/')])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBeUndefined()
  })

  it('prefers node.text over xma.message', async () => {
    setThread('t1', [
      edge('https://www.instagram.com/p/Abc/', { text: 'node text wins' }, { message: 'xma loses' }),
    ])
    const links = await scrapeExternalLinks()
    expect(links[0].message).toBe('node text wins')
  })

  it('uses lastFbid when no URL thread-key match is available', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.__igSlideThreads   = { fbid_999: { edges: [edge('https://www.instagram.com/p/X/')], pageInfo: {} } }
    w.__igThreadKeyMap   = {}
    w.__igLastThreadFbid = 'fbid_999'

    const links = await scrapeExternalLinks()
    expect(links[0].url).toBe('https://www.instagram.com/p/X/')
  })
})

// ─── autoScrollOnce ───────────────────────────────────────────────────────────

describe('autoScrollOnce', () => {
  let mockXHR: {
    open: ReturnType<typeof vi.fn>
    setRequestHeader: ReturnType<typeof vi.fn>
    addEventListener: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    _loadCb?: () => void
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OriginalXHR: any

  beforeEach(() => {
    clearThreads()
    vi.useFakeTimers()
    OriginalXHR = window.XMLHttpRequest

    mockXHR = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      addEventListener: vi.fn((event: string, cb: () => void) => {
        if (event === 'load') mockXHR._loadCb = cb
      }),
      send: vi.fn(() => { mockXHR._loadCb?.() }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).XMLHttpRequest = vi.fn(() => mockXHR)
  })

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).XMLHttpRequest = OriginalXHR
    vi.useRealTimers()
  })

  it('returns false when slideThreads has no entry for the resolved fbid', async () => {
    expect(await autoScrollOnce()).toBe(false)
  })

  it('returns false when has_next_page is false', async () => {
    setThread('t1', [], { has_next_page: false, end_cursor: 'cursor' })
    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    expect(await p).toBe(false)
  })

  it('returns false when there is no end_cursor', async () => {
    setThread('t1', [], { has_next_page: true })
    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    expect(await p).toBe(false)
  })

  it('returns false when there is no bodyStr to paginate with', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    w.__igSlideThreads   = { t1: { edges: [], pageInfo: { has_next_page: true, end_cursor: 'c' }, bodyStr: '', headers: {} } }
    w.__igLastThreadFbid = 't1'
    w.__igFetchBodyStr   = null
    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    expect(await p).toBe(false)
  })

  it('sends a POST to /api/graphql with the updated cursor', async () => {
    const vars = { after: 'old_cursor', count: 20 }
    const bodyStr = new URLSearchParams({ variables: JSON.stringify(vars) }).toString()

    setThread('t1', [], { has_next_page: true, end_cursor: 'new_cursor' }, bodyStr)

    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    await p

    expect(mockXHR.open).toHaveBeenCalledWith('POST', '/api/graphql', true)

    const sentBody = mockXHR.send.mock.calls[0][0] as string
    const sentVars = JSON.parse(new URLSearchParams(sentBody).get('variables')!)
    expect(sentVars.after).toBe('new_cursor')
    expect(sentVars.count).toBe(20)
  })

  it('picks up the "before" cursor key when "after" is not present', async () => {
    const vars = { before: 'old', count: 10 }
    const bodyStr = new URLSearchParams({ variables: JSON.stringify(vars) }).toString()

    setThread('t1', [], { has_next_page: true, end_cursor: 'next' }, bodyStr)

    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    await p

    const sentVars = JSON.parse(
      new URLSearchParams(mockXHR.send.mock.calls[0][0]).get('variables')!,
    )
    expect(sentVars.before).toBe('next')
  })

  it('returns true when new edges arrive after the XHR fires', async () => {
    const bodyStr = new URLSearchParams({ variables: JSON.stringify({ after: 'c' }) }).toString()
    setThread('t1', [], { has_next_page: true, end_cursor: 'next' }, bodyStr)

    mockXHR.send = vi.fn(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any).__igSlideThreads.t1.edges.push(
        edge('https://www.instagram.com/p/New/'),
      )
      mockXHR._loadCb?.()
    })

    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    expect(await p).toBe(true)
  })

  it('returns false when no new edges arrive', async () => {
    const bodyStr = new URLSearchParams({ variables: JSON.stringify({ after: 'c' }) }).toString()
    setThread('t1', [], { has_next_page: true, end_cursor: 'next' }, bodyStr)

    const p = autoScrollOnce()
    await vi.runAllTimersAsync()
    expect(await p).toBe(false)
  })
})
