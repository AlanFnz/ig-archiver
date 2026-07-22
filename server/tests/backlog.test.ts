import { describe, expect, it } from 'vitest';
import { analyzeBacklog } from '../lib/backlog.js';
import type { ArchiveEntry } from '../lib/types.js';

function entry(url: string, overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    url, title: 'Title', metaDescription: '', summary: '', category: 'Tutorials', keywords: 'texture, type',
    notes: '', screenshotPath: 'screenshots/example.png', aiConfidence: null, aiConfidenceReason: '',
    archivedAt: '2024-01-01T00:00:00.000Z', createdAt: '2024-01-01T00:00:00.000Z',
    intent: null, workflowState: 'inbox', difficulty: null, estimatedMinutes: null, priority: 0,
    nextAction: '', stateChangedAt: '2024-01-01T00:00:00.000Z', mediums: [], tools: [], skills: [],
    ...overrides,
  };
}

describe('analyzeBacklog', () => {
  it('summarizes only unreviewed Inbox entries', () => {
    const result = analyzeBacklog([
      entry('a', { userMessage: 'Try this', tools: ['Photoshop'] }),
      entry('b', { tools: ['photoshop'], screenshotPath: '' }),
      entry('c', { reviewedAt: '2026-01-01T00:00:00.000Z', tools: ['Photoshop'] }),
      entry('d', { workflowState: 'cold_storage' }),
    ], new Date('2026-07-21T00:00:00.000Z'));

    expect(result).toMatchObject({ total: 2, withOriginalMessage: 1, withScreenshot: 1, olderThanOneYear: 2 });
    expect(result.clusters).toEqual(expect.arrayContaining([
      expect.objectContaining({ dimension: 'tool', value: 'Photoshop', count: 2, urls: ['a', 'b'] }),
      expect.objectContaining({ dimension: 'category', value: 'Tutorials', count: 2 }),
    ]));
  });

  it('deduplicates values within an entry and omits singleton clusters', () => {
    const result = analyzeBacklog([
      entry('a', { category: 'Design, design', keywords: 'unique' }),
      entry('b', { category: 'Tutorials', keywords: '' }),
    ]);
    expect(result.clusters.some(cluster => cluster.value.toLocaleLowerCase() === 'design')).toBe(false);
    expect(result.clusters.some(cluster => cluster.value === 'unique')).toBe(false);
  });

  it('returns an empty analysis safely', () => {
    expect(analyzeBacklog([])).toEqual({
      total: 0, withOriginalMessage: 0, withScreenshot: 0,
      olderThanOneYear: 0, oldestArchivedAt: null, clusters: [],
    });
  });
});
