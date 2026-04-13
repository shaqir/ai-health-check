import { AlertCircle } from 'lucide-react';

export default function ErrorState({ message = 'Something went wrong', onRetry }) {
  return (
    <div className="bg-status-failing-muted rounded-lg border border-status-failing/20 p-6 text-center" role="alert">
      <AlertCircle size={20} strokeWidth={1.5} className="text-status-failing mx-auto mb-2" />
      <p className="text-sm font-medium text-text">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-3 px-3 py-1.5 text-xs font-medium text-accent bg-accent-muted rounded-md hover:bg-accent/20 transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
