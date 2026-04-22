/**
 * ModelBadge — renders a short tier label (Sonnet / Haiku / …) from a full
 * Anthropic model id so the API Usage table and eval runs stay scannable.
 *
 * Two-tier architecture: Sonnet = actor (service under test, synthesis);
 * Haiku = judges + injection detector. Unknown model ids fall back to a
 * truncated display so future model additions don't break the UI.
 */

const MODEL_STYLES = {
  sonnet: { bg: 'bg-status-healthy-muted', text: 'text-status-healthy', label: 'Sonnet' },
  haiku:  { bg: 'bg-severity-low-muted',   text: 'text-severity-low',   label: 'Haiku'  },
  opus:   { bg: 'bg-severity-high-muted',  text: 'text-severity-high',  label: 'Opus'   },
};

const DEFAULT = { bg: 'bg-status-unknown-muted', text: 'text-status-unknown', label: 'Model' };

function pickStyle(modelId) {
  const lower = String(modelId || '').toLowerCase();
  for (const key of Object.keys(MODEL_STYLES)) {
    if (lower.includes(key)) return MODEL_STYLES[key];
  }
  // Unknown model — show a short slug, fall back to generic styling
  const fallback = { ...DEFAULT };
  if (lower) {
    // take the last meaningful segment, e.g. "gpt-4o-mini" → "gpt-4o-mini"
    fallback.label = lower.slice(0, 16);
  }
  return fallback;
}

export default function ModelBadge({ model }) {
  if (!model) return <span className="text-[11px] text-text-muted">—</span>;
  const style = pickStyle(model);
  return (
    <span
      title={model}
      className={`inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-medium tracking-tight ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}
