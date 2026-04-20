import { useEffect, useState } from 'react';
import { ShieldCheck, AlertCircle } from 'lucide-react';
import Modal from './Modal';

/**
 * Reviewer-note input modal — replaces window.prompt() for the incident
 * summary approval flow. Enforces the same min-length contract as the
 * backend (20 non-whitespace chars) with live character count and inline
 * validation so the submit button is only enabled when a valid note is
 * entered.
 *
 * Paired with backend R17: approval requires a mandatory reviewer_note.
 * The backend re-checks length after strip, so the UI validation is UX,
 * not security.
 */
export default function ReviewerNoteModal({
  isOpen,
  onClose,
  onSubmit,
  title = 'Approve and publish summary',
  description = (
    'This summary will become the official record. Confirm what you verified — ' +
    'e.g. root causes match the checklist, no fabricated claims. At least 20 ' +
    'non-whitespace characters.'
  ),
  minLength = 20,
  busy = false,
  error = null,
}) {
  const [note, setNote] = useState('');

  // Reset the field every time the modal opens fresh. If it's already open
  // when an error arrives, keep the typed text — losing it on a validation
  // failure is the footgun we're specifically trying to fix.
  useEffect(() => {
    if (isOpen) setNote('');
  }, [isOpen]);

  const trimmedLen = note.trim().length;
  const valid = trimmedLen >= minLength;

  const handleSubmit = () => {
    if (!valid || busy) return;
    onSubmit(note.trim());
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={title}
      maxWidth="max-w-lg"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valid || busy}
            className="px-4 py-1.5 text-[12px] font-medium bg-accent text-white rounded-pill hover:bg-accent-hover transition-standard disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve &amp; publish
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 shrink-0 rounded-lg bg-accent-weak flex items-center justify-center">
          <ShieldCheck size={18} strokeWidth={1.75} className="text-accent" />
        </div>
        <p className="flex-1 text-sm text-text-muted leading-relaxed">{description}</p>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3 py-2 mb-3 text-[12px] text-status-failing bg-status-failing-muted border border-status-failing/30 rounded-md"
        >
          <AlertCircle size={14} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <label htmlFor="reviewer-note" className="block text-[11px] font-medium text-text-muted tracking-tight mb-1.5">
        Reviewer note
      </label>
      <textarea
        id="reviewer-note"
        rows={4}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
        }}
        placeholder="Read full draft — root causes match the checklist, no fabricated claims."
        className="w-full px-3.5 py-2 text-sm bg-[var(--material-thick)] rounded-md text-text placeholder-text-subtle transition-standard resize-none"
        autoFocus
      />

      <div className="mt-1.5 flex items-center justify-between text-[11px]">
        <span className={valid ? 'text-status-healthy' : 'text-text-subtle'}>
          {valid
            ? `✓ ${trimmedLen} characters — ready to approve`
            : `${trimmedLen} / ${minLength} non-whitespace characters required`}
        </span>
        <span className="text-text-subtle font-mono">⌘↵ submit</span>
      </div>
    </Modal>
  );
}
