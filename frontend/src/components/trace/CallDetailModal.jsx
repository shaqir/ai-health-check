import { useState } from 'react';
import { Copy, Check, ExternalLink } from 'lucide-react';
import Modal from '../common/Modal';
import ModelBadge from '../common/ModelBadge';
import StatusBadge from '../common/StatusBadge';
import FamilyBadge from './FamilyBadge';

function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const onClick = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard can fail in non-secure contexts — fail silently, the
      // user can select and copy manually.
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] text-text-subtle hover:text-accent transition-standard"
      aria-label={label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'copied' : label}
    </button>
  );
}

function Field({ label, children, valueClass = 'text-text' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-hairline last:border-b-0">
      <span className="text-[11px] font-medium text-text-subtle tracking-tight uppercase">{label}</span>
      <span className={`font-mono tabular-nums text-[12px] ${valueClass} text-right truncate`}>
        {children}
      </span>
    </div>
  );
}

export default function CallDetailModal({ call, onClose }) {
  if (!call) return null;

  const tsLocal = new Date(call.timestamp).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'medium',
  });

  return (
    <Modal isOpen={!!call} onClose={onClose} title="API call detail" size="lg">
      <div className="space-y-4">
        {/* Header strip — caller + family + status at a glance */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <FamilyBadge family={call.family} label={call.family_label} />
            <code className="font-mono text-[13px] font-semibold text-text bg-surface-elevated px-2 py-0.5 rounded truncate">
              {call.caller}
            </code>
          </div>
          <StatusBadge status={call.status} />
        </div>

        {/* Primary facts — two columns of scalar fields */}
        <div className="grid md:grid-cols-2 gap-x-6 gap-y-0">
          <div>
            <Field label="Timestamp">{tsLocal}</Field>
            <Field label="Model"><ModelBadge model={call.model} /></Field>
            <Field label="Latency">{Math.round(call.latency_ms)} ms</Field>
            <Field label="Cost">${call.estimated_cost_usd.toFixed(6)}</Field>
          </div>
          <div>
            <Field label="Input tokens">{call.input_tokens?.toLocaleString()}</Field>
            <Field label="Output tokens">{call.output_tokens?.toLocaleString()}</Field>
            <Field label="Risk score">{call.risk_score ?? 0}</Field>
            <Field label="Safety flags" valueClass="text-text-muted">
              {call.safety_flags || <span className="text-text-subtle">—</span>}
            </Field>
          </div>
        </div>

        {/* Prompt + response blocks. These are the whole point of the
            drill-down — the reason the feature exists at all. */}
        {call.prompt_text && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.08em]">
                Prompt sent
              </span>
              <CopyButton text={call.prompt_text} />
            </div>
            <pre className="font-mono text-[12px] text-text bg-surface-elevated border border-hairline rounded-md p-3 whitespace-pre-wrap max-h-64 overflow-auto">
              {call.prompt_text}
            </pre>
            <p className="text-[10px] text-text-subtle mt-1">
              Stored truncated to 2000 characters. What you see here is what Claude received.
            </p>
          </div>
        )}

        {call.response_text && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-text-subtle uppercase tracking-[0.08em]">
                Response received
              </span>
              <CopyButton text={call.response_text} />
            </div>
            <pre className="font-mono text-[12px] text-text bg-surface-elevated border border-hairline rounded-md p-3 whitespace-pre-wrap max-h-64 overflow-auto">
              {call.response_text}
            </pre>
          </div>
        )}
      </div>
    </Modal>
  );
}
