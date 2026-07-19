import crypto from 'crypto';

import { listStoredJobs, saveStoredJob } from './db.js';
import { logger } from './logger.js';
import type { ArchiveEvent, ArchiveRunner, JobStatus, JobStore, SequencedArchiveEvent, StoredJob } from './types.js';

const ACTIVE_STATUSES = new Set<JobStatus>(['queued', 'running', 'paused', 'cancelling']);
const TERMINAL_STATUSES = new Set<JobStatus>(['completed', 'cancelled', 'failed']);
const TERMINAL_EVENT_TYPES = new Set(['done', 'error', 'skipped']);

interface JobOptions {
  urls?: string[];
  urlMessages?: Record<string, string>;
  runner: ArchiveRunner;
  store: JobStore;
  restored?: StoredJob | null;
}

class ArchiveJob {
  id: string;
  urls: string[];
  urlMessages: Record<string, string>;
  runner: ArchiveRunner;
  store: JobStore;
  status: JobStatus;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  events: SequencedArchiveEvent[];
  sequence: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  pauseRequested: boolean;
  cancelRequested: boolean;
  waiters: Array<() => void>;
  persistence: Promise<unknown>;
  runPromise?: Promise<void>;

  constructor({ urls = [], urlMessages = {}, runner, store, restored = null }: JobOptions) {
    this.id = restored?.id || crypto.randomUUID();
    this.urls = restored?.urls || urls;
    this.urlMessages = restored?.urlMessages || urlMessages;
    this.runner = runner;
    this.store = store;
    this.status = restored?.status || 'queued';
    this.total = restored?.total ?? this.urls.length;
    this.processed = restored?.processed || 0;
    this.succeeded = restored?.succeeded || 0;
    this.failed = restored?.failed || 0;
    this.skipped = restored?.skipped || 0;
    this.events = restored?.events || [];
    this.sequence = restored?.sequence || 0;
    this.error = restored?.error || null;
    this.createdAt = restored?.createdAt || new Date().toISOString();
    this.updatedAt = restored?.updatedAt || this.createdAt;
    this.finishedAt = restored?.finishedAt || null;
    this.pauseRequested = this.status === 'paused';
    this.cancelRequested = false;
    this.waiters = [];
    this.persistence = Promise.resolve();
  }

  pendingUrls() {
    const completed = new Set(
      this.events.filter(event => TERMINAL_EVENT_TYPES.has(event.type)).map(event => event.url),
    );
    return this.urls.filter(url => !completed.has(url));
  }

  persist() {
    const snapshot = this.toStored();
    this.persistence = this.persistence.then(() => this.store.saveStoredJob(snapshot));
    return this.persistence;
  }

  start() {
    if (this.runPromise) return this.runPromise;
    this.runPromise = this.run();
    return this.runPromise;
  }

  async run() {
    await this.setStatus('running');
    logger.info('job.started', 'Archive job started.', { jobId: this.id, total: this.total, remaining: this.pendingUrls().length });
    try {
      await this.runner({
        urls: this.pendingUrls(),
        urlMessages: this.urlMessages,
        onEvent: event => this.recordEvent(event),
        control: {
          isCancelled: () => this.cancelRequested,
          waitUntilRunnable: () => this.waitUntilRunnable(),
        },
      });
      await this.setStatus(this.cancelRequested ? 'cancelled' : 'completed');
    } catch (err) {
      this.error = err.message ?? String(err);
      await this.setStatus(this.cancelRequested ? 'cancelled' : 'failed');
      logger.error('job.failed', 'Archive job failed.', { jobId: this.id, error: this.error });
    } finally {
      this.finishedAt = new Date().toISOString();
      this.updatedAt = this.finishedAt;
      this.resolveWaiters();
      await this.persist();
      logger.info('job.finished', 'Archive job reached a terminal state.', { jobId: this.id, status: this.status, processed: this.processed });
    }
  }

