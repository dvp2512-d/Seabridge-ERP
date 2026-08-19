import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { lifecycleApi } from '@/lib/api';
import { DEPENDENT_QUERY_KEYS } from '@/lib/queryKeys';
import type { ConfirmTone } from '@/components/ui/ConfirmDialog';

/**
 * The deactivate / reactivate / cancel flow, in one place.
 *
 * Every list needs the same sequence: ask what the action will affect, show a
 * confirmation stating the consequences, perform it, then refresh. Repeating that
 * across a dozen pages guarantees they drift apart, so it lives here.
 *
 * Deactivation fetches a preview first, so the dialog can say "this appears on 4
 * quotations" before the user commits rather than reporting it afterwards.
 */
export type LifecycleAction =
  | { kind: 'deactivate'; resource: string }
  | { kind: 'reactivate'; resource: string }
  /**
   * Permanent deletion of a business record. Cascades through orders, invoices
   * and payments where the database requires it, so the confirmation lists what
   * will be destroyed before the user commits.
   */
  | { kind: 'delete'; resource: 'inquiries' | 'quotations' | 'orders' | 'invoices' | 'expenses' }
  | { kind: 'reactivateUser' };

interface PendingAction {
  action: LifecycleAction;
  id: string;
  /** Shown in the dialog, e.g. "INV-00042" or "Basmati Rice" */
  label: string;
}

export function useLifecycleActions(queryKeys: string[]) {
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [consequences, setConsequences] = useState<string[]>([]);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  /**
   * Refresh after a change.
   *
   * The dashboard and finance queries are always invalidated alongside the page's
   * own list, because deleting an invoice or an expense changes revenue and
   * receivables. Without this the totals stay on the previously fetched values
   * until the page is reloaded.
   *
   * This only marks the existing queries stale so they refetch - no total is
   * calculated here. The existing dashboard formulas run again against the new
   * data and produce the new figure themselves.
   */
  const refresh = () => {
    for (const key of queryKeys) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
    for (const key of DEPENDENT_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };

  /** Open the confirmation, fetching the impact preview when relevant. */
  const request = async (action: LifecycleAction, id: string, label: string) => {
    setPending({ action, id, label });
    setConsequences([]);
    setBlocked(null);

    if (action.kind === 'deactivate') {
      setLoadingPreview(true);
      try {
        const res = await lifecycleApi.preview(action.resource, id);
        const data = res.data.data;
        setBlocked(data.blocked ?? null);
        setConsequences(
          (data.dependents ?? []).map((d: any) => `Stays on ${d.count} ${d.label}`)
        );
      } catch {
        // The preview is advisory; failing to load it must not block the action.
        setConsequences([]);
      } finally {
        setLoadingPreview(false);
      }
      return;
    }

    if (action.kind === 'delete') {
      setLoadingPreview(true);
      try {
        const res = await lifecycleApi.previewDelete(action.resource, id);
        const data = res.data.data;
        setBlocked(data.blocked ?? null);
        // Spell out exactly what disappears, including money, because these
        // deletions are irreversible and change reported figures.
        setConsequences(
          (data.impacts ?? []).map((i: any) => {
            const money =
              i.amount != null
                ? ` totalling ${i.currency ? i.currency + ' ' : ''}${Number(i.amount).toLocaleString()}`
                : '';
            return `${i.count} ${i.label}${money}`;
          })
        );
      } catch {
        setConsequences([]);
      } finally {
        setLoadingPreview(false);
      }
    }
  };

  const perform = useMutation({
    mutationFn: async ({ action, id }: PendingAction) => {
      switch (action.kind) {
        case 'deactivate':
          return lifecycleApi.deactivate(action.resource, id);
        case 'reactivate':
          return lifecycleApi.reactivate(action.resource, id);
        case 'delete':
          return lifecycleApi.deleteRecord(action.resource, id);
        case 'reactivateUser':
          return lifecycleApi.reactivateUser(id);
      }
    },
    onSuccess: (res: any) => {
      // Prefer the server's wording: it knows what actually happened, including
      // which dependents were left untouched.
      toast.success(res?.data?.message ?? 'Done');
      refresh();
      setPending(null);
    },
    onError: (error: any) => {
      // These failures are usually a deliberate guard rather than a fault, so the
      // reason matters and should not be flattened to "something went wrong".
      toast.error(error.response?.data?.message || 'Could not complete that action');
    },
  });

  /** Everything the dialog needs, derived from the pending action. */
  const dialog = pending ? buildDialog(pending, consequences, blocked, loadingPreview) : null;

  return {
    request,
    pending,
    dialog,
    consequences,
    blocked,
    isPending: perform.isPending,
    confirm: () => pending && !blocked && perform.mutate(pending),
    dismiss: () => setPending(null),
  };
}

function buildDialog(
  pending: PendingAction,
  consequences: string[],
  blocked: string | null,
  loadingPreview: boolean
): {
  title: string;
  message: string;
  tone: ConfirmTone;
  confirmLabel: string;
  requireTyping?: string;
  consequences: string[];
} {
  const { action, label } = pending;

  if (blocked) {
    return {
      title: 'Not possible',
      message: blocked,
      tone: 'permanent',
      confirmLabel: 'Cannot continue',
      consequences: [],
    };
  }

  switch (action.kind) {
    case 'deactivate':
      return {
        title: `Deactivate ${label}?`,
        message: loadingPreview
          ? 'Checking what this is attached to...'
          : 'It will be hidden from new records but stays on everything that already uses it. You can switch it back on later.',
        tone: 'soft',
        confirmLabel: 'Deactivate',
        consequences,
      };

    case 'reactivate':
    case 'reactivateUser':
      return {
        title: `Reactivate ${label}?`,
        message: 'It becomes available for new records again.',
        tone: 'soft',
        confirmLabel: 'Reactivate',
        consequences: [],
      };

    case 'delete':
      return {
        title: `Delete ${label}?`,
        message: loadingPreview
          ? 'Checking what this will remove...'
          : 'Are you sure you want to delete this record? This action cannot be undone.',
        tone: 'permanent',
        confirmLabel: 'Delete permanently',
        // Typing the record number makes an irreversible action deliberate. These
        // deletions remove payments and change reported revenue, so a mis-click
        // must not be enough.
        requireTyping: label,
        consequences,
      };
  }
}
