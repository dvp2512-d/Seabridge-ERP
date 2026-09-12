import { AlertCircle, RefreshCw } from 'lucide-react';
import { getApiErrorMessage } from '@/lib/api';

interface ErrorStateProps {
  /** The error object from useQuery or useMutation */
  error?: unknown;
  /** Custom message to display instead of parsing the error */
  message?: string;
  /** Called when the user clicks "Try Again" */
  onRetry?: () => void;
  /** Additional CSS classes for the container */
  className?: string;
  /** Compact mode for inline/card errors vs full-page errors */
  compact?: boolean;
}

/**
 * A friendly error state with a retry button.
 *
 * Used when a query fails — shows what went wrong and lets the user try again
 * without refreshing the whole page.
 */
export function ErrorState({
  error,
  message,
  onRetry,
  className = '',
  compact = false,
}: ErrorStateProps) {
  const displayMessage = message || getApiErrorMessage(error, 'Failed to load data');

  if (compact) {
    return (
      <div className={`flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg ${className}`}>
        <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-700">{displayMessage}</p>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-md transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-16 px-4 ${className}`}>
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
        <AlertCircle className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
      <p className="text-gray-500 text-center max-w-md mb-6">{displayMessage}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 bg-navy-600 text-white rounded-lg hover:bg-navy-700 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      )}
    </div>
  );
}
