import { useState, useEffect } from 'react';
import {
  Brain, DollarSign, Zap, ShieldCheck, Activity, Gauge, CreditCard,
  Shield, BarChart3, Ban, Cpu, LineChart as LineChartIcon
} from 'lucide-react';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/common/EmptyState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DataTable from '../components/common/DataTable';
import StatusBadge from '../components/common/StatusBadge';
import { InfoTip } from '../components/common/Tooltip';

const SECTIONS = [
  { id: 'model', label: 'Model & Pricing', icon: Cpu },
  { id: 'evaluation', label: 'Evaluation', icon: Activity },
  { id: 'usage', label: 'API Usage', icon: Zap },
  { id: 'safety', label: 'Safety', icon: Shield },
  { id: 'performance', label: 'Performance', icon: LineChartIcon },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [apiUsage, setApiUsage] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [safety, setSafety] = useState(null);
  // Initialize active section from URL hash so /settings#safety deep-links
  // straight into the Safety tab. Falls back to 'model' when the hash is
  // empty or points at an unknown section.
  const [active, setActive] = useState(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
    return SECTIONS.some(s => s.id === hash) ? hash : 'model';
  });
  // Live refresh indicator — matches Dashboard / Evaluations / Incidents.
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());

  const handleSectionChange = (id) => {
    setActive(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${id}`);
    }
  };

  const fetchAll = async (showLoading = false) => {
    if (showLoading) setError(null);
    try {
      const [c, u, p, s] = await Promise.all([
        api.get('/dashboard/settings'),
        api.get('/dashboard/api-usage'),
        api.get('/dashboard/performance'),
        api.get('/dashboard/api-safety'),
      ]);
      setConfig(c.data); setApiUsage(u.data); setPerformance(p.data); setSafety(s.data);
      setLastFetchAt(Date.now());
    } catch { if (showLoading) setError('Failed to load settings.'); }
    finally { if (showLoading) setLoading(false); }
  };

  useEffect(() => {
    fetchAll(true);
    // 60s — the data on this page (daily spend, token totals, blocked calls)
    // only changes on LLM-call cadence. 10s was overkill.
    const interval = setInterval(() => fetchAll(false), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;

  const callColumns = [
    {
      key: 'timestamp',
      label: 'Time',
      render: v => {
        if (!v) return <span className="font-mono text-xs text-text-subtle">—</span>;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return <span className="font-mono tabular-nums text-xs">{v}</span>;
        const short = d.toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        return (
          <span
            className="font-mono tabular-nums text-xs"
            title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
          >
            {short}
          </span>
        );
      },
    },
    { key: 'caller', label: 'Function', render: v => <span className="font-mono text-xs bg-surface-elevated px-1.5 py-0.5 rounded-xs">{v}</span> },
    { key: 'input_tokens', label: 'In', render: v => <span className="font-mono tabular-nums">{v?.toLocaleString()}</span> },
    { key: 'output_tokens', label: 'Out', render: v => <span className="font-mono tabular-nums">{v?.toLocaleString()}</span> },
    { key: 'cost_usd', label: 'Cost', render: v => <span className="font-mono tabular-nums font-medium">${v?.toFixed(4)}</span> },
    { key: 'latency_ms', label: 'Latency', render: v => <span className="font-mono tabular-nums">{v?.toFixed(0)}ms</span> },
    { key: 'status', label: 'Status', render: v => <StatusBadge status={v === 'success' ? 'healthy' : 'failed'} /> },
  ];

  if (loading) return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><LoadingSkeleton type="card" /><LoadingSkeleton type="card" /></div>
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); fetchAll(true); }} />;

  return (
    <div className="space-y-6">
      <PageHeader title="API & Settings" description="Model configuration, cost monitoring, safety scanner, and performance.">
        <div
          className="flex items-center gap-1.5"
          aria-label={`Last refreshed ${updatedLabel}, auto-refreshing every 60 seconds`}
          title={`Refreshes every 60 seconds. Last: ${updatedLabel}.`}
        >
          <span
            key={lastFetchAt}
            className="dash-pulse w-1.5 h-1.5 rounded-full bg-status-healthy"
            aria-hidden="true"
          />
          <span className="text-[11px] font-medium text-text-subtle tracking-tight tabular-nums">
            Updated {updatedLabel}
          </span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        {/* Left secondary nav */}
        <aside className="lg:sticky lg:top-24 self-start">
          <nav className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible" aria-label="Settings sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => handleSectionChange(id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={`shrink-0 flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] text-left transition-standard ${
                    isActive
                      ? 'bg-accent-weak text-text font-medium'
                      : 'text-text-muted hover:bg-surface-elevated hover:text-text'
                  }`}
                >
                  <Icon size={15} strokeWidth={1.5} className={isActive ? 'text-accent' : 'text-text-subtle'} />
                  {label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Right content panel */}
        <div className="space-y-5 min-w-0">
          {active === 'model' && config && (
            <>
              <Card icon={Brain} title="AI model">
                <Row label="Provider" value={config.ai_model.provider} />
                <Row label="Model" value={<span className="font-mono text-[12px] bg-surface-elevated px-1.5 py-0.5 rounded-xs">{config.ai_model.model}</span>} />
                <Row label="Max tokens" value={config.ai_model.max_tokens.toLocaleString()} mono />
                <Row label="Timeout" value={`${config.ai_model.timeout_seconds}s`} mono />
              </Card>
              <Card icon={CreditCard} title="Pricing">
                <Row label="Input" value={`$${config.pricing.input_per_million_usd} / 1M tokens`} mono />
                <Row label="Output" value={`$${config.pricing.output_per_million_usd} / 1M tokens`} mono />
                <p className="text-[11px] text-text-subtle pt-3 border-t border-hairline mt-2">Estimated from API response token counts.</p>
              </Card>
            </>
          )}

          {active === 'evaluation' && config && (
            <Card icon={Activity} title="Evaluation">
              <Row
                label="Drift threshold"
                value={`${config.evaluation.drift_threshold_pct}%`}
                mono
                tooltip="Quality score below which drift is flagged. Runs scoring lower than this trigger alerts."
              />
              <Row
                label="Health check"
                value={`${config.evaluation.health_check_schedule_minutes} min`}
                mono
                tooltip="How often the system pings each service to confirm it's reachable."
              />
              <Row
                label="Auto eval"
                value={`${config.evaluation.eval_schedule_minutes} min`}
                mono
                tooltip="How often the background scheduler runs evaluations against every active, non-confidential service with test cases. Saved as scheduled runs; drift alerts fire on threshold breach."
              />
            </Card>
          )}

          {active === 'usage' && apiUsage && config && (
            <>
              <Card icon={ShieldCheck} title="Budget & rate limits" badge="Configured in .env">
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <BudgetCard
                    label="Daily"
                    spent={apiUsage.daily.cost_usd}
                    budget={apiUsage.daily.budget_usd}
                    pct={apiUsage.daily.budget_pct_used}
                    tooltip="Total USD spent on the Claude API today vs. the daily cap. New calls are blocked at 100%."
                  />
                  <BudgetCard
                    label="Monthly"
                    spent={apiUsage.monthly.cost_usd}
                    budget={apiUsage.monthly.budget_usd}
                    pct={apiUsage.monthly.budget_pct_used}
                    tooltip="Total USD spent this month vs. the monthly cap. Prevents runaway costs."
                  />
                  <div className="bg-surface-elevated rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Gauge size={12} strokeWidth={1.5} className="text-text-subtle" />
                      <span className="text-[10px] font-medium text-text-subtle tracking-tight">Rate limit</span>
                      <InfoTip content="Max API calls per minute. Prevents bursts that could trigger provider-side throttling." size={10} />
                    </div>
                    <p className="text-xl font-semibold font-mono tabular-nums text-text">{config.budget.rate_limit_per_min}</p>
                    <p className="text-[10px] text-text-subtle">calls/min</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[12px] text-text-muted">
                  <div className="flex items-center gap-1.5"><ShieldCheck size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Budget blocks calls at limit</div>
                  <div className="flex items-center gap-1.5"><Gauge size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Rate limiter prevents bursts</div>
                </div>
              </Card>

              <Card icon={Zap} title="Token usage">
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <Stat label="Today calls" value={apiUsage.daily.calls} tooltip="Number of Claude API calls made today." />
                  <Stat label="Today tokens" value={apiUsage.daily.total_tokens.toLocaleString()} tooltip="Total input + output tokens used today. Tokens are roughly 4 characters each." />
                  <Stat label="Month calls" value={apiUsage.monthly.calls} tooltip="Total API calls made this calendar month." />
                  <Stat label="Month tokens" value={apiUsage.monthly.total_tokens.toLocaleString()} tooltip="Total tokens consumed this month, input and output combined." />
                </div>
                {apiUsage.breakdown.length > 0 && (
                  <div className="pt-3 border-t border-hairline space-y-1.5">
                    <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2">Cost by function</h4>
                    {apiUsage.breakdown.map(b => (
                      <div key={b.function} className="flex items-center justify-between px-3 py-2 bg-surface-elevated rounded-lg text-[12px]">
                        <span className="font-mono text-text-muted">{b.function}</span>
                        <div className="flex items-center gap-3 font-mono tabular-nums">
                          <span className="text-text-subtle">{b.calls} calls</span>
                          <span className="font-medium text-text">${b.cost_usd.toFixed(4)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <div>
                <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3">Recent API calls</h3>
                {apiUsage?.recent_calls?.length > 0 ? (
                  <DataTable columns={callColumns} data={apiUsage.recent_calls} searchPlaceholder="Search calls..." />
                ) : (
                  <EmptyState icon={Zap} title="No API calls yet" description="Usage appears here when Claude API features are used." />
                )}
              </div>
            </>
          )}

          {active === 'safety' && safety && (
            <Card icon={Shield} title="Prompt safety scanner">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                <Stat label="Scanned" value={safety.total_scanned_today} tooltip="Total prompts checked by the safety scanner today, before reaching the model." />
                <Stat label="Blocked" value={safety.blocked_today} danger={safety.blocked_today > 0} tooltip="Prompts rejected outright today — prompt-injection, PII, or policy violations." />
                <Stat label="Flagged" value={safety.flagged_today} warn={safety.flagged_today > 0} tooltip="Prompts that raised a warning but were still allowed through today." />
                <Stat label="Avg risk" value={safety.avg_risk_score} tooltip="Average risk score (0–100) of inputs scanned today. Higher means more flags per prompt." />
                <Stat label="Blocked MTD" value={safety.blocked_this_month} danger={safety.blocked_this_month > 0} tooltip="Total prompts blocked month-to-date. Promoted out of the footer line so month-over-month scanner load is scannable at a glance." />
              </div>
              {Object.keys(safety.flag_breakdown).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2">Flags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(safety.flag_breakdown).map(([flag, count]) => (
                      <span key={flag} className="px-2.5 py-0.5 bg-status-failing-muted text-status-failing rounded-pill text-[11px] font-medium tracking-tight">
                        {flag}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {safety.recent_blocked.length > 0 && (
                <div className="space-y-1.5 pt-3 border-t border-hairline">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Recently blocked</h4>
                  {safety.recent_blocked.map((b, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-status-failing-muted rounded-lg text-[12px]">
                      <div className="flex items-center gap-1.5">
                        <Ban size={11} strokeWidth={1.5} className="text-status-failing" />
                        <span className="font-mono text-text">{b.caller}</span>
                      </div>
                      <span className="font-mono text-text-subtle">{b.safety_flags}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-status-healthy">
                <ShieldCheck size={12} strokeWidth={1.5} />
                <span>Scanner active — every prompt is checked before transmission.</span>
              </div>
            </Card>
          )}

          {active === 'performance' && performance && (
            <Card icon={BarChart3} title="Performance">
              <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2 flex items-center gap-1.5">
                API latency · today
                <InfoTip content="Response times today across all Claude API calls, in milliseconds. Percentile labels describe where a given value sits in the distribution." />
              </h4>
              <div className="grid grid-cols-6 gap-2 mb-4">
                {[
                  { key: 'min', tip: 'Fastest response time today.' },
                  { key: 'p50', tip: 'Median — half of all calls were faster than this.' },
                  { key: 'avg', tip: 'Arithmetic mean. Can be skewed by outliers.' },
                  { key: 'p95', tip: '95% of calls were faster than this. Shows slow-tail.' },
                  { key: 'p99', tip: '99% of calls were faster. Extreme-tail outliers.' },
                  { key: 'max', tip: 'Slowest single call today.' },
                ].map(({ key, tip }) => (
                  <div key={key} className="text-center p-2.5 bg-surface-elevated rounded-lg">
                    <p className="text-[10px] font-medium text-text-subtle tracking-tight uppercase flex items-center justify-center gap-1">
                      {key}
                      <InfoTip content={tip} size={10} />
                    </p>
                    <p className="text-[15px] font-semibold font-mono tabular-nums text-text mt-0.5">{performance.latency[key]}ms</p>
                  </div>
                ))}
              </div>
              {Object.keys(performance.error_breakdown).length > 0 && (
                <div className="mb-3 pt-3 border-t border-hairline">
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-2">Errors</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(performance.error_breakdown).map(([type, count]) => (
                      <span key={type} className="px-2.5 py-0.5 bg-status-failing-muted text-status-failing rounded-pill text-[11px] font-medium tracking-tight">{type}: {count}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-3 pt-3 border-t border-hairline">
                <Stat label="Calls" value={performance.throughput.calls_today} tooltip="Total API calls made today." />
                <Stat label="Tokens" value={performance.throughput.tokens_today.toLocaleString()} tooltip="Total tokens processed today (input + output)." />
                <Stat label="Cost/call" value={`$${performance.efficiency.avg_cost_per_call.toFixed(4)}`} tooltip="Average USD cost per API call today. Lower is more efficient." />
                <Stat label="Tokens/$" value={performance.efficiency.tokens_per_dollar.toLocaleString()} tooltip="Tokens received per dollar spent. Higher is more efficient." />
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Local sub-components ── */

function Card({ icon: Icon, title, badge, children }) {
  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
      <div className="px-5 py-3.5 border-b border-hairline flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon size={14} strokeWidth={1.75} className="text-text-subtle" />
          <h3 className="text-[13px] font-semibold text-text tracking-tight">{title}</h3>
        </div>
        {badge && <span className="text-[11px] text-text-subtle">{badge}</span>}
      </div>
      <div className="p-5 space-y-2.5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono, tooltip }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[13px] text-text-muted flex items-center gap-1.5">
        {label}
        {tooltip && <InfoTip content={tooltip} size={11} />}
      </span>
      <span className={`text-[13px] font-medium text-text ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

function BudgetCard({ label, spent, budget, pct, tooltip }) {
  const barColor = pct > 90 ? 'bg-status-failing' : pct > 70 ? 'bg-status-degraded' : 'bg-accent';
  const remaining = Math.max(budget - spent, 0);
  return (
    <div className="bg-surface-elevated rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <DollarSign size={12} strokeWidth={1.5} className="text-text-subtle" />
        <span className="text-[10px] font-medium text-text-subtle tracking-tight">{label}</span>
        {tooltip && <InfoTip content={tooltip} size={10} />}
      </div>
      {/* Spent is the hero; cap is shown as denominator so users see how
          much headroom is left without needing to subtract mentally. */}
      <div className="flex items-baseline gap-1.5">
        <p className="text-xl font-semibold font-mono tabular-nums text-text">${spent.toFixed(4)}</p>
        <span className="text-[11px] text-text-subtle font-mono tabular-nums">/ ${budget.toFixed(2)}</span>
      </div>
      <div className="w-full bg-hairline rounded-pill h-1.5 my-1.5">
        <div className={`h-1.5 rounded-pill transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-text-subtle font-mono tabular-nums">
        <span>{pct.toFixed(1)}% used</span>
        <span>${remaining.toFixed(2)} left</span>
      </div>
    </div>
  );
}

function Stat({ label, value, danger, warn, tooltip }) {
  const color = danger ? 'text-status-failing' : warn ? 'text-status-degraded' : 'text-text';
  return (
    <div className="text-center p-2.5 bg-surface-elevated rounded-lg">
      <p className="text-[10px] font-medium text-text-subtle tracking-tight flex items-center justify-center gap-1">
        {label}
        {tooltip && <InfoTip content={tooltip} size={10} />}
      </p>
      <p className={`text-[15px] font-semibold font-mono tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
