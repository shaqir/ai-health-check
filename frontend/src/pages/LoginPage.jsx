import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Server, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoClick = (demoEmail, demoPwd) => {
    setEmail(demoEmail);
    setPassword(demoPwd);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B1120] relative max-w-[100vw] overflow-hidden">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-blue-600/10 blur-[100px] rounded-full"></div>
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-600/10 blur-[100px] rounded-full"></div>
      </div>
      
      <div className="w-full max-w-md px-6 relative z-10">
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8 sm:p-10">
          
          <div className="flex flex-col items-center mb-8">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 mb-4">
              <Server size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">AIHealthCheck</h1>
            <p className="text-sm text-slate-400 mt-2 text-center">Sign in to control room</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                placeholder="admin@aiops.local"
                required
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Password</label>
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-lg flex items-center gap-2">
                <span className="block w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0"></span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={16} className="animate-spin" />}
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-800/80">
            <button 
              onClick={() => setShowDemo(!showDemo)}
              className="w-full flex items-center justify-between text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors"
            >
              <span>Need demo credentials?</span>
              {showDemo ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            
            {showDemo && (
              <div className="mt-4 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                {[
                  { role: 'Admin', email: 'admin@aiops.local', pwd: 'admin123' },
                  { role: 'Maintainer', email: 'maintainer@aiops.local', pwd: 'maintain123' },
                  { role: 'Viewer', email: 'viewer@aiops.local', pwd: 'viewer123' }
                ].map((cred, idx) => (
                  <div 
                    key={idx} 
                    onClick={() => handleDemoClick(cred.email, cred.pwd)}
                    className="flex justify-between items-center p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:bg-slate-800/60 cursor-pointer transition-colors group"
                  >
                    <div>
                      <p className="text-xs font-semibold text-slate-300">{cred.role}</p>
                      <p className="text-xs text-slate-500">{cred.email}</p>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      Use
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
