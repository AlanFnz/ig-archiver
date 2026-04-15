import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const { mockCreate, mockReadFile } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockReadFile: vi.fn(),
}))

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = { completions: { create: mockCreate } }
  },
}))

vi.mock('fs', () => ({
  promises: { readFile: mockReadFile },
}))

import { summarize } from '../lib/summarize.js'
import { VALID_CATEGORIES } from '../lib/config.js'

const FAKE_PATH = '/fake/screenshot.png'

function modelReturns(content) {
  return { choices: [{ message: { content } }] }
}

describe('summarize — MOCK mode', () => {
  beforeEach(() => { process.env.MOCK = 'true' })
  afterEach(() => { delete process.env.MOCK })

  it('returns mock values without calling OpenAI', async () => {
    const result = await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)
    expect(mockCreate).not.toHaveBeenCalled()
    expect(result.summary).toMatch(/mock summary/)
    expect(result.keywords).toBe('mock, keywords')
    expect(VALID_CATEGORIES).toContain(result.category)
  })
})

describe('summarize — live mode', () => {
  beforeEach(() => {
    delete process.env.MOCK
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue(Buffer.from('fake-image-bytes'))
  })

  it('parses a valid JSON response', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'A cool meme.',
      category: 'Memes',
      keywords: 'funny, viral',
    })))
    const result = await summarize('https://www.instagram.com/p/abc/', 'Title', 'caption', 'desc', FAKE_PATH)
    expect(result.summary).toBe('A cool meme.')
    expect(result.category).toBe('Memes')
    expect(result.keywords).toBe('funny, viral')
  })

  it('parses JSON wrapped in a markdown code block', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(
      '```json\n{"summary":"S","category":"Music","keywords":"k"}\n```',
    ))
    const result = await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)
    expect(result.summary).toBe('S')
    expect(result.category).toBe('Music')
  })

  it('accepts two comma-separated valid categories', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'Mix.',
      category: 'Music, Design',
      keywords: '',
    })))
    const result = await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)
    expect(result.category).toBe('Music, Design')
  })

  it('defaults to the first valid category when the model returns an unknown one', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'S.',
      category: 'SomethingMadeUp',
      keywords: '',
    })))
    const result = await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)
    expect(result.category).toBe(VALID_CATEGORIES[0])
  })

  it('returns a fallback summary when the response JSON is empty', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns('{}'))
    const result = await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)
    expect(result.summary).toBe('No summary available.')
  })

  it('includes the userMessage as the primary intent signal in the prompt', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'S', category: 'Memes', keywords: '',
    })))
    await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH, 'check this out!')

    const promptText = mockCreate.mock.calls[0][0].messages[0].content
      .find(c => c.type === 'text').text
    expect(promptText).toContain('check this out!')
    expect(promptText).toContain('primary signal')
  })

  it('omits the intent clause when no userMessage is provided', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'S', category: 'Memes', keywords: '',
    })))
    await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)

    const promptText = mockCreate.mock.calls[0][0].messages[0].content
      .find(c => c.type === 'text').text
    expect(promptText).not.toContain('primary signal')
  })

  it('sends the screenshot as a base64 image to the model', async () => {
    mockCreate.mockResolvedValueOnce(modelReturns(JSON.stringify({
      summary: 'S', category: 'Memes', keywords: '',
    })))
    await summarize('https://www.instagram.com/p/abc/', '', '', '', FAKE_PATH)

    const imageContent = mockCreate.mock.calls[0][0].messages[0].content
      .find(c => c.type === 'image_url')
    expect(imageContent.image_url.url).toMatch(/^data:image\/png;base64,/)
  })
})
