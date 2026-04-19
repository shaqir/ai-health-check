import { useState, useEffect } from 'react';
import { Plus, Wifi, Trash2, LayoutGrid, List as ListIcon, Loader2, Server, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import Modal from '../components/common/Modal';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential'];
const ENV_OPTIONS = ['dev', 'staging', 'prod'];

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] rounded-md text-text placeholder-text-subtle transition-standard';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function ServicesPage() {
  const { canEdit } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '', owner: '', environment: 'dev',
    model_name: 'claude-sonnet-4-6-20250415',
    sensitivity_label: 'internal', endpoint_url: '',
  });

  const fetchServices = async () => {
    setError(null);
    try {
      const res = await api.get('/services');
      setServices(res.data);
    } catch (err) {
      setError('Failed to load services.');
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
      setForm({ name: '', owner: '', environment: 'dev', model_name: 'claude-sonnet-4-6-20250415', sensitivity_label: 'internal', endpoint_url: '' });
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
      setTestResults((prev) => ({ ...prev, [id]: { status: 'failed', latency_ms: 0, response_snippet: err.message } }));
    }
  };

  const filtered = services.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.owner.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-5 w-36 bg-surface-elevated rounded-md animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchServices(); }} />;
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <PageHeader title="Service Registry" description="Manage and monitor connected AI models and endpoints.">
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative w-52">
            <Search size={14} strokeWidth={1.5} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input
              type="text"
              placeholder="Search services..."
              aria-label="Search services"
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-[var(--material-thick)] rounded-pill text-text placeholder-text-subtle transition-standard"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* View toggle */}
          <div className="flex bg-[var(--material-thick)] rounded-pill p-0.5" role="group" aria-label="View mode">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-pill transition-standard ${viewMode === 'grid' ? 'bg-surface-elevated text-text shadow-xs' : 'text-text-subtle hover:text-text'}`}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid size={14} strokeWidth={1.5} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-pill transition-standard ${viewMode === 'list' ? 'bg-surface-elevated text-text shadow-xs' : 'text-text-subtle hover:text-text'}`}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <ListIcon size={14} strokeWidth={1.5} />
            </button>
          </div>

          {canEdit && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-white rounded-pill text-[12px] font-medium hover:bg-accent-hover transition-standard"
            >
              <Plus size={14} strokeWidth={1.75} /> Register
            </button>
          )}
        </div>
      </PageHeader>

      {/* Service cards */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No services found"
          description={search ? 'Try a different search term.' : 'Get started by registering a new AI service.'}
          action={canEdit && !search && (
            <button onClick={() => setShowAddModal(true)} className="px-3.5 py-1.5 text-[12px] font-medium text-accent bg-accent-weak rounded-pill hover:bg-accent-muted transition-standard">
              Register service
            </button>
          )}
        />
      ) : (
        <div className={`grid gap-3 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1'}`}>
          {filtered.map((s) => {
            const test = testResults[s.id];
            const statusLabel = !test ? 'Untested' : test.loading ? 'Testing...' : test.status === 'healthy' ? 'Connected' : 'Failed';
            const statusDot = !test ? 'bg-status-unknown' : test.loading ? 'bg-status-degraded' : test.status === 'healthy' ? 'bg-status-healthy' : 'bg-status-failing';

            return (
              <div key={s.id} className="bg-surface rounded-xl border border-hairline shadow-xs hover:shadow-sm transition-standard flex flex-col group">
                <div className="p-5 flex-1">
                  {/* Top row: name + delete */}
                  <div className="flex justify-between items-start mb-3">
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold text-text tracking-tight truncate" title={s.name}>{s.name}</h3>
                      <p className="text-[12px] text-text-muted mt-0.5">{s.owner}</p>
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => setDeleteConfirmId(s.id)}
                        className="p-1.5 text-text-subtle hover:text-status-failing hover:bg-status-failing-muted rounded-pill transition-standard opacity-0 group-hover:opacity-100"
                        aria-label={`Delete ${s.name}`}
                      >
                        <Trash2 size={14} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <StatusBadge status={s.environment} />
                    <StatusBadge status={s.sensitivity_label} />
                  </div>

                  {/* Model */}
                  <p className="text-[11px] font-mono text-text-muted bg-surface-elevated px-2 py-1 rounded-md truncate" title={s.model_name}>
                    {s.model_name}
                  </p>
                </div>

                {/* Footer: status + ping */}
                <div className="px-5 py-3 border-t border-hairline flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusDot}`} aria-hidden="true" />
                    <span className="text-[12px] font-medium text-text-muted">{statusLabel}</span>
                    {test && !test.loading && test.latency_ms > 0 && (
                      <span className="text-[11px] font-mono tabular-nums text-text-subtle">{test.latency_ms}ms</span>
                    )}
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => handleTestConnection(s.id)}
                      disabled={test?.loading}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-accent bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
                      aria-label={`Ping ${s.name}`}
                    >
                      {test?.loading ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <Wifi size={12} strokeWidth={1.5} />}
                      Ping
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Service Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Register AI service" footer={
        <>
          <button onClick={() => setShowAddModal(false)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isSubmitting || !form.name || !form.owner || !form.model_name}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover disabled:opacity-50 transition-standard"
          >
            {isSubmitting ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : 'Register'}
          </button>
        </>
      }>
        <form className="space-y-3" onSubmit={handleCreate}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Service Name *</label>
              <input className={INPUT_CLS} placeholder="Content Generator" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div>
              <label className={LABEL_CLS}>Owner Team *</label>
              <input className={INPUT_CLS} placeholder="Marketing" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>Environment</label>
              <select className={INPUT_CLS} value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                {ENV_OPTIONS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Sensitivity</label>
              <select className={INPUT_CLS} value={form.sensitivity_label} onChange={(e) => setForm({ ...form, sensitivity_label: e.target.value })}>
                {SENSITIVITY_OPTIONS.map(o => <option key={o} value={o}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL_CLS}>Model Identifier *</label>
            <input className={`${INPUT_CLS} font-mono`} placeholder="claude-sonnet-4-6-20250415" value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Endpoint URL</label>
            <input className={INPUT_CLS} placeholder="https://api.example.com/v1/..." value={form.endpoint_url} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })} />
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <Modal isOpen={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} title="Delete service" maxWidth="max-w-sm" footer={
        <>
          <button onClick={() => setDeleteConfirmId(null)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
            Cancel
          </button>
          <button onClick={handleDelete} className="px-4 py-1.5 bg-status-failing text-white text-[12px] font-medium rounded-pill hover:opacity-90 transition-standard">
            Delete
          </button>
        </>
      }>
        <p className="text-sm text-text-muted">
          This will permanently remove the service and its connection logs. This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
