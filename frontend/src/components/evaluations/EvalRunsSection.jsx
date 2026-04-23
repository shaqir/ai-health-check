import { useState } from 'react';
import { Activity, Clock, User as UserIcon, Check, AlertTriangle, Gauge, Info } from 'lucide-react';
import DataTable from '../common/DataTable';
import StatusBadge from '../common/StatusBadge';
import ModelBadge from '../common/ModelBadge';
import EmptyState from '../common/EmptyState';
import Modal from '../common/Modal';
import { Tooltip } from '../common/Tooltip';

// Hallucination scoring is inverted: 0 = clean, 100 = fully hallucinated.
// Show as a Yes/No flag; when Yes, show the severity-colored score alongside.
// A score ≤10 is treated as noise from the judge and counted as No.
function HallucCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="font-mono text-[13px] text-text-subtle">—</span>;
  }
  const isHallucinating = value > 10;
  if (!isHallucinating) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[12px] font-semibold bg-status-healthy-muted text-status-healthy">
        <Check size={12} strokeWidth={2.25} />
        No
      </span>
    );
  }
  // Yes-case severity: amber at 11–30, red above.
  const severe = value > 30;
  const toneText = severe ? 'text-status-failing' : 'text-status-degraded';
  const toneBg = severe ? 'bg-status-failing-muted' : 'bg-status-degraded-muted';
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[12px] font-semibold ${toneBg} ${toneText}`}>
        <AlertTriangle size={12} strokeWidth={2.25} />
        Yes
      </span>
      <span className={`font-mono tabular-nums text-[13px] font-medium ${toneText}`}>{value}%</span>
    </div>
  );
}

// Tooltip content for the scheduler badge. Numbers match defaults in
// backend/app/config.py (eval_schedule_minutes=60). Narrated so a panel
// reviewer can hover and get the "what fires, when, and how to turn it off"
// story without having to dig into the code.
const SCHEDULED_TOOLTIP = (
  <div className="space-y-1.5 leading-snug">
    <div className="font-semibold text-text text-[12px]">Scheduler-driven eval run</div>
    <p>
      APScheduler fires every <code className="font-mono text-[10.5px]">eval_schedule_minutes</code> (default
      <span className="whitespace-nowrap"> 60 min</span>) inside the running backend process. Each tick runs
      factuality + format tests against every active service that has at least one test case.
    </p>
    <p>
      <span className="font-semibold text-text">Skipped:</span> services labelled <em>confidential</em> — the
      scheduler has no admin present to approve the sensitivity override, so their prompts never leave the box
      automatically. Register a manual run to include them.
    </p>
    <p className="text-text-subtle text-[10.5px]">
      Disable entirely with <code className="font-mono text-[10.5px]">SCHEDULER_ENABLED=false</code> in the
      backend <code className="font-mono text-[10.5px]">.env</code>.
    </p>
  </div>
);

const MANUAL_TOOLTIP = (
  <div className="space-y-1.5 leading-snug">
    <div className="font-semibold text-text text-[12px]">User-triggered eval run</div>
    <p>
      A logged-in user clicked <em>Run Evaluation</em> on this service. Attributed to that user in the audit
      log, and it <em>can</em> reach a confidential service via an explicit
      <code className="font-mono text-[10.5px]"> allow_confidential=true</code> admin override.
    </p>
  </div>
);

function RunTypeBadge({ value }) {
  const scheduled = value === 'scheduled';
  const Icon = scheduled ? Clock : UserIcon;
  const cls = scheduled
    ? 'bg-accent-weak text-accent'
    : 'bg-surface-elevated text-text-muted';
  const tooltipContent = scheduled ? SCHEDULED_TOOLTIP : MANUAL_TOOLTIP;
  return (
    <Tooltip content={tooltipContent}>
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[11px] font-medium capitalize cursor-help ${cls}`}>
        <Icon size={11} strokeWidth={2} />
        {value || 'manual'}
      </span>
    </Tooltip>
  );
}

