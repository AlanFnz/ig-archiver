import { vi, describe, it, expect, beforeEach } from 'vitest'

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
}))

vi.mock('fs', () => ({
  promises: { readFile: mockReadFile, writeFile: mockWriteFile },
}))

vi.mock('../lib/config.js', () => ({
  DB_PATH: '/fake/database.json',
}))

import { readDb, writeDb } from '../lib/db.js'

describe('readDb', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns [] when the file does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('no such file'), { code: 'ENOENT' }))
    expect(await readDb()).toEqual([])
  })

  it('returns [] for malformed JSON', async () => {
    mockReadFile.mockResolvedValueOnce('{ not valid json {{')
    expect(await readDb()).toEqual([])
  })

  it('returns the parsed array from a valid file', async () => {
    const data = [{ url: 'https://www.instagram.com/p/abc/', category: 'Memes' }]
    mockReadFile.mockResolvedValueOnce(JSON.stringify(data))
    expect(await readDb()).toEqual(data)
  })

  it('reads from the configured DB_PATH', async () => {
    mockReadFile.mockResolvedValueOnce('[]')
    await readDb()
    expect(mockReadFile).toHaveBeenCalledWith('/fake/database.json', 'utf8')
  })
})

describe('writeDb', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes to DB_PATH with 2-space indentation', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined)
    const data = [{ url: 'https://www.instagram.com/p/abc/' }]
    await writeDb(data)
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/fake/database.json',
      JSON.stringify(data, null, 2),
      'utf8',
    )
  })

  it('writes an empty array correctly', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined)
    await writeDb([])
    expect(mockWriteFile).toHaveBeenCalledWith('/fake/database.json', '[]', 'utf8')
  })
})
