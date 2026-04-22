import { Cpu, Scale } from 'lucide-react';
import ModelBadge from '../common/ModelBadge';
import { InfoTip } from '../common/Tooltip';

// Role-specific visual treatment. Actor is the primary workhorse (warmer
// accent); judge is the auditor/check (cooler accent). Keeps the two
// cards distinguishable at a glance even in grayscale.
const ROLE_STYLE = {
  actor: {
    icon: Cpu,
    accent: 'text-amber-600 dark:text-amber-400',
    accentBg: 'bg-amber-50 dark:bg-amber-900/30',
    accentBorder: 'border-amber-200 dark:border-amber-800',
    label: 'Actor',
    subtitle: 'Service under test',
  },
  judge: {
    icon: Scale,
    accent: 'text-sky-600 dark:text-sky-400',
    accentBg: 'bg-sky-50 dark:bg-sky-900/30',
    accentBorder: 'border-sky-200 dark:border-sky-800',
    label: 'Judge',
    subtitle: 'Independent scorer',
  },
};

export default function ModelCard({ role, model, todayUsage }) {
  const style = ROLE_STYLE[role] || ROLE_STYLE.actor;
  const Icon = style.icon;

  return (
    <div className="bg-surface rounded-xl border border-hairline overflow-hidden">
      {/* Role strip across the top — instantly distinguishes the two cards */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-hairline ${style.accentBg}`}>
        <Icon size={14} strokeWidth={2} className={style.accent} />
        <span className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${style.accent}`}>
          {style.label}
        </span>
        <span className="text-[11px] text-text-subtle">· {style.subtitle}</span>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Model id + purpose */}
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <ModelBadge model={model.id} />
            <span className="text-[11px] text-text-subtle">by {model.provider}</span>
          </div>
          <p className="text-[12px] text-text-muted mt-2 leading-relaxed">
            {model.purpose}
          </p>
        </div>

        {/* Pricing — input + output side-by-side */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[11px] font-medium text-text-subtle uppercase tracking-[0.08em]">
              Pricing
            </span>
            <InfoTip
              size={10}
              content={`Per million tokens. Input tokens are what you send to ${model.id}; output tokens are what it returns. The cost estimator charges both against the daily budget.`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <PriceTile label="Input" usd={model.pricing?.input_per_million_usd} />
            <PriceTile label="Output" usd={model.pricing?.output_per_million_usd} />
          </div>
        </div>

        {/* Today's activity chip */}
        <div className="pt-3 border-t border-hairline">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[11px] font-medium text-text-subtle uppercase tracking-[0.08em]">
              Today
            </span>
            <InfoTip
              size={10}
              content="Count and cost of calls this role produced since midnight UTC. Confirms both models are actually being exercised, not just configured."
            />
          </div>
          {todayUsage ? (
            <div className="flex items-baseline gap-3 font-mono tabular-nums">
              <span className="text-[18px] font-semibold text-text">
                {todayUsage.calls.toLocaleString()}
              </span>
              <span className="text-[11px] text-text-subtle">
                call{todayUsage.calls === 1 ? '' : 's'}
              </span>
              <span className="text-[14px] font-semibold text-text">
                ${todayUsage.cost_usd.toFixed(4)}
              </span>
              <span className="text-[11px] text-text-subtle">spent</span>
            </div>
          ) : (
            <p className="text-[12px] text-text-subtle italic">
              No activity yet today.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function PriceTile({ label, usd }) {
  const hasPrice = Number.isFinite(usd);
  return (
    <div className="bg-surface-elevated rounded-lg px-3 py-2">
      <p className="text-[10px] font-medium text-text-subtle uppercase tracking-tight">{label}</p>
      <p className="text-[14px] font-semibold font-mono tabular-nums text-text mt-0.5">
        {hasPrice ? (
          <>${usd.toFixed(2)}<span className="text-[10px] text-text-subtle font-normal"> / 1M tok</span></>
        ) : (
          <span className="text-text-subtle font-normal">— not listed</span>
        )}
      </p>
    </div>
  );
}
