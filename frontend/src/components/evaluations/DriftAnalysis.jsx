import { useState, useEffect } from 'react';
import { TrendingDown, TrendingUp, Minus, ShieldCheck, ShieldAlert, ShieldX, Activity, Loader2, Target } from 'lucide-react';
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import api from '../../utils/api';
import EmptyState from '../common/EmptyState';
import { InfoTip } from '../common/Tooltip';
import { GRID_STROKE, AXIS_TICK, TOOLTIP_STYLE, CHART_GRID_DASH, CHART_LINE_STROKE } from '../common/chartStyle';

const SEV_CONFIG = {
  critical: { icon: ShieldX, bg: 'bg-status-failing-muted', text: 'text-status-failing', label: 'Critical drift', desc: 'Quality below threshold. Immediate attention required.' },
  warning: { icon: ShieldAlert, bg: 'bg-status-degraded-muted', text: 'text-status-degraded', label: 'Warning', desc: 'Declining quality or approaching threshold.' },
  none: { icon: ShieldCheck, bg: 'bg-status-healthy-muted', text: 'text-status-healthy', label: 'Healthy', desc: 'Quality within acceptable range.' },
};

const scoreColor = (s) => s >= 85 ? 'text-status-healthy' : s >= 75 ? 'text-status-degraded' : 'text-status-failing';
const scoreBg = (s) => s >= 85 ? 'bg-status-healthy' : s >= 75 ? 'bg-status-degraded' : 'bg-status-failing';

