import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, CheckSquare, Clock, ShieldCheck, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import StatusBadge from '../components/common/StatusBadge';
import ErrorState from '../components/common/ErrorState';
import ReviewerNoteModal from '../components/common/ReviewerNoteModal';
import ConfirmModal from '../components/common/ConfirmModal';
import Toast from '../components/common/Toast';
import DateTimeField from '../components/common/DateTimeField';

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
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
  const { canEdit, isAdmin } = useAuth();

  const [incident, setIncident] = useState(null);
  const [maintenancePlans, setMaintenancePlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [submittingMaint, setSubmittingMaint] = useState(false);

  const [maintForm, setMaintForm] = useState({
    risk_level: 'medium', rollback_plan: '', validation_steps: '',
    scheduled_date: '',
  });
  // Reviewer-note modal state for incident summary approval. Open =
  // modal visible; busy = API call in flight.
  const [reviewerNoteOpen, setReviewerNoteOpen] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState(null);
  const [planToApprove, setPlanToApprove] = useState(null);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  // Live refresh indicator — matches Dashboard/Evaluations/Incidents pattern.
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  const [nowTick, setNowTick] = useState(Date.now());
  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const fetchData = async () => {
    setError(null);
    try {
      const [incRes, maintRes] = await Promise.all([
        api.get(`/incidents/${id}`),
        api.get(`/maintenance?incident_id=${id}`),
      ]);
      setIncident(incRes.data);
      setMaintenancePlans(maintRes.data);
      setLastFetchAt(Date.now());
    } catch (err) {
      if (err.response?.status === 404) { navigate('/incidents'); return; }
      setError('Failed to load incident details.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(() => fetchData(), 30000);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    const tid = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(tid);
  }, []);

  const secsSinceFetch = Math.max(0, Math.floor((nowTick - lastFetchAt) / 1000));
  const updatedLabel = secsSinceFetch < 1 ? 'just now' : `${secsSinceFetch}s ago`;

  const handleGenerateSummary = async () => {
    setGenerating(true);
    try {
      await api.post(`/incidents/${id}/generate-summary`);
      showToast('Draft generated', 'success');
      fetchData();
    } catch (err) {
      showToast(err.response?.data?.detail || 'Failed to generate summary', 'error');
    } finally {
      setGenerating(false);
    }
  };

  // Approval is a two-step flow:
  //   1. User clicks "Approve" — we open ReviewerNoteModal
  //   2. User types a note (≥20 non-whitespace chars enforced client-side
  //      AND server-side) and submits — we POST with the note
  const handleApproveSummary = () => {
    setApproveError(null);
    setReviewerNoteOpen(true);
  };

  const submitReviewerNote = async (note) => {
    setApproving(true);
    setApproveError(null);
    try {
      await api.post(`/incidents/${id}/approve-summary`, { reviewer_note: note });
      setReviewerNoteOpen(false);
      showToast('Summary approved', 'success');
      fetchData();
    } catch (err) {
      // Keep the modal open so the user can retry without losing context.
      // Inline banner in ReviewerNoteModal + Toast for redundancy.
      const detail = err.response?.data?.detail || err.message;
      const msg = typeof detail === 'string' ? detail : 'Approval failed — please try again.';
      setApproveError(msg);
      showToast('Failed to approve summary: ' + msg, 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleCreateMaintenance = async (e) => {
    e.preventDefault();
    if (submittingMaint) return;
    setSubmittingMaint(true);
    try {
      await api.post('/maintenance', { ...maintForm, incident_id: parseInt(id) });
      setShowMaintForm(false);
      setMaintForm({ risk_level: 'medium', rollback_plan: '', validation_steps: '', scheduled_date: '' });
      showToast('Maintenance plan created', 'success');
      fetchData();
    } catch (err) {
      showToast('Failed to create maintenance plan: ' + (err.response?.data?.detail || err.message), 'error');
    } finally {
      setSubmittingMaint(false);
    }
  };

  const confirmApprovePlan = async () => {
    if (!planToApprove) return;
    setApprovingPlan(true);
    try {
      await api.put(`/maintenance/${planToApprove.id}/approve`);
      setPlanToApprove(null);
      showToast('Maintenance plan approved', 'success');
      fetchData();
    } catch (err) {
      showToast('Failed to approve plan: ' + (err.response?.data?.detail || err.message), 'error');
    } finally {
      setApprovingPlan(false);
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
      <PageHeader
        title={`Incident INC-${incident.id}`}
        description={`Service: ${incident.service_name}`}
      >
        <div className="flex items-center gap-3">
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
          <Link
            to="/incidents"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-text-muted hover:text-text bg-surface-elevated rounded-pill transition-standard"
          >
            <ArrowLeft size={12} strokeWidth={1.5} /> Back
          </Link>
        </div>
      </PageHeader>

      {/* Secondary metadata strip — sits below the sticky bar, preserves
          the at-a-glance severity/status/reported-at info. */}
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-text-muted">
        <StatusBadge status={incident.severity} />
        <StatusBadge status={incident.status} />
        {(() => {
          const d = incident.created_at ? new Date(incident.created_at) : null;
          if (!d || Number.isNaN(d.getTime())) return null;
          const short = d.toLocaleString(undefined, {
            month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
          });
          return (
            <span
              className="flex items-center gap-1.5 font-mono tabular-nums text-text-subtle"
              title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
            >
              <Clock size={12} strokeWidth={1.5} />
              Reported {short}
            </span>
          );
        })()}
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
                  aria-busy={generating}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-[12px] font-medium bg-accent-weak text-accent rounded-pill hover:bg-accent-muted disabled:opacity-50 transition-standard"
                >
                  {generating ? (
                    <>
                      <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                      Drafting…
                    </>
                  ) : 'Generate draft'}
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
                          <button onClick={handleApproveSummary} className="px-3 py-1 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover transition-standard">
                            Approve &amp; publish
                          </button>
                          <button onClick={handleGenerateSummary} disabled={generating} aria-busy={generating} className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium text-text-muted bg-surface-elevated rounded-pill hover:text-text transition-standard disabled:opacity-50">
                            {generating ? (
                              <>
                                <Loader2 size={12} strokeWidth={1.75} className="animate-spin" />
                                Drafting…
                              </>
                            ) : 'Regenerate'}
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

                {/* HITL attribution — visible proof that the reviewer_note
                    requirement and four-eyes audit trail actually fired. */}
                {incident.summary && incident.approved_by_email && (
                  <div
                    role="status"
                    className="pt-3 border-t border-hairline flex items-start gap-2 bg-status-healthy-muted rounded-lg p-3"
                  >
                    <ShieldCheck size={14} strokeWidth={1.75} className="text-status-healthy shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] text-text">
                        <span className="font-medium">Approved by</span>{' '}
                        <span className="font-mono">{incident.approved_by_email}</span>
                        {incident.approved_at && (() => {
                          const d = new Date(incident.approved_at);
                          if (Number.isNaN(d.getTime())) return null;
                          const full = d.toLocaleString();
                          return (
                            <>
                              {' '}
                              <span className="text-text-muted">at</span>{' '}
                              <span
                                className="font-mono tabular-nums"
                                title={`${full} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
                              >
                                {full}
                              </span>
                            </>
                          );
                        })()}
                      </p>
                      {incident.reviewer_note && (
                        <p className="text-[12px] text-text-muted mt-1 italic leading-snug">
                          &ldquo;{incident.reviewer_note}&rdquo;
                        </p>
                      )}
                    </div>
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
              <form onSubmit={handleCreateMaintenance} className="mb-5 p-5 bg-surface-elevated rounded-xl border border-hairline space-y-3">
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
                <DateTimeField
                  label="Scheduled Date"
                  value={maintForm.scheduled_date}
                  onChange={(v) => setMaintForm({ ...maintForm, scheduled_date: v })}
                  placeholder="When should this change be applied?"
                  presets={['plus1h', 'tomorrow9am', 'nextWeek']}
                />
                <p className="text-[11px] text-text-subtle leading-snug">
                  Plans start unapproved. Submit creates the proposal — use the
                  Approve button on the timeline below once reviewed.
                </p>
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={submittingMaint}
                    aria-busy={submittingMaint}
                    className="px-3.5 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover transition-standard disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submittingMaint ? 'Submitting…' : 'Submit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMaintForm(false)}
                    disabled={submittingMaint}
                    className="px-3.5 py-1.5 text-[12px] font-medium text-text-muted bg-surface rounded-pill hover:text-text transition-standard disabled:opacity-50"
                  >
                    Cancel
                  </button>
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
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] font-medium ${plan.approved ? 'text-status-healthy' : 'text-text-subtle'}`}>
                            {plan.approved ? 'Approved' : 'Pending approval'}
                          </span>
                          {isAdmin && !plan.approved && (
                            <button
                              onClick={() => setPlanToApprove(plan)}
                              className="px-2.5 py-1 text-[11px] font-medium bg-accent-weak text-accent rounded-pill hover:bg-accent-muted transition-standard"
                            >
                              Approve
                            </button>
                          )}
                        </div>
                      </div>
                      {plan.scheduled_date && (() => {
                        const d = new Date(plan.scheduled_date);
                        if (Number.isNaN(d.getTime())) return null;
                        const short = d.toLocaleString(undefined, {
                          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
                        });
                        return (
                          <p
                            className="text-[12px] text-text-muted font-mono tabular-nums mb-3 flex items-center gap-1.5"
                            title={`${d.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
                          >
                            <Clock size={12} strokeWidth={1.5} />
                            Scheduled: {short}
                          </p>
                        );
                      })()}
                      <div className="space-y-2.5">
                        <div>
                          <h5 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Rollback strategy</h5>
                          <p className="text-[13px] text-text bg-surface-elevated border border-hairline p-2.5 rounded-lg">{plan.rollback_plan}</p>
                        </div>
                        <div>
                          <h5 className="text-[11px] font-medium text-text-subtle tracking-tight mb-1">Validation steps</h5>
                          <p className="text-[13px] text-text bg-surface-elevated border border-hairline p-2.5 rounded-lg">{plan.validation_steps}</p>
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

      {/* Mandatory reviewer-note modal for incident summary approval.
          Backend enforces ≥20 non-whitespace chars; this UI mirrors that
          contract with a live character count and inline validation. */}
      <ReviewerNoteModal
        isOpen={reviewerNoteOpen}
        onClose={() => {
          if (approving) return;
          setReviewerNoteOpen(false);
          setApproveError(null);
        }}
        onSubmit={submitReviewerNote}
        busy={approving}
        error={approveError}
      />

      <ConfirmModal
        isOpen={!!planToApprove}
        onClose={() => (approvingPlan ? null : setPlanToApprove(null))}
        onConfirm={confirmApprovePlan}
        title="Approve maintenance plan"
        description={`Approving a ${planToApprove?.risk_level ?? ''} risk plan for INC-${incident.id}. The approval is recorded in the audit log.`}
        confirmLabel={approvingPlan ? 'Approving…' : 'Approve plan'}
        busy={approvingPlan}
      />

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
