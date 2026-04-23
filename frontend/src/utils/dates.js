/**
 * Shared date helpers. Kept in one place so any page that consumes a
 * backend timestamp uses the same UTC-coercion + relative-label logic.
 *
 * Before this util existed, `EvalRunsSection.jsx` had its own local
 * copies and the other pages (Incidents, Governance, Settings) parsed
 * timestamps directly with `new Date(str)` — which for naive strings
 * is a bug (see parseBackendDate below).
 */

/**
 * Parse a backend-issued timestamp as UTC.
 *
 * Problem: SQLAlchemy's `DateTime` column is naive. Pydantic serializes
 * UTC datetimes WITHOUT a `Z` suffix ("2026-04-23T14:23:56.203304").
 * Per ES spec, `new Date(naiveString)` interprets those as LOCAL time,
 * offsetting every display by the viewer's timezone (e.g. MDT pushes
 * 14:23 UTC to 14:23 local == 20:23 UTC == "6 hours in the future").
 *
 * This helper appends a `Z` when no offset marker is present, forcing
 * correct UTC parsing. Already-offset strings (...Z / ...+05:30) and
 * Date instances pass through untouched.
 *
 * @param {string | Date | null | undefined} value
 * @returns {Date | null} null on empty / malformed input
 */
export function parseBackendDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const str = String(value);
  const normalized = /[Zz]|[+-]\d\d:?\d\d$/.test(str) ? str : `${str}Z`;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Scan-friendly relative label: "just now", "14m ago", "3h ago",
 * "2d ago". Falls back to a short absolute ("Mon DD") for timestamps
 * older than a week.
 *
 * Used in list views where an exact timestamp would be noise; the
 * caller is expected to keep the full absolute in a tooltip.
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatRelative(d) {
  if (!d || Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  if (diffMs < 0) {
    // Clock skew / future timestamp — don't render "in 2h".
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const sec = 1000;
  const min = 60 * sec;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diffMs < min) return 'just now';
  if (diffMs < hour) return `${Math.floor(diffMs / min)}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Compact absolute timestamp: "Apr 23, 02:23 PM".
 *
 * Designed for a secondary-line display under the relative label —
 * wrap prevention is the caller's responsibility (wrap nearest parent
 * in `whitespace-nowrap`).
 *
 * @param {Date} d
 * @returns {string}
 */
export function formatShortAbsolute(d) {
  if (!d || Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString(undefined, { month: 'short', day: '2-digit' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, ${time}`;
}