  async recordEvent(event: ArchiveEvent) {
    const sequenced = { ...event, sequence: ++this.sequence, at: new Date().toISOString() };
    this.events.push(sequenced);
    if (this.events.length > 600) this.events.shift();
    if (event.type === 'done') {
      this.processed++;
      this.succeeded++;
    } else if (event.type === 'error') {
      this.processed++;
      this.failed++;
    } else if (event.type === 'skipped') {
      this.processed++;
      this.skipped++;
    }
    this.updatedAt = sequenced.at;
    await this.persist();
  }

  async pause() {
    if (this.status !== 'running') throw new Error('Only a running job can be paused.');
    this.pauseRequested = true;
    await this.setStatus('paused');
  }

  async resume() {
    if (this.status !== 'paused') throw new Error('Only a paused job can be resumed.');
    this.pauseRequested = false;
    if (!this.runPromise) {
      this.status = 'queued';
      this.updatedAt = new Date().toISOString();
      await this.persist();
      this.start();
      return;
    }
    await this.setStatus('running');
    this.resolveWaiters();
  }

  async cancel() {
    if (!ACTIVE_STATUSES.has(this.status)) throw new Error('This job is no longer active.');
    this.cancelRequested = true;
    this.pauseRequested = false;
    await this.setStatus('cancelling');
    this.resolveWaiters();
  }

  async waitUntilRunnable() {
    if (!this.pauseRequested || this.cancelRequested) return;
    await new Promise<void>(resolve => this.waiters.push(resolve));
  }

  resolveWaiters() {
    const waiters = this.waiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  async setStatus(status: JobStatus) {
    this.status = status;
    this.updatedAt = new Date().toISOString();
    await this.persist();
  }

  toStored(): StoredJob {
    return {
      id: this.id,
      urls: this.urls,
      urlMessages: this.urlMessages,
      status: this.status,
      total: this.total,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      skipped: this.skipped,
      sequence: this.sequence,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      finishedAt: this.finishedAt,
      events: this.events,
    };
  }

  serialize({ after = 0 } = {}) {
    return {
      id: this.id,
      status: this.status,
      total: this.total,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      skipped: this.skipped,
      error: this.error,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      finishedAt: this.finishedAt,
      events: this.events.filter(event => event.sequence > after),
    };
  }
}

export function createJobManager({ runner, store = { listStoredJobs, saveStoredJob } }: { runner: ArchiveRunner; store?: JobStore }) {
  const jobs = new Map<string, ArchiveJob>();

  return {
    async init() {
      const restoredJobs = await store.listStoredJobs();
      for (const restored of restoredJobs) {
        if (restored.status === 'running' || restored.status === 'cancelling') restored.status = 'queued';
        const job = new ArchiveJob({ runner, store, restored });
        jobs.set(job.id, job);
      }
      const resumable = [...jobs.values()].find(job => job.status === 'queued');
      if (resumable) {
        logger.info('job.recovered', 'Resuming archive job after server restart.', { jobId: resumable.id });
        resumable.start();
      }
      return jobs.size;
    },

    async create({ urls, urlMessages = {} }: { urls: string[]; urlMessages?: Record<string, string> }) {
      const activeJob = [...jobs.values()].find(job => ACTIVE_STATUSES.has(job.status));
      if (activeJob) {
        const err = new Error('Another archive job is already active.') as Error & { code: string; job: ArchiveJob };
        err.code = 'JOB_ACTIVE';
        err.job = activeJob;
        throw err;
      }

      const job = new ArchiveJob({ urls, urlMessages, runner, store });
      jobs.set(job.id, job);
      await job.persist();
      job.start();
      return job;
    },

    get(id: string) {
      return jobs.get(id) || null;
    },

    hasActiveJob() {
      return [...jobs.values()].some(job => ACTIVE_STATUSES.has(job.status));
    },

    isTerminal(status: JobStatus) {
      return TERMINAL_STATUSES.has(status);
    },
  };
}
