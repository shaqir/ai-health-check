/**
 * Shared API error → human-readable detail extractor.
 *
 * Before this file existed, ServicesPage.jsx and GovernancePage.jsx
 * had byte-identical copies of the same logic. EvaluationsPage.jsx
 * used a dumber fallback (`err.response?.data?.detail || '...'`)
 * that rendered "[object Object]" on Pydantic validation errors.
 * One utility, consumed by all three pages.
 *
 * Handles every FastAPI/axios response shape the backend produces:
 *
 *   1. Network-level failure (no `err.response`): label as
 *      "Backend unreachable — ..." if err.code === 'ERR_NETWORK',
 *      else fall back to err.message.
 *
 *   2. Blob body (used by responseType:'blob' requests like the PDF
 *      export). Read as text, try JSON.parse, format the detail.
 *
 *   3. Plain `{ detail: "string" }` — the common case. Prefix with
 *      HTTP status for context ("403 · ...").
 *
 *   4. Pydantic validation `{ detail: [{loc, msg, type}, ...] }` —
 *      format as "field1: msg1; field2: msg2" with a cap of 4
 *      entries + "(+N more)" tail. This is the one EvaluationsPage
 *      was rendering as "[object Object]".
 *
 *   5. Any other object body — try `.msg` / `.message`, fall back
 *      to JSON.stringify.
 *
 * @param {Error} err      axios / fetch error object
 * @param {string} fallback label used when nothing else yields text
 * @returns {Promise<string>} human-readable detail, already
 *     status-prefixed when applicable
 */
export async function extractErrorDetail(err, fallback = 'Request failed') {
  const data = err?.response?.data;
  const status = err?.response?.status;

  const formatDetail = (detail) => {
    if (detail == null) return null;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      // Pydantic validation: [{loc:[...], msg:"Field required", type:"missing"}, ...]
      const lines = detail.slice(0, 4).map((d) => {
        const field = Array.isArray(d?.loc)
          ? d.loc.slice(1).join('.') || d.loc.join('.')
          : 'input';
        const msg = d?.msg || d?.type || 'invalid value';
        return `${field}: ${msg}`;
      });
      const extra = detail.length > 4 ? ` (+${detail.length - 4} more)` : '';
      return `Validation error — ${lines.join('; ')}${extra}`;
    }
    if (typeof detail === 'object') {
      return detail.msg || detail.message || JSON.stringify(detail);
    }
    return String(detail);
  };

  const prefix = status ? `${status} · ` : '';

  if (!data) {
    return `${err?.code === 'ERR_NETWORK' ? 'Backend unreachable — ' : ''}${err?.message || fallback}`;
  }
  if (data instanceof Blob) {
    try {
      const text = await data.text();
      try {
        const parsed = JSON.parse(text);
        const detail = formatDetail(parsed.detail);
        return detail ? `${prefix}${detail}` : text || err?.message || fallback;
      } catch {
        return text || err?.message || fallback;
      }
    } catch {
      return err?.message || fallback;
    }
  }
  if (typeof data === 'string') return `${prefix}${data}`;
  const detail = formatDetail(data.detail);
  return detail ? `${prefix}${detail}` : (err?.message || fallback);
}
