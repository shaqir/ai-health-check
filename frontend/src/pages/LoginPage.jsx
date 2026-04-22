import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Server, ChevronDown, ChevronUp, Loader2, ShieldAlert, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';

// Demo-role convenience panel. Emails only — passwords are set by the
// operator via SEED_ADMIN_PASSWORD / SEED_MAINTAINER_PASSWORD /
// SEED_VIEWER_PASSWORD in backend/.env and never shipped with the
// frontend bundle. Clicking a row pre-fills the email field; the user
// types the password they configured themselves.
const DEMO_ROLES = [
  { role: 'Admin', email: 'admin@aiops.local', desc: 'Full access' },
  { role: 'Maintainer', email: 'maintainer@aiops.local', desc: 'Services + incidents' },
  { role: 'Viewer', email: 'viewer@aiops.local', desc: 'Read-only' },
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

  // Recovery state
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryEnabled, setRecoveryEnabled] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoverySuccess, setRecoverySuccess] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // Check if recovery is enabled on the server
  useEffect(() => {
    api.get('/auth/recovery-status')
      .then(res => setRecoveryEnabled(res.data.enabled))
      .catch(() => setRecoveryEnabled(false));
  }, []);

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

  const handleDemoClick = (demoEmail) => {
    setEmail(demoEmail);
    // Password intentionally not pre-filled — the user enters the
    // password they set via SEED_*_PASSWORD in backend/.env. See
    // .env.example for the override documentation.
  };

  const handleRecovery = async (e) => {
    e.preventDefault();
    setRecoveryError('');
    setRecoverySuccess('');

    if (newPassword !== confirmPassword) {
      setRecoveryError('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setRecoveryError('Password must be at least 6 characters.');
      return;
    }

    setRecoveryLoading(true);
    try {
      const res = await api.post('/auth/recover', {
        recovery_key: recoveryKey,
        email: recoveryEmail,
        new_password: newPassword,
      });
      setRecoverySuccess(res.data.message);
      setRecoveryKey('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setRecoveryError(err.response?.data?.detail || 'Recovery failed. Check your recovery key and try again.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const exitRecovery = () => {
    setShowRecovery(false);
    setRecoveryError('');
    setRecoverySuccess('');
    setRecoveryKey('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        {/* Wordmark */}
        <div className="flex items-center justify-center gap-2.5 mb-10">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
            showRecovery ? 'bg-amber-500' : 'bg-accent'
          }`}>
            {showRecovery
              ? <KeyRound size={14} strokeWidth={2} className="text-white" />
              : <Server size={14} strokeWidth={2} className="text-white" />
            }
          </div>
          <h1 className="text-[15px] font-semibold text-text tracking-tight">
            {showRecovery ? 'Account Recovery' : 'AI Health Check'}
          </h1>
        </div>

        {showRecovery ? (
          /* ─── Recovery Form ─── */
          <div className="rounded-2xl border border-hairline bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material shadow-lg p-8">
            <h2 className="text-display-sm font-semibold text-text mb-1.5">Reset password</h2>
            <p className="text-[13px] text-text-muted mb-6">Enter the server recovery key and your new password.</p>

            <form onSubmit={handleRecovery} className="space-y-3.5">
              <div>
                <label htmlFor="recovery-key" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                  Recovery Key
                </label>
                <input
                  id="recovery-key"
                  type="password"
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Enter server recovery key"
                  required
                />
              </div>
              <div>
                <label htmlFor="recovery-email" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                  Account Email
                </label>
                <input
                  id="recovery-email"
                  type="email"
                  value={recoveryEmail}
                  onChange={(e) => setRecoveryEmail(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="admin@aiops.local"
                  required
                />
              </div>
              <div>
                <label htmlFor="new-password" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Enter new password"
                  required
                />
              </div>
              <div>
                <label htmlFor="confirm-password" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="Confirm new password"
                  required
                />
              </div>

              {recoveryError && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium bg-status-failing-muted text-status-failing rounded-md" role="alert">
                  <span className="w-1 h-1 rounded-full bg-status-failing shrink-0" aria-hidden="true" />
                  {recoveryError}
                </div>
              )}

              {recoverySuccess && (
                <div className="flex items-center gap-2 px-3.5 py-2.5 text-[12px] font-medium bg-emerald-50 text-emerald-700 rounded-md" role="alert">
                  <CheckCircle2 size={14} className="shrink-0" />
                  {recoverySuccess}
                </div>
              )}

              <button
                type="submit"
                disabled={recoveryLoading}
                aria-busy={recoveryLoading}
                className="w-full py-2.5 mt-2 bg-amber-500 hover:bg-amber-600 text-white rounded-pill text-sm font-medium transition-standard flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {recoveryLoading && <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />}
                {recoveryLoading ? 'Resetting...' : 'Reset password'}
              </button>
            </form>

            <div className="mt-5 pt-4 border-t border-hairline">
              <button
                onClick={exitRecovery}
                className="w-full flex items-center justify-center gap-2 text-[12px] font-medium text-text-muted hover:text-text transition-standard py-1"
              >
                <ArrowLeft size={14} strokeWidth={1.5} />
                Back to sign in
              </button>
            </div>
          </div>
        ) : (
          /* ─── Login Form ─── */
          <>
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

              {/* Recovery link */}
              {recoveryEnabled && (
                <div className="mt-4 pt-3 border-t border-hairline">
                  <button
                    onClick={() => setShowRecovery(true)}
                    className="w-full flex items-center justify-center gap-2 text-[11px] font-medium text-amber-600 hover:text-amber-700 transition-standard py-1"
                  >
                    <ShieldAlert size={12} strokeWidth={1.75} />
                    Forgot password? Use Recovery Key
                  </button>
                </div>
              )}
            </div>

            {/* Demo role emails — click to pre-fill */}
            <div className="mt-4 rounded-2xl bg-surface border border-hairline shadow-xs overflow-hidden">
              <button
                onClick={() => setShowDemo(!showDemo)}
                className="w-full flex items-center justify-between px-5 py-3 text-[12px] font-medium text-text-muted hover:text-text transition-standard"
                aria-expanded={showDemo}
              >
                <span>Seed role emails (click to pre-fill)</span>
                {showDemo
                  ? <ChevronUp size={14} strokeWidth={1.5} />
                  : <ChevronDown size={14} strokeWidth={1.5} />
                }
              </button>

              {showDemo && (
                <div className="border-t border-hairline">
                  {DEMO_ROLES.map((cred, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleDemoClick(cred.email)}
                      className="w-full flex items-center justify-between px-5 py-2.5 text-left hover:bg-accent-weak transition-standard border-b border-hairline last:border-b-0"
                    >
                      <div>
                        <p className="text-[12px] font-medium text-text">{cred.role}</p>
                        <p className="text-[10px] text-text-subtle font-mono">{cred.email}</p>
                      </div>
                      <span className="text-[10px] font-medium text-accent">{cred.desc}</span>
                    </button>
                  ))}
                  <p className="px-5 py-2.5 text-[10px] text-text-subtle border-t border-hairline bg-[var(--material-thick)]">
                    Passwords are set via <code className="font-mono">SEED_*_PASSWORD</code> in <code className="font-mono">backend/.env</code>.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