// Compact relative labels for recent runs ("2m ago", "14h ago"), falling
// back to "Mon DD" for anything older than a week. The previous absolute
// "Apr 23, 02:23 PM" format wrapped to two lines in the table because of
// the trailing "PM" — the relative labels keep everything on one line and
// are also easier to scan when a grader is staring at a run that happened
// 30 seconds ago.
function formatRelative(d) {
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) {
    // Clock skew / future timestamp — show short absolute to avoid "in 2h".
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const sec = 1000;
  const min = 60 * sec;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diffMs < min) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TimeCell({ value }) {
  if (!value) return <span className="font-mono text-[13px] text-text-subtle">—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return <span className="font-mono tabular-nums text-[13px]">{value}</span>;
  }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <span
      className="font-mono tabular-nums text-[13px] whitespace-nowrap"
      title={`${d.toLocaleString()} (${tz})`}
    >
      {formatRelative(d)}
    </span>
  );
}

// Derives a worked example of the half-split trend rule from the row's own
// history if we have enough runs. Keeps the explanation concrete — "your
// recent scores are [X, Y, Z], split in half, diff = ...".
function buildTrendExample(row) {
  const scores = Array.isArray(row?.trend_scores) ? row.trend_scores : [];
  if (scores.length < 2) return null;
  const mid = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, mid);
  const secondHalf = scores.slice(mid);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const f = mean(firstHalf);
  const s = mean(secondHalf);
  const diff = s - f;
  let label = 'stable';
  if (diff > 3) label = 'improving';
  else if (diff < -3) label = 'declining';
  return {
    scores,
    firstHalf,
    secondHalf,
    firstMean: f.toFixed(1),
    secondMean: s.toFixed(1),
    diff: diff.toFixed(2),
    label,
  };
}

