import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Server, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

const DEMO_CREDS = [
  { role: 'Admin', email: 'admin@aiops.local', pwd: 'admin123', desc: 'Full access' },
  { role: 'Maintainer', email: 'maintainer@aiops.local', pwd: 'maintain123', desc: 'Services + incidents' },
  { role: 'Viewer', email: 'viewer@aiops.local', pwd: 'viewer123', desc: 'Read-only' },
];

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
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-8 h-8 rounded-md bg-accent flex items-center justify-center">
            <Server size={16} strokeWidth={1.5} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text tracking-tight">AIHealthCheck</h1>
            <p className="text-[10px] text-text-subtle uppercase tracking-wider">Control Room</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-surface border border-border rounded-lg p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text mb-1">Sign in</h2>
          <p className="text-xs text-text-muted mb-5">Enter your credentials to access the dashboard.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-text-muted mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-md text-text placeholder-text-subtle focus:outline-none focus:border-accent transition-colors"
                placeholder="admin@aiops.local"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-text-muted mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-elevated border border-border rounded-md text-text placeholder-text-subtle focus:outline-none focus:border-accent transition-colors"
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-status-failing-muted text-status-failing border border-status-failing/20 rounded-md" role="alert">
                <span className="w-1.5 h-1.5 rounded-full bg-status-failing shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full py-2 bg-accent hover:bg-accent-hover text-white rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Demo credentials */}
        <div className="mt-4 bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
          <button
            onClick={() => setShowDemo(!showDemo)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs font-medium text-text-muted hover:text-text transition-colors"
            aria-expanded={showDemo}
          >
            <span>Demo credentials</span>
            {showDemo
              ? <ChevronUp size={14} strokeWidth={1.5} />
              : <ChevronDown size={14} strokeWidth={1.5} />
            }
          </button>

          {showDemo && (
            <div className="border-t border-border">
              {DEMO_CREDS.map((cred, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleDemoClick(cred.email, cred.pwd)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-surface-elevated transition-colors border-b border-border last:border-b-0"
                >
                  <div>
                    <p className="text-xs font-medium text-text">{cred.role}</p>
                    <p className="text-[10px] text-text-subtle font-mono">{cred.email}</p>
                  </div>
                  <span className="text-[10px] font-medium text-accent">{cred.desc}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
