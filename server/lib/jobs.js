import crypto from 'crypto';

const ACTIVE_STATUSES = new Set(['queued', 'running', 'paused', 'cancelling']);
const TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'failed']);

class ArchiveJob {
  constructor({ urls, urlMessages, runner }) {
    this.id = crypto.randomUUID();
    this.urls = urls;
    this.urlMessages = urlMessages;
    this.runner = runner;
    this.status = 'queued';
    this.total = urls.length;
    this.processed = 0;
    this.succeeded = 0;
    this.failed = 0;
    this.skipped = 0;
    this.events = [];
    this.sequence = 0;
    this.error = null;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.finishedAt = null;
    this.pauseRequested = false;
    this.cancelRequested = false;
    this.waiters = [];
  }

  start() {
    this.runPromise = this.run();
  }

  async run() {
    this.setStatus('running');
    try {
      await this.runner({
        urls: this.urls,
        urlMessages: this.urlMessages,
        onEvent: event => this.recordEvent(event),
        control: {
          isCancelled: () => this.cancelRequested,
          waitUntilRunnable: () => this.waitUntilRunnable(),
        },
      });
      this.setStatus(this.cancelRequested ? 'cancelled' : 'completed');
    } catch (err) {
      this.error = err.message ?? String(err);
      this.setStatus(this.cancelRequested ? 'cancelled' : 'failed');
    } finally {
      this.finishedAt = new Date().toISOString();
      this.updatedAt = this.finishedAt;
      this.resolveWaiters();
    }
  }

  recordEvent(event) {
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
  }

  pause() {
    if (this.status !== 'running') throw new Error('Only a running job can be paused.');
    this.pauseRequested = true;
    this.setStatus('paused');
  }

  resume() {
    if (this.status !== 'paused') throw new Error('Only a paused job can be resumed.');
    this.pauseRequested = false;
    this.setStatus('running');
    this.resolveWaiters();
  }

  cancel() {
    if (!ACTIVE_STATUSES.has(this.status)) throw new Error('This job is no longer active.');
    this.cancelRequested = true;
    this.pauseRequested = false;
    this.setStatus('cancelling');
    this.resolveWaiters();
  }

  async waitUntilRunnable() {
    if (!this.pauseRequested || this.cancelRequested) return;
    await new Promise(resolve => this.waiters.push(resolve));
  }

  resolveWaiters() {
    const waiters = this.waiters.splice(0);
    waiters.forEach(resolve => resolve());
  }

  setStatus(status) {
    this.status = status;
    this.updatedAt = new Date().toISOString();
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

export function createJobManager({ runner }) {
  const jobs = new Map();

  return {
    create({ urls, urlMessages }) {
      const activeJob = Array.from(jobs.values()).find(job => ACTIVE_STATUSES.has(job.status));
      if (activeJob) {
        const err = new Error('Another archive job is already active.');
        err.code = 'JOB_ACTIVE';
        err.job = activeJob;
        throw err;
      }

      const job = new ArchiveJob({ urls, urlMessages, runner });
      jobs.set(job.id, job);
      job.start();
      return job;
    },

    get(id) {
      return jobs.get(id) || null;
    },

    hasActiveJob() {
      return Array.from(jobs.values()).some(job => ACTIVE_STATUSES.has(job.status));
    },

    isTerminal(status) {
      return TERMINAL_STATUSES.has(status);
    },
  };
}