function ScoreDetailsModal({ isOpen, onClose, row, threshold }) {
  if (!row) return null;
  // `threshold` comes from /evaluations/config (backend settings.drift_threshold).
  // Fallback to 75 if the parent hasn't loaded it yet — matches config.py default.
  const effectiveThreshold = threshold ?? 75;
  const warnCeiling = effectiveThreshold + 10;  // Gate B early-warning ceiling (threshold + 10)
  const score = row.quality_score;
  const gateA = typeof score === 'number' && score < effectiveThreshold;
  const incomplete = row.run_status === 'incomplete';
  const trend = buildTrendExample(row);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`How was ${row.service_name}'s score computed?`} maxWidth="max-w-2xl">
      <div className="space-y-5 text-[13px] text-text-muted leading-relaxed">
        {/* This run's numbers */}
        <div className="rounded-lg border border-hairline bg-surface-elevated/40 p-4">
          <p className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.09em] mb-2">This run</p>
          <div className="grid grid-cols-4 gap-3 text-center">
            <div>
              <p className="text-[11px] text-text-subtle">Quality</p>
              <p className={`font-mono tabular-nums text-[18px] font-semibold ${gateA ? 'text-status-failing' : 'text-text'}`}>
                {incomplete ? '—' : `${score}%`}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-subtle">Factuality</p>
              <p className="font-mono tabular-nums text-[16px] font-semibold text-text">
                {row.factuality_score ?? '—'}{row.factuality_score != null && '%'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-subtle">Format</p>
              <p className="font-mono tabular-nums text-[16px] font-semibold text-text">
                {row.format_score ?? '—'}{row.format_score != null && '%'}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-text-subtle">Hallucination</p>
              <p className="font-mono tabular-nums text-[16px] font-semibold text-text">
                {row.hallucination_score ?? '—'}{row.hallucination_score != null && '%'}
              </p>
            </div>
          </div>
          {incomplete && (
            <p className="text-[11px] text-status-degraded mt-2 text-center">
              Incomplete run — every test errored or the judge refused. Score is not meaningful.
            </p>
          )}
        </div>

        {/* Per-test scoring */}
        <section>
          <h4 className="text-[14px] font-semibold text-text flex items-center gap-1.5 mb-2">
            <Gauge size={14} strokeWidth={1.75} className="text-accent" /> 1. Per-test-case score
          </h4>
          <div className="pl-5 space-y-1.5">
            <p><span className="font-semibold text-text">factuality</span> — LLM judge (Haiku 4.5) rates similarity to the expected output, 0–100. Also runs a hallucination check. Judge refusal ⇒ excluded (not read as 0).</p>
            <p><span className="font-semibold text-text">format_json</span> — deterministic parser. Tries raw parse → <code className="font-mono text-[11px] bg-surface-elevated px-1 rounded">```json</code> fence → first <code className="font-mono text-[11px] bg-surface-elevated px-1 rounded">{'{...}'}</code> span. Valid JSON = 100, else 0.</p>
          </div>
        </section>

        {/* Aggregate math */}
        <section>
          <h4 className="text-[14px] font-semibold text-text flex items-center gap-1.5 mb-2">
            <Gauge size={14} strokeWidth={1.75} className="text-accent" /> 2. Aggregate quality score
          </h4>
          <p className="pl-5">Mean of all valid per-case scores. Excludes <span className="font-mono text-[11px] bg-surface-elevated px-1 rounded">judge_refused</span> and infra <span className="font-mono text-[11px] bg-surface-elevated px-1 rounded">error</span> rows so a flaky judge or a Claude 404 can't fake-drift by scoring 0. If every case is excluded ⇒ <span className="font-semibold text-text">incomplete</span> (dash, not 0%).</p>
        </section>

        {/* Drift gates */}
        <section>
          <h4 className="text-[14px] font-semibold text-text flex items-center gap-1.5 mb-2">
            <Info size={14} strokeWidth={1.75} className="text-accent" /> 3. Drift detection — two gates (OR)
          </h4>
          <div className="pl-5 space-y-3">
            <div className="rounded-md bg-surface-elevated/50 border border-hairline p-3">
              <p className="font-semibold text-text mb-1">Gate A — hard threshold</p>
              <p>Flag drift when <code className="font-mono text-[11px] bg-surface px-1.5 py-0.5 rounded">quality_score &lt; {effectiveThreshold}</code>.</p>
              <p className="mt-1 text-[12px]">
                This run: <span className="font-mono tabular-nums">{incomplete ? '—' : `${score}`}</span>{' < '}{effectiveThreshold} → {' '}
                <span className={gateA ? 'text-status-failing font-semibold' : 'text-status-healthy font-semibold'}>
                  {incomplete ? 'N/A' : (gateA ? 'TRIPPED (critical)' : 'clear')}
                </span>
              </p>
            </div>
            <div className="rounded-md bg-surface-elevated/50 border border-hairline p-3">
              <p className="font-semibold text-text mb-1">Gate B — half-split trend + early warning</p>
              <p>Needs at least 3 prior runs. Splits the last ~5 scores in half, compares averages:</p>
              <pre className="font-mono text-[11px] bg-surface p-2 rounded mt-1.5 overflow-x-auto leading-relaxed">
{`mid        = len(scores) // 2
first_half = mean(scores[:mid])
second_half = mean(scores[mid:])
diff       = second_half - first_half

diff >  3 → improving
diff < -3 → declining
else      → stable`}
              </pre>
              <p className="mt-2">If trend is <span className="text-status-failing font-semibold">declining</span> AND score &lt; {warnCeiling} (i.e. threshold + 10) ⇒ flag drift as <span className="text-status-degraded font-semibold">warning</span>. Catches the slide <em>before</em> it crashes through {effectiveThreshold}.</p>
              {trend ? (
                <div className="mt-2 text-[12px] space-y-1 bg-surface p-2 rounded">
                  <p>Recent scores: <span className="font-mono tabular-nums">[{trend.scores.join(', ')}]</span></p>
                  <p>First half mean = <span className="font-mono tabular-nums">{trend.firstMean}</span>, second half mean = <span className="font-mono tabular-nums">{trend.secondMean}</span></p>
                  <p>diff = <span className="font-mono tabular-nums">{trend.diff}</span> → <span className={trend.label === 'declining' ? 'text-status-failing font-semibold' : trend.label === 'improving' ? 'text-status-healthy font-semibold' : 'text-text-subtle'}>{trend.label}</span></p>
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-text-subtle italic">Not enough history on this row to show the split — need at least 2 runs.</p>
              )}
            </div>
          </div>
        </section>

        {/* Severity mapping */}
        <section>
          <h4 className="text-[14px] font-semibold text-text flex items-center gap-1.5 mb-2">
            <Info size={14} strokeWidth={1.75} className="text-accent" /> 4. Alert severity
          </h4>
          <p className="pl-5">Gate A trip ⇒ <span className="text-status-failing font-semibold">critical</span>. Gate B alone (trend-only) ⇒ <span className="text-status-degraded font-semibold">warning</span>.</p>
        </section>

        <p className="text-[11px] text-text-subtle pt-2 border-t border-hairline">
          Source: <code className="font-mono">backend/app/services/eval_runner.py</code> · threshold configurable via <code className="font-mono">DRIFT_THRESHOLD</code>.
        </p>
      </div>
    </Modal>
  );
}

export default function EvalRunsSection({ evalRuns, driftThreshold }) {
  const [detailRow, setDetailRow] = useState(null);

  const columns = [
    { key: 'service_name', label: 'Service', render: (v) => <span className="font-medium text-text text-[14px]">{v}</span> },
    {
      key: 'quality_score',
      label: 'Quality',
      tooltip: 'Blended score across evaluated test cases (factuality + format). Click a score to see how it was computed.',
      render: (v, row) => {
        if (row && row.run_status === 'incomplete') {
          return (
            <button
              type="button"
              onClick={() => setDetailRow(row)}
              className="font-mono text-[14px] text-text-subtle underline decoration-dotted underline-offset-2 hover:text-text transition-standard"
              title="No measurable signal — click for details"
            >
              —
            </button>
          );
        }
        return (
          <button
            type="button"
            onClick={() => setDetailRow(row)}
            className="font-mono tabular-nums font-semibold text-[14px] text-text underline decoration-dotted underline-offset-2 decoration-text-subtle hover:decoration-accent transition-standard"
            title="Click to see how this score was computed"
          >
            {v}%
          </button>
        );
      },
    },
    {
      key: 'factuality_score',
      label: 'Factuality',
      tooltip: 'How closely the AI\'s response matched the expected output. Higher is better.',
      render: (v) => <span className="font-mono tabular-nums text-[13px]">{v !== null ? `${v}%` : '-'}</span>,
    },
    {
      key: 'format_score',
      label: 'Format',
      tooltip: 'Whether the output parses correctly (e.g. valid JSON for format-typed test cases). Higher is better.',
      render: (v) => <span className="font-mono tabular-nums text-[13px]">{v !== null ? `${v}%` : '-'}</span>,
    },
    {
      key: 'hallucination_score',
      label: 'Hallucination',
      tooltip: 'Did the model fabricate claims not grounded in the input? No = score ≤10 (clean). Yes = score >10, shown alongside as a severity %. Score >30 is treated as severe.',
      render: (v) => <HallucCell value={v} />,
    },
    {
      key: 'judge_model',
      label: 'Judge',
      tooltip: 'Which model scored this run. Two-tier architecture: Sonnet is the actor (under test), Haiku is the judge (cheaper, faster, different size/training emphasis to reduce model-scoring-itself correlation).',
      render: (v) => <ModelBadge model={v} />,
    },
    {
      key: 'run_type',
      label: 'Type',
      tooltip: 'How this run was triggered — manual (user clicked Run) or scheduled (recurring timer).',
      render: (v) => <RunTypeBadge value={v} />,
    },
    {
      key: 'drift_flagged',
      label: 'Status',
      tooltip: 'Tri-state: Healthy (quality above threshold), Drift Detected (quality below threshold — triggers an alert), or No Signal (every test errored or judge refused — we honestly cannot measure).',
      render: (v, row) => {
        if (row && row.run_status === 'incomplete') {
          return <StatusBadge status="No signal" />;
        }
        return <StatusBadge status={v ? 'Drift Detected' : 'Healthy'} />;
      },
    },
    { key: 'run_at', label: 'Time', render: (v) => <TimeCell value={v} /> },
  ];

  return (
    <div>
      <div className="mb-3">
        <h3 className="text-[15px] font-semibold text-text tracking-tight">Evaluation runs</h3>
        <p className="text-[12px] text-text-subtle leading-snug mt-0.5">
          History of every run — click a quality score to see how it was computed.
        </p>
      </div>
      {evalRuns.length > 0 ? (
        <DataTable columns={columns} data={evalRuns} searchPlaceholder="Search runs..." />
      ) : (
        <EmptyState icon={Activity} title="No evaluation runs" description="Add test cases and run an evaluation." />
      )}
      <ScoreDetailsModal
        isOpen={Boolean(detailRow)}
        onClose={() => setDetailRow(null)}
        row={detailRow}
        threshold={driftThreshold}
      />
    </div>
  );
}
