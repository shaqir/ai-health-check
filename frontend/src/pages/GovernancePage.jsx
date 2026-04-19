import { useState, useEffect } from 'react';
import { FileJson, FileText, Download, Users, UserCog, History, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import DataTable from '../components/common/DataTable';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import Toast from '../components/common/Toast';

const INPUT_CLS = 'w-full px-3 py-1.5 text-sm bg-[var(--material-thick)] rounded-md text-text transition-standard';

export default function GovernancePage() {
  const { user, isAdmin } = useAuth();
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [exportRange, setExportRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
  });

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  useEffect(() => {
    const fetchData = async () => {
      setError(null);
      try {
        const res = await api.get('/compliance/audit-log');
        setAuditLogs(res.data.map(log => ({
          id: log.id,
          timestamp: log.timestamp ? new Date(log.timestamp).toLocaleString() : '',
          user: log.user_email || 'system',
          action: log.action.toUpperCase(),
          target: `${log.target_table}#${log.target_id || ''}`,
          details: log.new_value || log.old_value || '',
        })));

        if (isAdmin) {
          const userRes = await api.get('/compliance/users');
          setUsers(userRes.data.map(u => ({
            id: u.id, email: u.email, role: u.role,
            lastActive: u.created_at ? new Date(u.created_at).toLocaleDateString() : '',
          })));
        }
      } catch {
        setError('Failed to load governance data.');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [isAdmin]);

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
    if (!confirm(`Change this user's role to ${newRole}?`)) return;
    try {
      await api.put(`/compliance/users/${userId}/role`, { role: newRole });
      showToast(`Role updated to ${newRole}`, 'success');
      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to update role', 'error');
    }
  };

  const auditColumns = [
    { key: 'timestamp', label: 'Time', render: (v) => <span className="font-mono tabular-nums text-xs">{v}</span> },
    { key: 'user', label: 'Actor', render: (v) => <span className="font-medium text-text">{v}</span> },
    { key: 'action', label: 'Action', render: (v) => <span className="px-1.5 py-0.5 bg-surface-elevated rounded-sm text-xs font-mono text-text-muted">{v}</span> },
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
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-accent-weak rounded-pill">
          <Shield size={12} strokeWidth={1.75} className="text-accent" />
          <span className="text-[11px] font-medium text-accent capitalize tracking-tight">{user?.role}</span>
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
                {users.map(u => (
                  <div key={u.id} className="px-5 py-3 flex items-center justify-between border-b border-hairline last:border-0 hover:bg-accent-weak transition-standard">
                    <div>
                      <p className="text-sm font-medium text-text">{u.email}</p>
                      <p className="text-[10px] text-text-subtle font-mono">Joined {u.lastActive}</p>
                    </div>
                    <select
                      className="px-3 py-1 text-[12px] bg-[var(--material-thick)] rounded-pill text-text transition-standard capitalize"
                      value={u.role}
                      onChange={e => handleChangeRole(u.id, e.target.value)}
                      disabled={u.email === user?.email}
                      aria-label={`Role for ${u.email}`}
                    >
                      <option value="admin">Admin</option>
                      <option value="maintainer">Maintainer</option>
                      <option value="viewer">Viewer</option>
                    </select>
                  </div>
                ))}
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
