export default function LoadingSkeleton({ type = 'card' }) {
  if (type === 'table') {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-slate-100 rounded-lg mb-4"></div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-16 bg-slate-50 rounded-lg mb-2 border border-slate-100"></div>
        ))}
      </div>
    );
  }

  if (type === 'chart') {
    return (
      <div className="animate-pulse bg-slate-50 border border-slate-100 rounded-xl p-5 h-72 flex items-end gap-2">
        <div className="w-full h-full flex flex-col justify-between pt-4 pb-8 border-l border-b border-slate-200 px-4">
           <div className="flex items-end h-full gap-4 w-full justify-between">
              {[40, 70, 45, 90, 65, 80, 50].map((h, i) => (
                <div key={i} className="w-full bg-slate-200 rounded-t-sm" style={{ height: `${h}%` }}></div>
              ))}
           </div>
        </div>
      </div>
    );
  }

  // Default card skeleton
  return (
    <div className="animate-pulse bg-white border border-slate-100 rounded-xl p-5 shadow-sm">
      <div className="flex justify-between items-start mb-4">
        <div className="h-4 bg-slate-200 rounded w-1/3"></div>
        <div className="h-10 w-10 bg-slate-100 rounded-lg"></div>
      </div>
      <div className="h-8 bg-slate-200 rounded w-1/2 mb-4"></div>
      <div className="h-4 bg-slate-100 rounded w-1/4"></div>
    </div>
  );
}
