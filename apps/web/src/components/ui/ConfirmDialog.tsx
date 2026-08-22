import { useState } from 'react';
import Modal from './Modal';
import { AlertTriangle, Trash2, Info } from 'lucide-react';

/** Tone controls the colour and icon to visually communicate severity. */
export type ConfirmTone = 'soft' | 'warning' | 'permanent';

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** List of effects shown below the message, e.g. 'Deletes 3 payments' */
  consequences?: string[];
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  /** 'soft' = deactivate, 'warning' = caution, 'permanent' = destructive */
  tone?: ConfirmTone;
  /** Legacy prop for backwards compatibility */
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
  isPending?: boolean;
  /**
   * When set, the user must type this string exactly before the confirm button
   * enables. Used for irreversible actions like permanent deletes.
   */
  requireTyping?: string;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onCancel,
  onConfirm,
  title,
  message,
  consequences = [],
  confirmText,
  confirmLabel,
  cancelText = 'Cancel',
  tone,
  variant,
  isLoading,
  isPending,
  requireTyping,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  
  // Determine the actual close handler (support both prop names)
  const handleClose = onCancel ?? onClose ?? (() => {});
  
  // Determine the actual confirm text (support both prop names)
  const actualConfirmText = confirmLabel ?? confirmText ?? 'Confirm';
  
  // Determine loading state (support both prop names)
  const loading = isPending ?? isLoading ?? false;

  // Map tone to variant for styling, or use variant directly
  const effectiveVariant = tone
    ? tone === 'permanent' ? 'danger' : tone === 'warning' ? 'warning' : 'info'
    : variant ?? 'danger';

  const colors = {
    danger: 'bg-red-100 text-red-600',
    warning: 'bg-yellow-100 text-yellow-600',
    info: 'bg-blue-100 text-blue-600',
  };

  const buttonColors = {
    danger: 'btn-danger',
    warning: 'bg-yellow-500 text-white hover:bg-yellow-600',
    info: 'btn-primary',
  };

  const icons = {
    danger: Trash2,
    warning: AlertTriangle,
    info: Info,
  };

  const Icon = icons[effectiveVariant];

  // If requireTyping is set, the confirm button stays disabled until the user
  // types the exact string. This makes permanent deletes deliberate.
  const needsTyping = requireTyping != null && requireTyping !== '';
  const typingMatch = !needsTyping || typed === requireTyping;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="sm">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-full ${colors[effectiveVariant]}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <p className="text-gray-700">{message}</p>

            {/* Consequences list, shown when provided */}
            {consequences.length > 0 && (
              <ul className="mt-3 text-sm text-gray-600 list-disc list-inside space-y-1">
                {consequences.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}

            {/* Typing confirmation for irreversible actions */}
            {needsTyping && (
              <div className="mt-4">
                <p className="text-sm text-gray-600 mb-2">
                  Type <span className="font-mono font-semibold">{requireTyping}</span> to confirm:
                </p>
                <input
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="input w-full"
                  placeholder={requireTyping}
                  autoFocus
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={handleClose} className="btn btn-secondary" disabled={loading}>
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`btn ${buttonColors[effectiveVariant]}`}
            disabled={loading || !typingMatch}
          >
            {loading ? 'Processing...' : actualConfirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
