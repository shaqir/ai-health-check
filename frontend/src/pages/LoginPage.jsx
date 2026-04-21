import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Server, ChevronDown, ChevronUp, Loader2, ShieldAlert, ArrowLeft, KeyRound, CheckCircle2 } from 'lucide-react';
import api from '../utils/api';

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

  const handleDemoClick = (demoEmail, demoPwd) => {
    setEmail(demoEmail);
    setPassword(demoPwd);
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
      // Clear fields
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
    <div className="min-h-screen flex items-center justify-center bg-[#0B1120] relative max-w-[100vw] overflow-hidden">
      {/* Subtle Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-blue-600/10 blur-[100px] rounded-full"></div>
        <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-indigo-600/10 blur-[100px] rounded-full"></div>
      </div>
      
      <div className="w-full max-w-md px-6 relative z-10">
        <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8 sm:p-10">
          
          {/* ─── Header ─── */}
          <div className="flex flex-col items-center mb-8">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg mb-4 transition-all duration-300 ${
              showRecovery 
                ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-amber-500/20' 
                : 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-blue-500/20'
            }`}>
              {showRecovery ? <KeyRound size={24} className="text-white" /> : <Server size={24} className="text-white" />}
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              {showRecovery ? 'Account Recovery' : 'AIHealthCheck'}
            </h1>
            <p className="text-sm text-slate-400 mt-2 text-center">
              {showRecovery ? 'Reset your password using the recovery key' : 'Sign in to control room'}
            </p>
          </div>

          {/* ─── Recovery Form ─── */}
          {showRecovery ? (
            <>
              <form onSubmit={handleRecovery} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Recovery Key</label>
                  <input
                    type="password"
                    value={recoveryKey}
                    onChange={(e) => setRecoveryKey(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none transition-all"
                    placeholder="Enter server recovery key"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Account Email</label>
                  <input
                    type="email"
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none transition-all"
                    placeholder="admin@aiops.local"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none transition-all"
                    placeholder="••••••••"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-950/50 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500 outline-none transition-all"
                    placeholder="••••••••"
                    required
                  />
                </div>

                {recoveryError && (
                  <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-3 rounded-lg flex items-center gap-2">
                    <span className="block w-1.5 h-1.5 rounded-full bg-rose-500 flex-shrink-0"></span>
                    {recoveryError}
                  </div>
                )}

                {recoverySuccess && (
                  <div className="text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 rounded-lg flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />
                    {recoverySuccess}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={recoveryLoading}
                  className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-sm font-semibold transition-all shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {recoveryLoading && <Loader2 size={16} className="animate-spin" />}
                  {recoveryLoading ? 'Resetting...' : 'Reset Password'}
                </button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-800/80">
                <button
                  onClick={exitRecovery}
                  className="w-full flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors py-2"
                >
                  <ArrowLeft size={14} />
                  Back to Sign In
                </button>
              </div>
            </>
          ) : (
            /* ─── Login Form ─── */
            <>
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

              {/* Recovery + Demo section */}
              <div className="mt-8 pt-6 border-t border-slate-800/80 space-y-4">
                {/* Forgot password / recovery link */}
                {recoveryEnabled && (
                  <button
                    onClick={() => setShowRecovery(true)}
                    className="w-full flex items-center justify-center gap-2 text-xs font-medium text-amber-400/80 hover:text-amber-300 transition-colors py-1"
                  >
                    <ShieldAlert size={14} />
                    Forgot password? Use Recovery Key
                  </button>
                )}

                {/* Demo credentials toggle */}
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
            </>
          )}

        </div>
      </div>
    </div>
  );
}
