import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Clock, AlertTriangle, Server, FlaskConical, Zap } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, ReferenceLine,
  Tooltip as RechartsTooltip, ResponsiveContainer,
} from 'recharts';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import MetricCard from '../components/common/MetricCard';
import StatusBadge from '../components/common/StatusBadge';
import DataTable from '../components/common/DataTable';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import { InfoTip } from '../components/common/Tooltip';
import {
  GRID_STROKE, AXIS_TICK,
  CHART_GRID_DASH, CHART_BAR_RADIUS,
} from '../components/common/chartStyle';

const QUALITY_THRESHOLD = 70;

// Shared tooltip for the main charts — pill-shaped with blur material so it
// reads over dark chart areas without washing out.
function ChartTooltip({ active, payload, label, unit = '', decimals = 0 }) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0].value;
  const formatted = typeof v === 'number' ? v.toFixed(decimals) : v;
  return (
    <div className="px-3 py-2 bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material border border-hairline-strong rounded-lg shadow-md">
      <p className="text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-text tabular-nums">
        {formatted}{unit}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeEnv, setActiveEnv] = useState('all');

  const [metrics, setMetrics] = useState({
    active_services: 0, avg_latency_ms: 0, error_rate_pct: 0,
    avg_quality_score: 0, p50_latency_ms: 0, p95_latency_ms: 0, p99_latency_ms: 0,
    latency_trend: 'neutral', error_trend: 'neutral', quality_trend: 'neutral',
  });
  const [latencyData, setLatencyData] = useState([]);
  const [qualityData, setQualityData] = useState([]);
  const [errorData, setErrorData] = useState([]);
  const [recentEvals, setRecentEvals] = useState([]);

  // Tracking actual refresh moments so the Live indicator reflects reality
  // instead of pulsing every second regardless of state.
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());

  const fetchDashboard = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      const [metricsRes, latencyRes, qualityRes, errorRes, evalsRes] = await Promise.all([
        api.get('/dashboard/metrics', { params: envParam }),
        api.get('/dashboard/latency-trend', { params: envParam }),
        api.get('/dashboard/quality-trend', { params: envParam }),
        api.get('/dashboard/error-trend', { params: envParam }),
        api.get('/dashboard/recent-evals'),
      ]);
      setMetrics(metricsRes.data);
      setLatencyData(latencyRes.data);
      setQualityData(qualityRes.data);
      setErrorData(errorRes.data);
      setRecentEvals(evalsRes.data);
      setLastFetchAt(Date.now());
    } catch (err) {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
    const interval = setInterval(() => fetchDashboard(), 15000);
    return () => clearInterval(interval);
  }, [activeEnv]);

  // 1-second ticker for the "Updated Ns ago" label. Decoupled from fetch
  // interval so the counter keeps moving even between refreshes.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;
  const envFiltered = activeEnv !== 'all';

  const evalColumns = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (v) => {
        if (!v) return <span className="font-mono text-xs text-text-subtle">—</span>;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return <span className="font-mono text-xs tabular-nums">{v}</span>;
        }
        const short = d.toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
        });
        return (
          <span
            className="font-mono text-xs tabular-nums"
            title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
          >
            {short}
          </span>
        );
      },
    },
    { key: 'service_name', label: 'Service' },
    { key: 'score', label: 'Score', render: (v) => <span className="font-mono tabular-nums font-medium">{v}%</span> },
    { key: 'type', label: 'Type' },
    { key: 'drift', label: 'Status', render: (v) => <StatusBadge status={v ? 'Drift Detected' : 'Healthy'} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LoadingSkeleton type="chart" />
          <LoadingSkeleton type="chart" />
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchDashboard(); }} />;
  }

  const latestLatency = latencyData[latencyData.length - 1]?.ms;
  const latestError = errorData[errorData.length - 1]?.rate;

  return (
    <div className="space-y-5">
      {/* Header + live indicator + env filter */}
      <PageHeader title="Dashboard" description="Platform health across all connected AI services">
        <div className="flex items-center gap-3">
          {/* Live refresh indicator — static dot, one-shot pulse on actual
              refresh (keyed by lastFetchAt), honest "Ns ago" counter. */}
          <div
            className="flex items-center gap-1.5"
            aria-label={`Last refreshed ${updatedLabel}, auto-refreshing every 15 seconds`}
            title={`Refreshes every 15 seconds. Last: ${updatedLabel}.`}
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

          {/* Env tabs */}
          <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Environment filter">
            {['all', 'dev', 'staging', 'production'].map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeEnv === tab}
                onClick={() => setActiveEnv(tab)}
                className={`px-3 py-1 text-[12px] font-medium rounded-pill capitalize transition-standard ${
                  activeEnv === tab
                    ? 'bg-surface-elevated text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </PageHeader>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 dash-rise" style={{ animationDelay: '0ms' }}>
        <MetricCard
          title="Active Services"
          value={metrics.active_services}
          icon={Server}
          color="slate"
          tooltip="Count of AI services registered in the platform that are currently enabled."
        />
        <MetricCard
          title="Avg Quality"
          value={`${metrics.avg_quality_score.toFixed(1)}%`}
          icon={Activity}
          trend={metrics.quality_trend}
          higherIsBetter={true}
          color="green"
          sparklineData={qualityData}
          sparklineKey="score"
          tooltip="Rolling average of evaluation scores (0–100%) across all recent runs. Higher is better. Measures how well the AI's answers match expected outputs."
        />
        <MetricCard
          title="Error Rate"
          qualifier="quality"
          value={`${metrics.error_rate_pct.toFixed(1)}%`}
          icon={AlertTriangle}
          trend={metrics.error_trend}
          higherIsBetter={false}
          color="amber"
          sparklineData={errorData}
          sparklineKey="rate"
          caption="Model quality, not server uptime"
          tooltip="Percentage of evaluation runs in the last 7 days flagged for quality drift (answers diverged from expected outputs). This is QUALITY error — not HTTP failures, not blocked prompts. Infra failures are tracked separately via the Service Registry ping."
        />
        <MetricCard
          title="Avg Latency"
          value={`${metrics.avg_latency_ms.toFixed(0)}ms`}
          icon={Clock}
          trend={metrics.latency_trend}
          higherIsBetter={false}
          color="blue"
          sparklineData={latencyData}
          sparklineKey="ms"
          tooltip="Mean response time across all LLM calls in the last 24 hours. Lower is better. See the percentile tiles below for tail-latency."
        />
      </div>

      {/* Latency percentiles — editorial tiles with semantic rail */}
      <div className="bg-surface rounded-2xl border border-hairline shadow-sm overflow-hidden dash-rise" style={{ animationDelay: '80ms' }}>
        <div className="px-6 py-3.5 border-b border-hairline flex items-baseline justify-between">
          <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
            <Zap size={14} strokeWidth={1.75} className="text-text-subtle" />
            Response time distribution
            <InfoTip content="How fast the AI replies for a typical user vs. the slowest users. Percentiles matter more than averages — a single 10-second outlier can hide the fact that most users are fine. Showing the last 24 hours." />
          </h3>
          <span className="text-[11px] text-text-subtle tracking-tight">Last 24 hours</span>
        </div>
        <div className="grid grid-cols-3 divide-x divide-hairline">
          {[
            { label: 'Typical', caption: 'P50 · Half of requests are faster', value: metrics.p50_latency_ms, tone: 'healthy'  },
            { label: 'Slow',    caption: 'P95 · Only 5% are slower',          value: metrics.p95_latency_ms, tone: 'degraded' },
            { label: 'Worst',   caption: 'P99 · Only 1% are slower',          value: metrics.p99_latency_ms, tone: 'failing'  },
          ].map(({ label, caption, value, tone }) => (
            <div
              key={label}
              className="relative px-6 py-5"
              style={{ backgroundImage: `linear-gradient(180deg, color-mix(in oklab, var(--status-${tone}) 5%, transparent), transparent 85%)` }}
            >
              <span
                className="absolute left-0 top-6 bottom-6 w-[3px] rounded-r-full"
                style={{ background: `var(--status-${tone})` }}
                aria-hidden="true"
              />
              <div className="flex items-baseline justify-between mb-1 pl-3">
                <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-subtle">{label}</span>
                <div className="flex items-baseline">
                  <span
                    className="text-[26px] font-semibold font-mono tabular-nums tracking-[-0.025em] leading-none"
                    style={{ color: `var(--status-${tone})` }}
                  >
                    {(value || 0).toFixed(0)}
                  </span>
                  <span className="text-[12px] text-text-muted ml-1 font-mono">ms</span>
                </div>
              </div>
              <p className="text-[11px] text-text-subtle leading-snug pl-3">{caption}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Charts grid — latency (3/5) + quality (2/5) + error trend (full) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 dash-rise" style={{ animationDelay: '160ms' }}>
        {/* Latency — gradient area */}
        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-6 lg:col-span-3">
          <div className="flex items-baseline justify-between mb-5">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
                Response latency
                <InfoTip content="How long the AI takes to reply, in milliseconds, bucketed over time. Spikes often precede incidents." />
              </h3>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-elevated text-[10px] font-mono uppercase tracking-wide text-text-subtle">
                24h
              </span>
            </div>
            {latestLatency != null && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-text-subtle tracking-tight">Current</span>
                <span className="text-[13px] font-semibold text-accent tabular-nums">{latestLatency.toFixed(0)}ms</span>
              </div>
            )}
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-6} tickFormatter={(v) => `${v}ms`} />
                <RechartsTooltip
                  content={<ChartTooltip unit="ms" />}
                  cursor={{ stroke: 'var(--hairline-strong)', strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="ms"
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  fill="url(#latencyFill)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-surface)', fill: 'var(--chart-1)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quality per run — gradient bars + drift reference */}
        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-6 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-5">
            <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
              Quality per run
              <InfoTip content="Each bar is one evaluation run. Score 0–100% based on how closely AI responses matched expected answers. Drift is flagged below the threshold." />
            </h3>
            <div className="flex items-center gap-1.5 text-[11px] text-text-subtle tracking-tight">
              <span className="w-2 h-0 border-t border-dashed border-status-degraded" aria-hidden="true" />
              Threshold {QUALITY_THRESHOLD}%
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={qualityData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="qualityHealthy" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--status-healthy)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--status-healthy)" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="qualityFailing" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--status-failing)" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="var(--status-failing)" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="run" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-6} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip
                  content={<ChartTooltip unit="%" decimals={1} />}
                  cursor={{ fill: 'color-mix(in oklab, var(--color-text) 4%, transparent)' }}
                />
                <ReferenceLine
                  y={QUALITY_THRESHOLD}
                  stroke="var(--status-degraded)"
                  strokeDasharray="3 4"
                  strokeOpacity={0.65}
                />
                <Bar dataKey="score" radius={CHART_BAR_RADIUS}>
                  {qualityData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.score >= QUALITY_THRESHOLD ? 'url(#qualityHealthy)' : 'url(#qualityFailing)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Error rate trend — full width layered gradient */}
        <div className="bg-surface rounded-2xl border border-hairline shadow-sm p-6 lg:col-span-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
                <AlertTriangle size={14} strokeWidth={1.75} className="text-status-degraded" />
                Error rate trend
                <span className="normal-case font-medium tracking-tight text-status-degraded opacity-90 text-[11px]">· quality</span>
                <InfoTip content="Percentage of evaluation runs flagged for quality drift, broken down by day of the week over the last 7 days. Quality error, not infra — the AI's answers diverged from expected outputs." />
              </h3>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-surface-elevated text-[10px] font-mono uppercase tracking-wide text-text-subtle">
                7d
              </span>
            </div>
            {latestError != null && (
              <div className="flex items-baseline gap-1.5">
                <span className="text-[11px] text-text-subtle tracking-tight">Current</span>
                <span className="text-[13px] font-semibold text-status-degraded tabular-nums">{latestError.toFixed(1)}%</span>
              </div>
            )}
          </div>
          <p className="text-[11px] text-text-muted leading-snug mb-4">
            Percent of eval runs below the quality threshold. The server can be 100% up and this chart can still spike — it reads AI usefulness, not infra reachability.
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={errorData} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="var(--chart-3)" stopOpacity={0.34} />
                    <stop offset="50%"  stopColor="var(--chart-3)" stopOpacity={0.14} />
                    <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-6} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip
                  content={<ChartTooltip unit="%" decimals={1} />}
                  cursor={{ stroke: 'var(--hairline-strong)', strokeDasharray: '3 3' }}
                />
                <Area
                  type="monotone"
                  dataKey="rate"
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  fill="url(#errorGrad)"
                  dot={false}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--color-surface)', fill: 'var(--chart-3)' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent evaluations */}
      <div className="dash-rise" style={{ animationDelay: '240ms' }}>
        <div className="flex items-baseline justify-between mb-3 gap-3">
          <h3 className="text-[13px] font-semibold text-text tracking-tight">Recent evaluations</h3>
          <div
            className={`flex items-center gap-1.5 text-[11px] tracking-tight ${
              envFiltered ? 'text-status-degraded' : 'text-text-subtle'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                envFiltered ? 'bg-status-degraded' : 'bg-text-subtle opacity-60'
              }`}
              aria-hidden="true"
            />
            <span>
              {envFiltered
                ? `All environments · ignoring "${activeEnv}" filter`
                : 'All environments · last 10 runs'}
            </span>
            <InfoTip content={
              envFiltered
                ? `Heads up: the "${activeEnv}" env filter above applies to the metric cards and charts, but this table stays global. You see the 10 most-recent runs across every environment so the latest activity is visible regardless of scope.`
                : 'This table ignores the environment filter above. You get the 10 most-recent eval runs across every environment so the latest activity is visible regardless of scope.'
            } />
          </div>
        </div>
        {recentEvals.length > 0 ? (
          <DataTable columns={evalColumns} data={recentEvals} searchPlaceholder="Search evaluations..." />
        ) : (
          <EmptyState
            icon={FlaskConical}
            title="No evaluations yet"
            description="Run evaluations from the Evaluations page to see results here."
          />
        )}
      </div>
    </div>
  );
}
