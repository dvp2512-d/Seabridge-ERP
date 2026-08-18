import { useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import Modal from './Modal';

/**
 * Confirmation for destructive actions.
 *
 * Replaces the browser's confirm(), which cannot explain consequences and looks
 * identical whether you are hiding a product or voiding an invoice.
 *
 * Three levels of friction, matched to how reversible the action is:
 *   soft        - deactivating something that can be switched back on
 *   cancel      - voiding a numbered document, which keeps its number
 *   permanent   - the row really goes, so the user types the name to confirm
 */
export type ConfirmTone = 'soft' | 'cancel' | 'permanent';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** What will happen, in plain terms. */
  message: React.ReactNode;
  /** Shown when the action has knock-on effects worth stating. */
  consequences?: string[];
  tone?: ConfirmTone;
  /**
   * When set, the user must type this exactly. Used for permanent deletion so it
   * cannot happen from a mis-click.
   */
  requireTyping?: string;
  confirmLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE_STYLES: Record<ConfirmTone, { button: string; banner: string; icon: string }> = {
  soft: {
    button: 'btn-primary',
    banner: 'bg-blue-50 border-blue-200 text-blue-800',
    icon: 'text-blue-600',
  },
  cancel: {
    button: 'bg-amber-600 hover:bg-amber-700 text-white',
    banner: 'bg-amber-50 border-amber-200 text-amber-800',
    icon: 'text-amber-600',
  },
  permanent: {
    button: 'bg-red-600 hover:bg-red-700 text-white',
    banner: 'bg-red-50 border-red-200 text-red-800',
    icon: 'text-red-600',
  },
};

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  consequences,
  tone = 'soft',
  requireTyping,
  confirmLabel,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const styles = TONE_STYLES[tone];

  // Comparison is trimmed but case-sensitive: the point is deliberate effort,
  // not a memory test.
  const canConfirm = !requireTyping || typed.trim() === requireTyping;

  const close = () => {
    setTyped('');
    onCancel();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={title} size="md">
      <div className="space-y-4">
        <div className={`flex items-start gap-3 p-3 rounded-lg border ${styles.banner}`}>
          {tone === 'soft' ? (
            <Info className={`w-4 h-4 flex-shrink-0 mt-0.5 ${styles.icon}`} />
          ) : (
            <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${styles.icon}`} />
          )}
          <div className="text-sm">{message}</div>
        </div>

        {consequences && consequences.length > 0 && (
          <ul className="text-sm text-gray-600 space-y-1 pl-1">
            {consequences.map((c, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-400">&bull;</span>
                <span>{c}</span>
              </li>
            ))}
          </ul>
        )}

        {requireTyping && (
          <div>
            <label className="label">
              Type <span className="font-mono font-semibold">{requireTyping}</span> to confirm
            </label>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireTyping}
              autoComplete="off"
              aria-label={`Type ${requireTyping} to confirm`}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={close} className="btn btn-secondary">
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || isPending}
            className={`btn ${styles.button} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isPending ? 'Working...' : confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
