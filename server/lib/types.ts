export const ARCHIVE_INTENTS = ['learn', 'make', 'reference', 'dismiss'] as const;
export type ArchiveIntent = typeof ARCHIVE_INTENTS[number];

export const WORKFLOW_STATES = ['inbox', 'up_next', 'in_progress', 'practiced', 'applied', 'published', 'cold_storage'] as const;
export type WorkflowState = typeof WORKFLOW_STATES[number];

export const DIFFICULTIES = ['easy', 'intermediate', 'advanced'] as const;
export type Difficulty = typeof DIFFICULTIES[number];

export const TAG_DIMENSIONS = ['medium', 'tool', 'skill'] as const;
export type TagDimension = typeof TAG_DIMENSIONS[number];

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
  intent: ArchiveIntent | null;
  workflowState: WorkflowState;
  difficulty: Difficulty | null;
  estimatedMinutes: number | null;
  priority: number;
  nextAction: string;
  reviewedAt?: string;
  stateChangedAt: string;
  mediums: string[];
  tools: string[];
  skills: string[];
}
export type ArchiveEntryInput = Pick<ArchiveEntry, 'url'> & Partial<Omit<ArchiveEntry, 'url'>>;

export type ArchivePatch = Pick<ArchiveEntry,
  | 'title' | 'summary' | 'category' | 'keywords' | 'notes'
  | 'intent' | 'workflowState' | 'difficulty' | 'estimatedMinutes'
  | 'priority' | 'nextAction' | 'mediums' | 'tools' | 'skills'
>;

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
