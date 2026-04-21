import { useState, useEffect, useMemo } from 'react';
import { FileJson, FileText, Download, Users, UserCog, History, Shield, ShieldCheck, ShieldAlert, Filter } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import Toast from '../components/common/Toast';

const INPUT_CLS = 'w-full px-3 py-1.5 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text transition-standard focus:border-accent focus:bg-surface';

// DB table names → reviewer-friendly labels. Audit log targets go through
// this so rows read "Service #4" instead of "ai_services#4".
const TABLE_LABEL = {
  ai_services: 'Service',
  incidents: 'Incident',
  maintenance_plans: 'Plan',
  eval_test_cases: 'Test Case',
  eval_runs: 'Eval Run',
  eval_results: 'Eval Result',
  connection_logs: 'Ping',
  alerts: 'Alert',
  users: 'User',
  ai_llm_drafts: 'AI Draft',
  exports: 'Export',
  audit_log: 'Audit row',
  telemetry: 'Telemetry',
  api_usage_log: 'API Call',
};

// Action category styling. Reviewers pattern-match by color: creates are
// accent-blue, deletes red, approvals green, exports purple, failed auth
// amber. Prevents every row from reading identical in the Action column.
const ACTION_TONE = {
  create:    'bg-accent-weak text-accent',
  update:    'bg-surface-elevated text-text-muted',
  delete:    'bg-status-failing-muted text-status-failing',
  approve:   'bg-status-healthy-muted text-status-healthy',
  export:    'bg-status-paused-muted text-status-paused',
  auth:      'bg-surface-elevated text-text-subtle',
  auth_fail: 'bg-status-degraded-muted text-status-degraded',
  test:      'bg-surface-elevated text-text-subtle',
  alert:     'bg-status-degraded-muted text-status-degraded',
  run:       'bg-accent-weak text-accent',
  other:     'bg-surface-elevated text-text-muted',
};

function categorize(rawAction) {
  if (!rawAction) return 'other';
  if (rawAction.startsWith('create_') || rawAction === 'register') return 'create';
  if (rawAction.startsWith('delete_')) return 'delete';
  if (rawAction.startsWith('approve_')) return 'approve';
  if (rawAction.startsWith('export_') || rawAction.includes('ai_report')) return 'export';
  if (rawAction.startsWith('login_')) {
    return (rawAction.includes('fail') || rawAction.includes('lockout')) ? 'auth_fail' : 'auth';
  }
  if (rawAction === 'test_connection') return 'test';
  if (rawAction.includes('alert') || rawAction.includes('override')) return 'alert';
  if (rawAction.startsWith('update_') || rawAction.startsWith('generate_')) return 'update';
  if (rawAction.startsWith('run_')) return 'run';
  return 'other';
}

