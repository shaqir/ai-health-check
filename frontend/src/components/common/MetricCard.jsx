import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { InfoTip } from './Tooltip';

const TONE = {
  blue:   { ink: 'text-accent',          bg: 'bg-accent-weak',           hex: 'var(--accent)' },
  green:  { ink: 'text-status-healthy',  bg: 'bg-status-healthy-muted',  hex: 'var(--status-healthy)' },
  amber:  { ink: 'text-status-degraded', bg: 'bg-status-degraded-muted', hex: 'var(--status-degraded)' },
  red:    { ink: 'text-status-failing',  bg: 'bg-status-failing-muted',  hex: 'var(--status-failing)' },
  purple: { ink: 'text-status-paused',   bg: 'bg-status-paused-muted',   hex: 'var(--status-paused)' },
  slate:  { ink: 'text-text-subtle',     bg: 'bg-surface-elevated',      hex: 'var(--color-text-subtle)' },
};

// Chip conveys the verdict, not the raw direction. Arrow, color and label all
// agree: Improving is always up+green, Worsening is always down+red. For
// "lower is better" metrics (error/latency), a raw trend of 'up' means
// worsening — the chip flips to down+red accordingly.
const CHIP = {
  good:   { ink: 'text-status-healthy', bg: 'bg-status-healthy-muted', label: 'Improving', Icon: ArrowUp   },
  bad:    { ink: 'text-status-failing', bg: 'bg-status-failing-muted', label: 'Worsening', Icon: ArrowDown },
  steady: { ink: 'text-text-subtle',    bg: 'bg-surface-elevated',     label: 'Stable',    Icon: Minus     },
};

function resolveChip(trend, higherIsBetter) {
  if (trend === 'up')   return higherIsBetter ? CHIP.good : CHIP.bad;
  if (trend === 'down') return higherIsBetter ? CHIP.bad  : CHIP.good;
  return CHIP.steady;
}

const TREND_TIP =
  'Direction vs. the previous comparable window (e.g. this week vs. last week). ' +
  'Improving = the metric moved in the good direction by more than 5%. ' +
  'Worsening = it moved in the bad direction by more than 5%. ' +
  'Stable = change is within ±5%, or either window has fewer than 3 samples ' +
  '(we refuse to draw an arrow on noise).';

export default function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  color = 'blue',
  tooltip,
  qualifier,
  caption,
  higherIsBetter = true,
  sparklineData,
  sparklineKey,
}) {
  const tone = TONE[color] || TONE.blue;
  const chip = trend ? resolveChip(trend, higherIsBetter) : null;
  const hasSparkline = Array.isArray(sparklineData) && sparklineData.length > 1 && sparklineKey;

  return (
    <div
      className="relative bg-surface rounded-2xl border border-hairline p-5 shadow-sm transition-spring hover:shadow-md hover:-translate-y-0.5 overflow-hidden"
      style={{
        backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, ${tone.hex} 9%, transparent) 0%, transparent 55%)`,
      }}
      aria-label={`${title}: ${value}`}
    >
      {/* Header: label + icon badge */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-text-subtle flex items-center gap-1.5 min-w-0">
          <span className="truncate">{title}</span>
          {qualifier && (
            <span className={`normal-case font-medium tracking-tight ${tone.ink} opacity-90`}>
              · {qualifier}
            </span>
          )}
          {tooltip && <InfoTip content={tooltip} size={11} />}
        </p>
        {Icon && (
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center ${tone.bg} ${tone.ink}`}
            style={{ boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tone.hex} 22%, transparent)` }}
            aria-hidden="true"
          >
            <Icon size={16} strokeWidth={1.75} />
          </div>
        )}
      </div>

      {/* Hero value + semantic trend chip */}
      <div className="flex items-end justify-between gap-3">
        <h3 className="text-[36px] leading-[1] font-semibold text-text tracking-[-0.03em] tabular-nums">
          {value}
        </h3>
        {chip && (
          <div
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-pill text-[11px] font-medium ${chip.bg} ${chip.ink}`}
            title={TREND_TIP}
            aria-label={`${chip.label}. ${TREND_TIP}`}
          >
            <chip.Icon size={11} strokeWidth={2.25} />
            <span className="tracking-tight">{chip.label}</span>
          </div>
        )}
      </div>

      {/* Always-visible semantic caption — disambiguates what the number does
          and doesn't measure, without requiring a hover. */}
      {caption && (
        <p className={`mt-2.5 text-[11px] leading-snug ${tone.ink} opacity-90`}>
          {caption}
        </p>
      )}

      {/* Sparkline rail (or reserved whitespace to keep cards equal height) */}
      <div className={`${caption ? 'mt-3' : 'mt-4'} h-10 -mx-1 pointer-events-none`}>
        {hasSparkline && (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparklineData} margin={{ top: 2, right: 4, bottom: 2, left: 4 }}>
              <YAxis hide domain={['dataMin', 'dataMax']} />
              <Line
                type="monotone"
                dataKey={sparklineKey}
                stroke={tone.hex}
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
