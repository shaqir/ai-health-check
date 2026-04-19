import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, CheckSquare, Clock, ShieldCheck, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../utils/api';
import StatusBadge from '../components/common/StatusBadge';
import EmptyState from '../components/common/EmptyState';
import ErrorState from '../components/common/ErrorState';

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] rounded-md text-text placeholder-text-subtle transition-standard';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

const CHECKLIST_LABELS = {
  checklist_data_issue: 'Data Formatting Issue',
  checklist_prompt_change: 'Recent Prompt Change',
  checklist_model_update: 'Model Routing Update',
  checklist_infrastructure: 'Infrastructure / Latency',
  checklist_safety_policy: 'Safety Policy Trigger',
};

export default function IncidentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { canEdit } = useAuth();

  const [incident, setIncident] = useState(null);
  const [maintenancePlans, setMaintenancePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);

  const [maintForm, setMaintForm] = useState({
    risk_level: 'medium', rollback_plan: '', validation_steps: '',
    scheduled_date: '', human_approved: false,
  });

  const fetchData = async () => {
    setError(null);
    try {
      const [incRes, maintRes] = await Promise.all([
        api.get('/incidents'),
        api.get('/maintenance'),
      ]);
      const found = incRes.data.find(i => i.id === parseInt(id));
      if (!found) { navigate('/incidents'); return; }
      setIncident(found);
      setMaintenancePlans(maintRes.data.filter(p => p.incident_id === parseInt(id)));
    } catch (err) {
      setError('Failed to load incident details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [id]);

  const handleGenerateSummary = async () => {
    setGenerating(true);
    try {
      await api.post(`/incidents/${id}/generate-summary`);
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to generate summary');
    } finally {
      setGenerating(false);
    }
  };

  const handleApproveSummary = async () => {
    // Force the reviewer to articulate what they read. The backend also
    // enforces min length — this dialog is UX, not security.
    const note = window.prompt(
      'Reviewer note (required, min 20 chars):\n\n' +
      'Briefly confirm what you verified — e.g. "Read full draft; root causes match symptoms timeline; no hallucinated claims."'
    );
    if (note === null) return;
    if (note.trim().length < 20) {
      alert('Reviewer note must be at least 20 non-whitespace characters.');
      return;
    }
    try {
      await api.post(`/incidents/${id}/approve-summary`, { reviewer_note: note });
      fetchData();
    } catch (err) {
      alert('Failed to approve summary: ' + (err.response?.data?.detail || err.message));
    }
  };

  const handleCreateMaintenance = async (e) => {
    e.preventDefault();
    try {
      await api.post('/maintenance', { ...maintForm, incident_id: parseInt(id) });
      setShowMaintForm(false);
      setMaintForm({ risk_level: 'medium', rollback_plan: '', validation_steps: '', scheduled_date: '', human_approved: false });
      fetchData();
    } catch (err) {
      alert('Failed to create maintenance plan');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" aria-busy="true">
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-text-subtle" />
      </div>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={() => { setLoading(true); fetchData(); }} />;
  }

  if (!incident) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Breadcrumb + header */}
      <div>
        <Link to="/incidents" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text transition-standard mb-3">
          <ArrowLeft size={12} strokeWidth={1.5} /> Back to Incidents
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-display-sm font-semibold text-text font-mono tracking-tight">INC-{incident.id}</h1>
            <StatusBadge status={incident.severity} />
            <StatusBadge status={incident.status} />
          </div>
          <div className="text-right">
            <p className="text-[11px] text-text-subtle">Reported</p>
            <p className="text-[12px] font-mono tabular-nums text-text-muted">{new Date(incident.created_at).toLocaleString()}</p>
          </div>
        </div>
        <p className="text-[13px] text-text-muted mt-1.5">Service: <span className="font-medium text-text">{incident.service_name}</span></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Left: Details */}
        <div className="md:col-span-1 space-y-4">
          {/* Symptoms */}
          <div className="bg-surface rounded-xl border border-hairline shadow-xs p-5">
            <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3 flex items-center gap-2">
              <AlertTriangle size={12} strokeWidth={1.5} /> Symptoms
            </h3>
            <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">{incident.symptoms}</p>
          </div>

          {/* Checklist */}
          <div className="bg-surface rounded-xl border border-hairline shadow-xs p-5">
            <h3 className="text-[13px] font-semibold text-text tracking-tight mb-3 flex items-center gap-2">
              <CheckSquare size={12} strokeWidth={1.5} /> Triage Checklist
            </h3>
            <ul className="space-y-2">
              {Object.entries(CHECKLIST_LABELS).map(([key, label]) => {
                const checked = incident[key];
                return (
                  <li key={key} className="flex items-center justify-between text-sm">
                    <span className="text-text-muted">{label}</span>
                    <span className={`text-xs font-medium ${checked ? 'text-status-failing' : 'text-text-subtle'}`}>
                      {checked ? 'Yes' : 'No'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Right: Summary + Maintenance */}
        <div className="md:col-span-2 space-y-4">
          {/* LLM Summary */}
          <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-hairline">
              <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-2">
                <ShieldCheck size={12} strokeWidth={1.5} /> Stakeholder Summary
              </h3>
              {!incident.summary && !incident.summary_draft && canEdit && (
                <button
                  onClick={handleGenerateSummary}
                  disabled={generating}
                  className="px-3.5 py-1.5 text-[12px] font-medium bg-accent-weak text-accent rounded-pill hover:bg-accent-muted disabled:opacity-50 transition-standard"
                >
                  {generating ? 'Drafting...' : 'Generate draft'}
                </button>
              )}
            </div>

            {!incident.summary && !incident.summary_draft ? (
              <p className="text-sm text-text-subtle text-center py-6">
                No summary generated yet. Use the AI assistant to draft a stakeholder report.
              </p>
            ) : (
              <div className="space-y-4">
                {/* Approval banner */}
                {incident.summary_draft && !incident.summary && (
                  <div className="flex items-start gap-3 px-4 py-3.5 bg-status-degraded-muted rounded-xl" role="alert">
                    <ShieldCheck size={16} strokeWidth={1.75} className="text-status-degraded shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-text mb-0.5">Draft needs human approval</p>
                      <p className="text-[12px] text-text-muted mb-2.5">Review the AI-generated update below. Once approved, it will be published to the official record.</p>
                      {canEdit && (
                        <div className="flex gap-2">
                          <button onClick={handleApproveSummary} className="px-3 py-1 bg-status-degraded text-white text-[12px] font-medium rounded-pill hover:opacity-90 transition-standard">
                            Approve &amp; publish
                          </button>
                          <button onClick={handleGenerateSummary} disabled={generating} className="px-3 py-1 text-[12px] font-medium text-text-muted bg-surface-elevated rounded-pill hover:text-text transition-standard disabled:opacity-50">
                            Regenerate
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5">Stakeholder update</h4>
                  <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">
                    {incident.summary || incident.summary_draft}
                  </p>
                </div>

                {incident.root_causes && (
                  <div className="pt-3 border-t border-hairline">
                    <h4 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1.5">Root causes</h4>
                    <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">
                      {incident.root_causes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Maintenance Plans */}
          <div className="bg-surface rounded-xl border border-hairline shadow-xs p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-hairline">
              <h3 className="text-[13px] font-semibold text-text tracking-tight flex items-center gap-2">
                <FileText size={12} strokeWidth={1.5} /> Maintenance Plans
              </h3>
              {!showMaintForm && canEdit && (
                <button
                  onClick={() => setShowMaintForm(true)}
                  className="px-3.5 py-1.5 text-[12px] font-medium bg-accent-weak text-accent rounded-pill hover:bg-accent-muted transition-standard"
                >
                  Add plan
                </button>
              )}
            </div>

            {/* Create form */}
            {showMaintForm && (
              <form onSubmit={handleCreateMaintenance} className="mb-5 p-5 bg-surface-elevated rounded-xl space-y-3">
                <div>
                  <label className={LABEL_CLS}>Risk Level</label>
                  <select className={INPUT_CLS} value={maintForm.risk_level} onChange={e => setMaintForm({ ...maintForm, risk_level: e.target.value })}>
                    {['critical', 'high', 'medium', 'low'].map(r => <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS}>Rollback Plan</label>
                  <textarea required className={`${INPUT_CLS} resize-none`} rows="2" value={maintForm.rollback_plan} onChange={e => setMaintForm({ ...maintForm, rollback_plan: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Validation Steps</label>
                  <textarea required className={`${INPUT_CLS} resize-none`} rows="2" value={maintForm.validation_steps} onChange={e => setMaintForm({ ...maintForm, validation_steps: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>Scheduled Date</label>
                  <input type="datetime-local" className={INPUT_CLS} value={maintForm.scheduled_date} onChange={e => setMaintForm({ ...maintForm, scheduled_date: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
                  <input type="checkbox" className="w-3.5 h-3.5 rounded-xs accent-accent" checked={maintForm.human_approved} onChange={e => setMaintForm({ ...maintForm, human_approved: e.target.checked })} />
                  I have reviewed and approve this plan
                </label>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover transition-standard">Submit</button>
                  <button type="button" onClick={() => setShowMaintForm(false)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted bg-surface rounded-pill hover:text-text transition-standard">Cancel</button>
                </div>
              </form>
            )}

            {/* Plan list — timeline with hairline spine */}
            {maintenancePlans.length === 0 && !showMaintForm ? (
              <p className="text-sm text-text-subtle text-center py-6">No maintenance plans proposed.</p>
            ) : (
              <div className="relative pl-6">
                <span aria-hidden="true" className="absolute left-[7px] top-2 bottom-2 w-px bg-hairline" />
                <div className="space-y-5">
                  {maintenancePlans.map(plan => (
                    <div key={plan.id} className="relative">
                      <span
                        aria-hidden="true"
                        className={`absolute -left-[21px] top-1.5 w-3 h-3 rounded-full ring-4 ring-surface ${plan.approved ? 'bg-status-healthy' : 'bg-status-degraded'}`}
                      />
                      <div className="flex items-center justify-between mb-2.5">
                        <StatusBadge status={plan.risk_level} />
                        <span className={`text-[11px] font-medium ${plan.approved ? 'text-status-healthy' : 'text-text-subtle'}`}>
                          {plan.approved ? 'Approved' : 'Pending approval'}
                        </span>
                      </div>
                      {plan.scheduled_date && (
                        <p className="text-[12px] text-text-muted font-mono tabular-nums mb-3 flex items-center gap-1.5">
                          <Clock size={12} strokeWidth={1.5} />
                          Scheduled: {new Date(plan.scheduled_date).toLocaleString()}
                        </p>
                      )}
                      <div className="space-y-2.5">
                        <div>
                          <h5 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Rollback strategy</h5>
                          <p className="text-[13px] text-text bg-surface-elevated p-2.5 rounded-lg">{plan.rollback_plan}</p>
                        </div>
                        <div>
                          <h5 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Validation steps</h5>
                          <p className="text-[13px] text-text bg-surface-elevated p-2.5 rounded-lg">{plan.validation_steps}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
