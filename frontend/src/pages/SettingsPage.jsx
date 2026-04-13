import { useState, useEffect } from 'react';
import {
  Brain, DollarSign, Zap, ShieldCheck, Activity, Gauge, CreditCard,
  Shield, BarChart3, Ban
} from 'lucide-react';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import ErrorState from '../components/common/ErrorState';
import EmptyState from '../components/common/EmptyState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DataTable from '../components/common/DataTable';
import StatusBadge from '../components/common/StatusBadge';

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [apiUsage, setApiUsage] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [safety, setSafety] = useState(null);

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
    } catch { if (showLoading) setError('Failed to load settings.'); }
    finally { if (showLoading) setLoading(false); }
  };

  useEffect(() => {
    fetchAll(true);
    const interval = setInterval(() => fetchAll(false), 10000);
    return () => clearInterval(interval);
  }, []);

  const callColumns = [
    { key: 'timestamp', label: 'Time', render: v => <span className="font-mono tabular-nums text-xs">{v}</span> },
    { key: 'caller', label: 'Function', render: v => <span className="font-mono text-xs bg-surface-elevated px-1.5 py-0.5 rounded-sm">{v}</span> },
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

  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-5">
      <PageHeader title="API & Settings" description="Model configuration, cost monitoring, safety scanner, and performance." />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Left: Config cards */}
        <div className="space-y-4">
          {/* Model */}
          {config && (
            <Card icon={Brain} title="AI Model">
              <Row label="Provider" value={config.ai_model.provider} />
              <Row label="Model" value={<span className="font-mono text-xs bg-surface-elevated px-1.5 py-0.5 rounded-sm border border-border">{config.ai_model.model}</span>} />
              <Row label="Max Tokens" value={config.ai_model.max_tokens.toLocaleString()} mono />
              <Row label="Timeout" value={`${config.ai_model.timeout_seconds}s`} mono />
            </Card>
          )}
          {/* Pricing */}
          {config && (
            <Card icon={CreditCard} title="Pricing">
              <Row label="Input" value={`$${config.pricing.input_per_million_usd} / 1M tokens`} mono />
              <Row label="Output" value={`$${config.pricing.output_per_million_usd} / 1M tokens`} mono />
              <p className="text-[11px] text-text-subtle pt-2 border-t border-border mt-2">Estimated from API response token counts.</p>
            </Card>
          )}
          {/* Eval config */}
          {config && (
            <Card icon={Activity} title="Evaluation">
              <Row label="Drift Threshold" value={`${config.evaluation.drift_threshold_pct}%`} mono />
              <Row label="Health Check" value={`${config.evaluation.health_check_schedule_minutes} min`} mono />
              <Row label="Eval Schedule" value={`${config.evaluation.eval_schedule_minutes} min`} mono />
            </Card>
          )}
        </div>

        {/* Right: Budget, Usage, Safety, Performance */}
        <div className="xl:col-span-2 space-y-4">
          {/* Budget */}
          {apiUsage && config && (
            <Card icon={ShieldCheck} title="Budget & Rate Limits" badge="Configured in .env">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <BudgetCard label="Daily" spent={apiUsage.daily.cost_usd} budget={apiUsage.daily.budget_usd} pct={apiUsage.daily.budget_pct_used} />
                <BudgetCard label="Monthly" spent={apiUsage.monthly.cost_usd} budget={apiUsage.monthly.budget_usd} pct={apiUsage.monthly.budget_pct_used} />
                <div className="bg-surface-elevated rounded-md border border-border p-3">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Gauge size={12} strokeWidth={1.5} className="text-text-subtle" />
                    <span className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">Rate Limit</span>
                  </div>
                  <p className="text-lg font-bold font-mono tabular-nums text-text">{config.budget.rate_limit_per_min}</p>
                  <p className="text-[10px] text-text-subtle">calls/min</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-text-muted">
                <div className="flex items-center gap-1.5"><ShieldCheck size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Budget blocks calls at limit</div>
                <div className="flex items-center gap-1.5"><Gauge size={12} strokeWidth={1.5} className="text-accent shrink-0" /> Rate limiter prevents bursts</div>
              </div>
            </Card>
          )}

          {/* Token usage */}
          {apiUsage && (
            <Card icon={Zap} title="Token Usage">
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="Today Calls" value={apiUsage.daily.calls} />
                <Stat label="Today Tokens" value={apiUsage.daily.total_tokens.toLocaleString()} />
                <Stat label="Month Calls" value={apiUsage.monthly.calls} />
                <Stat label="Month Tokens" value={apiUsage.monthly.total_tokens.toLocaleString()} />
              </div>
              {apiUsage.breakdown.length > 0 && (
                <div className="pt-3 border-t border-border space-y-1.5">
                  <h4 className="text-[10px] font-medium text-text-subtle uppercase tracking-wider mb-2">Cost by Function</h4>
                  {apiUsage.breakdown.map(b => (
                    <div key={b.function} className="flex items-center justify-between px-2.5 py-1.5 bg-surface-elevated rounded-md text-xs">
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
          )}

          {/* Recent calls */}
          <div>
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Recent API Calls</h3>
            {apiUsage?.recent_calls?.length > 0 ? (
              <DataTable columns={callColumns} data={apiUsage.recent_calls} searchPlaceholder="Search calls..." />
            ) : (
              <EmptyState icon={Zap} title="No API calls yet" description="Usage appears here when Claude API features are used." />
            )}
          </div>

          {/* Safety */}
          {safety && (
            <Card icon={Shield} title="Prompt Safety Scanner">
              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="Scanned" value={safety.total_scanned_today} />
                <Stat label="Blocked" value={safety.blocked_today} danger={safety.blocked_today > 0} />
                <Stat label="Flagged" value={safety.flagged_today} warn={safety.flagged_today > 0} />
                <Stat label="Avg Risk" value={safety.avg_risk_score} />
              </div>
              {Object.keys(safety.flag_breakdown).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[10px] font-medium text-text-subtle uppercase tracking-wider mb-2">Flags</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(safety.flag_breakdown).map(([flag, count]) => (
                      <span key={flag} className="px-2 py-0.5 bg-status-failing-muted text-status-failing rounded-md text-xs font-medium">
                        {flag}: {count}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {safety.recent_blocked.length > 0 && (
                <div className="space-y-1.5">
                  <h4 className="text-[10px] font-medium text-text-subtle uppercase tracking-wider mb-1">Recent Blocked</h4>
                  {safety.recent_blocked.map((b, i) => (
                    <div key={i} className="flex items-center justify-between px-2.5 py-1.5 bg-status-failing-muted rounded-md text-xs">
                      <div className="flex items-center gap-1.5">
                        <Ban size={10} strokeWidth={1.5} className="text-status-failing" />
                        <span className="font-mono text-text">{b.caller}</span>
                      </div>
                      <span className="font-mono text-text-subtle">{b.safety_flags}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center gap-1.5 text-xs text-status-healthy">
                <ShieldCheck size={12} strokeWidth={1.5} />
                <span>Scanner active. Blocked this month: <strong>{safety.blocked_this_month}</strong></span>
              </div>
            </Card>
          )}

          {/* Performance */}
          {performance && (
            <Card icon={BarChart3} title="Performance">
              <h4 className="text-[10px] font-medium text-text-subtle uppercase tracking-wider mb-2">API Latency (Today)</h4>
              <div className="grid grid-cols-6 gap-2 mb-4">
                {['min', 'p50', 'avg', 'p95', 'p99', 'max'].map(key => (
                  <div key={key} className="text-center p-2 bg-surface-elevated rounded-md border border-border">
                    <p className="text-[10px] font-medium text-text-subtle uppercase">{key}</p>
                    <p className="text-sm font-bold font-mono tabular-nums text-text">{performance.latency[key]}ms</p>
                  </div>
                ))}
              </div>
              {Object.keys(performance.error_breakdown).length > 0 && (
                <div className="mb-3">
                  <h4 className="text-[10px] font-medium text-text-subtle uppercase tracking-wider mb-2">Errors</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(performance.error_breakdown).map(([type, count]) => (
                      <span key={type} className="px-2 py-0.5 bg-status-failing-muted text-status-failing rounded-md text-xs font-medium">{type}: {count}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-3">
                <Stat label="Calls" value={performance.throughput.calls_today} />
                <Stat label="Tokens" value={performance.throughput.tokens_today.toLocaleString()} />
                <Stat label="Cost/Call" value={`$${performance.efficiency.avg_cost_per_call.toFixed(4)}`} />
                <Stat label="Tokens/$" value={performance.efficiency.tokens_per_dollar.toLocaleString()} />
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
    <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={14} strokeWidth={1.5} className="text-text-subtle" />
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{title}</h3>
        </div>
        {badge && <span className="text-[10px] text-text-subtle">{badge}</span>}
      </div>
      <div className="p-4 space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`text-xs font-medium text-text ${mono ? 'font-mono tabular-nums' : ''}`}>{value}</span>
    </div>
  );
}

function BudgetCard({ label, spent, budget, pct }) {
  const barColor = pct > 90 ? 'bg-status-failing' : pct > 70 ? 'bg-status-degraded' : 'bg-accent';
  return (
    <div className="bg-surface-elevated rounded-md border border-border p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <DollarSign size={12} strokeWidth={1.5} className="text-text-subtle" />
        <span className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold font-mono tabular-nums text-text">${budget.toFixed(2)}</p>
      <div className="w-full bg-border rounded-full h-1.5 my-1.5">
        <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-text-subtle font-mono tabular-nums">
        <span>${spent.toFixed(4)}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function Stat({ label, value, danger, warn }) {
  const color = danger ? 'text-status-failing' : warn ? 'text-status-degraded' : 'text-text';
  return (
    <div className="text-center p-2 bg-surface-elevated rounded-md border border-border">
      <p className="text-[10px] font-medium text-text-subtle uppercase tracking-wider">{label}</p>
      <p className={`text-base font-bold font-mono tabular-nums mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}
