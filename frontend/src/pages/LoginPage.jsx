import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Server, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

const DEMO_CREDS = [
  { role: 'Admin', email: 'admin@aiops.local', pwd: 'admin123', desc: 'Full access' },
  { role: 'Maintainer', email: 'maintainer@aiops.local', pwd: 'maintain123', desc: 'Services + incidents' },
  { role: 'Viewer', email: 'viewer@aiops.local', pwd: 'viewer123', desc: 'Read-only' },
];

const INPUT_CLS = 'w-full px-4 py-2.5 text-sm bg-[var(--material-thick)] border border-hairline rounded-md text-text placeholder-text-subtle transition-standard focus:border-accent focus:bg-surface';

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
      <div className="w-full max-w-[380px]">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center">
            <Server size={14} strokeWidth={2} className="text-white" />
          </div>
          <h1 className="text-[15px] font-semibold text-text tracking-tight">AI Health Check</h1>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-hairline bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material shadow-lg p-8">
          <h2 className="text-display-sm font-semibold text-text mb-1.5">Sign in</h2>
          <p className="text-[13px] text-text-muted mb-6">Enter your credentials to access the dashboard.</p>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="email" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLS}
                placeholder="admin@aiops.local"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLS}
                placeholder="Enter password"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium bg-status-failing-muted text-status-failing rounded-md" role="alert">
                <span className="w-1 h-1 rounded-full bg-status-failing shrink-0" aria-hidden="true" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full py-2.5 mt-2 bg-accent hover:bg-accent-hover text-white rounded-pill text-sm font-medium transition-standard flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading && <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />}
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
        </div>

        {/* Demo credentials */}
        <div className="mt-4 rounded-2xl bg-surface border border-hairline shadow-xs overflow-hidden">
          <button
            onClick={() => setShowDemo(!showDemo)}
            className="w-full flex items-center justify-between px-5 py-3 text-[12px] font-medium text-text-muted hover:text-text transition-standard"
            aria-expanded={showDemo}
          >
            <span>Demo credentials</span>
            {showDemo
              ? <ChevronUp size={14} strokeWidth={1.5} />
              : <ChevronDown size={14} strokeWidth={1.5} />
            }
          </button>

          {showDemo && (
            <div className="border-t border-hairline">
              {DEMO_CREDS.map((cred, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleDemoClick(cred.email, cred.pwd)}
                  className="w-full flex items-center justify-between px-5 py-2.5 text-left hover:bg-accent-weak transition-standard border-b border-hairline last:border-b-0"
                >
                  <div>
                    <p className="text-[12px] font-medium text-text">{cred.role}</p>
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
