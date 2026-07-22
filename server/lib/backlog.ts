import type { ArchiveEntry } from './types.js';

export type BacklogDimension = 'category' | 'medium' | 'tool' | 'skill' | 'keyword';

export interface BacklogCluster {
  dimension: BacklogDimension;
  value: string;
  count: number;
  urls: string[];
}

export interface BacklogAnalysis {
  total: number;
  withOriginalMessage: number;
  withScreenshot: number;
  olderThanOneYear: number;
  oldestArchivedAt: string | null;
  clusters: BacklogCluster[];
}

function commaValues(value: string) {
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function valuesByDimension(entry: ArchiveEntry): Array<[BacklogDimension, string[]]> {
  return [
    ['category', commaValues(entry.category || '')],
    ['medium', entry.mediums || []],
    ['tool', entry.tools || []],
    ['skill', entry.skills || []],
    ['keyword', commaValues(entry.keywords || '')],
  ];
}

export function analyzeBacklog(entries: ArchiveEntry[], now = new Date()): BacklogAnalysis {
  const backlog = entries.filter(entry => !entry.reviewedAt && entry.workflowState === 'inbox');
  const groups = new Map<string, BacklogCluster>();

  for (const entry of backlog) {
    for (const [dimension, values] of valuesByDimension(entry)) {
      const seen = new Set<string>();
      for (const rawValue of values) {
        const value = rawValue.trim();
        const normalized = value.toLocaleLowerCase();
        if (!value || seen.has(normalized)) continue;
        seen.add(normalized);
        const key = `${dimension}:${normalized}`;
        const cluster = groups.get(key) || { dimension, value, count: 0, urls: [] };
        cluster.count++;
        cluster.urls.push(entry.url);
        groups.set(key, cluster);
      }
    }
  }

  const oneYearAgo = new Date(now);
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const timestamps = backlog
    .map(entry => entry.archivedAt || entry.createdAt)
    .filter(Boolean)
    .sort();

  return {
    total: backlog.length,
    withOriginalMessage: backlog.filter(entry => Boolean(entry.userMessage?.trim())).length,
    withScreenshot: backlog.filter(entry => Boolean(entry.screenshotPath)).length,
    olderThanOneYear: backlog.filter(entry => {
      const timestamp = entry.archivedAt || entry.createdAt;
      return Boolean(timestamp) && new Date(timestamp) < oneYearAgo;
    }).length,
    oldestArchivedAt: timestamps[0] || null,
    clusters: [...groups.values()]
      .filter(cluster => cluster.count >= 2)
      .sort((a, b) => b.count - a.count || a.dimension.localeCompare(b.dimension) || a.value.localeCompare(b.value))
      .slice(0, 30),
  };
}
