import { promises as fs } from 'fs'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const { DB_PATH, LEGACY_DB_PATH } = vi.hoisted(() => ({
  DB_PATH: '/tmp/ig-archiver-db-test.sqlite',
  LEGACY_DB_PATH: '/tmp/ig-archiver-legacy-test.json',
}))

vi.mock('../lib/config.js', () => ({ DB_PATH, LEGACY_DB_PATH }))

import {
  closeDatabase,
  deleteArchives,
  exportArchive,
  findArchiveByUrl,
  importArchive,
  initializeDatabase,
  listStoredJobs,
  partitionEntriesByUrl,
  readDb,
  saveStoredJob,
  updateArchive,
  upsertArchive,
  writeDb,
} from '../lib/db.js'

const entry = (url, overrides = {}) => ({
  url,
  title: 'Title',
  metaDescription: 'Description',
  summary: 'Summary',
  category: 'References',
  keywords: 'one, two',
  screenshotPath: 'screenshots/example.png',
  archivedAt: '2026-07-14T10:00:00.000Z',
  createdAt: '2026-07-14T10:00:00.000Z',
  ...overrides,
})

describe('SQLite storage', () => {
  beforeEach(async () => {
    await closeDatabase().catch(() => {})
    await Promise.all([fs.rm(DB_PATH, { force: true }), fs.rm(`${DB_PATH}.tmp`, { force: true }), fs.rm(LEGACY_DB_PATH, { force: true })])
  })

  afterEach(async () => {
    await closeDatabase().catch(() => {})
    await Promise.all([fs.rm(DB_PATH, { force: true }), fs.rm(`${DB_PATH}.tmp`, { force: true }), fs.rm(LEGACY_DB_PATH, { force: true })])
  })

  it('creates a SQLite database and returns an empty archive', async () => {
    await initializeDatabase()
    expect(await readDb()).toEqual([])
    expect((await fs.readFile(DB_PATH)).subarray(0, 15).toString()).toBe('SQLite format 3')
  })

  it('imports database.json once when SQLite is empty', async () => {
    await fs.writeFile(LEGACY_DB_PATH, JSON.stringify([entry('https://www.instagram.com/p/legacy/')]))
    expect(await readDb()).toHaveLength(1)

    await closeDatabase()
    await fs.writeFile(LEGACY_DB_PATH, JSON.stringify([entry('https://www.instagram.com/p/other/')]))
    expect((await readDb())[0].url).toContain('/legacy/')
  })

  it('upserts entries idempotently while preserving their creation time', async () => {
    const url = 'https://www.instagram.com/p/a/'
    await upsertArchive(entry(url))
    await upsertArchive(entry(url, { title: 'Updated', createdAt: '2099-01-01T00:00:00.000Z' }))
    const stored = await findArchiveByUrl(url)
    expect(stored).toMatchObject({ title: 'Updated', createdAt: '2026-07-14T10:00:00.000Z' })
    expect(await readDb()).toHaveLength(1)
  })

  it('supports compatibility replacement and bulk deletion', async () => {
    const entries = [entry('https://www.instagram.com/p/a/'), entry('https://www.instagram.com/p/b/')]
    await writeDb(entries)
    const removed = await deleteArchives([entries[0].url, 'missing'])
    expect(removed.map(item => item.url)).toEqual([entries[0].url])
    expect((await readDb()).map(item => item.url)).toEqual([entries[1].url])
  })

  it('persists AI provenance and tracks manual edits independently', async () => {
    const url = 'https://www.instagram.com/p/curated/'
    await upsertArchive(entry(url, { aiConfidence: 78, aiConfidenceReason: 'Readable caption.' }))
    const updated = await updateArchive(url, { summary: 'Curated summary', notes: 'Personal context.' })
    expect(updated).toMatchObject({
      summary: 'Curated summary', notes: 'Personal context.',
      aiConfidence: 78, aiConfidenceReason: 'Readable caption.',
    })
    expect(updated.manuallyEditedAt).toBeTruthy()
  })

  it('exports and imports portable JSON backups', async () => {
    await upsertArchive(entry('https://www.instagram.com/p/a/'))
    const backup = await exportArchive()
    expect(backup).toMatchObject({ format: 'ig-archiver-backup', version: 1 })
    await importArchive([entry('https://www.instagram.com/p/b/')], { replace: true })
    expect((await readDb()).map(item => item.url)).toEqual(['https://www.instagram.com/p/b/'])
  })

  it('persists job snapshots and events', async () => {
    await saveStoredJob({
      id: 'job-1', status: 'paused', urls: ['a'], urlMessages: {}, total: 1,
      processed: 0, succeeded: 0, failed: 0, skipped: 0, sequence: 1, error: null,
      createdAt: '2026-07-14T10:00:00.000Z', updatedAt: '2026-07-14T10:01:00.000Z', finishedAt: null,
      events: [{ type: 'progress', url: 'a', sequence: 1, at: '2026-07-14T10:01:00.000Z' }],
    })
    expect(await listStoredJobs()).toEqual([
      expect.objectContaining({ id: 'job-1', status: 'paused', events: [expect.objectContaining({ sequence: 1 })] }),
    ])
  })
})

describe('partitionEntriesByUrl', () => {
  const entries = [{ url: 'a' }, { url: 'b' }, { url: 'c' }]

  it('separates matching entries while preserving order', () => {
    expect(partitionEntriesByUrl(entries, ['a', 'c'])).toEqual({ removed: [entries[0], entries[2]], remaining: [entries[1]] })
  })

  it('ignores duplicate and unknown URLs', () => {
    expect(partitionEntriesByUrl(entries, ['b', 'b', 'missing'])).toEqual({ removed: [entries[1]], remaining: [entries[0], entries[2]] })
  })
})
