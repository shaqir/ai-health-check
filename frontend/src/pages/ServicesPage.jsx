import { useState, useEffect } from 'react';
import { Plus, Wifi, Trash2, Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

const SENSITIVITY_OPTIONS = ['public', 'internal', 'confidential'];
const ENV_OPTIONS = ['dev', 'prod'];

export default function ServicesPage() {
  const { canEdit } = useAuth();
  const [services, setServices] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testResults, setTestResults] = useState({});
  const [form, setForm] = useState({
    name: '', owner: '', environment: 'dev',
    model_name: 'claude-sonnet-4-20250514',
    sensitivity_label: 'internal', endpoint_url: '',
  });

  const fetchServices = async () => {
    try {
      const res = await api.get('/services');
      setServices(res.data);
    } catch (err) {
      console.error('Failed to load services:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServices(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/services', form);
      setShowForm(false);
      setForm({ name: '', owner: '', environment: 'dev', model_name: 'claude-sonnet-4-20250514', sensitivity_label: 'internal', endpoint_url: '' });
      fetchServices();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create service');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this service?')) return;
    try {
      await api.delete(`/services/${id}`);
      fetchServices();
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to delete');
    }
  };

  const handleTestConnection = async (id) => {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await api.post(`/services/${id}/test-connection`);
      setTestResults((prev) => ({ ...prev, [id]: res.data }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { status: 'failure', latency_ms: 0, response_snippet: err.message },
      }));
    }
  };

  const sensitivityColor = {
    public: 'bg-green-100 text-green-700',
    internal: 'bg-yellow-100 text-yellow-700',
    confidential: 'bg-red-100 text-red-700',
  };

  if (loading) return <div className="text-gray-500">Loading services...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">AI Service Registry</h2>
        {canEdit && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
          >
            <Plus size={16} /> Register Service
          </button>
        )}
      </div>

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Register New AI Service</h3>
          <div className="grid grid-cols-2 gap-4">
            <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Service name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Owner (team)" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} required />
            <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
              {ENV_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Model name" value={form.model_name} onChange={(e) => setForm({ ...form, model_name: e.target.value })} required />
            <select className="px-3 py-2 border border-gray-300 rounded-lg text-sm" value={form.sensitivity_label} onChange={(e) => setForm({ ...form, sensitivity_label: e.target.value })}>
              {SENSITIVITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input className="px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Endpoint URL (optional)" value={form.endpoint_url} onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })} />
          </div>
          <div className="flex gap-3 mt-4">
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Save</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      {/* Service List */}
      <div className="space-y-3">
        {services.length === 0 && (
          <div className="text-center py-12 text-gray-400">No services registered yet</div>
        )}
        {services.map((s) => (
          <div key={s.id} className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-sm font-medium text-gray-900">{s.name}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${sensitivityColor[s.sensitivity_label]}`}>
                    {s.sensitivity_label}
                  </span>
                  <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{s.environment}</span>
                </div>
                <p className="text-xs text-gray-500">Owner: {s.owner} · Model: {s.model_name}</p>
              </div>
              <div className="flex gap-2">
                {canEdit && (
                  <>
                    <button
                      onClick={() => handleTestConnection(s.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 transition-colors"
                    >
                      <Wifi size={14} /> Test Connection
                    </button>
                    <button
                      onClick={() => handleDelete(s.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
            {/* Test Connection Result */}
            {testResults[s.id] && (
              <div className={`mt-3 p-3 rounded-lg text-xs ${
                testResults[s.id].loading
                  ? 'bg-gray-50 text-gray-500'
                  : testResults[s.id].status === 'success'
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}>
                {testResults[s.id].loading
                  ? 'Testing connection...'
                  : `${testResults[s.id].status === 'success' ? '✓' : '✗'} ${testResults[s.id].status} — ${testResults[s.id].latency_ms}ms`
                }
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
