import { useState, useEffect } from 'react';
import { Shield, FileJson, FileText, Download, Users, UserCog, Activity, History } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import DataTable from '../components/common/DataTable';
import Toast from '../components/common/Toast';

export default function GovernancePage() {
  const { user, isAdmin } = useAuth();
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showToast, setShowToast] = useState({ visible: false, message: '', type: 'info' });

  // Date range state
  const [exportRange, setExportRange] = useState({
    from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0]
  });

  const triggerToast = (message, type = 'info') => {
    setShowToast({ visible: true, message, type });
  };

  useEffect(() => {
    const fetchGovernanceData = async () => {
      try {
        // const res = await api.get('/audit-log');
        // setAuditLogs(res.data);
        
        // Mock data
        setAuditLogs([
          { id: 1, timestamp: '2026-03-18 15:42', user: 'admin@aiops.local', action: 'UPDATE_SERVICE', target: 'Customer Support Bot', details: '{"sensitivity": "internal"}' },
          { id: 2, timestamp: '2026-03-18 10:15', user: 'system', action: 'EVAL_RUN', target: 'Financial Forecast Model', details: '{"status": "degraded", "score": 78}' },
          { id: 3, timestamp: '2026-03-17 09:30', user: 'maintainer@aiops.local', action: 'APPROVE_INCIDENT', target: 'INC-142', details: '{"resolution": "Rollback completed"}' },
        ]);

        if (isAdmin) {
          // const userRes = await api.get('/users');
          setUsers([
            { id: 1, email: 'admin@aiops.local', role: 'admin', lastActive: 'Just now' },
            { id: 2, email: 'maintainer@aiops.local', role: 'maintainer', lastActive: '2h ago' },
            { id: 3, email: 'viewer@aiops.local', role: 'viewer', lastActive: '1d ago' },
          ]);
        }
      } catch (err) {
        console.error('Failed to load governance data', err);
      } finally {
        setLoading(false);
      }
    };

    fetchGovernanceData();
  }, [isAdmin]);

  const handleExport = (format) => {
    triggerToast(`Exporting compliance report as ${format.toUpperCase()}...`, 'info');
    setTimeout(() => {
      triggerToast(`${format.toUpperCase()} report generated successfully.`, 'success');
    }, 1500);
  };

  const handleChangeRole = (userId, newRole) => {
    // mock api call
    triggerToast(`User role updated to ${newRole}`, 'success');
    setUsers(users.map(u => u.id === userId ? { ...u, role: newRole } : u));
  };

  const auditColumns = [
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'user', label: 'Actor', render: (val) => <span className="font-medium text-slate-700">{val}</span> },
    { key: 'action', label: 'Action', render: (val) => <span className="px-2 py-1 bg-slate-100 rounded text-xs font-mono text-slate-600">{val}</span> },
    { key: 'target', label: 'Target Resource' },
    { key: 'details', label: 'Changes', render: (val) => <span className="text-xs text-slate-500 font-mono truncate max-w-xs block">{val}</span> },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {showToast.visible && (
        <Toast message={showToast.message} type={showToast.type} onClose={() => setShowToast({ ...showToast, visible: false })} />
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Governance & Compliance</h1>
          <p className="text-sm text-slate-500 mt-1">Audit logs, role-based access control, and compliance exports.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg">
          <Shield size={16} className="text-blue-600" />
          <span className="text-sm font-semibold text-blue-900 capitalize">Role: {user?.role}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Main Content: Audit Log */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History size={18} className="text-slate-500" />
                <h3 className="text-lg font-semibold text-slate-800">System Audit Log</h3>
              </div>
            </div>
            <div className="p-1">
              <DataTable 
                columns={auditColumns} 
                data={auditLogs} 
                searchPlaceholder="Search audit events by user, action, or target..." 
              />
            </div>
          </div>
        </div>

        {/* Sidebar Controls */}
        <div className="space-y-6">
          
          {/* Export Section */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
              <Download size={18} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-800">Compliance Export</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-xs text-slate-500 leading-relaxed">
                Generate an immutable ledger export of all AI telemetry, incidents, and administrative changes for compliance auditors.
              </p>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From</label>
                  <input 
                    type="date" 
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-sm outline-none focus:border-blue-500"
                    value={exportRange.from}
                    onChange={(e) => setExportRange({...exportRange, from: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To</label>
                  <input 
                    type="date" 
                    className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-md text-sm outline-none focus:border-blue-500"
                    value={exportRange.to}
                    onChange={(e) => setExportRange({...exportRange, to: e.target.value})}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button onClick={() => handleExport('pdf')} className="flex-1 flex justify-center items-center gap-2 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors">
                  <FileText size={16} /> PDF
                </button>
                <button onClick={() => handleExport('json')} className="flex-1 flex justify-center items-center gap-2 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm">
                  <FileJson size={16} /> JSON
                </button>
              </div>
            </div>
          </div>

          {/* RBAC Administration */}
          {isAdmin && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                <UserCog size={18} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-800">RBAC Administration</h3>
              </div>
              <div className="p-0">
                <div className="divide-y divide-slate-100">
                   {users.map(u => (
                     <div key={u.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                       <div>
                         <p className="text-sm font-medium text-slate-800">{u.email}</p>
                         <p className="text-[10px] text-slate-400">Last active: {u.lastActive}</p>
                       </div>
                       <select 
                         className="px-2 py-1 text-xs border border-slate-300 rounded bg-white shadow-sm outline-none focus:border-blue-500 capitalize"
                         value={u.role}
                         onChange={(e) => handleChangeRole(u.id, e.target.value)}
                         disabled={u.email === user?.email}
                       >
                         <option value="admin">Admin</option>
                         <option value="maintainer">Maintainer</option>
                         <option value="viewer">Viewer</option>
                       </select>
                     </div>
                   ))}
                </div>
              </div>
            </div>
          )}
          
          {!isAdmin && (
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 text-center">
              <Users size={24} className="text-slate-400 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-slate-700">Restricted Access</h4>
              <p className="text-xs text-slate-500 mt-1">Role-based access management requires administrator privileges.</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
