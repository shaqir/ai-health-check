import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, AlertTriangle, CheckSquare, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];
const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] rounded-md text-text placeholder-text-subtle transition-standard';
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
  const [incidents, setIncidents] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);

  const fetchData = async () => {
    setError(null);
    try {
      const [incRes, srvRes] = await Promise.all([
        api.get('/incidents'),
        api.get('/services'),
      ]);
      setIncidents(incRes.data);
      setServices(srvRes.data);
      if (srvRes.data.length > 0 && !form.service_id) {
        setForm(prev => ({ ...prev, service_id: srvRes.data[0].id }));
      }
    } catch (err) {
      setError('Failed to load incidents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/incidents', form);
      setShowForm(false);
      setForm({ ...INITIAL_FORM, service_id: services[0]?.id || '' });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to report incident');
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
        {canEdit && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-status-failing text-white rounded-pill text-[12px] font-medium hover:opacity-90 transition-standard"
          >
            <Plus size={14} strokeWidth={1.75} /> Report
          </button>
        )}
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
              <div>
                <label className={LABEL_CLS}>Timeline</label>
                <input type="datetime-local" className={INPUT_CLS} value={form.timeline} onChange={(e) => setForm({ ...form, timeline: e.target.value })} />
              </div>
            </div>

            {/* Right column: checklist */}
            <div className="bg-surface-elevated p-4 rounded-xl">
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
            <button type="submit" className="px-4 py-1.5 bg-status-failing text-white rounded-pill text-[12px] font-medium hover:opacity-90 transition-standard">
              Save incident
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text bg-surface-elevated rounded-pill transition-standard">
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
                <span className="flex items-center gap-1 font-mono tabular-nums">
                  <Clock size={12} strokeWidth={1.5} />
                  {new Date(inc.created_at).toLocaleString()}
                </span>
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
    </div>
  );
}
