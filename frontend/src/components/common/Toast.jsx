import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ message, type = 'info', onClose, duration = 5000 }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 150);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const config = {
    success: { icon: CheckCircle2, classes: 'bg-status-healthy-muted border-status-healthy text-status-healthy' },
    error: { icon: AlertCircle, classes: 'bg-status-failing-muted border-status-failing text-status-failing' },
    info: { icon: Info, classes: 'bg-accent-muted border-accent text-accent' },
  };

  const { icon: Icon, classes } = config[type] || config.info;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`fixed bottom-4 right-4 z-50 max-w-sm w-full border rounded-lg shadow-md p-3 flex items-start gap-3 transition-all duration-150 ${classes} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <Icon size={16} strokeWidth={1.5} className="shrink-0 mt-0.5" />
      <p className="text-sm font-medium text-text flex-1">{message}</p>
      <button
        onClick={() => { setVisible(false); setTimeout(onClose, 150); }}
        className="p-0.5 text-text-subtle hover:text-text rounded-sm transition-colors"
        aria-label="Dismiss notification"
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  );
}
