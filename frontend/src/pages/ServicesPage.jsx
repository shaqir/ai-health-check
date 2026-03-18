import { useState, useEffect } from 'react';
import { Plus, Wifi, Trash2, LayoutGrid, List as ListIcon, Loader2, Server, Search, CheckCircle2, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import StatusBadge from '../components/common/StatusBadge';
import Modal from '../components/common/Modal';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential'];
const ENV_OPTIONS = ['dev', 'staging', 'prod'];

export default function ServicesPage() {
  const { canEdit } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  
  const [testResults, setTestResults] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [form, setForm] = useState({
    name: '', owner: '', environment: 'dev',
    model_name: 'claude-sonnet-4-20250514',
    sensitivity_label: 'internal', endpoint_url: '',
  });

  const fetchServices = async () => {
    try {
      const res = await api.get('/services');
      setServices(res.data);
    } catch (err) {
      console.error('Failed to load services:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServices(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await api.post('/services', form);
      setShowAddModal(false);
      setForm({ name: '', owner: '', environment: 'dev', model_name: 'claude-sonnet-4-20250514', sensitivity_label: 'internal', endpoint_url: '' });
      fetchServices();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create service');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    try {
      await api.delete(`/services/${deleteConfirmId}`);
      setDeleteConfirmId(null);
      fetchServices();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const handleTestConnection = async (id) => {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await api.post(`/services/${id}/test-connection`);
      setTestResults((prev) => ({ ...prev, [id]: { ...res.data, status: res.data.status === 'success' ? 'healthy' : 'failed' } }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'failed', latency_ms: 0, response_snippet: err.message },
      }));
    }
  };

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.owner.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Service Registry</h1>
          <p className="text-sm text-slate-500 mt-1">Manage and monitor connected AI models and endpoints.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Search services..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex bg-white rounded-lg border border-slate-200 p-1 shadow-sm">
            <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
              <LayoutGrid size={16} />
            </button>
            <button onClick={() => setViewMode('list')} className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
              <ListIcon size={16} />
            </button>
          </div>

          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm shadow-blue-600/20"
            >
              <Plus size={16} /> Register Service
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className={`grid gap-4 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl shadow-sm">
          <Server className="mx-auto h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-900">No services found</h3>
          <p className="text-sm text-slate-500 mt-1">Get started by registering a new AI service.</p>
          {canEdit && (
            <button onClick={() => setShowAddModal(true)} className="mt-4 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">
              Register Service
            </button>
          )}
        </div>
      ) : (
        <div className={`grid gap-4 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
          {filteredServices.map((s) => (
            <div key={s.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow group flex flex-col">
              <div className="p-5 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
                      <Server size={20} className="text-blue-500" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900 truncate pr-2" title={s.name}>{s.name}</h3>
                      <p className="text-xs text-slate-500">Owned by {s.owner}</p>
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => setDeleteConfirmId(s.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete service"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                
                <div className="flex flex-wrap gap-2 mb-4">
                  <StatusBadge status={s.environment} type="environment" />
                  <StatusBadge status={s.sensitivity_label} type="sensitivity" />
                </div>
                
                <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 font-mono border border-slate-100 truncate" title={s.model_name}>
                  {s.model_name}
                </div>
              </div>

              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    {testResults[s.id]?.status === 'healthy' && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                    <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${!testResults[s.id] ? 'bg-slate-300' : testResults[s.id]?.status === 'healthy' ? 'bg-emerald-500' : testResults[s.id]?.status === 'failed' ? 'bg-rose-500' : 'bg-slate-300'}`}></span>
                  </span>
                  <span className="text-xs font-medium text-slate-600">
                    {!testResults[s.id] ? 'Untested' : testResults[s.id].loading ? 'Testing...' : testResults[s.id].status === 'healthy' ? 'Connected' : 'Failed'}
                  </span>
                </div>
                
                {canEdit && (
                  <button
                    onClick={() => handleTestConnection(s.id)}
                    disabled={testResults[s.id]?.loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition-colors disabled:opacity-50"
                  >
                    {testResults[s.id]?.loading ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
                    <span className={viewMode === 'grid' ? "hidden sm:inline" : ""}>
                       Ping
                    </span>
                    {testResults[s.id] && !testResults[s.id].loading && (
                       <span className={`ml-1 px-1.5 py-0.5 rounded ${testResults[s.id].status === 'healthy' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                         {testResults[s.id].latency_ms ? `${testResults[s.id].latency_ms}ms` : 'Error'}
                       </span>
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Service Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Register AI Service"
        footer={
          <>
            <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button 
              onClick={handleCreate} 
              disabled={isSubmitting || !form.name || !form.owner || !form.model_name}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : 'Register Service'}
            </button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleCreate}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Service Name *</label>
              <input className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" placeholder="e.g. Content Generator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Owner Team *</label>
              <input className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" placeholder="e.g. Marketing" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
            </div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Environment</label>
              <select className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Data Sensitivity</label>
              <select className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" value={form.sensitivity_label} onChange={(e) => setForm({ ...form, sensitivity_label: e.target.value })}>
                {SENSITIVITY_OPTIONS.map((o) => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Model Identifier *</label>
            <input className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none font-mono" placeholder="e.g. claude-3-opus-20240229" value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} required />
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Endpoint URL (Optional)</label>
            <input className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" placeholder="https://api.example.com/v1/..." value={form.endpoint_url} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })} />
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Confirm Deletion"
        maxWidth="max-w-sm"
        footer={
          <>
            <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button 
              onClick={handleDelete}
              className="px-4 py-2 bg-rose-600 text-white text-sm font-medium rounded-lg hover:bg-rose-700 transition-colors shadow-sm"
            >
              Delete Service
            </button>
          </>
        }
      >
        <div className="text-sm text-slate-600">
          Are you sure you want to permanently delete this AI service from the registry? This action cannot be undone.
        </div>
      </Modal>

    </div>
  );
}
