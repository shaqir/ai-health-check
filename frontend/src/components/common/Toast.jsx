import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ message, type = 'info', onClose, duration = 5000 }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 200);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const config = {
    success: { icon: CheckCircle2, accent: 'bg-status-healthy', iconColor: 'text-status-healthy' },
    error: { icon: AlertCircle, accent: 'bg-status-failing', iconColor: 'text-status-failing' },
    info: { icon: Info, accent: 'bg-accent', iconColor: 'text-accent' },
  };

  const { icon: Icon, accent, iconColor } = config[type] || config.info;

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
        <p className="text-sm font-medium text-text flex-1">{message}</p>
        <button
          onClick={() => { setVisible(false); setTimeout(onClose, 200); }}
          className="p-0.5 text-text-subtle hover:text-text rounded-xs transition-standard"
          aria-label="Dismiss notification"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
