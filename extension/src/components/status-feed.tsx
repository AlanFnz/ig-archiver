import type { StatusEntry, StatusType } from '../types';

const dotColor: Record<StatusType, string> = {
  info: '#4a90d9',
  success: '#4caf82',
  error: '#e05c5c',
  warning: '#d4a843',
};

interface StatusFeedProps {
  entries: StatusEntry[];
}

export function StatusFeed({ entries }: StatusFeedProps) {
  if (entries.length === 0) return null;

  return (
    <div className="mt-3.5 min-h-12 flex flex-col gap-0.5">
      {entries.map(entry => (
        <div key={entry.id} className="flex items-start gap-[7px] text-xs text-[#9090b0] leading-relaxed">
          <span
            className="w-1.5 h-1.5 rounded-full mt-[5px] flex-shrink-0"
            style={{ background: dotColor[entry.type] }}
          />
          <span className="flex-1" dangerouslySetInnerHTML={{ __html: entry.message }} />
        </div>
      ))}
    </div>
  );
}
