import { useState, useEffect } from 'react';
import { FileJson, FileText, Download, Users, UserCog, History, Shield, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import Toast from '../components/common/Toast';

const INPUT_CLS = 'w-full px-3 py-1.5 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text transition-standard focus:border-accent focus:bg-surface';

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
        setAuditLogs(res.data.map(log => ({
          id: log.id,
          // Keep the raw ISO string so the column renderer can do
          // tz-aware formatting with a hover tooltip (Dashboard pattern).
          timestamp: log.timestamp || '',
          user: log.user_email || 'system',
          // Title-case snake_case action for display; keep the raw value
          // available in details if an examiner inspects the network tab.
          action: log.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
          target: `${log.target_table}#${log.target_id || ''}`,
          details: log.new_value || log.old_value || '',
        })));

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
    { key: 'action', label: 'Action', render: (v) => <span className="text-[12px] font-medium text-text">{v}</span> },
    { key: 'target', label: 'Target', render: (v) => <span className="font-mono text-xs">{v}</span> },
    { key: 'details', label: 'Changes', render: (v) => <span className="text-xs text-text-subtle font-mono truncate max-w-[200px] block">{v}</span> },
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
              <DataTable columns={auditColumns} data={auditLogs} searchPlaceholder="Search audit events..." />
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
