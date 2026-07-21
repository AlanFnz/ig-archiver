interface HeaderProps {
  serverOnline: boolean | null;
  onSettings: () => void;
  settingsOpen: boolean;
}

export function Header({ serverOnline, onSettings, settingsOpen }: HeaderProps) {
  return (
    <div className="flex items-center justify-between mb-4.5">
      <div className="flex items-center gap-2.5">
        <div className="brand-mark w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M7 17.5h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 8.4 4.6 4.6 0 0 0 7 17.5Z" />
            <path d="m9.5 12 2.5-2.5 2.5 2.5M12 9.8v5" />
          </svg>
        </div>
        <div>
          <h1 className="display-type text-[15px] font-semibold tracking-[-0.01em] text-[#f4f2ff]">IG Archiver</h1>
          <p className="text-[9px] uppercase tracking-[0.13em] text-[#69697d]">Archive posts from Instagram DMs</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[10px] text-[#8c8c9e]" title="Archive server status">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            serverOnline === true
              ? 'bg-[#4caf82]'
              : serverOnline === false
              ? 'bg-[#e05c5c]'
              : 'bg-[#8c8c9e] animate-pulse'
          }`}
        />
        <span>
          {serverOnline === true
            ? 'Online'
            : serverOnline === false
            ? 'Offline'
            : 'Checking...'}
        </span>
        </div>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Connection settings"
          aria-expanded={settingsOpen}
          className={`icon-button ${settingsOpen ? 'active' : ''}`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.55 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.1A1.7 1.7 0 0 0 4.2 8.55a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.55 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.1A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.55a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
