import { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import api from '../../utils/api';
import FamilyBadge from './FamilyBadge';
import ModelBadge from '../common/ModelBadge';

function formatRelativeTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return d.toLocaleString(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function ActivityRow({ activity, onCallClick, canDrillDown }) {
  const [expanded, setExpanded] = useState(false);
  const [calls, setCalls] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadCalls = async () => {
    if (calls || loading) return;
    if (!canDrillDown) {
      // Viewers can see the activity summary but not the prompt/response text.
      // No fetch — the drill-down endpoint returns 403 for them.
      setError('Drill-down is admin/maintainer only.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/settings/trace/calls/${activity.correlation_id}`);
      setCalls(res.data.calls);
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Failed to load calls';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) loadCalls();
  };

  const statusDot =
    activity.status === 'success' ? 'bg-status-healthy' :
    activity.status === 'error' ? 'bg-status-failing' :
    'bg-status-degraded';

  return (
    <div className="bg-surface rounded-xl border border-hairline overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-elevated/60 transition-standard"
        aria-expanded={expanded}
      >
        <span className="text-text-subtle shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>

        <FamilyBadge family={activity.family} label={activity.family_label} size="lg" />

        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-text truncate">
            {activity.service_name || (activity.family === 'dashboard_insight'
              ? 'Dashboard'
              : activity.family === 'compliance_report'
                ? 'Compliance'
                : 'Activity')}
          </p>
          <p className="text-[11px] text-text-subtle font-mono tabular-nums truncate">
            {activity.user_email || (activity.user_id ? `user #${activity.user_id}` : 'system')}
            {' · '}
            {formatRelativeTime(activity.started_at)}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-[12px]">
          <span className="text-text-subtle">{activity.call_count} call{activity.call_count === 1 ? '' : 's'}</span>
          <span className="text-text">${activity.total_cost_usd.toFixed(4)}</span>
          <span className="text-text-subtle">{(activity.total_latency_ms / 1000).toFixed(2)}s</span>
          <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} aria-label={activity.status} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-hairline bg-surface-elevated/40">
          {loading && (
            <div className="px-4 py-4 flex items-center gap-2 text-[12px] text-text-subtle">
              <Loader2 size={12} className="animate-spin" /> Loading calls…
            </div>
          )}
          {error && (
            <div className="px-4 py-3 flex items-start gap-2 text-[12px] text-status-degraded">
              <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {calls && calls.length > 0 && (
            <ul className="divide-y divide-hairline">
              {calls.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onCallClick && onCallClick(c)}
                    className="w-full grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-center px-4 py-2.5 text-left hover:bg-surface/80 transition-standard"
                  >
                    <div className="min-w-0">
                      <code className="font-mono text-[12px] font-medium text-text">{c.caller}</code>
                      <span className="ml-2 text-[11px] text-text-subtle">
                        {new Date(c.timestamp).toLocaleTimeString(undefined, { hour12: false })}
                      </span>
                    </div>
                    <ModelBadge model={c.model} />
                    <span className="font-mono tabular-nums text-[11px] text-text-subtle">
                      {c.input_tokens}/{c.output_tokens} tok
                    </span>
                    <span className="font-mono tabular-nums text-[12px] text-text">
                      ${c.estimated_cost_usd.toFixed(4)}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-text-subtle">
                      {Math.round(c.latency_ms)}ms
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
