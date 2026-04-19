import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellOff, X, AlertOctagon, AlertTriangle, Info, Clock,
  ArrowRight, CheckCheck,
} from 'lucide-react';
import api from '../../utils/api';

function formatRelativeTime(input) {
  if (!input) return '';
  const then = new Date(input.includes('T') ? input : input.replace(' ', 'T') + 'Z');
  const diffSec = Math.max(0, Math.round((Date.now() - then.getTime()) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1 min ago';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay} d ago`;
  return then.toLocaleDateString();
}

const severityTheme = {
  critical: { bar: 'bg-status-failing', icon: 'bg-status-failing-muted text-status-failing', pill: 'bg-status-failing text-white', Icon: AlertOctagon },
  warning: { bar: 'bg-status-degraded', icon: 'bg-status-degraded-muted text-status-degraded', pill: 'bg-status-degraded text-white', Icon: AlertTriangle },
  info: { bar: 'bg-accent', icon: 'bg-accent-weak text-accent', pill: 'bg-accent text-white', Icon: Info },
};

export default function NotificationsBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('active');
  const [busyId, setBusyId] = useState(null);
  const [clearingAll, setClearingAll] = useState(false);
  const bellRef = useRef(null);

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/dashboard/alerts?active_only=false');
      setAlerts(res.data);
    } catch {
      // silent — the bell just won't update; no need to notify users on every poll
    } finally {
      setLoading(false);
    }
  };

  // Poll every 30s so alerts appear without a page reload.
  useEffect(() => {
    setLoading(true);
    fetchAlerts();
    const t = setInterval(fetchAlerts, 30000);
    return () => clearInterval(t);
  }, []);

  // Close drawer on ESC.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const activeAlerts = alerts.filter(a => !a.acknowledged);
  const historyAlerts = alerts.filter(a => a.acknowledged);
  const unreadCount = activeAlerts.length;

  const acknowledge = async (id) => {
    setBusyId(id);
    try {
      await api.post(`/dashboard/alerts/${id}/acknowledge`);
      await fetchAlerts();
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = async () => {
    if (activeAlerts.length === 0) return;
    setClearingAll(true);
    try {
      await Promise.all(activeAlerts.map(a => api.post(`/dashboard/alerts/${a.id}/acknowledge`)));
      await fetchAlerts();
    } finally {
      setClearingAll(false);
    }
  };

  // Map alert severity → incident severity; alert type → the checklist items
  // most commonly implicated, so the triage form opens already on-point.
  const SEVERITY_MAP = { critical: 'critical', warning: 'high', info: 'medium' };
  const TYPE_CHECKLIST = {
    drift: { checklist_data_issue: true, checklist_prompt_change: true },
    budget: {},
    safety: { checklist_safety_policy: true },
    outage: { checklist_infrastructure: true },
  };

  const createIncidentFromAlert = (alert) => {
    setOpen(false);
    const prefill = {
      service_name: alert.service_name || '',
      severity: SEVERITY_MAP[alert.severity] || 'medium',
      symptoms: alert.message || '',
      alert_type: alert.type,
      ...(TYPE_CHECKLIST[alert.type] || {}),
    };
    navigate('/incidents', { state: { prefill } });
  };

  const rowsToRender = activeTab === 'active' ? activeAlerts : historyAlerts;

  return (
    <>
      {/* Bell button — lives in the sidebar footer. Badge is severity-tinted
          when the most urgent unread alert is critical; otherwise subtle. */}
      <button
        ref={bellRef}
        onClick={() => setOpen(true)}
        className="relative w-full flex items-center gap-2 px-3 py-1.5 text-xs text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard"
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
      >
        {unreadCount > 0 ? (
          <Bell size={14} strokeWidth={1.5} />
        ) : (
          <BellOff size={14} strokeWidth={1.5} className="text-text-subtle" />
        )}
        <span className="flex-1 text-left">Notifications</span>
        {unreadCount > 0 && (
          <span
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold text-white rounded-pill ${
              activeAlerts.some(a => a.severity === 'critical') ? 'bg-status-failing' : 'bg-status-degraded'
            }`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Drawer — portal-rendered so it overlays the whole app on every page */}
      {open && createPortal(
        <div
          className="fixed inset-0 z-50 flex justify-end"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panel */}
          <div
            className="relative w-full max-w-md h-full bg-surface border-l border-hairline shadow-lg flex flex-col animate-slide-in-right"
            style={{ animation: 'slideInRight var(--duration-slow) var(--ease-spring)' }}
          >
            {/* Header */}
            <div className="flex items-start justify-between px-5 py-4 border-b border-hairline">
              <div>
                <h2 className="text-[15px] font-semibold text-text tracking-tight flex items-center gap-2">
                  <Bell size={16} strokeWidth={1.75} className="text-text-muted" />
                  Notifications
                </h2>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {unreadCount > 0
                    ? `${unreadCount} unread · ${historyAlerts.length} in history`
                    : `All caught up · ${historyAlerts.length} in history`}
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 text-text-subtle hover:text-text bg-surface-elevated rounded-pill transition-standard"
                aria-label="Close notifications"
              >
                <X size={14} strokeWidth={1.75} />
              </button>
            </div>

            {/* Tabs + clear-all */}
            <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-hairline">
              <div className="flex items-center gap-1">
                {[
                  { key: 'active', label: 'Active', count: activeAlerts.length },
                  { key: 'history', label: 'History', count: historyAlerts.length },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium rounded-pill transition-standard ${
                      activeTab === tab.key
                        ? 'bg-accent-weak text-accent'
                        : 'text-text-muted hover:text-text hover:bg-surface-elevated'
                    }`}
                  >
                    {tab.label}
                    <span className={`text-[10px] font-mono tabular-nums px-1.5 py-0 rounded-xs ${
                      activeTab === tab.key ? 'bg-surface text-text-muted' : 'bg-surface-elevated text-text-subtle'
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
              {activeTab === 'active' && activeAlerts.length > 0 && (
                <button
                  onClick={clearAll}
                  disabled={clearingAll}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-text bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
                >
                  <CheckCheck size={12} strokeWidth={1.75} />
                  {clearingAll ? 'Clearing…' : 'Clear all'}
                </button>
              )}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading && alerts.length === 0 ? (
                <div className="px-5 py-12 text-center text-[12px] text-text-subtle">Loading…</div>
              ) : rowsToRender.length === 0 ? (
                <div className="px-5 py-16 text-center">
                  <div className="w-10 h-10 mx-auto rounded-lg bg-surface-elevated flex items-center justify-center mb-3">
                    <BellOff size={16} strokeWidth={1.5} className="text-text-subtle" />
                  </div>
                  <p className="text-[13px] font-medium text-text mb-1">
                    {activeTab === 'active' ? 'No active alerts' : 'No history'}
                  </p>
                  <p className="text-[12px] text-text-muted leading-relaxed max-w-xs mx-auto">
                    {activeTab === 'active'
                      ? 'When a service trips a drift, budget, or safety threshold, it will appear here.'
                      : 'Acknowledged alerts from the last 50 entries will appear here.'}
                  </p>
                </div>
              ) : (
                <div>
                  {rowsToRender.map(a => {
                    const theme = severityTheme[a.severity] || severityTheme.info;
                    const Icon = theme.Icon;
                    const isAcked = !!a.acknowledged;
                    return (
                      <div
                        key={a.id}
                        className={`relative flex items-start gap-3 px-5 py-4 border-b border-hairline last:border-0 transition-standard ${
                          isAcked ? 'opacity-70' : 'hover:bg-surface-elevated'
                        }`}
                      >
                        <span aria-hidden="true" className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-pill ${theme.bar}`} />

                        <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${theme.icon}`}>
                          <Icon size={16} strokeWidth={1.75} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                            <h4 className="text-[13px] font-semibold text-text truncate">
                              {a.service_name || 'System'}
                            </h4>
                            <span className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-xs ${theme.pill}`}>
                              {a.severity}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-text-subtle">
                              {a.type}
                            </span>
                          </div>
                          <p className="text-[12px] text-text-muted leading-snug">{a.message}</p>
                          <p className="text-[10px] text-text-subtle font-mono tabular-nums mt-1.5 inline-flex items-center gap-1">
                            <Clock size={10} strokeWidth={1.5} />
                            {formatRelativeTime(a.created_at)}
                            {isAcked && <span className="ml-1.5 text-text-subtle">· Acknowledged</span>}
                          </p>
                          {!isAcked && (
                            <div className="flex items-center gap-1.5 mt-2.5">
                              <button
                                onClick={() => createIncidentFromAlert(a)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-accent text-white rounded-pill hover:bg-accent-hover transition-standard"
                              >
                                Create incident <ArrowRight size={10} strokeWidth={1.75} />
                              </button>
                              <button
                                onClick={() => acknowledge(a.id)}
                                disabled={busyId === a.id}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-text-muted hover:text-text bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
                              >
                                {busyId === a.id ? 'Dismissing…' : 'Dismiss'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Keyframes — scoped style tag keeps this self-contained */}
          <style>{`
            @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0.4; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
        </div>,
        document.body
      )}
    </>
  );
}
