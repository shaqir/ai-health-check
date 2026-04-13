export default function LoadingSkeleton({ type = 'card' }) {
  const pulse = 'animate-pulse bg-surface-elevated rounded-md';

  if (type === 'table') {
    return (
      <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden" aria-busy="true" aria-label="Loading table">
        <div className={`h-10 ${pulse} m-4`} />
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 px-4 py-3">
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
      <div className="bg-surface rounded-lg border border-border shadow-sm p-5" aria-busy="true" aria-label="Loading chart">
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
    <div className="bg-surface rounded-lg border border-border shadow-sm p-4" aria-busy="true" aria-label="Loading">
      <div className="flex justify-between">
        <div>
          <div className={`h-3 w-20 ${pulse} mb-2`} />
          <div className={`h-6 w-16 ${pulse}`} />
        </div>
        <div className={`h-9 w-9 ${pulse} rounded-md`} />
      </div>
      <div className={`h-3 w-24 ${pulse} mt-3`} />
    </div>
  );
}
