import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';
import { InfoTip } from './Tooltip';

export default function MetricCard({ title, value, icon: Icon, trend, trendValue, color = 'blue', tooltip }) {
  const iconColors = {
    blue: 'bg-accent-weak text-accent',
    green: 'bg-status-healthy-muted text-status-healthy',
    amber: 'bg-status-degraded-muted text-status-degraded',
    red: 'bg-status-failing-muted text-status-failing',
    purple: 'bg-status-paused-muted text-status-paused',
    slate: 'bg-surface-elevated text-text-subtle',
  };

  return (
    <div className="bg-surface rounded-xl border border-hairline p-5 shadow-sm transition-standard hover:shadow-md" aria-label={`${title}: ${value}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="text-[11px] font-medium text-text-muted tracking-tight mb-1.5 flex items-center gap-1">
            {title}
            {tooltip && <InfoTip content={tooltip} size={11} />}
          </p>
          <h3 className="text-[28px] leading-none font-semibold text-text tracking-[-0.022em] tabular-nums">{value}</h3>
        </div>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconColors[color] || iconColors.blue}`}>
            <Icon size={15} strokeWidth={1.75} />
          </div>
        )}
      </div>

      {trend && (
        <div className="mt-4 flex items-center text-[11px]">
          {trend === 'up' && <ArrowUpRight size={13} strokeWidth={1.75} className="text-status-healthy mr-1" />}
          {trend === 'down' && <ArrowDownRight size={13} strokeWidth={1.75} className="text-status-failing mr-1" />}
          {trend === 'neutral' && <Minus size={13} strokeWidth={1.75} className="text-text-subtle mr-1" />}

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
