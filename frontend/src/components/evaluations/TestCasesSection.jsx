import { useMemo, useState } from 'react';
import { FlaskConical, Filter, FileCheck, Braces } from 'lucide-react';
import DataTable from '../common/DataTable';
import EmptyState from '../common/EmptyState';

// Category → label + pill tone. Keeps "format_json" from showing as a raw
// snake_case token in the table; reviewers pattern-match by color.
const CATEGORY_META = {
  factuality:  { label: 'Factuality',  cls: 'bg-accent-weak text-accent',               Icon: FileCheck },
  format_json: { label: 'Format · JSON', cls: 'bg-status-paused-muted text-status-paused', Icon: Braces },
};

function categoryMeta(key) {
  return CATEGORY_META[key] || {
    label: key,
    cls: 'bg-surface-elevated text-text-muted',
    Icon: null,
  };
}

export default function TestCasesSection({ testCases, services }) {
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');

  // Only list services that actually have test cases — no dead entries in the
  // dropdown. Preserves service order as returned by the /services endpoint.
  const serviceOptions = useMemo(() => {
    const ids = new Set(testCases.map(tc => tc.service_id));
    return services.filter(s => ids.has(s.id));
  }, [testCases, services]);

  const filtered = useMemo(() => {
    return testCases.filter(tc => {
      if (categoryFilter !== 'all' && tc.category !== categoryFilter) return false;
      if (serviceFilter !== 'all' && String(tc.service_id) !== serviceFilter) return false;
      return true;
    });
  }, [testCases, categoryFilter, serviceFilter]);

  // Stats reflect the filtered view so the tiles match what the table shows.
  const stats = useMemo(() => {
    let factuality = 0;
    let formatJson = 0;
    const svcSet = new Set();
    for (const tc of filtered) {
      svcSet.add(tc.service_id);
      if (tc.category === 'factuality') factuality += 1;
      else if (tc.category === 'format_json') formatJson += 1;
    }
    return { total: filtered.length, services: svcSet.size, factuality, formatJson };
  }, [filtered]);

  const columns = [
    {
      key: 'id',
      label: 'ID',
      render: (v) => (
        <span className="font-mono tabular-nums text-[12px] text-text-subtle whitespace-nowrap">
          #{v}
        </span>
      ),
    },
    {
      key: 'service_id',
      label: 'Service',
      render: (v) => {
        const svc = services.find(s => s.id === v);
        const name = svc?.name || `Service #${v}`;
        return (
          <span
            className="font-medium text-text text-[13px] whitespace-nowrap truncate max-w-[200px] block"
            title={name}
          >
            {name}
          </span>
        );
      },
    },
    {
      key: 'category',
      label: 'Category',
      render: (v) => {
        const meta = categoryMeta(v);
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill text-[11px] font-medium tracking-tight whitespace-nowrap ${meta.cls}`}>
            {meta.Icon && <meta.Icon size={10} strokeWidth={2} />}
            {meta.label}
          </span>
        );
      },
    },
    {
      key: 'prompt',
      label: 'Prompt',
      render: (v) => (
        <span
          className="text-[12px] text-text-muted truncate max-w-[320px] block"
          title={v || ''}
        >
          {v || '—'}
        </span>
      ),
    },
    {
      key: 'expected_output',
      label: 'Expected',
      render: (v) => (
        <span
          className="text-[12px] text-text-subtle font-mono truncate max-w-[260px] block"
          title={v || ''}
        >
          {v || '—'}
        </span>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-end justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-text tracking-tight">Test cases</h3>
          <p className="text-[12px] text-text-subtle leading-snug mt-0.5">
            The <span className="font-medium text-text-muted">golden dataset</span> — stored prompts with known-good answers. Each run scores every test case in scope.
          </p>
        </div>
        {testCases.length > 0 && (
          <span className="text-[11px] text-text-subtle tracking-tight tabular-nums shrink-0">
            {stats.total === testCases.length
              ? `${testCases.length} total`
              : `${stats.total} of ${testCases.length} shown`}
          </span>
        )}
      </div>

      {testCases.length > 0 ? (
        <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
          {/* Stats tiles — react to filter selections. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4 border-b border-hairline">
            <StatTile label="Test cases" value={stats.total} />
            <StatTile label="Services" value={stats.services} />
            <StatTile
              label="Factuality"
              value={stats.factuality}
              tone="accent"
            />
            <StatTile
              label="Format JSON"
              value={stats.formatJson}
              tone="paused"
            />
          </div>

          {/* Filter toolbar — category chips + service dropdown. */}
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-hairline bg-surface-elevated/40">
            <div className="flex items-center gap-1.5 text-text-subtle" aria-hidden="true">
              <Filter size={12} strokeWidth={1.75} />
              <span className="text-[10px] uppercase font-semibold tracking-[0.09em]">Filter</span>
            </div>

            <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Category filter">
              {[
                { id: 'all',         label: 'All' },
                { id: 'factuality',  label: 'Factuality' },
                { id: 'format_json', label: 'Format JSON' },
              ].map(c => (
                <button
                  key={c.id}
                  role="tab"
                  aria-selected={categoryFilter === c.id}
                  onClick={() => setCategoryFilter(c.id)}
                  className={`px-2.5 py-0.5 text-[11px] font-medium rounded-pill transition-standard whitespace-nowrap ${
                    categoryFilter === c.id
                      ? 'bg-surface-elevated text-text shadow-xs'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            <select
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              aria-label="Filter by service"
              className="ml-auto text-[11px] py-1 px-2.5 rounded-pill bg-[var(--material-thick)] text-text transition-standard"
            >
              <option value="all">All services</option>
              {serviceOptions.map(s => (
                <option key={s.id} value={String(s.id)}>{s.name}</option>
              ))}
            </select>
          </div>

          {filtered.length > 0 ? (
            <DataTable
              columns={columns}
              data={filtered}
              searchPlaceholder="Search test cases..."
              flat
              maxHeight="480px"
            />
          ) : (
            <div className="p-6">
              <EmptyState
                icon={FlaskConical}
                title="No matches"
                description="No test cases match the current filters. Clear a filter to see more."
              />
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon={FlaskConical}
          title="No test cases"
          description="Create a test case to start evaluating services."
        />
      )}
    </div>
  );
}

function StatTile({ label, value, tone }) {
  const toneCls = tone === 'accent'
    ? 'text-accent'
    : tone === 'paused'
      ? 'text-status-paused'
      : 'text-text';
  const displayValue = value === null || value === undefined ? '—' : String(value);
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-subtle mb-0.5">
        {label}
      </p>
      <p className={`text-[15px] font-semibold tabular-nums truncate ${toneCls}`} title={displayValue}>
        {displayValue}
      </p>
    </div>
  );
}
