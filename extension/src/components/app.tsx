import { useState, useRef } from 'react';
import type { Platform } from '../platform/types';
import type { ScanState, StatusEntry, StatusType } from '../types';
import { archiveStream } from '../lib/archiveStream';
import { truncate } from '../lib/truncate';
import { SCROLL_LOADS } from '../lib/config';
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
  statusFeed: [],
};

export function App({ platform }: AppProps) {
  const [state, setState] = useState<ScanState>(initialState);
  const idRef = useRef(0);

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
    setState({ phase: 'scanning', processed: 0, total: 0, statusFeed: [] });
    idRef.current = 0;

    try {
      for (let i = 0; i < SCROLL_LOADS; i++) {
        setSingleStatus(`Loading conversation history… (${i + 1} / ${SCROLL_LOADS})`, 'info');
        const hasMore = await platform.scrollOnce();
        if (!hasMore) break;
      }

      setSingleStatus('Scanning for shared posts and reels…', 'info');
      const { urls } = await platform.scrapeLinks();

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
            `Found <strong>${urls.length}</strong> external link${urls.length !== 1 ? 's' : ''}. Sending to server…`,
            'info',
          ),
        ],
      }));

      let processed = 0;

      for await (const event of archiveStream(urls)) {
        switch (event.type) {
          case 'progress':
            processed = event.index;
            setState(s => ({
              ...s,
              processed,
              statusFeed: [
                makeEntry(
                  `Processing link ${event.index} of ${urls.length}: <em>${truncate(event.url, 45)}</em>`,
                  'info',
                ),
              ],
            }));
            break;

          case 'done':
            appendEntry(
              `Archived: <em>${truncate(event.url, 45)}</em> — ${event.category}`,
              'success',
            );
            break;

          case 'error':
            appendEntry(
              `Failed: <em>${truncate(event.url, 45)}</em> — ${event.message}`,
              'error',
            );
            break;
        }
      }

      const finalType = processed === urls.length ? 'success' : 'warning';
      appendEntry(
        `Done! Archived ${processed} of ${urls.length} link${urls.length !== 1 ? 's' : ''}.`,
        finalType,
      );

      setState(s => ({ ...s, phase: 'done', processed: urls.length }));
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
    <div className="w-80 min-h-45 bg-[#0f0f13] text-[#e8e8f0] p-5 font-sans">
      <Header />
      <ScanButton onClick={handleScan} disabled={isActive} />
      {showProgress && <ProgressBar processed={state.processed} total={state.total} />}
      <StatusFeed entries={state.statusFeed} />
    </div>
  );
}
