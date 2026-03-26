import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, AlertTriangle, CheckSquare, Clock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

const SEVERITY_OPTIONS = ['critical', 'high', 'medium', 'low'];

export default function IncidentsPage() {
  const { canEdit } = useAuth();
  const [incidents, setIncidents] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    service_id: '',
    severity: 'medium',
    symptoms: '',
    checklist_data_issue: false,
    checklist_prompt_change: false,
    checklist_model_update: false,
    checklist_infrastructure: false,
    checklist_safety_policy: false,
  });

  const fetchData = async () => {
    try {
      const [incRes, srvRes] = await Promise.all([
        api.get('/incidents'),
        api.get('/services')
      ]);
      setIncidents(incRes.data);
      setServices(srvRes.data);
      if (srvRes.data.length > 0 && !form.service_id) {
        setForm(prev => ({ ...prev, service_id: srvRes.data[0].id }));
      }
    } catch (err) {
      console.error('Failed to fetch data', err);
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
      setForm({
        service_id: services.length > 0 ? services[0].id : '',
        severity: 'medium',
        symptoms: '',
        checklist_data_issue: false,
        checklist_prompt_change: false,
        checklist_model_update: false,
        checklist_infrastructure: false,
        checklist_safety_policy: false,
      });
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to report incident');
    }
  };

  const severityColor = {
    critical: 'bg-red-100 text-red-700 border-red-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    low: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  const statusColor = {
    open: 'bg-red-50 text-red-600',
    investigating: 'bg-yellow-50 text-yellow-600',
    resolved: 'bg-green-50 text-green-600',
    closed: 'bg-gray-50 text-gray-600',
  };

  if (loading) return <div className="text-gray-500">Loading incidents...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Incident Triage & Maintenance</h2>
          <p className="text-sm text-gray-500 mt-1">Report, investigate, and draft summaries for AI system incidents.</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
          >
            <Plus size={16} /> Report Incident
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-6 mb-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-500" /> Report New Incident
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Target Service</label>
                <select 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 uppercase-first"
                  value={form.service_id} 
                  onChange={(e) => setForm({ ...form, service_id: e.target.value })} 
                  required
                >
                  <option value="" disabled>Select a service...</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Severity</label>
                <select 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 capitalize"
                  value={form.severity} 
                  onChange={(e) => setForm({ ...form, severity: e.target.value })}
                >
                  {SEVERITY_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Symptoms Observation</label>
                <textarea 
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-gray-50 h-24"
                  placeholder="Describe the anomalous behaviour..."
                  value={form.symptoms} 
                  onChange={(e) => setForm({ ...form, symptoms: e.target.value })} 
                  required 
                />
              </div>
            </div>

            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
              <h4 className="text-xs font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <CheckSquare size={14} /> Troubleshooting Initial Checklist
              </h4>
              <p className="text-[11px] text-gray-500 mb-4">Check any items that apply or have been ruled out during initial triage.</p>
              
              <div className="space-y-3">
                {[
                  { key: 'checklist_data_issue', label: 'Data format issue (inputs/outputs)' },
                  { key: 'checklist_prompt_change', label: 'Recent system prompt change' },
                  { key: 'checklist_model_update', label: 'Underlying model routing update' },
                  { key: 'checklist_infrastructure', label: 'Infrastructure or latency spike' },
                  { key: 'checklist_safety_policy', label: 'Triggered safety/rate limits' },
                ].map(({key, label}) => (
                  <label key={key} className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                      checked={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-100">
            <button type="submit" className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">Save Incident</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-gray-700">Cancel</button>
          </div>
        </form>
      )}

      {/* List Incidents */}
      <div className="grid grid-cols-1 gap-4">
        {incidents.length === 0 && !loading && (
          <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">No incidents reported yet</div>
        )}
        {incidents.map(inc => (
          <Link to={`/incidents/${inc.id}`} key={inc.id} className="block bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-md text-xs font-semibold uppercase tracking-wide border ${severityColor[inc.severity]}`}>
                  {inc.severity}
                </span>
                <h3 className="text-base font-semibold text-gray-900">{inc.service_name}</h3>
              </div>
              <span className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${statusColor[inc.status]}`}>
                {inc.status}
              </span>
            </div>
            
            <p className="text-sm text-gray-600 mt-3 line-clamp-2">{inc.symptoms}</p>
            
            <div className="flex items-center gap-4 mt-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><Clock size={14} /> {new Date(inc.created_at).toLocaleString()}</span>
              {inc.summary && (
                <span className="text-green-600 font-medium flex items-center gap-1">✓ Summary Published</span>
              )}
               {inc.summary_draft && !inc.summary && (
                <span className="text-orange-500 font-medium flex items-center gap-1">✎ Draft Needs Review</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
