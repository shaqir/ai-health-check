import { useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';

export default function DataTable({ columns, data, searchPlaceholder = 'Search...', onRowClick }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const filtered = data.filter(row =>
    Object.values(row).some(val =>
      String(val).toLowerCase().includes(search.toLowerCase())
    )
  );

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const aVal = a[sortKey] ?? '';
        const bVal = b[sortKey] ?? '';
        const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      })
    : filtered;

  return (
    <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
      {/* Search */}
      <div className="px-4 py-3 border-b border-border">
        <div className="relative">
          <Search size={14} strokeWidth={1.5} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full pl-9 pr-3 py-2 text-sm bg-surface-elevated border border-border rounded-md text-text placeholder-text-subtle focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="border-b border-border bg-surface-elevated">
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-4 py-2.5 text-left text-xs font-semibold text-text-muted uppercase tracking-wider cursor-pointer select-none hover:text-text transition-colors"
                  onClick={() => handleSort(col.key)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSort(col.key)}
                  tabIndex={0}
                  role="columnheader"
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      sortDir === 'asc'
                        ? <ChevronUp size={12} strokeWidth={1.5} />
                        : <ChevronDown size={12} strokeWidth={1.5} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-text-subtle text-sm">
                  No results found
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={row.id || i}
                  className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-surface-elevated' : 'hover:bg-surface-elevated/50'}`}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(e) => e.key === 'Enter' && onRowClick?.(row)}
                  tabIndex={onRowClick ? 0 : undefined}
                  role={onRowClick ? 'button' : undefined}
                >
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-3 text-text">
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border text-xs text-text-subtle tabular-nums">
        {sorted.length} of {data.length} {data.length === 1 ? 'record' : 'records'}
      </div>
    </div>
  );
}
