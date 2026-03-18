import { useState, useEffect } from 'react';
import { Plus, Search, AlertCircle, Bot, CheckSquare, Sparkles, RefreshCcw, Loader2, X, Check } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/common/StatusBadge';
import Modal from '../components/common/Modal';
import Toast from '../components/common/Toast';
import DataTable from '../components/common/DataTable';

export default function IncidentsPage() {
  const { canEdit } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showToast, setShowToast] = useState({ visible: false, message: '', type: 'info' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mock data for initial render
  useEffect(() => {
    setIncidents([
      { id: 1, service: 'Customer Support Bot', severity: 'critical', symptoms: 'Response latency spiked to 4s. Hallucination rate up 15%.', status: 'investigating', date: '2026-03-18' },
      { id: 2, service: 'Financial Forecast Model', severity: 'high', symptoms: 'Drift detected in output formatting.', status: 'mitigated', date: '2026-03-17' },
      { id: 3, service: 'Content Generator', severity: 'medium', symptoms: 'Occasional timeouts during peak load.', status: 'resolved', date: '2026-03-15' },
    ]);
  }, []);

  const triggerToast = (message, type = 'info') => {
    setShowToast({ visible: true, message, type });
  };

  // Form states
  const [createForm, setCreateForm] = useState({ service: '', severity: 'high', symptoms: '', date: '' });
  
  const handleCreateIncident = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Mock API call
      await api.post('/incidents', createForm);
      triggerToast('Incident created successfully', 'success');
      setShowCreateModal(false);
    } catch (err) {
      triggerToast(err.response?.data?.detail || 'Failed to create incident', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // AI Summary states
  const [isGenerating, setIsGenerating] = useState(false);
  const [draftSummary, setDraftSummary] = useState(null);
  
  const handleGenerateSummary = async (incidentId) => {
    setIsGenerating(true);
    try {
      // Mock API call
      // const res = await api.post(`/incidents/${incidentId}/generate-summary`);
      await new Promise(r => setTimeout(r, 1500)); // simulate loading
      setDraftSummary(`Based on the symptoms, this appears to be an infrastructure degradation issue causing elevated latency. The recent alert indicates potential model drift, but it is likely a downstream side-effect of the timeout errors. Recommended action: Rollback latest deployment or scale up inference pods.`);
    } catch (err) {
      triggerToast('Failed to generate summary', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleApproveSummary = async (incidentId) => {
    try {
      // await api.post(`/incidents/${incidentId}/approve-summary`, { summary: draftSummary });
      triggerToast('Incident summary approved and saved.', 'success');
      setDraftSummary(null);
    } catch (err) {
      triggerToast('Failed to approve summary', 'error');
    }
  };

  const columns = [
    { key: 'service', label: 'Service Affected', render: (val) => <span className="font-semibold text-slate-800">{val}</span> },
    { key: 'severity', label: 'Severity', render: (val) => <StatusBadge status={val} type="severity" /> },
    { key: 'status', label: 'Status', render: (val) => <StatusBadge status={val} /> },
    { key: 'date', label: 'Timeline' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-12">
      {/* Toast */}
      {showToast.visible && (
        <Toast 
          message={showToast.message} 
          type={showToast.type} 
          onClose={() => setShowToast({ ...showToast, visible: false })} 
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Incident Triage & Maintenance</h1>
          <p className="text-sm text-slate-500 mt-1">Investigate anomalies, generate post-mortems, and plan maintenance.</p>
        </div>
        
        {canEdit && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700 transition-colors shadow-sm shadow-rose-600/20"
          >
            <AlertCircle size={16} /> Declare Incident
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: List & Checklist */}
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-800 mb-4">Active & Recent Incidents</h3>
            <DataTable 
              columns={columns} 
              data={incidents} 
              searchPlaceholder="Search incidents..." 
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">Troubleshooting Workspace</h3>
                <p className="text-sm text-slate-500">Run diagnostics and generate AI summaries</p>
              </div>
              <Bot size={24} className="text-blue-500" />
            </div>
            
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wider">Diagnostic Checklist</h4>
                <div className="space-y-2">
                  {['Data drift or quality issue?', 'Recent prompt template change?', 'Upstream model update / deprecation?', 'Infrastructure or rate limit issue?', 'Safety filter / policy rejection?'].map((item, idx) => (
                    <label key={idx} className="flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-100">
                      <input type="checkbox" className="mt-1 w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                      <span className="text-sm text-slate-700">{item}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wider">AI Investigation</h4>
                {!draftSummary ? (
                  <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50 text-center">
                     <Sparkles size={32} className="text-slate-400 mb-3" />
                     <p className="text-sm text-slate-500 mb-4">Generate an automated incident summary based on current symptoms and telemetry.</p>
                     <button 
                       onClick={() => handleGenerateSummary(1)}
                       disabled={isGenerating}
                       className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors disabled:opacity-50"
                     >
                       {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                       {isGenerating ? 'Analyzing Telemetry...' : 'Generate AI Summary'}
                     </button>
                  </div>
                ) : (
                  <div className="border border-blue-200 bg-blue-50/50 rounded-xl p-4 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-2 opacity-10">
                      <Bot size={64} />
                    </div>
                    <div className="flex items-center gap-2 mb-2 relative z-10">
                      <Sparkles size={16} className="text-blue-600" />
                      <h4 className="text-sm font-semibold text-blue-900">AI Draft Generated</h4>
                    </div>
                    <p className="text-sm text-slate-700 italic border-l-2 border-blue-300 pl-3 py-1 my-3 relative z-10">
                      "{draftSummary}"
                    </p>
                    <div className="flex gap-2 mt-4 relative z-10">
                      <button onClick={() => handleApproveSummary(1)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 transition-colors">
                        <Check size={14} /> Approve & Log
                      </button>
                      <button onClick={() => setDraftSummary(null)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-md text-xs font-medium hover:bg-slate-50 transition-colors">
                        <X size={14} /> Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Maintenance Planner */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-semibold text-slate-800">Maintenance Planner</h3>
              <p className="text-sm text-slate-500">Schedule fixes and rollbacks</p>
            </div>
            
            <form className="p-5 space-y-4 flex-1">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Risk Level</label>
                <select className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none">
                  <option value="low">Low - Zero Downtime</option>
                  <option value="medium">Medium - Potential Degradation</option>
                  <option value="high">High - Hard Outage Expected</option>
                </select>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Scheduled Date & Time</label>
                <input type="datetime-local" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none" />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Rollback Plan</label>
                <textarea rows="3" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none" placeholder="Steps to revert changes..."></textarea>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Validation Steps</label>
                <textarea rows="2" className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none resize-none" placeholder="How to verify success..."></textarea>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input type="checkbox" className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                  <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">Require manual human-in-the-loop approval before starting</span>
                </label>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <button type="button" onClick={() => triggerToast('Maintenance scheduled.', 'success')} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors shadow-sm">
                  <CheckSquare size={16} /> Schedule Maintenance
                </button>
              </div>
            </form>
          </div>
        </div>

      </div>

      {/* Create Incident Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Declare New Incident"
        footer={
          <>
            <button onClick={() => setShowCreateModal(false)} className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
              Cancel
            </button>
            <button 
              onClick={handleCreateIncident} 
              disabled={isSubmitting || !createForm.service || !createForm.symptoms}
              className="px-4 py-2 bg-rose-600 text-white text-sm font-medium rounded-lg hover:bg-rose-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              Raise Alert
            </button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleCreateIncident}>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Affected Service *</label>
            <select 
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none" 
              value={createForm.service} 
              onChange={(e) => setCreateForm({...createForm, service: e.target.value})}
              required
            >
              <option value="">Select a service...</option>
              <option value="Customer Support Bot">Customer Support Bot</option>
              <option value="Financial Forecast Model">Financial Forecast Model</option>
              <option value="Content Generator">Content Generator</option>
            </select>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Severity *</label>
              <select 
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none" 
                value={createForm.severity} 
                onChange={(e) => setCreateForm({...createForm, severity: e.target.value})}
              >
                <option value="critical">Critical Outage</option>
                <option value="high">High - Severe Degradation</option>
                <option value="medium">Medium - Partial Failure</option>
                <option value="low">Low - Minor Issue</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Start Timeline</label>
              <input 
                type="datetime-local" 
                className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none" 
                value={createForm.date} 
                onChange={(e) => setCreateForm({...createForm, date: e.target.value})}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Symptoms & Impact *</label>
            <textarea 
              rows="4" 
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 outline-none resize-none" 
              placeholder="Describe the anomalous behavior, error logs, or user impact..." 
              value={createForm.symptoms} 
              onChange={(e) => setCreateForm({...createForm, symptoms: e.target.value})}
              required
            ></textarea>
          </div>
        </form>
      </Modal>
    </div>
  );
}
