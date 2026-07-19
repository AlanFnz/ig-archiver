export interface ArchiveEntry {
  url: string;
  title: string;
  metaDescription: string;
  userMessage?: string;
  summary: string;
  category: string;
  keywords: string;
  notes: string;
  screenshotPath: string;
  aiConfidence: number | null;
  aiConfidenceReason: string;
  archivedAt: string;
  createdAt: string;
  updatedAt?: string;
  manuallyEditedAt?: string;
}
export type ArchiveEntryInput = Pick<ArchiveEntry, 'url'> & Partial<Omit<ArchiveEntry, 'url'>>;

export type ArchivePatch = Pick<ArchiveEntry, 'title' | 'summary' | 'category' | 'keywords' | 'notes'>;

export type ArchiveEvent =
  | { type: 'progress'; index: number; total: number; url: string }
  | { type: 'done'; url: string; category: string; summary: string; screenshotPath: string }
  | { type: 'skipped'; url: string; category: string; summary: string }
  | { type: 'error'; url: string; message: string };

export type JobStatus = 'queued' | 'running' | 'paused' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
export type SequencedArchiveEvent = ArchiveEvent & { sequence: number; at: string };

export interface StoredJob {
  id: string;
  status: JobStatus;
  urls: string[];
  urlMessages: Record<string, string>;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  sequence: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  events: SequencedArchiveEvent[];
}

export interface ArchiveControl {
  isCancelled(): boolean;
  waitUntilRunnable(): Promise<void>;
}

export interface ArchiveBatchOptions {
  urls: string[];
  urlMessages?: Record<string, string>;
  onEvent?: (event: ArchiveEvent) => void | Promise<void>;
  control?: ArchiveControl;
}

export type ArchiveRunner = (options: ArchiveBatchOptions) => Promise<void>;

export interface JobStore {
  listStoredJobs(): Promise<StoredJob[]>;
  saveStoredJob(job: StoredJob): Promise<unknown>;
}