export default function DriftAnalysis({ services, selectedId, onSelect }) {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchDrift = async (id) => {
    onSelect(id);
    setLoading(true);
    try {
      const [checkRes, trendRes] = await Promise.all([
        api.get(`/evaluations/drift-check/${id}`),
        api.get(`/evaluations/drift-trend/${id}?limit=10`),
      ]);
      setData(checkRes.data);
      setTrend(trendRes.data.map((r, i) => ({
        ...r,
        label: r.run_at ? new Date(r.run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `#${i + 1}`,
      })));
    } catch { /* silent */ } finally { setLoading(false); }
  };

  useEffect(() => {
    if (selectedId) fetchDrift(selectedId);
  }, []);

  const sev = data ? SEV_CONFIG[data.drift_severity] || SEV_CONFIG.none : null;

  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-hairline" role="tablist" aria-label="Service drift analysis">
        <span className="text-[11px] font-medium text-text-subtle tracking-tight mr-3">Drift</span>
        {services.map(svc => (
          <button
            key={svc.id}
            role="tab"
            aria-selected={selectedId === svc.id}
            onClick={() => fetchDrift(svc.id)}
            className={`px-3 py-1 text-[12px] font-medium rounded-pill transition-standard ${
              selectedId === svc.id ? 'bg-accent-weak text-text shadow-xs' : 'text-text-muted hover:text-text'
            }`}
          >
            {svc.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-text-subtle" />
        </div>
      ) : data && data.current_score !== null ? (
        <div>
          {/* Severity banner */}
          <div className={`px-5 py-3.5 ${sev.bg} border-b border-hairline flex items-center justify-between`}>
            <div className="flex items-center gap-2.5">
              <sev.icon size={16} strokeWidth={1.75} className={sev.text} />
              <div>
                <span className={`text-[13px] font-semibold ${sev.text}`}>{sev.label}</span>
                <p className={`text-[11px] ${sev.text} opacity-75`}>{sev.desc}</p>
              </div>
            </div>
            <span className="text-[12px] text-text-muted">{services.find(s => s.id === selectedId)?.name}</span>
          </div>

          {/* Score row */}
          <div className="grid grid-cols-5 border-b border-hairline">
            {/* Current */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[11px] font-medium text-text-subtle tracking-tight mb-2.5 flex items-center gap-1">
                Current
                <InfoTip content="Latest evaluation quality score for this service (0–100%). Higher is better." size={11} />
              </p>
              <div className="relative w-14 h-14 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--hairline)" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={data.current_score >= 85 ? 'var(--status-healthy)' : data.current_score >= 75 ? 'var(--status-degraded)' : 'var(--status-failing)'} strokeWidth="2.5" strokeDasharray={`${data.current_score} ${100 - data.current_score}`} strokeLinecap="round" />
                </svg>
                <span className={`text-sm font-semibold font-mono tabular-nums ${scoreColor(data.current_score)}`}>{data.current_score}%</span>
              </div>
            </div>
            {/* Previous */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Previous
                <InfoTip content="Score from the previous run, with the delta below (green = improved, red = regressed)." size={11} />
              </p>
              <p className={`text-lg font-semibold font-mono tabular-nums ${data.previous_score !== null ? scoreColor(data.previous_score) : 'text-text-subtle'}`}>
                {data.previous_score !== null ? `${data.previous_score}%` : '--'}
              </p>
              {data.previous_score !== null && (
                <p className={`text-[11px] font-mono tabular-nums font-medium mt-0.5 ${data.current_score > data.previous_score ? 'text-status-healthy' : data.current_score < data.previous_score ? 'text-status-failing' : 'text-text-subtle'}`}>
                  {data.current_score > data.previous_score ? '+' : ''}{(data.current_score - data.previous_score).toFixed(1)}
                </p>
              )}
            </div>
            {/* Average */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Average
                <InfoTip content="Mean quality score across the last several runs. Used to detect gradual drift." size={11} />
              </p>
              <p className={`text-lg font-semibold font-mono tabular-nums ${data.avg_last_n !== null ? scoreColor(data.avg_last_n) : 'text-text-subtle'}`}>
                {data.avg_last_n !== null ? `${data.avg_last_n}%` : '--'}
              </p>
              <p className="text-[10px] text-text-subtle mt-0.5">{data.trend_scores?.length || 0} runs</p>
            </div>
            {/* Trend */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Trend
                <InfoTip content="Overall direction of quality change. Declining = slow drift; improving = getting better; stable = no change." size={11} />
              </p>
              <div className={`flex items-center gap-1 text-[15px] font-semibold ${
                data.trend_direction === 'declining' ? 'text-status-failing' : data.trend_direction === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
              }`}>
                {data.trend_direction === 'declining' ? <TrendingDown size={14} strokeWidth={1.75} /> : data.trend_direction === 'improving' ? <TrendingUp size={14} strokeWidth={1.75} /> : <Minus size={14} strokeWidth={1.75} />}
                <span className="capitalize">{data.trend_direction}</span>
              </div>
              <p className="text-[10px] text-text-subtle mt-0.5 capitalize">{data.confidence} conf.</p>
            </div>
            {/* Threshold */}
            <div className="p-5 flex flex-col items-center">
              <p className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Threshold
                <InfoTip content="Quality score below which drift is flagged as a problem. Set via DRIFT_THRESHOLD_PCT in .env (default: 75%)." size={11} />
              </p>
              <div className="flex items-center gap-1">
                <Target size={12} strokeWidth={1.75} className="text-status-failing" />
                <p className="text-lg font-semibold font-mono tabular-nums text-text">{data.threshold}%</p>
              </div>
              {data.score_variance !== null && <p className="text-[10px] text-text-subtle mt-0.5">Var: {data.score_variance}</p>}
            </div>
          </div>

          {/* Chart */}
          {trend.length > 0 && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-[13px] font-semibold text-text tracking-tight">Quality over time</h4>
                <div className="flex items-center gap-3 text-[11px] text-text-subtle">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded-full" style={{ background: 'var(--chart-1)' }} /> Quality</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded-full" style={{ background: 'var(--chart-2)' }} /> Factuality</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 rounded-full" style={{ background: 'var(--chart-4)' }} /> Threshold</span>
                </div>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="driftGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray={CHART_GRID_DASH} vertical={false} stroke={GRID_STROKE} />
                    <XAxis dataKey="label" axisLine={false} tickLine={false} tick={AXIS_TICK} dy={6} />
                    <YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={AXIS_TICK} dx={-6} tickFormatter={v => `${v}%`} />
                    <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v, n) => [`${v}%`, n]} />
                    <ReferenceLine y={data.threshold} stroke="var(--chart-4)" strokeDasharray="6 3" strokeWidth={1} />
                    <Area type="monotone" dataKey="quality_score" stroke="var(--chart-1)" strokeWidth={CHART_LINE_STROKE} fill="url(#driftGrad)" dot={{ r: 3, strokeWidth: 1.5, fill: 'var(--color-surface)' }} name="Quality" />
                    <Line type="monotone" dataKey="factuality_score" stroke="var(--chart-2)" strokeWidth={1.5} dot={{ r: 2.5, fill: 'var(--color-surface)', strokeWidth: 1 }} strokeDasharray="4 3" name="Factuality" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Per-test breakdown */}
          {data.per_test_case_breakdown?.length > 0 && (
            <div className="px-5 pb-5">
              <h4 className="text-[13px] font-semibold text-text tracking-tight mb-3">Per-test performance</h4>
              <div className="space-y-1.5">
                {data.per_test_case_breakdown.map(tc => {
                  const delta = tc.current_score - tc.avg_score;
                  return (
                    <div key={tc.test_case_id} className="flex items-center gap-3 px-3 py-2.5 bg-surface-elevated rounded-lg">
                      <span className={`px-2 py-0.5 rounded-pill text-[10px] font-medium tracking-tight ${tc.category === 'factuality' ? 'bg-severity-low-muted text-severity-low' : 'bg-status-paused-muted text-status-paused'}`}>
                        {tc.category}
                      </span>
                      <span className="text-[12px] text-text-muted flex-1 truncate">{tc.prompt_snippet}</span>
                      {/* Score bar */}
                      <div className="w-24 flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-hairline rounded-pill overflow-hidden">
                          <div className={`h-full rounded-pill ${scoreBg(tc.current_score)}`} style={{ width: `${tc.current_score}%` }} />
                        </div>
                        <span className={`text-[12px] font-mono tabular-nums font-medium w-10 text-right ${scoreColor(tc.current_score)}`}>{tc.current_score}%</span>
                      </div>
                      <span className={`text-[11px] font-mono tabular-nums w-12 text-right ${delta > 0 ? 'text-status-healthy' : delta < 0 ? 'text-status-failing' : 'text-text-subtle'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </span>
                      <div className={`flex items-center gap-0.5 w-16 justify-end text-[11px] font-medium ${
                        tc.trend === 'declining' ? 'text-status-failing' : tc.trend === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
                      }`}>
                        {tc.trend === 'declining' ? <TrendingDown size={10} strokeWidth={1.5} /> : tc.trend === 'improving' ? <TrendingUp size={10} strokeWidth={1.5} /> : <Minus size={10} strokeWidth={1.5} />}
                        {tc.trend}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="py-10">
          <EmptyState icon={Activity} title={data ? 'No evaluation data' : 'Select a service'} description={data ? 'Run an evaluation to see drift analysis.' : 'Choose a service tab above.'} />
        </div>
      )}
    </div>
  );
}
