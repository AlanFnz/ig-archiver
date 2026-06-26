import type { ArchiveEvent } from '../types';

export type ArchiveJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'cancelling'
  | 'cancelled'
  | 'completed'
  | 'failed';

export type ArchiveJobEvent = ArchiveEvent & { sequence: number; at: string };

export interface ArchiveJob {
  id: string;
  status: ArchiveJobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  error: string | null;
  events: ArchiveJobEvent[];
}

export interface SavedArchiveJob {
  id: string;
  serverUrl: string;
}

const ACTIVE_JOB_KEY = 'activeArchiveJob';
const TERMINAL_STATUSES = new Set<ArchiveJobStatus>(['completed', 'cancelled', 'failed']);

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Server error ${response.status}`) as Error & {
      status?: number;
      job?: ArchiveJob;
    };
    error.status = response.status;
    error.job = payload.job;
    throw error;
  }
  return payload as T;
}

export function isTerminalJob(status: ArchiveJobStatus) {
  return TERMINAL_STATUSES.has(status);
}

export function createArchiveJob(
  serverUrl: string,
  urls: string[],
  urlMessages: Record<string, string>,
) {
  return request<ArchiveJob>(`${serverUrl}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls, urlMessages }),
  });
}

export function getArchiveJob(serverUrl: string, id: string) {
  return request<ArchiveJob>(`${serverUrl}/api/jobs/${encodeURIComponent(id)}`);
}

export function controlArchiveJob(
  serverUrl: string,
  id: string,
  action: 'pause' | 'resume' | 'cancel',
) {
  return request<ArchiveJob>(
    `${serverUrl}/api/jobs/${encodeURIComponent(id)}/${action}`,
    { method: 'POST' },
  );
}

export async function saveActiveArchiveJob(job: SavedArchiveJob) {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [ACTIVE_JOB_KEY]: job });
  }
}

export async function getActiveArchiveJob(): Promise<SavedArchiveJob | null> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null;
  const stored = await chrome.storage.local.get(ACTIVE_JOB_KEY);
  const job = stored[ACTIVE_JOB_KEY];
  return job && typeof job.id === 'string' && typeof job.serverUrl === 'string' ? job : null;
}

export async function clearActiveArchiveJob(id?: string) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  if (id) {
    const current = await getActiveArchiveJob();
    if (current?.id !== id) return;
  }
  await chrome.storage.local.remove(ACTIVE_JOB_KEY);
}
