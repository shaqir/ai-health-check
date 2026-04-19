import { AlertCircle } from 'lucide-react';

export default function ErrorState({ message = 'Something went wrong', onRetry }) {
  return (
    <div className="rounded-xl bg-status-failing-muted p-6 text-center" role="alert">
      <AlertCircle size={22} strokeWidth={1.5} className="text-status-failing mx-auto mb-2.5" />
      <p className="text-sm font-medium text-text">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3.5 px-3.5 py-1.5 text-xs font-medium text-accent bg-accent-weak rounded-pill hover:bg-accent-muted transition-standard"
        >
          Try again
        </button>
      )}
    </div>
  );
}
