import { ShieldAlert, AlertTriangle, Info } from 'lucide-react';
import Modal from './Modal';

/**
 * Generic confirm dialog — replaces window.confirm() with a styled,
 * accessible, keyboard-navigable modal matching the rest of the UI.
 *
 * Variants tint the leading icon and confirm button:
 *   - danger:   red, for destructive or risk-laden actions
 *   - warning:  amber, for caution-worthy overrides (confidential, etc.)
 *   - default:  accent blue, for neutral confirmations
 *
 * Pass `details` to render extra structured content (cost preview, etc.)
 * between the description and the action buttons.
 */
export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  busy = false,
}) {
  const variantConfig = {
    danger: {
      Icon: AlertTriangle,
      iconColor: 'text-status-failing',
      iconBg: 'bg-status-failing-muted',
      confirmBtn: 'bg-status-failing text-white hover:opacity-90',
    },
    warning: {
      Icon: ShieldAlert,
      iconColor: 'text-status-degraded',
      iconBg: 'bg-status-degraded-muted',
      confirmBtn: 'bg-status-degraded text-white hover:opacity-90',
    },
    default: {
      Icon: Info,
      iconColor: 'text-accent',
      iconBg: 'bg-accent-weak',
      confirmBtn: 'bg-accent text-white hover:bg-accent-hover',
    },
  };
  const v = variantConfig[variant] || variantConfig.default;
  const Icon = v.Icon;

  return (
    <Modal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={title}
      maxWidth="max-w-md"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-1.5 text-[12px] font-medium text-text-muted hover:text-text hover:bg-surface-elevated rounded-pill transition-standard disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-1.5 text-[12px] font-medium rounded-pill transition-standard disabled:opacity-50 ${v.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 shrink-0 rounded-lg ${v.iconBg} flex items-center justify-center`}>
          <Icon size={18} strokeWidth={1.75} className={v.iconColor} />
        </div>
        <div className="flex-1 min-w-0 space-y-3">
          {description && (
            <p className="text-sm text-text leading-relaxed">{description}</p>
          )}
          {details && <div>{details}</div>}
        </div>
      </div>
    </Modal>
  );
}
