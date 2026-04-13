import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

export default function MetricCard({ title, value, icon: Icon, trend, trendValue, color = 'blue' }) {
  const iconColors = {
    blue: 'bg-accent-muted text-accent',
    green: 'bg-status-healthy-muted text-status-healthy',
    amber: 'bg-status-degraded-muted text-status-degraded',
    red: 'bg-status-failing-muted text-status-failing',
    purple: 'bg-status-paused-muted text-status-paused',
    slate: 'bg-surface-elevated text-text-subtle',
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4 shadow-sm" aria-label={`${title}: ${value}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-xs font-medium text-text-muted mb-1">{title}</p>
          <h3 className="text-xl font-semibold text-text tracking-tight tabular-nums">{value}</h3>
        </div>
        {Icon && (
          <div className={`p-2 rounded-md ${iconColors[color] || iconColors.blue}`}>
            <Icon size={16} strokeWidth={1.5} />
          </div>
        )}
      </div>

      {trend && (
        <div className="mt-3 flex items-center text-xs">
          {trend === 'up' && <ArrowUpRight size={14} strokeWidth={1.5} className="text-status-healthy mr-1" />}
          {trend === 'down' && <ArrowDownRight size={14} strokeWidth={1.5} className="text-status-failing mr-1" />}
          {trend === 'neutral' && <Minus size={14} strokeWidth={1.5} className="text-text-subtle mr-1" />}

          <span className={`font-medium tabular-nums ${
            trend === 'up' ? 'text-status-healthy' :
            trend === 'down' ? 'text-status-failing' :
            'text-text-subtle'
          }`}>
            {trendValue}
          </span>
          {trendValue && <span className="text-text-subtle ml-1">vs last period</span>}
        </div>
      )}
    </div>
  );
}
