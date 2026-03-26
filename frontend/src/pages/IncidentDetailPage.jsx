import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Sparkles, CheckSquare, Clock, ShieldCheck, FileText, AlertTriangle } from 'lucide-react';
import api from '../utils/api';

export default function IncidentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, canEdit } = useAuth();
  
  const [incident, setIncident] = useState(null);
  const [maintenancePlans, setMaintenancePlans] = useState([]);
  
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showMaintForm, setShowMaintForm] = useState(false);
  
  const [maintForm, setMaintForm] = useState({
    risk_level: 'medium',
    rollback_plan: '',
    validation_steps: '',
  });

  const fetchData = async () => {
    try {
      const [incRes, maintRes] = await Promise.all([
        api.get(`/incidents`),
        api.get(`/maintenance`)
      ]);
      const found = incRes.data.find(i => i.id === parseInt(id));
      if (!found) {
        alert("Incident not found");
        navigate('/incidents');
        return;
      }
      setIncident(found);
      setMaintenancePlans(maintRes.data.filter(p => p.incident_id === parseInt(id)));
    } catch (err) {
      console.error(err);
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
      alert(err.response?.data?.detail || "Failed to generate summary");
    } finally {
      setGenerating(false);
    }
  };

  const handleApproveSummary = async () => {
    try {
      await api.post(`/incidents/${id}/approve-summary`);
      fetchData();
    } catch (err) {
      alert("Failed to approve summary");
    }
  };

  const handleCreateMaintenance = async (e) => {
    e.preventDefault();
    try {
      await api.post('/maintenance', {
        ...maintForm,
        incident_id: parseInt(id)
      });
      setShowMaintForm(false);
      setMaintForm({ risk_level: 'medium', rollback_plan: '', validation_steps: '' });
      fetchData();
    } catch (err) {
      alert("Failed to create maintenance plan");
    }
  };

  if (loading || !incident) return <div className="p-8 text-center text-gray-500">Loading incident...</div>;

  const severityColor = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <div className="mb-6">
        <Link to="/incidents" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 mb-4 transition-colors">
          <ArrowLeft size={16} /> Back to Incidents
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-gray-900">INC-{incident.id}</h1>
              <span className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide border ${severityColor[incident.severity]}`}>
                {incident.severity}
              </span>
              <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium uppercase tracking-wide">
                {incident.status}
              </span>
            </div>
            <p className="text-gray-600 font-medium">Affected Service: {incident.service_name}</p>
          </div>
          <div className="text-right text-xs text-gray-500">
            Reported <span className="font-medium text-gray-900">{new Date(incident.created_at).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Left Col: Details & Troubleshooting */}
        <div className="md:col-span-1 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-500" /> Symptoms
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{incident.symptoms}</p>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3 border-b border-gray-100 pb-2 flex items-center gap-2">
              <CheckSquare size={16} className="text-blue-500" /> Triage Checklist
            </h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li className="flex items-center justify-between">
                <span>Data Formatting Issue</span>
                {incident.checklist_data_issue ? <span className="text-red-500 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
              </li>
              <li className="flex items-center justify-between">
                <span>Recent Prompt Change</span>
                {incident.checklist_prompt_change ? <span className="text-red-500 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
              </li>
              <li className="flex items-center justify-between">
                <span>Model Routing Update</span>
                {incident.checklist_model_update ? <span className="text-red-500 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
              </li>
              <li className="flex items-center justify-between">
                <span>Infrastructure / Latency</span>
                {incident.checklist_infrastructure ? <span className="text-red-500 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
              </li>
              <li className="flex items-center justify-between">
                <span>Safety Policy Trigger</span>
                {incident.checklist_safety_policy ? <span className="text-red-500 font-bold">Yes</span> : <span className="text-gray-400">No</span>}
              </li>
            </ul>
          </div>
        </div>

        {/* Right Col: LLM Summary & Maintenance */}
        <div className="md:col-span-2 space-y-6">
          
          {/* LLM Summary Card */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles size={18} className="text-indigo-500" /> Stakeholder Summary & Root Causes
              </h3>
              
              {!incident.summary && !incident.summary_draft && canEdit && (
                <button
                  onClick={handleGenerateSummary}
                  disabled={generating}
                  className="px-4 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-sm font-medium hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  {generating ? 'Drafting...' : 'Auto-Generate Draft'}
                </button>
              )}
            </div>

            {(!incident.summary && !incident.summary_draft) ? (
              <div className="text-center py-8 text-gray-400 text-sm">
                No summary generated yet. Use the AI assistant to draft a stakeholder report.
              </div>
            ) : (
              <div className="space-y-5">
                {incident.summary_draft && !incident.summary && (
                  <div className="bg-orange-50 border border-orange-200 text-orange-800 p-4 rounded-lg flex items-start gap-4">
                    <ShieldCheck size={24} className="text-orange-600 mt-1 flex-shrink-0" />
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-1">Draft Needs Human Approval</h4>
                      <p className="text-xs opacity-90 mb-3">Please review the AI-generated update below. Once approved, it will be published to the official record.</p>
                      {canEdit && (
                        <div className="flex gap-2">
                          <button onClick={handleApproveSummary} className="px-3 py-1.5 bg-orange-600 text-white text-xs font-medium rounded hover:bg-orange-700 transition-colors">Approve & Publish</button>
                          <button onClick={handleGenerateSummary} disabled={generating} className="px-3 py-1.5 border border-orange-300 text-orange-800 text-xs font-medium rounded hover:bg-orange-100 transition-colors">Regenerate</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div>
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Stakeholder Update</h4>
                  <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                    {incident.summary || incident.summary_draft}
                  </p>
                </div>

                {incident.root_causes && (
                  <div className="pt-4 border-t border-gray-100">
                    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Algorithm-Identified Root Causes</h4>
                    <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                      {incident.root_causes}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Maintenance Section */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-3">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <FileText size={18} className="text-blue-500" /> Maintenance Plans
              </h3>
              {!showMaintForm && canEdit && (
                <button
                  onClick={() => setShowMaintForm(true)}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors"
                >
                  Add Plan
                </button>
              )}
            </div>

            {showMaintForm && (
              <form onSubmit={handleCreateMaintenance} className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Risk Level</label>
                  <select 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                    value={maintForm.risk_level} 
                    onChange={e => setMaintForm({...maintForm, risk_level: e.target.value})}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rollback Plan</label>
                  <textarea 
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" rows="2"
                    value={maintForm.rollback_plan} onChange={e => setMaintForm({...maintForm, rollback_plan: e.target.value})}
                  />
                </div>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Validation Steps</label>
                  <textarea 
                    required className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white" rows="2"
                    value={maintForm.validation_steps} onChange={e => setMaintForm({...maintForm, validation_steps: e.target.value})}
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700">Submit Plan</button>
                  <button type="button" onClick={() => setShowMaintForm(false)} className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded text-sm font-medium hover:bg-gray-100">Cancel</button>
                </div>
              </form>
            )}

            <div className="space-y-4">
              {maintenancePlans.length === 0 && !showMaintForm && (
                <div className="text-center py-6 text-gray-400 text-sm">No maintenance plans proposed.</div>
              )}
              {maintenancePlans.map(plan => (
                <div key={plan.id} className="p-4 border border-gray-200 rounded-lg bg-white">
                  <div className="flex justify-between items-start mb-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${severityColor[plan.risk_level]} uppercase tracking-wider`}>
                      {plan.risk_level} RISK
                    </span>
                    {plan.approved ? (
                      <span className="text-green-600 text-xs font-bold flex items-center gap-1">✓ APPROVED</span>
                    ) : (
                      <span className="text-gray-500 text-xs font-bold flex items-center gap-1">PENDING APPROVAL</span>
                    )}
                  </div>
                  <div className="mb-2">
                    <h5 className="text-xs font-semibold text-gray-700 mb-1">Rollback Strategy</h5>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{plan.rollback_plan}</p>
                  </div>
                  <div>
                    <h5 className="text-xs font-semibold text-gray-700 mb-1">Validation Steps</h5>
                    <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded">{plan.validation_steps}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
