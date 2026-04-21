import { FlaskConical } from 'lucide-react';
import DataTable from '../common/DataTable';
import EmptyState from '../common/EmptyState';

export default function TestCasesSection({ testCases, services }) {
  const columns = [
    { key: 'id', label: 'ID', render: (v) => <span className="font-mono tabular-nums text-xs text-text-muted">#{v}</span> },
    { key: 'service_id', label: 'Service', render: (v) => {
      const svc = services.find(s => s.id === v);
      return <span className="font-medium text-text">{svc?.name || `#${v}`}</span>;
    }},
    { key: 'category', label: 'Category', render: (v) => (
      <span className={`px-2 py-0.5 rounded-pill text-[10px] font-medium tracking-tight ${v === 'factuality' ? 'bg-severity-low-muted text-severity-low' : 'bg-status-paused-muted text-status-paused'}`}>
        {v}
      </span>
    )},
    { key: 'prompt', label: 'Prompt', render: (v) => <span className="text-sm text-text-muted truncate max-w-xs block">{v}</span> },
  ];

  return (
    <div>
      <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3">Test cases</h3>
      {testCases.length > 0 ? (
        <DataTable columns={columns} data={testCases} searchPlaceholder="Search test cases..." />
      ) : (
        <EmptyState icon={FlaskConical} title="No test cases" description="Create a test case to start evaluating services." />
      )}
    </div>
  );
}
