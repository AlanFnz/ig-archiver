interface ProgressBarProps {
  processed: number;
  total: number;
}

export function ProgressBar({ processed, total }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="mt-2.5">
      <div className="h-1 bg-[#1e1e2e] rounded-sm overflow-hidden">
        <div
          className="h-full rounded-sm transition-[width] duration-350 ease-out"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #7b5ea7, #4a90d9)',
          }}
        />
      </div>
      {total > 0 && (
        <p className="mt-2 text-[11px] text-[#606080] text-right">
          {processed} / {total} links
        </p>
      )}
    </div>
  );
}
