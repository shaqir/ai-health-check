import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Plus, AlertTriangle, CheckSquare, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { parseBackendDate } from '../utils/dates';
import { extractErrorDetail } from '../utils/errors';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import Toast from '../components/common/Toast';
import DateTimeField from '../components/common/DateTimeField';

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];
const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

const CHECKLIST_ITEMS = [
  { key: 'checklist_data_issue', label: 'Data format issue (inputs/outputs)' },
  { key: 'checklist_prompt_change', label: 'Recent system prompt change' },
  { key: 'checklist_model_update', label: 'Underlying model routing update' },
  { key: 'checklist_infrastructure', label: 'Infrastructure or latency spike' },
  { key: 'checklist_safety_policy', label: 'Triggered safety/rate limits' },
];

const INITIAL_FORM = {
  service_id: '', severity: 'medium', symptoms: '', timeline: '',
  checklist_data_issue: false, checklist_prompt_change: false,
  checklist_model_update: false, checklist_infrastructure: false,
  checklist_safety_policy: false,
};

export default function IncidentsPage() {
  const { canEdit } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [submitting, setSubmitting] = useState(false);
  const [activeEnv, setActiveEnv] = useState('all');
  // Live refresh indicator — honest "Updated Ns ago" + one-shot pulse on
  // actual refresh, mirroring Dashboard + Evaluations.
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const fetchData = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      const [incRes, srvRes] = await Promise.all([
        api.get('/incidents', { params: envParam }),
        api.get('/services'),
      ]);
      setIncidents(incRes.data);
      setServices(srvRes.data);
      if (srvRes.data.length > 0 && !form.service_id) {
        setForm(prev => ({ ...prev, service_id: srvRes.data[0].id }));
      }
      setLastFetchAt(Date.now());
    } catch (err) {
      setError('Failed to load incidents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [activeEnv]);

  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;

  // Prefill the form when navigated here from an alert's "Create incident"
  // button (router state carries {prefill: {service_name, severity, symptoms,
  // alert_type, checklist_*}}). Wait until services are loaded so we can
  // resolve service_name → service_id, then clear the state so a refresh
  // doesn't re-trigger the prefill.
  useEffect(() => {
    const prefill = location.state?.prefill;
    if (!prefill || services.length === 0) return;
    const matched = services.find(s => s.name === prefill.service_name);
    setForm(prev => ({
      ...prev,
      ...(matched && { service_id: matched.id }),
      ...(prefill.severity && { severity: prefill.severity }),
      ...(prefill.symptoms && { symptoms: prefill.symptoms }),
      ...(prefill.checklist_data_issue && { checklist_data_issue: true }),
      ...(prefill.checklist_prompt_change && { checklist_prompt_change: true }),
      ...(prefill.checklist_model_update && { checklist_model_update: true }),
      ...(prefill.checklist_infrastructure && { checklist_infrastructure: true }),
      ...(prefill.checklist_safety_policy && { checklist_safety_policy: true }),
    }));
    setShowForm(true);
    showToast(
      prefill.alert_type
        ? `Form pre-filled from ${prefill.alert_type} alert`
        : 'Form pre-filled from alert',
      'info',
    );
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, services, navigate]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      await api.post('/incidents', form);
      setShowForm(false);
      setForm({ ...INITIAL_FORM, service_id: services[0]?.id || '' });
      showToast('Incident reported', 'success');
      fetchData();
    } catch (err) {
      showToast(await extractErrorDetail(err, 'Failed to report incident'), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <div className="h-5 w-48 bg-surface-elevated rounded-md animate-pulse" />
        <LoadingSkeleton type="table" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchData(); }} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Incidents" description="Report, investigate, and draft summaries for AI system incidents.">
        <div className="flex items-center gap-3">
          {/* Live refresh indicator */}
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

          {/* Env tabs */}
          <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Environment filter">
            {['all', 'dev', 'staging', 'production'].map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeEnv === tab}
                onClick={() => setActiveEnv(tab)}
                className={`px-3 py-1 text-[12px] font-medium rounded-pill capitalize transition-standard ${
                  activeEnv === tab
                    ? 'bg-surface-elevated text-text shadow-xs'
                    : 'text-text-muted hover:text-text'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {canEdit && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-white rounded-pill text-[12px] font-medium hover:bg-accent-hover transition-standard"
            >
              <Plus size={14} strokeWidth={1.75} /> Report
            </button>
          )}
        </div>
      </PageHeader>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-surface rounded-xl border border-hairline p-6 shadow-xs">
          <h3 className="text-[13px] font-semibold text-text tracking-tight mb-4 flex items-center gap-2">
            <AlertTriangle size={14} strokeWidth={1.75} className="text-status-failing" />
            Report new incident
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
            {/* Left column: fields */}
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS}>Target Service</label>
                <select className={INPUT_CLS} value={form.service_id} onChange={(e) => setForm({ ...form, service_id: e.target.value })} required>
                  <option value="" disabled>Select a service...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Severity</label>
                <select className={`${INPUT_CLS} capitalize`} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
                  {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>Symptoms</label>
                <textarea className={`${INPUT_CLS} h-20 resize-none`} placeholder="Describe the anomalous behaviour..." value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} required />
              </div>
              <DateTimeField
                label="When did this occur?"
                value={form.timeline}
                onChange={(v) => setForm({ ...form, timeline: v })}
                placeholder="Select an approximate time"
              />
            </div>

            {/* Right column: checklist */}
            <div className="bg-surface-elevated p-4 rounded-xl border border-hairline">
              <h4 className="text-[13px] font-semibold text-text tracking-tight mb-1 flex items-center gap-2">
                <CheckSquare size={12} strokeWidth={1.75} /> Triage checklist
              </h4>
              <p className="text-[11px] text-text-subtle mb-3">Check items that apply or have been ruled out.</p>
              <div className="space-y-2.5">
                {CHECKLIST_ITEMS.map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2.5 text-sm text-text cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5 rounded-xs accent-accent"
                      checked={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t border-hairline">
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="px-3.5 py-1.5 bg-accent text-white rounded-pill text-[12px] font-medium hover:bg-accent-hover transition-standard disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Saving…' : 'Save incident'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              disabled={submitting}
              className="px-3.5 py-1.5 text-[12px] font-medium text-text-muted hover:text-text bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Incident list */}
      {incidents.length === 0 ? (
        <EmptyState
          icon={AlertTriangle}
          title="No incidents reported"
          description="No AI system incidents have been logged yet."
        />
      ) : (
        <div className="space-y-2">
          {incidents.map(inc => (
            <Link
              to={`/incidents/${inc.id}`}
              key={inc.id}
              className="block bg-surface rounded-xl border border-hairline p-5 shadow-xs hover:shadow-sm transition-standard"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={inc.severity} />
                  <h3 className="text-sm font-medium text-text">{inc.service_name}</h3>
                </div>
                <StatusBadge status={inc.status} />
              </div>

              <p className="text-sm text-text-muted line-clamp-1">{inc.symptoms}</p>

              <div className="flex items-center gap-4 mt-3 text-xs text-text-subtle">
                {(() => {
                  const d = parseBackendDate(inc.created_at);
                  if (!d) {
                    return <span className="flex items-center gap-1 font-mono"><Clock size={12} strokeWidth={1.5} />—</span>;
                  }
                  const short = d.toLocaleString(undefined, {
                    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                  });
                  return (
                    <span
                      className="flex items-center gap-1 font-mono tabular-nums"
                      title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
                    >
                      <Clock size={12} strokeWidth={1.5} />
                      {short}
                    </span>
                  );
                })()}
                {inc.summary && (
                  <span className="text-status-healthy font-medium">Summary published</span>
                )}
                {inc.summary_draft && !inc.summary && (
                  <span className="text-status-degraded font-medium">Draft needs review</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {toast.visible && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast({ ...toast, visible: false })}
        />
      )}
    </div>
  );
}
