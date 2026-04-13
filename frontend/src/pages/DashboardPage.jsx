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

/* Shared chart config — token-aware */
const GRID_STROKE = 'var(--color-border)';
const AXIS_TICK = { fontSize: 11, fill: 'var(--color-text-subtle)', fontFamily: 'var(--font-mono)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: '12px',
  color: 'var(--color-text)',
};

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

  const fetchDashboard = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      const [metricsRes, latencyRes, qualityRes, errorRes, evalsRes, driftRes] = await Promise.all([
        api.get('/dashboard/metrics', { params: envParam }),
        api.get('/dashboard/latency-trend', { params: envParam }),
        api.get('/dashboard/quality-trend', { params: envParam }),
        api.get('/dashboard/error-trend', { params: envParam }),
        api.get('/dashboard/recent-evals'),
        api.get('/dashboard/drift-alerts'),
      ]);
      setMetrics(metricsRes.data);
      setLatencyData(latencyRes.data);
      setQualityData(qualityRes.data);
      setErrorData(errorRes.data);
      setRecentEvals(evalsRes.data);
      setDriftAlerts(driftRes.data);
    } catch (err) {
      setError('Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchDashboard();
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
        <div className="flex items-center bg-surface border border-border rounded-md p-0.5" role="tablist" aria-label="Environment filter">
          {['all', 'production', 'staging'].map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeEnv === tab}
              onClick={() => setActiveEnv(tab)}
              className={`px-3 py-1 text-xs font-medium rounded-sm capitalize transition-colors ${
                activeEnv === tab
                  ? 'bg-surface-elevated text-text shadow-sm'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Drift alert */}
      {driftAlerts.length > 0 && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-status-failing-muted border border-status-failing/20 rounded-lg" role="alert">
          <div className="flex items-center gap-3">
            <AlertCircle size={16} strokeWidth={1.5} className="text-status-failing shrink-0" />
            <p className="text-sm text-text">
              <span className="font-medium">Drift detected</span>
              <span className="text-text-muted"> — {driftAlerts[0].service_name} quality dropped to </span>
              <span className="font-mono tabular-nums font-medium">{driftAlerts[0].score}%</span>
              <span className="text-text-muted"> (threshold: {driftAlerts[0].threshold}%)</span>
            </p>
          </div>
          <button
            onClick={() => navigate('/incidents')}
            className="shrink-0 px-3 py-1.5 text-xs font-medium bg-status-failing text-white rounded-md hover:opacity-90 transition-opacity"
          >
            Create incident
          </button>
        </div>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard title="Active Services" value={metrics.active_services} icon={Server} trend="neutral" color="slate" />
        <MetricCard title="Avg Quality" value={`${metrics.avg_quality_score.toFixed(1)}%`} icon={Activity} trend={metrics.quality_trend} color="green" />
        <MetricCard title="Error Rate" value={`${metrics.error_rate_pct.toFixed(1)}%`} icon={AlertTriangle} trend={metrics.error_trend} color="amber" />
        <MetricCard title="Avg Latency" value={`${metrics.avg_latency_ms.toFixed(0)}ms`} icon={Clock} trend={metrics.latency_trend} color="blue" />
      </div>

      {/* Latency percentiles bar */}
      <div className="bg-surface rounded-lg border border-border p-4 shadow-sm">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Latency Percentiles (24h)</h3>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'P50', value: metrics.p50_latency_ms, color: 'text-accent' },
            { label: 'P95', value: metrics.p95_latency_ms, color: 'text-status-degraded' },
            { label: 'P99', value: metrics.p99_latency_ms, color: 'text-status-failing' },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex items-baseline justify-between px-3 py-2 bg-surface-elevated rounded-md border border-border">
              <span className="text-xs font-medium text-text-muted">{label}</span>
              <span className={`text-sm font-semibold font-mono tabular-nums ${color}`}>
                {(value || 0).toFixed(0)}ms
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Latency */}
        <div className="bg-surface rounded-lg border border-border p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Response Latency (24h)</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={latencyData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} tickFormatter={(v) => `${v}ms`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}ms`, 'Latency']} />
                <Line type="monotone" dataKey="ms" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3, strokeWidth: 1.5, fill: 'var(--color-surface)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quality */}
        <div className="bg-surface rounded-lg border border-border p-4 shadow-sm">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Quality Scores per Run</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={qualityData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="run" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Quality']} cursor={{ fill: 'var(--color-surface-elevated)' }} />
                <Bar dataKey="score" fill="var(--chart-2)" radius={[3, 3, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Error trend — full width */}
        <div className="bg-surface rounded-lg border border-border p-4 shadow-sm lg:col-span-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Error Rate Trend (%)</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={errorData}>
                <defs>
                  <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--chart-3)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--chart-3)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={GRID_STROKE} />
                <XAxis dataKey="time" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-8} tickFormatter={(v) => `${v}%`} />
                <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [`${v}%`, 'Error Rate']} />
                <Area type="monotone" dataKey="rate" stroke="var(--chart-3)" strokeWidth={2} fillOpacity={1} fill="url(#errorGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent evaluations */}
      <div>
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Recent Evaluations</h3>
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
