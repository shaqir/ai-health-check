export default function StatusBadge({ status, type = 'default' }) {
  // Determine color scheme based on status value and type
  let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';
  let dotClass = 'bg-slate-400';

  const s = status?.toLowerCase() || '';

  if (type === 'severity') {
    if (s === 'critical') { colorClass = 'bg-rose-100 text-rose-700 border-rose-200'; dotClass = 'bg-rose-500'; }
    else if (s === 'high') { colorClass = 'bg-orange-100 text-orange-700 border-orange-200'; dotClass = 'bg-orange-500'; }
    else if (s === 'medium') { colorClass = 'bg-amber-100 text-amber-700 border-amber-200'; dotClass = 'bg-amber-500'; }
    else if (s === 'low') { colorClass = 'bg-blue-100 text-blue-700 border-blue-200'; dotClass = 'bg-blue-500'; }
  } else if (type === 'environment') {
    if (s === 'prod' || s === 'production') { colorClass = 'bg-emerald-100 text-emerald-700 border-emerald-200'; dotClass = 'bg-emerald-500'; }
    else if (s === 'staging') { colorClass = 'bg-amber-100 text-amber-700 border-amber-200'; dotClass = 'bg-amber-500'; }
    else if (s === 'dev' || s === 'development') { colorClass = 'bg-blue-100 text-blue-700 border-blue-200'; dotClass = 'bg-blue-500'; }
  } else if (type === 'sensitivity') {
    if (s === 'public') { colorClass = 'bg-emerald-100 text-emerald-700 border-emerald-200'; dotClass = 'bg-emerald-500'; }
    else if (s === 'internal') { colorClass = 'bg-amber-100 text-amber-700 border-amber-200'; dotClass = 'bg-amber-500'; }
    else if (s === 'confidential' || s === 'restricted') { colorClass = 'bg-rose-100 text-rose-700 border-rose-200'; dotClass = 'bg-rose-500'; }
  } else {
    // default statuses
    if (s === 'active' || s === 'healthy' || s === 'passed') { colorClass = 'bg-emerald-100 text-emerald-700 border-emerald-200'; dotClass = 'bg-emerald-500'; }
    else if (s === 'degraded' || s === 'drifted' || s === 'warning') { colorClass = 'bg-amber-100 text-amber-700 border-amber-200'; dotClass = 'bg-amber-500'; }
    else if (s === 'down' || s === 'failed' || s === 'error') { colorClass = 'bg-rose-100 text-rose-700 border-rose-200'; dotClass = 'bg-rose-500'; }
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${colorClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`}></span>
      {status}
    </span>
  );
}
