import { promises as fs } from 'fs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const databasePath = '/tmp/ig-archiver-api-test.sqlite'
process.env.DATABASE_PATH = databasePath

let app
let storage

const entry = url => ({
  url,
  title: 'Integration test',
  summary: 'Stored through SQLite',
  category: 'References',
  keywords: 'test',
  screenshotPath: '',
  archivedAt: '2026-07-14T10:00:00.000Z',
  createdAt: '2026-07-14T10:00:00.000Z',
})

beforeAll(async () => {
  ;({ app } = await import('../server.js'))
  storage = await import('../lib/db.js')
})

beforeEach(async () => {
  await storage.closeDatabase().catch(() => {})
  await fs.rm(databasePath, { force: true })
  await fs.rm(`${databasePath}.tmp`, { force: true })
})

afterAll(async () => {
  await storage.closeDatabase().catch(() => {})
  await fs.rm(databasePath, { force: true })
  await fs.rm(`${databasePath}.tmp`, { force: true })
})

describe('HTTP API', () => {
  it('reports health and returns archives from SQLite', async () => {
    await storage.upsertArchive(entry('https://www.instagram.com/p/a/'))
    await request(app).get('/health').expect(200, { status: 'ok' })
    const response = await request(app).get('/api/archive').expect(200)
    expect(response.body).toEqual([expect.objectContaining({ title: 'Integration test' })])
  })

  it('exports and restores portable backups', async () => {
    await storage.upsertArchive(entry('https://www.instagram.com/p/a/'))
    const exported = await request(app).get('/api/archive/export').expect(200)
    expect(exported.headers['content-disposition']).toContain('ig-archiver-')
    expect(exported.body).toMatchObject({ format: 'ig-archiver-backup', version: 1 })

    const replacement = entry('https://www.instagram.com/p/b/')
    await request(app)
      .post('/api/archive/import')
      .send({ format: 'ig-archiver-backup', mode: 'replace', entries: [replacement] })
      .expect(200, { success: true, imported: 1, mode: 'replace' })
    expect((await storage.readDb()).map(item => item.url)).toEqual([replacement.url])
  })

  it('bulk-deletes archive entries through the API', async () => {
    const first = entry('https://www.instagram.com/p/a/')
    const second = entry('https://www.instagram.com/p/b/')
    await storage.importArchive([first, second])
    await request(app).delete('/api/archive/bulk').send({ urls: [first.url] }).expect(200, { success: true, deleted: 1 })
    expect((await storage.readDb()).map(item => item.url)).toEqual([second.url])
  })

  it('edits allowlisted archive fields and records manual provenance', async () => {
    const original = entry('https://www.instagram.com/p/edit/')
    await storage.upsertArchive({ ...original, aiConfidence: 84, aiConfidenceReason: 'Clear caption and screenshot.' })
    const response = await request(app)
      .patch('/api/archive')
      .send({ url: original.url, title: 'Curated title', notes: 'Try this later.', category: 'Tutorials' })
      .expect(200)

    expect(response.body.entry).toMatchObject({
      title: 'Curated title',
      notes: 'Try this later.',
      category: 'Tutorials',
      aiConfidence: 84,
    })
    expect(response.body.entry.manuallyEditedAt).toBeTruthy()
  })

  it('rejects unknown edit fields and missing entries', async () => {
    const url = 'https://www.instagram.com/p/missing/'
    await request(app).patch('/api/archive').send({ url, screenshotPath: 'elsewhere.png' }).expect(400)
    await request(app).patch('/api/archive').send({ url, title: 'No match' }).expect(404)
  })

  it('edits creative workflow metadata with validation', async () => {
    const original = entry('https://www.instagram.com/p/workflow/')
    await storage.upsertArchive(original)
    const response = await request(app)
      .patch('/api/archive')
      .send({
        url: original.url,
        intent: 'learn', workflowState: 'up_next', difficulty: 'intermediate',
        estimatedMinutes: 45, priority: 5, nextAction: 'Build one small variation.',
        mediums: ['Motion'], tools: ['After Effects'], skills: ['Kinetic type'],
      })
      .expect(200)

    expect(response.body.entry).toMatchObject({
      intent: 'learn', workflowState: 'up_next', estimatedMinutes: 45,
      tools: ['After Effects'], nextAction: 'Build one small variation.',
    })
    expect(response.body.queue).toEqual({ inProgress: 0, upNext: 1 })
    await request(app).patch('/api/archive').send({ url: original.url, priority: 6 }).expect(400)
    await request(app).patch('/api/archive').send({ url: original.url, estimatedMinutes: 0 }).expect(400)
  })

  it('applies bulk triage atomically and reports queue conflicts', async () => {
    const entries = Array.from({ length: 6 }, (_, index) => entry(`https://www.instagram.com/p/bulk-${index}/`))
    await storage.importArchive(entries)
    const response = await request(app)
      .patch('/api/archive/bulk')
      .send({ urls: entries.slice(0, 5).map(item => item.url), patch: { intent: 'learn', workflowState: 'up_next' } })
      .expect(200)
    expect(response.body).toMatchObject({ success: true, updated: 5, queue: { inProgress: 0, upNext: 5 } })

    await request(app)
      .patch('/api/archive/bulk')
      .send({ urls: [entries[5].url], patch: { workflowState: 'up_next' } })
      .expect(409)
    expect((await storage.findArchiveByUrl(entries[5].url)).workflowState).toBe('inbox')
  })

  it('validates imports and archive jobs', async () => {
    await request(app).post('/api/archive/import').send({ entries: [] }).expect(400)
    await request(app).post('/api/jobs').send({ urls: [] }).expect(400)
  })

  it('rejects untrusted browser origins', async () => {
    await request(app).get('/api/archive').set('Origin', 'https://evil.example').expect(403)
  })
})
