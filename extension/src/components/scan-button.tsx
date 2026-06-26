interface ScanButtonProps {
  onClick: () => void;
  disabled: boolean;
}

export function ScanButton({ onClick, disabled }: ScanButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="scan-button group relative w-full overflow-hidden py-3 px-4 text-white text-[13px] font-semibold tracking-[0.01em] rounded-xl border border-white/10 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed hover:enabled:-translate-y-px active:enabled:translate-y-0"
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform duration-300 group-hover:rotate-[-8deg]" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7.5V5a1 1 0 0 1 1-1h2.5M16.5 4H19a1 1 0 0 1 1 1v2.5M20 16.5V19a1 1 0 0 1-1 1h-2.5M7.5 20H5a1 1 0 0 1-1-1v-2.5" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
        Scan loaded messages
      </span>
    </button>
  );
}