function titleCase(raw) {
  return raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GovernancePage() {
  const { user, isAdmin } = useAuth();
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  // Live refresh indicator (matches Dashboard / Evaluations / Incidents).
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  // Guards against double-submit on the role-change select.
  const [changingRoleFor, setChangingRoleFor] = useState(null);
  // Audit log filters — action type, actor, time window (client-side).
  const [actionFilter, setActionFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('all');
  const [timeWindow, setTimeWindow] = useState('all'); // '24h' | '7d' | 'all'

  const [exportRange, setExportRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
  });
  const [integrity, setIntegrity] = useState(null); // { valid, total, broken_at, reason }

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const fetchData = async () => {
    setError(null);
    try {
      // Audit log is admin-only (server-side) — skip the fetch for non-admins
      if (isAdmin) {
        const res = await api.get('/compliance/audit-log');
        setAuditLogs(res.data.map(log => {
          const tbl = TABLE_LABEL[log.target_table] || log.target_table;
          return {
            id: log.id,
            // Keep the raw ISO string so the column renderer can do
            // tz-aware formatting with a hover tooltip (Dashboard pattern).
            timestamp: log.timestamp || '',
            user: log.user_email || 'system',
            // Keep raw for category pill + filter dropdown; keep title-cased
            // for display in the Action column and stats "Top action".
            rawAction: log.action,
            action: titleCase(log.action),
            // Reviewer-friendly label instead of raw table#id.
            target: log.target_id ? `${tbl} #${log.target_id}` : tbl,
            details: log.new_value || log.old_value || '',
          };
        }));

        const userRes = await api.get('/compliance/users');
        setUsers(userRes.data.map(u => ({
          id: u.id, email: u.email, role: u.role,
          createdAt: u.created_at || null,
        })));
      }
      setLastFetchAt(Date.now());
    } catch {
      setError('Failed to load governance data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;

  // ── Audit log derived state ──────────────────────────────────────────────
  // Options are derived from the current fetched rows so the dropdowns only
  // list actions/actors that actually appear — no dead entries.
  const actionOptions = useMemo(() => {
    const set = new Set(auditLogs.map(l => l.rawAction).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [auditLogs]);

  const actorOptions = useMemo(() => {
    const set = new Set(auditLogs.map(l => l.user).filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [auditLogs]);

  const filteredLogs = useMemo(() => {
    const now = Date.now();
    const windowMs = timeWindow === '24h' ? 86_400_000 : timeWindow === '7d' ? 604_800_000 : Infinity;
    return auditLogs.filter(l => {
      if (actionFilter !== 'all' && l.rawAction !== actionFilter) return false;
      if (actorFilter !== 'all' && l.user !== actorFilter) return false;
      if (windowMs !== Infinity && l.timestamp) {
        const ts = new Date(l.timestamp).getTime();
        if (Number.isNaN(ts) || (now - ts) > windowMs) return false;
      }
      return true;
    });
  }, [auditLogs, actionFilter, actorFilter, timeWindow]);

  // Live volume stats derived from the filtered view — updates as the user
  // narrows the filter, so the tiles reflect what they're actually looking at.
  const stats = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 86_400_000;
    let eventsToday = 0;
    const actorSet = new Set();
    const actionCount = {};
    for (const l of filteredLogs) {
      actorSet.add(l.user);
      if (l.rawAction) actionCount[l.rawAction] = (actionCount[l.rawAction] || 0) + 1;
      if (l.timestamp) {
        const ts = new Date(l.timestamp).getTime();
        if (!Number.isNaN(ts) && ts > dayAgo) eventsToday += 1;
      }
    }
    const topEntry = Object.entries(actionCount).sort(([, a], [, b]) => b - a)[0];
    return {
      total: filteredLogs.length,
      actors: actorSet.size,
      eventsToday,
      topAction: topEntry ? { name: topEntry[0], count: topEntry[1] } : null,
    };
  }, [filteredLogs]);

  const handleVerifyIntegrity = async () => {
    try {
      const res = await api.get('/compliance/audit-log/verify');
      setIntegrity(res.data);
      if (res.data.valid) {
        showToast(`Audit chain verified — ${res.data.total} entries intact`, 'success');
      } else {
        showToast(`Integrity FAILURE at id ${res.data.broken_at}: ${res.data.reason}`, 'error');
      }
    } catch (err) {
      showToast('Integrity check failed: ' + (err.response?.data?.detail || err.message), 'error');
    }
  };

  const handleExport = async (format) => {
    showToast(`Exporting ${format.toUpperCase()}...`, 'info');
    try {
      const res = await api.post('/compliance/export', {
        format, from_date: exportRange.from, to_date: exportRange.to,
      }, format === 'pdf' ? { responseType: 'blob' } : {});

      const blob = format === 'pdf'
        ? new Blob([res.data])
        : new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `compliance_report.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`${format.toUpperCase()} exported`, 'success');
    } catch (err) {
      showToast('Export failed: ' + (err.response?.data?.detail || err.message), 'error');
    }
  };

  const handleChangeRole = async (userId, newRole) => {
    if (changingRoleFor) return; // guard against double-click while a PUT is mid-flight
    if (!confirm(`Change this user's role to ${newRole}?`)) return;
    setChangingRoleFor(userId);
    try {
      await api.put(`/compliance/users/${userId}/role`, { role: newRole });
      showToast(`Role updated to ${newRole}`, 'success');
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to update role', 'error');
    } finally {
      setChangingRoleFor(null);
    }
  };

  const auditColumns = [
    {
      key: 'timestamp',
      label: 'Time',
      render: (v) => {
        if (!v) return <span className="font-mono text-xs text-text-subtle">—</span>;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) {
          return <span className="font-mono tabular-nums text-xs">{v}</span>;
        }
        const short = d.toLocaleString(undefined, {
          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        return (
          <span
            className="font-mono tabular-nums text-xs"
            title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
          >
            {short}
          </span>
        );
      },
    },
    { key: 'user', label: 'Actor', render: (v) => <span className="font-medium text-text">{v}</span> },
    {
      key: 'action',
      label: 'Action',
      render: (v, row) => {
        const cat = categorize(row.rawAction);
        const cls = ACTION_TONE[cat] || ACTION_TONE.other;
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-medium ${cls}`}>
            {v}
          </span>
        );
      },
    },
    { key: 'target', label: 'Target', render: (v) => <span className="text-xs text-text">{v}</span> },
    {
      key: 'details',
      label: 'Changes',
      render: (v) => (
        <span
          className="text-xs text-text-subtle font-mono truncate max-w-[260px] block"
          title={v || ''}
        >
          {v || '—'}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-5 w-48 bg-surface-elevated rounded-md animate-pulse" />
        <LoadingSkeleton type="table" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }

  return (
    <div className="space-y-5">
      {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}

      <PageHeader title="Governance" description="Audit logs, role-based access control, and compliance exports.">
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div
              className="flex items-center gap-1.5"
              aria-label={`Last refreshed ${updatedLabel}, auto-refreshing every 30 seconds`}
              title={`Refreshes every 30 seconds. Last: ${updatedLabel}.`}
            >
              <span
                key={lastFetchAt}
                className="dash-pulse w-1.5 h-1.5 rounded-full bg-status-healthy"
                aria-hidden="true"
              />
              <span className="text-[11px] font-medium text-text-subtle tracking-tight tabular-nums">
                Updated {updatedLabel}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-weak rounded-pill">
            <Shield size={12} strokeWidth={1.75} className="text-accent" />
            <span className="text-[11px] font-medium text-accent capitalize tracking-tight">{user?.role}</span>
          </div>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Audit Log — main content */}
        <div className="xl:col-span-2">
          <div className="bg-surface rounded-xl border border-hairline shadow-xs overflow-hidden">
            <div className="px-5 py-3.5 border-b border-hairline flex items-center gap-2">
              <History size={14} strokeWidth={1.75} className="text-text-subtle" />
              <h3 className="text-[13px] font-semibold text-text tracking-tight">Audit log</h3>
            </div>

            {auditLogs.length > 0 ? (
              <>
                {/* Volume stats — reacts to filter selections so tiles
                    reflect what's currently visible in the table below. */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-5 py-4 border-b border-hairline">
                  <StatTile label="Events" value={stats.total} />
                  <StatTile label="Actors" value={stats.actors} />
                  <StatTile label="Last 24h" value={stats.eventsToday} />
                  <StatTile
                    label="Top action"
                    value={stats.topAction ? titleCase(stats.topAction.name) : '—'}
                    sublabel={stats.topAction ? `${stats.topAction.count}×` : undefined}
                  />
                </div>

                {/* Filter toolbar — client-side, narrows the table + stats
                    without a round-trip. Time window is a pill group; action
                    + actor are dropdowns derived from the fetched rows. */}
                <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-b border-hairline bg-surface-elevated/40">
                  <div className="flex items-center gap-1.5 text-text-subtle" aria-hidden="true">
                    <Filter size={12} strokeWidth={1.75} />
                    <span className="text-[10px] uppercase font-semibold tracking-[0.09em]">Filter</span>
                  </div>
                  <select
                    value={actionFilter}
                    onChange={(e) => setActionFilter(e.target.value)}
                    aria-label="Filter by action"
                    className="text-[11px] py-1 px-2.5 rounded-pill bg-[var(--material-thick)] text-text transition-standard"
                  >
                    {actionOptions.map(a => (
                      <option key={a} value={a}>
                        {a === 'all' ? 'All actions' : titleCase(a)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={actorFilter}
                    onChange={(e) => setActorFilter(e.target.value)}
                    aria-label="Filter by actor"
                    className="text-[11px] py-1 px-2.5 rounded-pill bg-[var(--material-thick)] text-text transition-standard"
                  >
                    {actorOptions.map(a => (
                      <option key={a} value={a}>
                        {a === 'all' ? 'All actors' : a}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center ml-auto bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Time window">
                    {[
                      { id: '24h', label: '24h' },
                      { id: '7d', label: '7d' },
                      { id: 'all', label: 'All' },
                    ].map(w => (
                      <button
                        key={w.id}
                        role="tab"
                        aria-selected={timeWindow === w.id}
                        onClick={() => setTimeWindow(w.id)}
                        className={`px-2.5 py-0.5 text-[11px] font-medium rounded-pill capitalize transition-standard ${
                          timeWindow === w.id
                            ? 'bg-surface-elevated text-text shadow-xs'
                            : 'text-text-muted hover:text-text'
                        }`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>

                {filteredLogs.length > 0 ? (
                  <DataTable columns={auditColumns} data={filteredLogs} searchPlaceholder="Search audit events..." />
                ) : (
                  <div className="p-6">
                    <EmptyState
                      icon={History}
                      title="No matches"
                      description="No events match the current filters. Widen the time window or clear the action/actor filter."
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="p-6">
                <EmptyState icon={History} title="No audit events" description="Actions will appear here as users interact with the platform." />
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Audit log integrity — admin only */}
          {isAdmin && (
            <div className="bg-surface rounded-xl border border-hairline shadow-xs">
              <div className="px-5 py-3.5 border-b border-hairline flex items-center gap-2">
                <ShieldCheck size={14} strokeWidth={1.75} className="text-text-subtle" />
                <h3 className="text-[13px] font-semibold text-text tracking-tight">Audit log integrity</h3>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-[12px] text-text-subtle leading-relaxed">
                  Walk the hash chain to detect tampering. Every audit row is linked to
                  the previous via SHA-256; any modification or deletion breaks the chain.
                </p>
                <button
                  onClick={handleVerifyIntegrity}
                  className="w-full flex justify-center items-center gap-1.5 py-1.5 text-[12px] font-medium text-white bg-accent rounded-pill hover:bg-accent-hover transition-standard"
                >
                  <ShieldCheck size={12} strokeWidth={1.5} /> Verify integrity
                </button>
                {integrity && (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`flex items-start gap-2 p-2.5 rounded-md text-[11px] ${
                      integrity.valid
                        ? 'bg-status-healthy-muted text-status-healthy'
                        : 'bg-status-failing-muted text-status-failing'
                    }`}
                  >
                    {integrity.valid ? (
                      <ShieldCheck size={14} strokeWidth={1.75} />
                    ) : (
                      <ShieldAlert size={14} strokeWidth={1.75} />
                    )}
                    <div>
                      {integrity.valid ? (
                        <span>Chain intact — {integrity.total} entries verified.</span>
                      ) : (
                        <span>
                          BROKEN at id {integrity.broken_at}: {integrity.reason}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Export */}
          <div className="bg-surface rounded-xl border border-hairline shadow-xs">
            <div className="px-5 py-3.5 border-b border-hairline flex items-center gap-2">
              <Download size={14} strokeWidth={1.75} className="text-text-subtle" />
              <h3 className="text-[13px] font-semibold text-text tracking-tight">Compliance export</h3>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-[12px] text-text-subtle leading-relaxed">
                Export audit trail, incidents, and telemetry for compliance review.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-medium text-text-subtle tracking-tight mb-1">From</label>
                  <input type="date" className={INPUT_CLS} value={exportRange.from} onChange={e => setExportRange({ ...exportRange, from: e.target.value })} />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-text-subtle tracking-tight mb-1">To</label>
                  <input type="date" className={INPUT_CLS} value={exportRange.to} onChange={e => setExportRange({ ...exportRange, to: e.target.value })} />
                </div>
              </div>
              <div className="flex gap-2 pt-3 border-t border-hairline">
                <button onClick={() => handleExport('pdf')} className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-[12px] font-medium text-text-muted bg-surface-elevated rounded-pill hover:text-text transition-standard">
                  <FileText size={12} strokeWidth={1.5} /> PDF
                </button>
                <button onClick={() => handleExport('json')} className="flex-1 flex justify-center items-center gap-1.5 py-1.5 text-[12px] font-medium text-white bg-accent rounded-pill hover:bg-accent-hover transition-standard">
                  <FileJson size={12} strokeWidth={1.5} /> JSON
                </button>
              </div>
            </div>
          </div>

          {/* RBAC */}
          {isAdmin ? (
            <div className="bg-surface rounded-xl border border-hairline shadow-xs">
              <div className="px-5 py-3.5 border-b border-hairline flex items-center gap-2">
                <UserCog size={14} strokeWidth={1.75} className="text-text-subtle" />
                <h3 className="text-[13px] font-semibold text-text tracking-tight">User roles</h3>
              </div>
              <div>
                {users.map(u => {
                  const joined = u.createdAt ? new Date(u.createdAt) : null;
                  const joinedShort = joined && !Number.isNaN(joined.getTime())
                    ? joined.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
                    : '—';
                  const joinedTitle = joined && !Number.isNaN(joined.getTime())
                    ? `${joined.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
                    : undefined;
                  const busy = changingRoleFor === u.id;
                  return (
                    <div key={u.id} className="px-5 py-3 flex items-center justify-between border-b border-hairline last:border-0 hover:bg-accent-weak transition-standard">
                      <div>
                        <p className="text-sm font-medium text-text">{u.email}</p>
                        <p className="text-[10px] text-text-subtle font-mono" title={joinedTitle}>
                          Joined {joinedShort}
                        </p>
                      </div>
                      <select
                        className="px-3 py-1 text-[12px] bg-[var(--material-thick)] rounded-pill text-text transition-standard capitalize disabled:opacity-50 disabled:cursor-not-allowed"
                        value={u.role}
                        onChange={e => handleChangeRole(u.id, e.target.value)}
                        disabled={u.email === user?.email || busy || Boolean(changingRoleFor)}
                        aria-busy={busy}
                        aria-label={`Role for ${u.email}`}
                      >
                        <option value="admin">Admin</option>
                        <option value="maintainer">Maintainer</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Users}
              title="Restricted"
              description="Role management requires administrator privileges."
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sublabel }) {
  const displayValue = value === null || value === undefined ? '—' : String(value);
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-text-subtle mb-0.5">
        {label}
      </p>
      <div className="flex items-baseline gap-1.5 min-w-0">
        <p
          className="text-[15px] font-semibold text-text tabular-nums truncate"
          title={displayValue}
        >
          {displayValue}
        </p>
        {sublabel && (
          <span className="text-[10px] text-text-subtle font-mono tabular-nums shrink-0">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
