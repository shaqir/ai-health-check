import { Activity, Clock, User as UserIcon } from 'lucide-react';
import DataTable from '../common/DataTable';
import StatusBadge from '../common/StatusBadge';
import EmptyState from '../common/EmptyState';

function RunTypeBadge({ value }) {
  const scheduled = value === 'scheduled';
  const Icon = scheduled ? Clock : UserIcon;
  const cls = scheduled
    ? 'bg-accent-weak text-accent'
    : 'bg-surface-elevated text-text-muted';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[10px] font-medium capitalize ${cls}`}>
      <Icon size={10} strokeWidth={2} />
      {value || 'manual'}
    </span>
  );
}

function TimeCell({ value }) {
  if (!value) return <span className="font-mono text-xs text-text-subtle">—</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return <span className="font-mono tabular-nums text-xs">{value}</span>;
  }
  const short = d.toLocaleString(undefined, {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  return (
    <span
      className="font-mono tabular-nums text-xs"
      title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
    >
      {short}
    </span>
  );
}

export default function EvalRunsSection({ evalRuns }) {
  const columns = [
    { key: 'service_name', label: 'Service', render: (v) => <span className="font-medium text-text">{v}</span> },
    {
      key: 'quality_score',
      label: 'Quality',
      tooltip: 'Overall evaluation score (0–100%). Blended from factuality and format sub-scores.',
      render: (v) => <span className="font-mono tabular-nums font-medium">{v}%</span>,
    },
    {
      key: 'factuality_score',
      label: 'Factuality',
      tooltip: 'How closely the AI\'s response matched the expected output. Higher is better.',
      render: (v) => <span className="font-mono tabular-nums">{v !== null ? `${v}%` : '-'}</span>,
    },
    {
      key: 'format_score',
      label: 'Format',
      tooltip: 'Whether the output parses correctly (e.g. valid JSON for format-typed test cases). Higher is better.',
      render: (v) => <span className="font-mono tabular-nums">{v !== null ? `${v}%` : '-'}</span>,
    },
    {
      key: 'hallucination_score',
      label: 'Halluc.',
      tooltip: 'LLM-as-judge score for fabricated claims not grounded in input (0–100). LOWER is better. Values above 30 are highlighted red.',
      render: (v) => <span className={`font-mono tabular-nums ${v !== null && v > 30 ? 'text-status-failing font-medium' : ''}`}>{v !== null ? `${v}%` : '-'}</span>,
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
      tooltip: 'Drift = quality dropped below the configured threshold. Triggers an alert.',
      render: (v) => <StatusBadge status={v ? 'Drift Detected' : 'Healthy'} />,
    },
    { key: 'run_at', label: 'Time', render: (v) => <TimeCell value={v} /> },
  ];

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3">Evaluation runs</h3>
      {evalRuns.length > 0 ? (
        <DataTable columns={columns} data={evalRuns} searchPlaceholder="Search runs..." />
      ) : (
        <EmptyState icon={Activity} title="No evaluation runs" description="Add test cases and run an evaluation." />
      )}
    </div>
  );
}
