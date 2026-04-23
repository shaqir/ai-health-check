import { useState, useEffect } from 'react';
import { TrendingDown, TrendingUp, Minus, ShieldCheck, ShieldAlert, ShieldX, Activity, Loader2, Target, Play, AlertCircle } from 'lucide-react';
import {
  AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import api from '../../utils/api';
import { extractErrorDetail } from '../../utils/errors';
import EmptyState from '../common/EmptyState';
import { InfoTip } from '../common/Tooltip';
import { GRID_STROKE, AXIS_TICK, TOOLTIP_STYLE, CHART_GRID_DASH, CHART_LINE_STROKE } from '../common/chartStyle';

// Backend sends naive UTC strings (no Z suffix). JS parses naive ISO as
// LOCAL, offsetting chart tick labels by the viewer's timezone. Append Z
// when missing so tick dates match the Time column in EvalRunsSection.
// Keep the raw value if it already has an offset.
function parseBackendDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const str = String(value);
  const normalized = /[Zz]|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

const SEV_CONFIG = {
  critical: { icon: ShieldX, bg: 'bg-status-failing-muted', text: 'text-status-failing', label: 'Critical drift', desc: 'Quality below threshold. Immediate attention required.' },
  warning: { icon: ShieldAlert, bg: 'bg-status-degraded-muted', text: 'text-status-degraded', label: 'Warning', desc: 'Declining quality or approaching threshold.' },
  none: { icon: ShieldCheck, bg: 'bg-status-healthy-muted', text: 'text-status-healthy', label: 'Healthy', desc: 'Quality within acceptable range.' },
};

const scoreColor = (s) => s >= 85 ? 'text-status-healthy' : s >= 75 ? 'text-status-degraded' : 'text-status-failing';
const scoreBg = (s) => s >= 85 ? 'bg-status-healthy' : s >= 75 ? 'bg-status-degraded' : 'bg-status-failing';

export default function DriftAnalysis({
  services,
  selectedId,
  onSelect,
  testCaseCountByService = {},
  canEdit = false,
  onRunService,
  selectedIsPending = false,
  anyPending = false,
  refetchToken = 0,
  onTrendScoreCountChange,
}) {
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);

  const fetchDrift = async (id) => {
    setLoading(true);
    setFetchError(null);
    try {
      const [checkRes, trendRes] = await Promise.all([
        api.get(`/evaluations/drift-check/${id}`),
        api.get(`/evaluations/drift-trend/${id}?limit=10`),
      ]);
      setData(checkRes.data);
      setTrend(trendRes.data.map((r, i) => {
        const d = parseBackendDate(r.run_at);
        return {
          ...r,
          label: d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `#${i + 1}`,
        };
      }));
      // Let the parent know how many runs the trend is based on so the
      // standalone DriftMethodology card can quote the same N.
      if (onTrendScoreCountChange) {
        onTrendScoreCountChange(checkRes.data?.trend_scores?.length ?? null);
      }
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Failed to load drift data');
      setFetchError(detail);
      setData(null);
      setTrend([]);
    } finally { setLoading(false); }
  };

  // Re-fetch on: (1) selection change (tab click / initial mount), and
  // (2) parent bumping `refetchToken` after a successful Run — required
  // because running the already-selected service leaves selectedId
  // unchanged, so a selectedId-only dep would silently render stale data.
  useEffect(() => {
    if (selectedId) fetchDrift(selectedId);
  }, [selectedId, refetchToken]);

  const sev = data ? SEV_CONFIG[data.drift_severity] || SEV_CONFIG.none : null;

  return (
    <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
      {/* Tabs — service picker on the left, primary Run action on the
          right so the main CTA lives next to the data it refreshes. */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-hairline" role="tablist" aria-label="Service drift analysis">
        <span className="text-[12px] font-semibold text-text-subtle tracking-tight mr-1 shrink-0">Drift</span>
        <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0">
          {services.map(svc => {
            const count = testCaseCountByService[svc.id];
            const isSelected = selectedId === svc.id;
            return (
              <button
                key={svc.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelect(svc.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium rounded-pill transition-standard ${
                  isSelected ? 'bg-accent-weak text-text shadow-xs' : 'text-text-muted hover:text-text'
                }`}
              >
                {svc.name}
                {count != null && (
                  <span className={`text-[11px] font-mono tabular-nums rounded-full px-1.5 py-0.5 ${
                    isSelected ? 'bg-surface text-text-subtle' : 'bg-surface-elevated text-text-subtle'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {canEdit && onRunService && selectedId != null && (
          <button
            onClick={() => onRunService(selectedId)}
            disabled={anyPending}
            aria-busy={selectedIsPending}
            title="Run evaluation for the selected service"
            className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-status-healthy text-white rounded-pill text-[13px] font-medium hover:opacity-90 transition-standard disabled:opacity-50"
          >
            {selectedIsPending
              ? <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
              : <Play size={14} strokeWidth={1.75} />
            }
            Run
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={18} strokeWidth={1.5} className="animate-spin text-text-subtle" />
        </div>
      ) : fetchError ? (
        <div className="px-5 py-6">
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-status-failing-muted border border-status-failing/30" role="alert">
            <AlertCircle size={16} strokeWidth={1.75} className="text-status-failing shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-status-failing">Failed to load drift data</p>
              <p className="text-[12px] text-text-muted leading-snug mt-0.5 break-words">{fetchError}</p>
              <button
                type="button"
                onClick={() => fetchDrift(selectedId)}
                className="mt-2 text-[12px] font-medium text-accent hover:underline"
              >
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : data && data.current_score !== null ? (
        <div>
          {/* Severity banner */}
          <div className={`px-5 py-4 ${sev.bg} border-b border-hairline flex items-center justify-between`}>
            <div className="flex items-center gap-2.5">
              <sev.icon size={18} strokeWidth={1.75} className={sev.text} />
              <div>
                <span className={`text-[15px] font-semibold ${sev.text}`}>{sev.label}</span>
                <p className={`text-[12px] ${sev.text} opacity-80`}>{sev.desc}</p>
              </div>
            </div>
            <span className="text-[13px] font-medium text-text-muted">{services.find(s => s.id === selectedId)?.name}</span>
          </div>

          {/* Score row */}
          <div className="grid grid-cols-5 border-b border-hairline">
            {/* Current */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-2.5 flex items-center gap-1">
                Current
                <InfoTip content="Latest evaluation quality score for this service (0–100%). Higher is better." size={12} />
              </p>
              <div className="relative w-16 h-16 flex items-center justify-center">
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--hairline)" strokeWidth="2.5" />
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke={data.current_score >= 85 ? 'var(--status-healthy)' : data.current_score >= 75 ? 'var(--status-degraded)' : 'var(--status-failing)'} strokeWidth="2.5" strokeDasharray={`${data.current_score} ${100 - data.current_score}`} strokeLinecap="round" />
                </svg>
                <span className={`text-[15px] font-semibold font-mono tabular-nums ${scoreColor(data.current_score)}`}>{data.current_score}%</span>
              </div>
            </div>
            {/* Previous */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
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
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Average
                <InfoTip content="Mean quality score across the last several runs. Used to detect gradual drift." size={11} />
              </p>
              <p className={`text-lg font-semibold font-mono tabular-nums ${data.avg_last_n !== null ? scoreColor(data.avg_last_n) : 'text-text-subtle'}`}>
                {data.avg_last_n !== null ? `${data.avg_last_n}%` : '--'}
              </p>
              <p className="text-[11px] text-text-subtle mt-1">{data.trend_scores?.length || 0} runs</p>
            </div>
            {/* Trend */}
            <div className="p-5 flex flex-col items-center border-r border-hairline">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Trend
                <InfoTip content="Overall direction of quality change. Declining = slow drift; improving = getting better; stable = no change." size={11} />
              </p>
              <div className={`flex items-center gap-1.5 text-[17px] font-semibold ${
                data.trend_direction === 'declining' ? 'text-status-failing' : data.trend_direction === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
              }`}>
                {data.trend_direction === 'declining' ? <TrendingDown size={16} strokeWidth={1.75} /> : data.trend_direction === 'improving' ? <TrendingUp size={16} strokeWidth={1.75} /> : <Minus size={16} strokeWidth={1.75} />}
                <span className="capitalize">{data.trend_direction}</span>
              </div>
              <p className="text-[11px] text-text-subtle mt-1 capitalize">{data.confidence} conf.</p>
            </div>
            {/* Threshold */}
            <div className="p-5 flex flex-col items-center">
              <p className="text-[12px] font-medium text-text-subtle tracking-tight mb-1.5 flex items-center gap-1">
                Threshold
                <InfoTip content="Quality score below which drift is flagged as a problem. Set via DRIFT_THRESHOLD_PCT in .env (default: 75%)." size={11} />
              </p>
              <div className="flex items-center gap-1">
                <Target size={12} strokeWidth={1.75} className="text-status-failing" />
                <p className="text-xl font-semibold font-mono tabular-nums text-text">{data.threshold}%</p>
              </div>
              {data.score_variance !== null && <p className="text-[11px] text-text-subtle mt-1">Var: {data.score_variance}</p>}
            </div>
          </div>

          {/* Sample-too-small notice — one or two runs produce noisy trends
              (split-half is 1-vs-1), so surface that explicitly instead of
              letting users read a 50% result as a meaningful regression. */}
          {data.trend_scores && data.trend_scores.length < 3 && (
            <div className="px-5 py-3 bg-severity-low-muted/40 border-b border-hairline flex items-center gap-2.5">
              <Info size={15} strokeWidth={1.75} className="text-severity-low shrink-0" />
              <p className="text-[13px] text-text-muted leading-snug">
                Only <span className="font-semibold text-text">{data.trend_scores.length} run{data.trend_scores.length === 1 ? '' : 's'}</span> available — trend and severity are low-confidence until 3+ runs. Quality may appear to swing sharply between runs.
              </p>
            </div>
          )}

          {/* Score composition — breaks down how current_score is built from
              factuality + format. Directly answers "why is quality 50%?" when
              e.g. factuality=100 + format=0 averages to exactly 50. */}
          {trend.length > 0 && (() => {
            const latest = trend[trend.length - 1] || {};
            const parts = [
              { key: 'factuality', label: 'Factuality', value: latest.factuality_score, tip: 'LLM-judged correctness vs. expected answer' },
              { key: 'format', label: 'Format (JSON)', value: latest.format_score, tip: '100 if response parses as valid JSON, else 0' },
            ].filter(p => p.value !== null && p.value !== undefined);
            if (parts.length === 0) return null;
            return (
              <div className="px-5 py-4 border-b border-hairline bg-surface-elevated/30">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-1.5">
                    Score composition
                    <InfoTip content="Quality is the mean of its components. A single failing component can drag the overall score down sharply." size={12} />
                  </p>
                  <p className="text-[12px] text-text-subtle">latest run · mean = <span className="font-mono tabular-nums font-medium text-text">{data.current_score}%</span></p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  {parts.map(p => (
                    <div key={p.key} className="flex items-center gap-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[12.5px] text-text-muted truncate" title={p.tip}>{p.label}</span>
                          <span className={`text-[13px] font-mono tabular-nums font-semibold ${scoreColor(p.value)}`}>{p.value}%</span>
                        </div>
                        <div className="h-2 bg-hairline rounded-pill overflow-hidden">
                          <div className={`h-full rounded-pill ${scoreBg(p.value)}`} style={{ width: `${p.value}%` }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Chart — bumped to 264px and given a lightly tinted backdrop
              so it reads as the focal point of the panel, not an
              afterthought between the score row and the per-test list. */}
          {trend.length > 0 && (
            <div className="px-5 py-5 bg-surface-elevated/20">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-[15px] font-semibold text-text tracking-tight">Quality over time</h4>
                  <p className="text-[11.5px] text-text-subtle mt-0.5">Last {trend.length} run{trend.length === 1 ? '' : 's'} · threshold line dashed</p>
                </div>
                <div className="flex items-center gap-3.5 text-[12px] text-text-muted">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-1)' }} /> Quality</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-2)' }} /> Factuality</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 rounded-full" style={{ background: 'var(--chart-4)' }} /> Threshold</span>
                </div>
              </div>
              <div className="h-64">
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
              <h4 className="text-[15px] font-semibold text-text tracking-tight mb-3">Per-test performance</h4>
              <div className="space-y-2">
                {data.per_test_case_breakdown.map(tc => {
                  const delta = tc.current_score - tc.avg_score;
                  return (
                    <div key={tc.test_case_id} className="flex items-center gap-3 px-3.5 py-3 bg-surface-elevated rounded-lg">
                      <span className={`px-2 py-0.5 rounded-pill text-[11px] font-medium tracking-tight ${tc.category === 'factuality' ? 'bg-severity-low-muted text-severity-low' : 'bg-status-paused-muted text-status-paused'}`}>
                        {tc.category}
                      </span>
                      <span className="text-[13px] text-text-muted flex-1 truncate">{tc.prompt_snippet}</span>
                      {/* Score bar */}
                      <div className="w-28 flex items-center gap-2">
                        <div className="flex-1 h-2 bg-hairline rounded-pill overflow-hidden">
                          <div className={`h-full rounded-pill ${scoreBg(tc.current_score)}`} style={{ width: `${tc.current_score}%` }} />
                        </div>
                        <span className={`text-[13px] font-mono tabular-nums font-semibold w-11 text-right ${scoreColor(tc.current_score)}`}>{tc.current_score}%</span>
                      </div>
                      <span className={`text-[12px] font-mono tabular-nums w-14 text-right ${delta > 0 ? 'text-status-healthy' : delta < 0 ? 'text-status-failing' : 'text-text-subtle'}`}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}
                      </span>
                      <div className={`flex items-center gap-1 w-20 justify-end text-[12px] font-medium ${
                        tc.trend === 'declining' ? 'text-status-failing' : tc.trend === 'improving' ? 'text-status-healthy' : 'text-text-subtle'
                      }`}>
                        {tc.trend === 'declining' ? <TrendingDown size={12} strokeWidth={1.5} /> : tc.trend === 'improving' ? <TrendingUp size={12} strokeWidth={1.5} /> : <Minus size={12} strokeWidth={1.5} />}
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
