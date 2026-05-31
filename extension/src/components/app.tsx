import { useState, useRef, useEffect } from 'react';
import type { Platform } from '../platform/types';
import type { ScanState, StatusEntry, StatusType } from '../types';
import { archiveStream } from '../lib/archiveStream';
import { truncate } from '../lib/truncate';
import { DEFAULT_SERVER_URL, getServerUrl, saveServerUrl, SCROLL_LOADS } from '../lib/config';
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
  statusFeed: [],
};

export function App({ platform }: AppProps) {
  const [state, setState] = useState<ScanState>(initialState);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsValue, setSettingsValue] = useState(DEFAULT_SERVER_URL);
  const [settingsError, setSettingsError] = useState('');
  const idRef = useRef(0);

  useEffect(() => {
    getServerUrl().then(url => {
      setServerUrl(url);
      setSettingsValue(url);
      return checkServer(url);
    }).catch(() => setServerOnline(false));
  }, []);

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

  function appendEntry(message: string, type: StatusType) {
    const entry = makeEntry(message, type);
    setState(s => ({
      ...s,
      statusFeed: [...s.statusFeed, entry].slice(-MAX_FEED_ENTRIES),
    }));
  }

  async function handleScan() {
    setState({ phase: 'scanning', processed: 0, total: 0, succeeded: 0, failed: 0, statusFeed: [] });
    idRef.current = 0;

    try {
      for (let i = 0; i < SCROLL_LOADS; i++) {
        setSingleStatus(`Loading conversation history… (${i + 1} / ${SCROLL_LOADS})`, 'info');
        const hasMore = await platform.scrollOnce();
        if (!hasMore) break;
      }

      setSingleStatus('Scanning for shared posts and reels…', 'info');
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

      let processed = 0;
      let succeeded = 0;
      let failed = 0;

      for await (const event of archiveStream(urls, urlMessages, serverUrl)) {
        switch (event.type) {
          case 'progress':
            appendEntry(
              `Processing link ${event.index} of ${urls.length}: ${truncate(event.url, 45)}`,
              'info',
            );
            break;

          case 'done':
            processed++;
            succeeded++;
            setState(s => ({ ...s, processed, succeeded }));
            appendEntry(
              `Archived: ${truncate(event.url, 45)} — ${event.category}`,
              'success',
            );
            break;

          case 'error':
            processed++;
            failed++;
            setState(s => ({ ...s, processed, failed }));
            appendEntry(
              `Failed: ${truncate(event.url, 45)} — ${event.message}`,
              'error',
            );
            break;
        }
      }

      const finalType = failed === 0 ? 'success' : 'warning';
      appendEntry(
        failed === 0
          ? `Done! Archived all ${succeeded} link${succeeded !== 1 ? 's' : ''}.`
          : `Done. Archived ${succeeded}; ${failed} failed.`,
        finalType,
      );

      setState(s => ({ ...s, phase: 'done', processed, succeeded, failed }));
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

  const isActive = state.phase === 'scanning' || state.phase === 'archiving';
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
            <button onClick={handleSaveSettings} className="rounded-lg bg-white/8 px-3 text-[11px] font-semibold hover:bg-white/12">
              Save
            </button>
          </div>
          {settingsError && <p className="mt-1.5 text-[10px] text-[#ef7a7a]">{settingsError}</p>}
        </section>
      )}
      <ScanButton onClick={handleScan} disabled={isActive || serverOnline !== true} />
      {showProgress && <ProgressBar processed={state.processed} total={state.total} failed={state.failed} />}
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
