import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Clock, AlertTriangle, Server, AlertCircle, FlaskConical } from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer
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
  GRID_STROKE, AXIS_TICK, TOOLTIP_STYLE,
  CHART_GRID_DASH, CHART_LINE_STROKE, CHART_BAR_RADIUS, CHART_BAR_SIZE,
} from '../components/common/chartStyle';

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
  const [driftAlerts, setDriftAlerts] = useState([]);
  const [alerts, setAlerts] = useState([]);

  const fetchDashboard = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      const [metricsRes, latencyRes, qualityRes, errorRes, evalsRes, driftRes, alertsRes] = await Promise.all([
        api.get('/dashboard/metrics', { params: envParam }),
        api.get('/dashboard/latency-trend', { params: envParam }),
        api.get('/dashboard/quality-trend', { params: envParam }),
        api.get('/dashboard/error-trend', { params: envParam }),
        api.get('/dashboard/recent-evals'),
        api.get('/dashboard/drift-alerts'),
        api.get('/dashboard/alerts?active_only=true'),
      ]);
      setMetrics(metricsRes.data);
      setLatencyData(latencyRes.data);
      setQualityData(qualityRes.data);
      setErrorData(errorRes.data);
      setRecentEvals(evalsRes.data);
      setDriftAlerts(driftRes.data);
      setAlerts(alertsRes.data);
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

  const evalColumns = [
    { key: 'timestamp', label: 'Time', render: (v) => <span className="font-mono text-xs tabular-nums">{v}</span> },
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

  return (
    <div className="space-y-5">
      {/* Header + env filter */}
      <PageHeader title="Dashboard" description="Platform health across all connected AI services">
        <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Environment filter">
          {['all', 'production', 'staging'].map((tab) => (
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
      </PageHeader>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
          <div className="px-5 py-3 border-b border-hairline flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} strokeWidth={1.75} className="text-status-failing" />
              <span className="text-[13px] font-semibold text-text tracking-tight">Active alerts</span>
            </div>
            <span className="text-[11px] font-mono tabular-nums text-text-subtle">{alerts.length}</span>
          </div>
          <div>
            {alerts.map(a => (
              <div key={a.id} className="flex items-center justify-between px-5 py-3 border-b border-hairline last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${a.severity === 'critical' ? 'bg-status-failing' : 'bg-status-degraded'}`} />
                  <span className="text-sm text-text">{a.message}</span>
                  <span className="text-[11px] text-text-subtle font-mono">{a.service_name}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-[11px] text-text-subtle font-mono tabular-nums">{a.created_at}</span>
                  <button
                    onClick={async () => {
                      await api.post(`/dashboard/alerts/${a.id}/acknowledge`);
                      fetchDashboard();
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium text-text-muted bg-surface-elevated rounded-pill hover:text-text transition-standard"
                  >
                    Ack
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legacy drift alert for backward compat */}
      {alerts.length === 0 && driftAlerts.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 bg-status-failing-muted rounded-xl" role="alert">
          <div className="flex items-center gap-3">
            <AlertCircle size={16} strokeWidth={1.75} className="text-status-failing shrink-0" />
            <p className="text-sm text-text">
              <span className="font-medium">Drift detected</span>
              <span className="text-text-muted"> — {driftAlerts[0].service_name} quality dropped to </span>
              <span className="font-mono tabular-nums font-medium">{driftAlerts[0].score}%</span>
              <span className="text-text-muted"> (threshold: {driftAlerts[0].threshold}%)</span>
            </p>
          </div>
          <button
            onClick={() => navigate('/incidents')}
            className="shrink-0 px-3 py-1.5 text-[11px] font-medium bg-status-failing text-white rounded-pill hover:opacity-90 transition-standard"
          >
            Create incident
          </button>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          title="Active Services"
          value={metrics.active_services}
          icon={Server}
          trend="neutral"
          color="slate"
          tooltip="Count of AI services registered in the platform that are currently enabled."
        />
        <MetricCard
          title="Avg Quality"
          value={`${metrics.avg_quality_score.toFixed(1)}%`}
          icon={Activity}
          trend={metrics.quality_trend}
          color="green"
          tooltip="Rolling average of evaluation scores (0–100%) across all recent runs. Higher is better. Measures how well the AI's answers match expected outputs."
        />
        <MetricCard
          title="Error Rate"
          value={`${metrics.error_rate_pct.toFixed(1)}%`}
          icon={AlertTriangle}
          trend={metrics.error_trend}
          color="amber"
          tooltip="Percentage of LLM calls that failed or tripped a safety check in the last 24 hours. Includes API errors, timeouts, and blocked prompts."
        />
        <MetricCard
          title="Avg Latency"
          value={`${metrics.avg_latency_ms.toFixed(0)}ms`}
          icon={Clock}
          trend={metrics.latency_trend}
          color="blue"
          tooltip="Mean response time across all LLM calls in the last 24 hours. Lower is better. See the percentile tiles below for tail-latency."
        />
      </div>

      {/* Latency percentiles bar */}
      <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
            Response times
            <InfoTip content="How fast the AI replies for a typical user vs. the slowest users. Percentiles matter more than averages — a single 10-second outlier can hide the fact that most users are fine. Showing the last 24 hours." />
          </h3>
          <span className="text-[11px] text-text-subtle tracking-tight">Last 24 hours</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Typical Response', sub: 'Median — P50 · half of requests are faster', value: metrics.p50_latency_ms, color: 'text-accent' },
            { label: 'Slow Response', sub: '95th percentile — P95 · only 5% are slower', value: metrics.p95_latency_ms, color: 'text-status-degraded' },
            { label: 'Worst Response', sub: '99th percentile — P99 · only 1% are slower', value: metrics.p99_latency_ms, color: 'text-status-failing' },
          ].map(({ label, sub, value, color }) => (
            <div key={label} className="flex flex-col gap-1 px-4 py-3 bg-surface-elevated rounded-lg border border-hairline">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium text-text-muted">{label}</span>
                <span className={`text-lg font-semibold font-mono tabular-nums tracking-tight ${color}`}>
                  {(value || 0).toFixed(0)}ms
                </span>
              </div>
              <span className="text-[11px] text-text-subtle leading-snug">{sub}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latency */}
        <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6">
          <h3 className="text-[13px] font-semibold text-text tracking-tight mb-4 flex items-center gap-1.5">
            Response latency · last 24 hours
            <InfoTip content="How long the AI takes to reply, in milliseconds, bucketed over time. Spikes often precede incidents." />
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} tickFormatter={(v) => `${v}ms`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}ms`, 'Latency']} />
                <Line type="monotone" dataKey="ms" stroke="var(--chart-1)" strokeWidth={CHART_LINE_STROKE} dot={{ r: 3, strokeWidth: 1.5, fill: 'var(--color-surface)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quality */}
        <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6">
          <h3 className="text-[13px] font-semibold text-text tracking-tight mb-4 flex items-center gap-1.5">
            Quality scores per run
            <InfoTip content="Each bar is one evaluation run. Score 0–100% based on how closely AI responses matched expected answers. Drift is flagged below the threshold." />
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={qualityData}>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="run" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Quality']} cursor={{ fill: 'var(--color-surface-elevated)' }} />
                <Bar dataKey="score" fill="var(--chart-2)" radius={CHART_BAR_RADIUS} barSize={CHART_BAR_SIZE} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Error trend — full width */}
        <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6 lg:col-span-2">
          <h3 className="text-[13px] font-semibold text-text tracking-tight mb-4 flex items-center gap-1.5">
            Error rate trend
            <InfoTip content="Percentage of LLM calls that failed or were blocked, over time. Covers API errors, timeouts, and safety-scanner blocks." />
          </h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={errorData}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Error Rate']} />
                <Area type="monotone" dataKey="rate" stroke="var(--chart-3)" strokeWidth={CHART_LINE_STROKE} fillOpacity={1} fill="url(#errorGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent evaluations */}
      <div>
        <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3">Recent evaluations</h3>
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
