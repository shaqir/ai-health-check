import { Activity } from 'lucide-react';
import DataTable from '../common/DataTable';
import StatusBadge from '../common/StatusBadge';
import EmptyState from '../common/EmptyState';

export default function EvalRunsSection({ evalRuns }) {
  const columns = [
    { key: 'service_name', label: 'Service', render: (v) => <span className="font-medium text-text">{v}</span> },
    { key: 'quality_score', label: 'Quality', render: (v) => <span className="font-mono tabular-nums font-medium">{v}%</span> },
    { key: 'factuality_score', label: 'Factuality', render: (v) => <span className="font-mono tabular-nums">{v !== null ? `${v}%` : '-'}</span> },
    { key: 'format_score', label: 'Format', render: (v) => <span className="font-mono tabular-nums">{v !== null ? `${v}%` : '-'}</span> },
    { key: 'hallucination_score', label: 'Halluc.', render: (v) => <span className={`font-mono tabular-nums ${v !== null && v > 30 ? 'text-status-failing font-medium' : ''}`}>{v !== null ? `${v}%` : '-'}</span> },
    { key: 'run_type', label: 'Type', render: (v) => <span className="capitalize">{v}</span> },
    { key: 'drift_flagged', label: 'Status', render: (v) => <StatusBadge status={v ? 'Drift Detected' : 'Healthy'} /> },
    { key: 'run_at', label: 'Time', render: (v) => <span className="font-mono tabular-nums text-xs">{v ? new Date(v).toLocaleString() : ''}</span> },
  ];

  return (
    <div>
      <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Evaluation Runs</h3>
      {evalRuns.length > 0 ? (
        <DataTable columns={columns} data={evalRuns} searchPlaceholder="Search runs..." />
      ) : (
        <EmptyState icon={Activity} title="No evaluation runs" description="Add test cases and run an evaluation." />
      )}
    </div>
  );
}
