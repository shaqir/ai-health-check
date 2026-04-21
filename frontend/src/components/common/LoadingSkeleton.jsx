export default function LoadingSkeleton({ type = 'card' }) {
  const pulse = 'animate-pulse bg-surface-elevated rounded-md';

  if (type === 'table') {
    return (
      <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden" aria-busy="true" aria-label="Loading table">
        <div className={`h-10 ${pulse} m-4`} />
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3 border-b border-hairline last:border-0">
              <div className={`h-4 flex-1 ${pulse}`} />
              <div className={`h-4 w-24 ${pulse}`} />
              <div className={`h-4 w-16 ${pulse}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'chart') {
    return (
      <div className="bg-surface rounded-xl border border-hairline shadow-xs p-5" aria-busy="true" aria-label="Loading chart">
        <div className={`h-4 w-32 ${pulse} mb-4`} />
        <div className="flex items-end gap-2 h-40">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={`flex-1 ${pulse}`} style={{ height: `${30 + Math.random() * 60}%` }} />
          ))}
        </div>
      </div>
    );
  }

  // Default: card
  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs p-5" aria-busy="true" aria-label="Loading">
      <div className="flex justify-between">
        <div>
          <div className={`h-3 w-20 ${pulse} mb-2.5`} />
          <div className={`h-7 w-20 ${pulse}`} />
        </div>
        <div className={`h-8 w-8 ${pulse} rounded-lg`} />
      </div>
      <div className={`h-3 w-28 ${pulse} mt-4`} />
    </div>
  );
}
