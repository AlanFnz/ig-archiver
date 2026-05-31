interface ProgressBarProps {
  processed: number;
  total: number;
  failed?: number;
}

export function ProgressBar({ processed, total, failed = 0 }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="mt-2.5">
      <div className="h-1.5 bg-white/6 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #7b5ea7, #4a90d9)',
          }}
        />
      </div>
      {total > 0 && (
        <p className="mt-2 text-[11px] text-[#77778c] text-right tabular-nums">
          {processed} / {total} complete{failed > 0 ? ` · ${failed} failed` : ''}
        </p>
      )}
    </div>
  );
}
