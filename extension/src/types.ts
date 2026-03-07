export type ScanPhase = 'idle' | 'scanning' | 'archiving' | 'done' | 'error';
export type StatusType = 'info' | 'success' | 'error' | 'warning';

export interface StatusEntry {
  id: number;
  message: string;
  type: StatusType;
}

export interface ScanState {
  phase: ScanPhase;
  processed: number;
  total: number;
  statusFeed: StatusEntry[];
}

export type ArchiveEvent =
  | { type: 'progress'; index: number; total: number; url: string }
  | { type: 'done'; url: string; category: string; summary: string; screenshotPath: string }
  | { type: 'error'; url: string; message: string };
