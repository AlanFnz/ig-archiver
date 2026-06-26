import { useState, useRef, useEffect } from 'react';
import type { Platform } from '../platform/types';
import type { ScanState, StatusEntry, StatusType } from '../types';
import { truncate } from '../lib/truncate';
import { DEFAULT_SERVER_URL, getServerUrl, saveServerUrl, SCROLL_LOADS } from '../lib/config';
import {
  clearActiveArchiveJob,
  controlArchiveJob,
  createArchiveJob,
  getActiveArchiveJob,
  getArchiveJob,
  isTerminalJob,
  saveActiveArchiveJob,
  type ArchiveJob,
  type ArchiveJobEvent,
  type ArchiveJobStatus,
} from '../lib/archiveJobs';
import { Header } from './header';
import { ScanButton } from './scan-button';
import { ProgressBar } from './progress-bar';
import { StatusFeed } from './status-feed';

const MAX_FEED_ENTRIES = 6;

interface AppProps {
  platform: Platform;
}

const initialState: ScanState = {
  phase: 'idle',
  processed: 0,
  total: 0,
  succeeded: 0,
  failed: 0,
  skipped: 0,
  statusFeed: [],
};

export function App({ platform }: AppProps) {
  const [state, setState] = useState<ScanState>(initialState);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsValue, setSettingsValue] = useState(DEFAULT_SERVER_URL);
  const [settingsError, setSettingsError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<ArchiveJobStatus | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    Promise.all([getServerUrl(), getActiveArchiveJob()]).then(([configuredUrl, activeJob]) => {
      const url = activeJob?.serverUrl || configuredUrl;
      setServerUrl(url);
      setSettingsValue(url);
      if (activeJob) setActiveJobId(activeJob.id);
      return checkServer(url);
    }).catch(() => setServerOnline(false));
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const job = await getArchiveJob(serverUrl, activeJobId!);
        if (disposed) return;
        applyJob(job);
        if (isTerminalJob(job.status)) {
          await clearActiveArchiveJob(job.id);
          if (!disposed) setActiveJobId(null);
          return;
        }
        timer = setTimeout(poll, 800);
      } catch (err) {
        if (disposed) return;
        const status = (err as Error & { status?: number }).status;
        if (status === 404) {
          await clearActiveArchiveJob(activeJobId!);
          setActiveJobId(null);
          setJobStatus(null);
        } else {
          timer = setTimeout(poll, 1_500);
        }
      }
    }

    poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeJobId, serverUrl]);

  async function checkServer(url: string) {
    setServerOnline(null);
    try {
      const res = await fetch(`${url}/health`);
      setServerOnline(res.ok);
      return res.ok;
    } catch {
      setServerOnline(false);
      return false;
    }
  }

  async function handleSaveSettings() {
    setSettingsError('');
    if (activeJobId) {
      setSettingsError('Finish or stop the active archive job before changing servers.');
      return;
    }
    try {
      const url = await saveServerUrl(settingsValue);
      setServerUrl(url);
      setSettingsValue(url);
      await checkServer(url);
      setShowSettings(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    }
  }

  function nextId() {
    return ++idRef.current;
  }

  function makeEntry(message: string, type: StatusType): StatusEntry {
    return { id: nextId(), message, type };
  }

  function setSingleStatus(message: string, type: StatusType) {
    setState(s => ({ ...s, statusFeed: [makeEntry(message, type)] }));
  }

  function entryFromJobEvent(event: ArchiveJobEvent): StatusEntry {
    switch (event.type) {
      case 'progress':
        return { id: event.sequence, message: `Processing ${truncate(event.url, 45)}`, type: 'info' };
      case 'done':
        return { id: event.sequence, message: `Archived: ${truncate(event.url, 45)} — ${event.category}`, type: 'success' };
      case 'skipped':
        return { id: event.sequence, message: `Skipped existing: ${truncate(event.url, 45)}`, type: 'info' };
      case 'error':
        return { id: event.sequence, message: `Failed: ${truncate(event.url, 45)} — ${event.message}`, type: 'error' };
    }
  }

  function applyJob(job: ArchiveJob) {
    setJobStatus(job.status);
    const entries = job.events.slice(-5).map(entryFromJobEvent);
    const statusId = (job.events.at(-1)?.sequence || 0) + 1_000_000;

    if (job.status === 'paused') {
      entries.push({ id: statusId, message: 'Paused. Active captures will finish; no new links will start.', type: 'warning' });
    } else if (job.status === 'cancelling') {
      entries.push({ id: statusId, message: 'Stopping after active captures finish…', type: 'warning' });
    } else if (job.status === 'completed') {
      entries.push({ id: statusId, message: `Done. Archived ${job.succeeded}; skipped ${job.skipped}; ${job.failed} failed.`, type: job.failed ? 'warning' : 'success' });
    } else if (job.status === 'cancelled') {
      entries.push({ id: statusId, message: `Stopped. Kept ${job.succeeded} archived; skipped ${job.skipped}; ${job.total - job.processed} not processed.`, type: 'warning' });
    } else if (job.status === 'failed') {
      entries.push({ id: statusId, message: `Job failed: ${job.error || 'Unknown server error.'}`, type: 'error' });
    }

    setState({
      phase: job.status === 'failed' ? 'error' : isTerminalJob(job.status) ? 'done' : 'archiving',
      processed: job.processed,
      total: job.total,
      succeeded: job.succeeded,
      failed: job.failed,
      skipped: job.skipped,
      statusFeed: entries.slice(-MAX_FEED_ENTRIES),
    });
  }

  async function handleLoadHistory() {
    setHistoryLoading(true);
    let loaded = 0;
    try {
      for (let i = 0; i < SCROLL_LOADS; i++) {
        setSingleStatus(`Trying to load older messages… (${i + 1} / ${SCROLL_LOADS})`, 'info');
        const hasMore = await platform.scrollOnce();
        if (!hasMore) break;
        loaded++;
      }
      setSingleStatus(
        loaded > 0
          ? `Loaded ${loaded} older message batch${loaded === 1 ? '' : 'es'}. You can scan now.`
          : 'Automatic history loading was unavailable. Scroll upward manually, then scan loaded messages.',
        loaded > 0 ? 'success' : 'warning',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSingleStatus(`Could not load older messages: ${message}`, 'warning');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function handleScan() {
    setState({ phase: 'scanning', processed: 0, total: 0, succeeded: 0, failed: 0, skipped: 0, statusFeed: [] });
    idRef.current = 0;

    try {
      setSingleStatus('Scanning loaded messages for shared posts and reels…', 'info');
      const { urls, urlMessages } = await platform.scrapeLinks();

      if (urls.length === 0) {
        setState(s => ({
          ...s,
          phase: 'done',
          statusFeed: [makeEntry('No external links found on this page.', 'warning')],
        }));
        return;
      }

      setState(s => ({
        ...s,
        phase: 'archiving',
        total: urls.length,
        statusFeed: [
          makeEntry(
            `Found ${urls.length} external link${urls.length !== 1 ? 's' : ''}. Sending to server…`,
            'info',
          ),
        ],
      }));
      try {
        const job = await createArchiveJob(serverUrl, urls, urlMessages);
        await saveActiveArchiveJob({ id: job.id, serverUrl });
        setActiveJobId(job.id);
        applyJob(job);
      } catch (err) {
        const existingJob = (err as Error & { job?: ArchiveJob }).job;
        if (existingJob) {
          await saveActiveArchiveJob({ id: existingJob.id, serverUrl });
          setActiveJobId(existingJob.id);
          applyJob(existingJob);
          return;
        }
        throw err;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState(s => ({
        ...s,
        phase: 'error',
        statusFeed: [makeEntry(`Error: ${message}`, 'error')],
      }));
      console.error('[ig-archiver]', err);
    }
  }

  async function handleJobControl(action: 'pause' | 'resume' | 'cancel') {
    if (!activeJobId) return;
    try {
      const job = await controlArchiveJob(serverUrl, activeJobId, action);
      applyJob(job);
    } catch (err) {
      const job = (err as Error & { job?: ArchiveJob }).job;
      if (job) applyJob(job);
      else setSingleStatus(`Could not ${action} job: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  const isActive = state.phase === 'scanning' || Boolean(activeJobId);
  const showProgress = state.phase === 'archiving' || state.phase === 'done';

  return (
    <main className="popup-shell w-90 min-h-64 overflow-hidden text-[#e8e8f0] p-5 border border-white/8 rounded-2xl shadow-[0_18px_60px_rgba(0,0,0,0.66)]">
      <div className="ambient-orb" aria-hidden="true" />
      <Header
        serverOnline={serverOnline}
        onSettings={() => setShowSettings(value => !value)}
        settingsOpen={showSettings}
      />
      {showSettings && (
        <section className="settings-panel mb-4" aria-label="Connection settings">
          <label htmlFor="server-url" className="block text-[10px] uppercase tracking-[0.14em] text-[#85859b] mb-1.5">
            Archive server
          </label>
          <div className="flex gap-2">
            <input
              id="server-url"
              value={settingsValue}
              onChange={event => setSettingsValue(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/8 bg-black/25 px-2.5 py-2 text-[11px] text-white outline-none focus:border-[#6fa8e7]/60"
              placeholder="http://localhost:3000"
            />
            <button
              onClick={handleSaveSettings}
              disabled={Boolean(activeJobId)}
              className="rounded-lg bg-white/8 px-3 text-[11px] font-semibold hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save
            </button>
          </div>
          {settingsError && <p className="mt-1.5 text-[10px] text-[#ef7a7a]">{settingsError}</p>}
        </section>
      )}
      <button
        type="button"
        onClick={handleLoadHistory}
        disabled={isActive || historyLoading || serverOnline !== true}
        className="history-button mb-2.5 w-full rounded-xl border border-white/7 bg-white/3 px-4 py-2.5 text-[11px] font-medium text-[#aaaabc] hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {historyLoading ? 'Loading older messages…' : 'Load older messages (experimental)'}
      </button>
      <ScanButton onClick={handleScan} disabled={isActive || historyLoading || serverOnline !== true} />
      {showProgress && <ProgressBar processed={state.processed} total={state.total} failed={state.failed} skipped={state.skipped} />}
      {activeJobId && (
        <section className="mt-3 rounded-xl border border-white/7 bg-black/15 p-2.5" aria-label="Archive job controls">
          <div className="flex gap-2">
            {jobStatus === 'paused' ? (
              <button
                type="button"
                onClick={() => handleJobControl('resume')}
                className="flex-1 rounded-lg bg-[#4caf82]/15 px-3 py-2 text-[11px] font-semibold text-[#86d5ad] hover:bg-[#4caf82]/22"
              >
                Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleJobControl('pause')}
                disabled={jobStatus !== 'running'}
                className="flex-1 rounded-lg bg-white/6 px-3 py-2 text-[11px] font-semibold text-[#b5b5c8] hover:bg-white/10 disabled:opacity-40"
              >
                Pause
              </button>
            )}
            <button
              type="button"
              onClick={() => handleJobControl('cancel')}
              disabled={jobStatus === 'cancelling'}
              className="flex-1 rounded-lg bg-[#e05c5c]/12 px-3 py-2 text-[11px] font-semibold text-[#ef8c8c] hover:bg-[#e05c5c]/20 disabled:opacity-40"
            >
              {jobStatus === 'cancelling' ? 'Stopping…' : 'Stop'}
            </button>
          </div>
          <p className="mt-2 text-center text-[9px] text-[#66667b]">Safe to close this popup—the server owns the job.</p>
        </section>
      )}
      <StatusFeed entries={state.statusFeed} />

      {serverOnline === true && (
        <div className="mt-4 pt-3.5 border-t border-[rgba(255,255,255,0.06)] flex justify-center">
          <a
            href={serverUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] font-semibold text-[#4a90d9] hover:text-[#7b5ea7] hover:underline transition-colors duration-200 flex items-center gap-1"
          >
            📊 Open Web Dashboard
          </a>
        </div>
      )}
    </main>
  );
}
