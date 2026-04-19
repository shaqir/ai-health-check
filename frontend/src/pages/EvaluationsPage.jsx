import { useState, useEffect } from 'react';
import { Plus, Play, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import PageHeader from '../components/common/PageHeader';
import Modal from '../components/common/Modal';
import Toast from '../components/common/Toast';
import ErrorState from '../components/common/ErrorState';
import LoadingSkeleton from '../components/common/LoadingSkeleton';
import DriftAnalysis from '../components/evaluations/DriftAnalysis';
import TestCasesSection from '../components/evaluations/TestCasesSection';
import EvalRunsSection from '../components/evaluations/EvalRunsSection';

const INPUT_CLS = 'w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] rounded-md text-text placeholder-text-subtle transition-standard';
const LABEL_CLS = 'block text-[11px] font-medium text-text-muted tracking-tight mb-1.5';

export default function EvaluationsPage() {
  const { canEdit } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [evalRuns, setEvalRuns] = useState([]);
  const [services, setServices] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [runningService, setRunningService] = useState(null);
  const [selectedDriftService, setSelectedDriftService] = useState(null);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const [form, setForm] = useState({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });

  const showToast = (message, type = 'info') => setToast({ visible: true, message, type });

  const fetchData = async () => {
    setError(null);
    try {
      const [tcRes, runsRes, srvRes] = await Promise.all([
        api.get('/evaluations/test-cases'),
        api.get('/evaluations/runs'),
        api.get('/services'),
      ]);
      setTestCases(tcRes.data);
      setEvalRuns(runsRes.data);
      setServices(srvRes.data);
      const svcWithCases = [...new Set(tcRes.data.map(tc => tc.service_id))];
      if (svcWithCases.length > 0 && !selectedDriftService) setSelectedDriftService(svcWithCases[0]);
    } catch { setError('Failed to load evaluation data.'); } finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const handleCreateTestCase = async (e) => {
    e.preventDefault();
    try {
      await api.post('/evaluations/test-cases', { ...form, service_id: parseInt(form.service_id) });
      setShowCreateModal(false);
      setForm({ service_id: '', prompt: '', expected_output: '', category: 'factuality' });
      showToast('Test case created', 'success');
      fetchData();
    } catch (err) { showToast(err.response?.data?.detail || 'Failed to create', 'error'); }
  };

  const handleRunEval = async (serviceId) => {
    try {
      const preview = await api.get(`/evaluations/cost-preview/${serviceId}`);
      const p = preview.data;
      if (!confirm(`Run evaluation?\n\n${p.test_cases} test cases, ${p.api_calls} API calls\nEst. cost: $${p.estimated_cost_usd.toFixed(4)} (budget: $${p.daily_budget_usd.toFixed(2)}/day)`)) return;
    } catch { showToast('Failed to get cost preview', 'error'); return; }

    setRunningService(serviceId);
    try {
      const res = await api.post(`/evaluations/run/${serviceId}`);
      const r = res.data;
      showToast(`Quality: ${r.quality_score}% ${r.drift_flagged ? '— drift detected' : ''}`, r.drift_flagged ? 'error' : 'success');
      fetchData();
      setSelectedDriftService(serviceId);
    } catch (err) { showToast(err.response?.data?.detail || 'Evaluation failed', 'error'); }
    finally { setRunningService(null); }
  };

  if (loading) return (
    <div className="space-y-5" aria-busy="true">
      <div className="h-5 w-40 bg-surface-elevated rounded-md animate-pulse" />
      <LoadingSkeleton type="table" />
    </div>
  );

  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); fetchData(); }} />;

  const serviceIds = [...new Set(testCases.map(tc => tc.service_id))];

  return (
    <div className="space-y-5">
      {toast.visible && <Toast message={toast.message} type={toast.type} onClose={() => setToast({ ...toast, visible: false })} />}

      <PageHeader title="Evaluations" description="Test cases, evaluation runs, and drift detection.">
        {canEdit && (
          <button onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 bg-accent text-white rounded-pill text-[12px] font-medium hover:bg-accent-hover transition-standard">
            <Plus size={14} strokeWidth={1.75} /> Add test case
          </button>
        )}
      </PageHeader>

      {/* Run buttons */}
      {canEdit && serviceIds.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {serviceIds.map(svcId => {
            const svc = services.find(s => s.id === svcId);
            const count = testCases.filter(tc => tc.service_id === svcId).length;
            return (
              <button
                key={svcId}
                onClick={() => handleRunEval(svcId)}
                disabled={runningService !== null}
                className="flex items-center gap-1.5 px-3.5 py-1.5 bg-status-healthy text-white rounded-pill text-[12px] font-medium hover:opacity-90 transition-standard disabled:opacity-50"
              >
                {runningService === svcId ? <Loader2 size={12} strokeWidth={1.5} className="animate-spin" /> : <Play size={12} strokeWidth={1.75} />}
                {svc?.name || `#${svcId}`} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Drift analysis */}
      {services.length > 0 && (
        <DriftAnalysis services={services} selectedId={selectedDriftService} onSelect={setSelectedDriftService} />
      )}

      <TestCasesSection testCases={testCases} services={services} />
      <EvalRunsSection evalRuns={evalRuns} />

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
    </div>
  );
}
