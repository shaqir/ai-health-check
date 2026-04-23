import { useState, useEffect, useMemo } from 'react';
import { Plus, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { extractErrorDetail } from '../utils/errors';
import PageHeader from '../components/common/PageHeader';
import Modal from '../components/common/Modal';
import ConfirmModal from '../components/common/ConfirmModal';
import Toast from '../components/common/Toast';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DriftAnalysis from '../components/evaluations/DriftAnalysis';
import DriftMethodology from '../components/evaluations/DriftMethodology';
import TestCasesSection from '../components/evaluations/TestCasesSection';
import EvalRunsSection from '../components/evaluations/EvalRunsSection';

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function EvaluationsPage() {
  const { canEdit } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [evalRuns, setEvalRuns] = useState([]);
  const [services, setServices] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  // Two-phase pending state: `previewingService` is set while
  // /cost-preview is in flight (before the confirm modal opens);
  // `runningService` takes over after confirm, while the eval itself
  // runs. Either being non-null disables all Run buttons so a user
  // can't double-click into overlapping flows.
  const [previewingService, setPreviewingService] = useState(null);
  const [runningService, setRunningService] = useState(null);
  const [selectedDriftService, setSelectedDriftService] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [activeEnv, setActiveEnv] = useState('all');
  // Falls back to 75 (config.py default) if /evaluations/config hasn't
  // responded yet. Once real data arrives the modal re-renders.
  const [driftThreshold, setDriftThreshold] = useState(75);
  // Bumped after a successful Run so DriftAnalysis re-fetches its
  // chart data even when the user ran the *already-selected* service
  // (setSelectedDriftService(sameId) is a no-op and wouldn't retrigger
  // the useEffect). Parent tracks it; child consumes it as a dep.
  const [driftRefetchToken, setDriftRefetchToken] = useState(0);
  // Surfaced from DriftAnalysis so DriftMethodology's "Trend direction"
  // card can cite the real N instead of a placeholder.
  const [trendScoreCount, setTrendScoreCount] = useState(null);

  const [form, setForm] = useState({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });
  // Eval-run confirmation. Holds the service + cost preview + confidential
  // flag between the "Run" click and the confirm action. Null when closed.
  const [runConfirm, setRunConfirm] = useState(null);

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  // Test-case counts per service — surfaced next to service names in
  // the DriftAnalysis tab bar so users still see "how many prompts
  // will this run exercise" after the Run button was relocated off
  // the top strip. Declared at component top so the hook order stays
  // stable across `if (loading) return` / `if (error) return` early
  // exits below (Rules of Hooks).
  const testCaseCountByService = useMemo(() => {
    const counts = {};
    for (const tc of testCases) counts[tc.service_id] = (counts[tc.service_id] || 0) + 1;
    return counts;
  }, [testCases]);

  const fetchData = async () => {
    setError(null);
    try {
      const envParam = activeEnv !== 'all' ? { environment: activeEnv } : {};
      // Core data must succeed or the page can't render. /evaluations/config
      // is a nice-to-have (used only by the ScoreDetails modal) so it's
      // fetched with allSettled — a missing endpoint on an older backend
      // must NOT blank out the whole page.
      const [tcRes, runsRes, srvRes] = await Promise.all([
        api.get('/evaluations/test-cases', { params: envParam }),
        api.get('/evaluations/runs', { params: envParam }),
        api.get('/services'),
      ]);
      setTestCases(tcRes.data);
      setEvalRuns(runsRes.data);
      setServices(srvRes.data);
      // Best-effort config fetch — failure silently falls back to 75.
      try {
        const cfgRes = await api.get('/evaluations/config');
        if (cfgRes?.data?.drift_threshold != null) {
          setDriftThreshold(cfgRes.data.drift_threshold);
        }
      } catch { /* leave driftThreshold at its current (or default) value */ }
      // Reselect drift service when the env filter drops the current pick
      // (e.g. switching from "all" to "dev" when the selected service is
      // prod-only). Without this, the Drift tab silently points at a
      // service with no data in the current env.
      const svcWithCases = [...new Set(tcRes.data.map(tc => tc.service_id))];
      setSelectedDriftService(prev => {
        if (svcWithCases.length === 0) return null;
        if (prev === null || !svcWithCases.includes(prev)) return svcWithCases[0];
        return prev;
      });
    } catch { setError('Failed to load evaluation data.'); } finally { setLoading(false); }
  };

  // Auto-refresh intentionally disabled on this page to avoid reloads
  // interrupting demos. Data refreshes on env change and after mutations.
  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [activeEnv]);

  const handleCreateTestCase = async (e) => {
    e.preventDefault();
    try {
      await api.post('/evaluations/test-cases', { ...form, service_id: parseInt(form.service_id) });
      setShowCreateModal(false);
      setForm({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });
      showToast('Test case created', 'success');
      fetchData();
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Failed to create test case');
      showToast(detail, 'error');
    }
  };

  const handleRunEval = async (serviceId) => {
    const service = services.find((s) => s.id === serviceId);
    if (!service) return;

    // Fetch cost preview up-front so the confirm modal can show it. If
    // this fails we bail before opening the modal. `previewingService`
    // locks the Run buttons during the fetch so a second click can't
    // race a second preview in.
    setPreviewingService(serviceId);
    let preview;
    try {
      const res = await api.get(`/evaluations/cost-preview/${serviceId}`);
      preview = res.data;
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Failed to get cost preview');
      showToast(detail, 'error');
      return;
    } finally {
      setPreviewingService(null);
    }

    setRunConfirm({ service, preview });
  };

  const confirmRunEval = async () => {
    if (!runConfirm) return;
    const { service, preview } = runConfirm;
    const isConfidential = service.sensitivity_label === 'confidential';
    const qs = isConfidential ? '?allow_confidential=true' : '';

    setRunConfirm(null);
    setRunningService(service.id);
    try {
      const res = await api.post(`/evaluations/run/${service.id}${qs}`);
      const r = res.data;
      showToast(
        `Quality: ${r.quality_score}% ${r.drift_flagged ? '— drift detected' : ''}`,
        r.drift_flagged ? 'error' : 'success',
      );
      // Point the drift panel at the just-evaluated service (no-op if
      // it was already selected — common case).
      setSelectedDriftService(service.id);
      // Bump the token so DriftAnalysis re-fetches its chart even
      // when the selectedId didn't actually change. Must fire before
      // fetchData() so the render for updated test-cases/runs already
      // carries the new token and the child fetches once.
      setDriftRefetchToken(t => t + 1);
      // Await the refresh so the Evaluation runs table visibly updates
      // in the same interaction — without the await, the finally block
      // clears runningService before the new row lands and the user
      // sees the old table + a dismissed spinner.
      await fetchData();
    } catch (err) {
      const detail = await extractErrorDetail(err, 'Evaluation failed');
      showToast(detail, 'error');
    } finally {
      setRunningService(null);
    }
  };

  if (loading) return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
      <LoadingSkeleton type="table" />
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); fetchData(); }} />;

  const serviceIds = [...new Set(testCases.map(tc => tc.service_id))];
  // DriftAnalysis only makes sense for services that have test cases
  // in the current env filter — otherwise the tab bar would list
  // services with nothing to chart and drift-check would 404 on them.
  // Preserve order from /services so the tab bar doesn't reshuffle
  // between env switches.
  const driftServices = services.filter(s => serviceIds.includes(s.id));
  const selectedIsPending =
    (previewingService !== null && previewingService === selectedDriftService) ||
    (runningService !== null && runningService === selectedDriftService);
  const anyPending = previewingService !== null || runningService !== null;

  return (
    <div className="space-y-5">
      {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}

      <PageHeader title="Evaluations" description="Grade AI services against a golden dataset; detect drift over time.">
        <div className="flex items-center gap-3">
          {/* Env tabs */}
          <div className="flex items-center bg-[var(--material-thick)] rounded-pill p-0.5" role="tablist" aria-label="Environment filter">
            {['all', 'dev', 'staging', 'production'].map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={activeEnv === tab}
                onClick={() => setActiveEnv(tab)}
                className={`px-3.5 py-1.5 text-[13px] font-medium rounded-pill capitalize transition-standard ${
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
            <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white rounded-pill text-[13px] font-medium hover:bg-accent-hover transition-standard">
              <Plus size={15} strokeWidth={1.75} /> Add test case
            </button>
          )}
        </div>
      </PageHeader>

      {/* Page intro — short, one-block explainer of what this page does
          and how the scoring works at a glance. Kept compact so it
          doesn't push the live data below the fold. */}
      <div className="rounded-xl border border-hairline bg-surface-elevated/40 px-4 py-3 flex items-start gap-3">
        <div className="w-7 h-7 rounded-md bg-accent-weak flex items-center justify-center shrink-0">
          <Info size={14} strokeWidth={1.75} className="text-accent" />
        </div>
        <ul className="flex-1 min-w-0 text-[12.5px] text-text-muted leading-snug space-y-1 list-disc pl-4 marker:text-text-subtle">
          <li>Each service is tested against its <span className="font-semibold text-text">golden dataset</span> — stored prompts with known-good answers.</li>
          <li>The <span className="font-semibold text-text">Actor</span> (Sonnet 4.6) answers; the <span className="font-semibold text-text">Judge</span> (Haiku 4.5) grades factuality + hallucination.</li>
          <li>Quality below the threshold or a declining trend flags <span className="font-semibold text-text">drift</span>.</li>
        </ul>
      </div>

      {/* Drift analysis — now owns the per-service Run action so the
          primary CTA lives next to the data it affects, not as a
          disconnected strip above the panel. */}
      {driftServices.length > 0 && (
        <DriftAnalysis
          services={driftServices}
          selectedId={selectedDriftService}
          onSelect={setSelectedDriftService}
          testCaseCountByService={testCaseCountByService}
          canEdit={canEdit}
          onRunService={handleRunEval}
          selectedIsPending={selectedIsPending}
          anyPending={anyPending}
          refetchToken={driftRefetchToken}
          onTrendScoreCountChange={setTrendScoreCount}
        />
      )}

      <TestCasesSection testCases={testCases} services={services} />
      <DriftMethodology threshold={driftThreshold} trendScoreCount={trendScoreCount} />
      <EvalRunsSection evalRuns={evalRuns} driftThreshold={driftThreshold} />

      {/* Create modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Add test case" footer={
        <>
          <button onClick={() => setShowCreateModal(false)} className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard">Cancel</button>
          <button onClick={handleCreateTestCase} disabled={!form.service_id || !form.prompt || !form.expected_output} className="px-4 py-1.5 bg-accent text-white text-[12px] font-medium rounded-pill hover:bg-accent-hover disabled:opacity-50 transition-standard">Create</button>
        </>
      }>
        <form className="space-y-3" onSubmit={handleCreateTestCase}>
          <div>
            <label className={LABEL_CLS}>Service</label>
            <select className={INPUT_CLS} value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })} required>
              <option value="">Select...</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Category</label>
            <select className={INPUT_CLS} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              <option value="factuality">Factuality</option>
              <option value="format_json">Format (JSON)</option>
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>Test Prompt</label>
            <textarea rows="3" className={`${INPUT_CLS} resize-none`} placeholder="Prompt to send..." value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} required />
          </div>
          <div>
            <label className={LABEL_CLS}>Expected Output</label>
            <textarea rows="3" className={`${INPUT_CLS} resize-none`} placeholder="Expected response..." value={form.expected_output} onChange={e => setForm({ ...form, expected_output: e.target.value })} required />
          </div>
        </form>
      </Modal>

      {/* Run-eval confirmation — shows cost preview + confidential warning
          in a single modal so the user isn't chained through two native
          prompts. */}
      <ConfirmModal
        isOpen={!!runConfirm}
        onClose={() => setRunConfirm(null)}
        onConfirm={confirmRunEval}
        title={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? 'Run evaluation — confidential service override'
            : 'Run evaluation — cost preview'
        }
        variant={runConfirm?.service?.sensitivity_label === 'confidential' ? 'warning' : 'default'}
        confirmLabel={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? 'Run with override'
            : 'Run evaluation'
        }
        description={
          runConfirm?.service?.sensitivity_label === 'confidential'
            ? `"${runConfirm.service.name}" is labelled confidential. The run will send prompts to an external LLM and the override will be recorded in the audit log.`
            : `Running ${runConfirm?.preview?.test_cases ?? 0} test cases against "${runConfirm?.service?.name ?? ''}".`
        }
        details={
          runConfirm?.preview && (
            <div className="rounded-lg bg-surface-elevated border border-hairline p-3 text-[12px] space-y-1">
              <div className="flex justify-between">
                <span className="text-text-muted">Test cases</span>
                <span className="font-mono tabular-nums text-text">{runConfirm.preview.test_cases}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">API calls</span>
                <span className="font-mono tabular-nums text-text">{runConfirm.preview.api_calls}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Estimated cost</span>
                <span className="font-mono tabular-nums text-text">
                  ${runConfirm.preview.estimated_cost_usd.toFixed(4)}
                  <span className="text-text-subtle"> (~{(runConfirm.preview.estimated_cost_usd * 100).toFixed(2)}¢)</span>
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-hairline mt-1">
                <span className="text-text-muted">Daily budget</span>
                <span className="font-mono tabular-nums text-text-subtle">${runConfirm.preview.daily_budget_usd.toFixed(2)}</span>
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
