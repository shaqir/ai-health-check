import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

// Per-type default auto-dismiss. Errors persist until the user clicks
// the close button — a 402/429/safety-block message needs to stay long
// enough to read. Success + info keep the 5s auto-dismiss so happy
// toasts don't pile up. Callers can still override with an explicit
// `duration` prop if they want different behaviour.
const DEFAULT_DURATION_MS = { success: 5000, info: 5000, error: 0 };

export default function Toast({ message, type = 'info', onClose, duration }) {
  const [visible, setVisible] = useState(true);
  const resolvedDuration = duration ?? DEFAULT_DURATION_MS[type] ?? 5000;
  const isPersistent = resolvedDuration <= 0;

  useEffect(() => {
    if (isPersistent) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, resolvedDuration);
    return () => clearTimeout(timer);
  }, [resolvedDuration, isPersistent, onClose]);

  const config = {
    success: { icon: CheckCircle2, accent: 'bg-status-healthy', iconColor: 'text-status-healthy' },
    error: { icon: AlertCircle, accent: 'bg-status-failing', iconColor: 'text-status-failing' },
    info: { icon: Info, accent: 'bg-accent', iconColor: 'text-accent' },
  };

  const { icon: Icon, accent, iconColor } = config[type] || config.info;

  const handleDismiss = () => { setVisible(false); setTimeout(onClose, 200); };

  // Error close button gets higher contrast + visible hover background
  // so long error messages never leave the user hunting for an X.
  const dismissClasses = type === 'error'
    ? 'shrink-0 p-1.5 -mr-1 -mt-1 rounded-md text-status-failing hover:bg-status-failing/10 focus:outline-none focus:ring-2 focus:ring-status-failing/40 transition-standard'
    : 'shrink-0 p-1 -mr-0.5 -mt-0.5 rounded-md text-text-subtle hover:text-text hover:bg-hairline/50 focus:outline-none focus:ring-2 focus:ring-hairline transition-standard';

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed bottom-4 right-4 z-50 max-w-sm w-full rounded-xl border border-hairline bg-[var(--material-thick)] backdrop-blur-material backdrop-saturate-material shadow-lg overflow-hidden transition-spring ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <div className="relative flex items-start gap-3 p-3.5 pl-4">
        <span aria-hidden="true" className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-pill ${accent}`} />
        <Icon size={16} strokeWidth={1.75} className={`shrink-0 mt-0.5 ${iconColor}`} />
        <div className="text-sm font-medium text-text flex-1 max-h-40 overflow-y-auto break-words pr-1">
          {message}
        </div>
        <button
          onClick={handleDismiss}
          className={dismissClasses}
          aria-label="Dismiss notification"
          title={isPersistent ? 'Dismiss (this notification stays until you close it)' : 'Dismiss'}
        >
          <X size={type === 'error' ? 16 : 14} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
