import { useState, useEffect } from 'react';
import { Plus, Wifi, Trash2, Pencil, LayoutGrid, List as ListIcon, Loader2, Server, Search, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import Modal from '../components/common/Modal';
import ConfirmModal from '../components/common/ConfirmModal';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential'];
const ENV_OPTIONS = ['dev', 'staging', 'prod'];
const DEFAULT_FORM = {
  name: '', owner: '', environment: 'dev',
  model_name: 'claude-sonnet-4-6-20250415',
  sensitivity_label: 'internal', endpoint_url: '',
};

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function ServicesPage() {
  const { canEdit } = useAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState('grid');
  const [search, setSearch] = useState('');
  // formMode: null | 'create' | 'edit'. editingId is set only for 'edit'.
  const [formMode, setFormMode] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Confidential Ping confirmation — holds the service the user clicked
  // on until they either confirm the override or cancel. Null when closed.
  const [confidentialPingTarget, setConfidentialPingTarget] = useState(null);

  const [form, setForm] = useState(DEFAULT_FORM);

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

  const openCreateForm = () => {
    setForm(DEFAULT_FORM);
    setFormError(null);
    setEditingId(null);
    setFormMode('create');
  };

  const openEditForm = (service) => {
    setForm({
      name: service.name,
      owner: service.owner,
      environment: service.environment,
      model_name: service.model_name,
      sensitivity_label: service.sensitivity_label,
      endpoint_url: service.endpoint_url || '',
    });
    setFormError(null);
    setEditingId(service.id);
    setFormMode('edit');
  };

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setFormError(null);
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    try {
      if (formMode === 'edit' && editingId != null) {
        await api.put(`/services/${editingId}`, form);
      } else {
        await api.post('/services', form);
      }
      closeForm();
      fetchServices();
    } catch (err) {
      setFormError(err.response?.data?.detail || `Failed to ${formMode === 'edit' ? 'update' : 'create'} service`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeDeleteConfirm = () => {
    setDeleteConfirmId(null);
    setDeleteError(null);
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;
    setDeleteError(null);
    try {
      await api.delete(`/services/${deleteConfirmId}`);
      closeDeleteConfirm();
      fetchServices();
    } catch (err) {
      setDeleteError(err.response?.data?.detail || 'Failed to delete service');
    }
  };

  const runPing = async (id, qs = '') => {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await api.post(`/services/${id}/test-connection${qs}`);
      setTestResults((prev) => ({ ...prev, [id]: { ...res.data, status: res.data.status === 'success' ? 'healthy' : 'failed' } }));
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      setTestResults((prev) => ({ ...prev, [id]: { status: 'failed', latency_ms: 0, response_snippet: detail } }));
    }
  };

  const handleTestConnection = (id) => {
    const service = services.find((s) => s.id === id);
    if (service?.sensitivity_label === 'confidential') {
      // Defer to confirm modal; override query-string attached on approve.
      setConfidentialPingTarget(service);
      return;
    }
    runPing(id);
  };

  const confirmConfidentialPing = async () => {
    if (!confidentialPingTarget) return;
    const id = confidentialPingTarget.id;
    setConfidentialPingTarget(null);
    await runPing(id, '?mode=llm&allow_confidential=true');
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
              onClick={openCreateForm}
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
            <button onClick={openCreateForm} className="px-3.5 py-1.5 text-[12px] font-medium text-accent bg-accent-weak rounded-pill hover:bg-accent-muted transition-standard">
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
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-standard">
                        <button
                          onClick={() => openEditForm(s)}
                          className="p-1.5 text-text-subtle hover:text-accent hover:bg-surface-elevated rounded-pill transition-standard"
                          aria-label={`Edit ${s.name}`}
                        >
                          <Pencil size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => setDeleteConfirmId(s.id)}
                          className="p-1.5 text-text-subtle hover:text-status-failing hover:bg-status-failing-muted rounded-pill transition-standard"
                          aria-label={`Delete ${s.name}`}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </div>
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
                <div className="px-5 py-3 border-t border-hairline flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
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
                  {test && !test.loading && test.status === 'failed' && test.response_snippet && (
                    <p
                      className="text-[11px] font-mono text-status-failing break-words line-clamp-2"
                      title={test.response_snippet}
                    >
                      {test.response_snippet}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Register / Edit Service Modal */}
      <Modal
        isOpen={formMode !== null}
        onClose={closeForm}
        title={formMode === 'edit' ? 'Edit AI service' : 'Register AI service'}
        footer={
          <>
            <button onClick={closeForm} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting || !form.name || !form.owner || !form.model_name}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover disabled:opacity-50 transition-standard"
            >
              {isSubmitting ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : (formMode === 'edit' ? 'Save changes' : 'Register')}
            </button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={handleSubmit}>
          {formError && (
            <div role="alert" className="flex items-start gap-2 px-3 py-2 text-[12px] text-status-failing bg-status-failing-muted border border-status-failing/30 rounded-md">
              <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
              <span>{formError}</span>
            </div>
          )}
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
      <Modal isOpen={!!deleteConfirmId} onClose={closeDeleteConfirm} title="Delete service" maxWidth="max-w-sm" footer={
        <>
          <button onClick={closeDeleteConfirm} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">
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
        {deleteError && (
          <div role="alert" className="mt-3 flex items-start gap-2 px-3 py-2 text-[12px] text-status-failing bg-status-failing-muted border border-status-failing/30 rounded-md">
            <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}
      </Modal>

      {/* Confidential Ping override — admin-only path through the
          sensitivity gate. Backend rejects without this flag. */}
      <ConfirmModal
        isOpen={!!confidentialPingTarget}
        onClose={() => setConfidentialPingTarget(null)}
        onConfirm={confirmConfidentialPing}
        title="Confidential service — override required"
        variant="warning"
        confirmLabel="Proceed with override"
        description={
          confidentialPingTarget
            ? `"${confidentialPingTarget.name}" is labelled confidential. Running the LLM test-connection will send a prompt to an external model. Only admins can override, and every override is recorded in the audit log.`
            : ''
        }
      />
    </div>
  );
}
