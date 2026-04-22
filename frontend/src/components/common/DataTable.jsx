import { useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { InfoTip } from './Tooltip';

export default function DataTable({
  columns,
  data,
  searchPlaceholder = 'Search...',
  onRowClick,
  // `flat` drops the outer card shell so the table can nest inside a parent
  // card without the double-border look (used by the audit log).
  flat = false,
  // `maxHeight` constrains the body scroll area and enables a sticky header.
  maxHeight,
}) {
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

  const outerCls = flat
    ? ''
    : 'bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden';
  const scrollStyle = maxHeight ? { maxHeight } : undefined;
  // With a max height we enable both axes so long rows don't push content
  // off-card; without it, preserve the original horizontal-only behavior.
  const scrollCls = maxHeight ? 'overflow-auto' : 'overflow-x-auto';
  const thStickyCls = maxHeight ? 'sticky top-0 z-10 bg-surface' : '';

  return (
    <div className={outerCls}>
      {/* Search */}
      <div className="px-4 py-3 border-b border-hairline">
        <div className="relative">
          <Search size={14} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--material-thick)] rounded-pill text-text placeholder-text-subtle transition-standard"
          />
        </div>
      </div>

      {/* Table */}
      <div className={scrollCls} style={scrollStyle}>
        <table className="w-full text-sm" role="table">
          <thead>
            <tr className="border-b border-hairline">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left text-[12px] font-semibold text-text-muted tracking-tight cursor-pointer select-none hover:text-text transition-standard whitespace-nowrap ${thStickyCls}`}
                  onClick={() => handleSort(col.key)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSort(col.key)}
                  tabIndex={0}
                  role="columnheader"
                  aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.tooltip && <InfoTip content={col.tooltip} size={11} />}
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
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-text-subtle text-sm">
                  No results found
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={row.id || i}
                  className={`border-b border-hairline last:border-0 transition-standard ${onRowClick ? 'cursor-pointer hover:bg-accent-weak' : 'hover:bg-surface-elevated/60'}`}
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
      <div className="px-4 py-2.5 border-t border-hairline text-[12px] text-text-subtle tabular-nums">
        {sorted.length} of {data.length} {data.length === 1 ? 'record' : 'records'}
      </div>
    </div>
  );
}
