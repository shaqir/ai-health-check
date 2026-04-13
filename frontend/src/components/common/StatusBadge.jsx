/**
 * StatusBadge — semantic status indicator with dot + label.
 * Uses token-based colors. Always includes text (never color-only).
 */

const STATUS_MAP = {
  healthy: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  active: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  passed: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  resolved: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  success: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  degraded: { bg: 'bg-status-degraded-muted', text: 'text-status-degraded', dot: 'bg-status-degraded' },
  warning: { bg: 'bg-status-degraded-muted', text: 'text-status-degraded', dot: 'bg-status-degraded' },
  investigating: { bg: 'bg-status-degraded-muted', text: 'text-status-degraded', dot: 'bg-status-degraded' },
  failed: { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
  error: { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
  down: { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
  open: { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
  'drift detected': { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
  unknown: { bg: 'bg-status-unknown-muted', text: 'text-status-unknown', dot: 'bg-status-unknown' },
  closed: { bg: 'bg-status-unknown-muted', text: 'text-status-unknown', dot: 'bg-status-unknown' },
  critical: { bg: 'bg-severity-critical-muted', text: 'text-severity-critical', dot: 'bg-severity-critical' },
  high: { bg: 'bg-severity-high-muted', text: 'text-severity-high', dot: 'bg-severity-high' },
  medium: { bg: 'bg-severity-medium-muted', text: 'text-severity-medium', dot: 'bg-severity-medium' },
  low: { bg: 'bg-severity-low-muted', text: 'text-severity-low', dot: 'bg-severity-low' },
  prod: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  production: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  staging: { bg: 'bg-status-degraded-muted', text: 'text-status-degraded', dot: 'bg-status-degraded' },
  dev: { bg: 'bg-severity-low-muted', text: 'text-severity-low', dot: 'bg-severity-low' },
  development: { bg: 'bg-severity-low-muted', text: 'text-severity-low', dot: 'bg-severity-low' },
  public: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', dot: 'bg-status-healthy' },
  internal: { bg: 'bg-status-degraded-muted', text: 'text-status-degraded', dot: 'bg-status-degraded' },
  confidential: { bg: 'bg-status-failing-muted', text: 'text-status-failing', dot: 'bg-status-failing' },
};

const DEFAULT = { bg: 'bg-status-unknown-muted', text: 'text-status-unknown', dot: 'bg-status-unknown' };

export default function StatusBadge({ status }) {
  const key = (status || '').toLowerCase();
  const style = STATUS_MAP[key] || DEFAULT;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${style.bg} ${style.text}`}
      role="status"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} aria-hidden="true" />
      <span className="capitalize">{status}</span>
    </span>
  );
}
