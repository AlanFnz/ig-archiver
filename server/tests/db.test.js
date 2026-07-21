import { promises as fs } from 'fs'
import { createRequire } from 'module'
import initSqlJs from 'sql.js'
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
  updateArchives,
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

  it('migrates the previous SQLite schema without losing archive data', async () => {
    const require = createRequire(import.meta.url)
    const SQL = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') })
    const legacy = new SQL.Database()
    legacy.run(`
      CREATE TABLE archive_entries (
        url TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', meta_description TEXT NOT NULL DEFAULT '',
        user_message TEXT, summary TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
        keywords TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', screenshot_path TEXT NOT NULL DEFAULT '',
        ai_confidence INTEGER, ai_confidence_reason TEXT NOT NULL DEFAULT '', archived_at TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT, manually_edited_at TEXT
      )
    `)
    legacy.run(
      `INSERT INTO archive_entries(url, title, archived_at, created_at) VALUES (?, ?, ?, ?)`,
      ['https://www.instagram.com/p/pre-phase-one/', 'Preserved', '2026-07-01T10:00:00.000Z', '2026-07-01T10:00:00.000Z'],
    )
    await fs.writeFile(DB_PATH, Buffer.from(legacy.export()))
    legacy.close()

    expect(await readDb()).toEqual([
      expect.objectContaining({
        title: 'Preserved', workflowState: 'inbox', intent: null,
        stateChangedAt: '2026-07-01T10:00:00.000Z', mediums: [], tools: [], skills: [],
      }),
    ])
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

  it('persists workflow metadata and structured tags', async () => {
    const url = 'https://www.instagram.com/p/workflow/'
    await upsertArchive(entry(url))
    expect(await findArchiveByUrl(url)).toMatchObject({
      intent: null, workflowState: 'inbox', difficulty: null, estimatedMinutes: null,
      priority: 0, nextAction: '', mediums: [], tools: [], skills: [],
    })

    const updated = await updateArchive(url, {
      intent: 'learn', workflowState: 'up_next', difficulty: 'intermediate',
      estimatedMinutes: 30, priority: 4, nextAction: 'Recreate the texture.',
      mediums: ['Visual art'], tools: ['Photoshop'], skills: ['Texture', 'texture'],
    })
    expect(updated).toMatchObject({
      intent: 'learn', workflowState: 'up_next', difficulty: 'intermediate',
      estimatedMinutes: 30, priority: 4, nextAction: 'Recreate the texture.',
      mediums: ['Visual art'], tools: ['Photoshop'], skills: ['Texture'],
    })
    expect(updated.reviewedAt).toBeTruthy()
    expect(updated.stateChangedAt).not.toBe(entry(url).createdAt)
  })

  it('preserves manual and workflow metadata when recapturing an entry', async () => {
    const url = 'https://www.instagram.com/p/curated-recapture/'
    await upsertArchive(entry(url))
    await updateArchive(url, {
      title: 'My title', notes: 'Keep this context.', intent: 'make', workflowState: 'in_progress',
      nextAction: 'Create a variation.', tools: ['After Effects'],
    })
    await upsertArchive(entry(url, { title: 'Fresh scraped title', summary: 'Fresh AI summary', notes: '' }))
    expect(await findArchiveByUrl(url)).toMatchObject({
      title: 'My title', notes: 'Keep this context.', intent: 'make', workflowState: 'in_progress',
      nextAction: 'Create a variation.', tools: ['After Effects'],
    })
  })

  it('enforces queue limits atomically', async () => {
    const urls = Array.from({ length: 7 }, (_, index) => `https://www.instagram.com/p/queue-${index}/`)
    await importArchive(urls.map(entry))
    await updateArchives(urls.slice(0, 5), { workflowState: 'up_next' })
    await expect(updateArchive(urls[5], { workflowState: 'up_next' })).rejects.toThrow('at most five')
    expect((await findArchiveByUrl(urls[5])).workflowState).toBe('inbox')

    await updateArchive(urls[0], { workflowState: 'in_progress' })
    await expect(updateArchive(urls[1], { workflowState: 'in_progress' })).rejects.toThrow('Only one')
    expect((await findArchiveByUrl(urls[1])).workflowState).toBe('up_next')
  })

  it('moves dismissed entries to cold storage and restores them as unreviewed', async () => {
    const url = 'https://www.instagram.com/p/dismissed/'
    await upsertArchive(entry(url))
    const dismissed = await updateArchive(url, { intent: 'dismiss', workflowState: 'in_progress' })
    expect(dismissed).toMatchObject({ intent: 'dismiss', workflowState: 'cold_storage' })
    expect(dismissed.reviewedAt).toBeTruthy()

    const restored = await updateArchive(url, { intent: null, workflowState: 'inbox' })
    expect(restored).toMatchObject({ intent: null, workflowState: 'inbox' })
    expect(restored.reviewedAt).toBeUndefined()
  })

  it('exports and imports portable JSON backups', async () => {
    await upsertArchive(entry('https://www.instagram.com/p/a/'))
    const backup = await exportArchive()
    expect(backup).toMatchObject({ format: 'ig-archiver-backup', version: 1 })
    await importArchive([entry('https://www.instagram.com/p/b/')], { replace: true })
    expect((await readDb()).map(item => item.url)).toEqual(['https://www.instagram.com/p/b/'])
  })

  it('does not erase workflow decisions when merging a legacy backup', async () => {
    const url = 'https://www.instagram.com/p/legacy-merge/'
    await upsertArchive(entry(url))
    await updateArchive(url, { intent: 'learn', workflowState: 'up_next', nextAction: 'Practice this.' })
    await importArchive([entry(url, { title: 'Imported title' })])
    expect(await findArchiveByUrl(url)).toMatchObject({
      title: 'Imported title', intent: 'learn', workflowState: 'up_next', nextAction: 'Practice this.',
    })
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
