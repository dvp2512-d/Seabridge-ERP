import { Edit, Trash2, Ban, RotateCcw, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import type { Permission } from '@/lib/permissions';

/**
 * Row actions for a list.
 *
 * Exists so every section behaves identically rather than each page inventing its
 * own placement and wording. The important part is that the label matches what
 * actually happens:
 *
 *   deactivate  master data that other records still reference, so it is hidden
 *               rather than removed and can be switched back on
 *   cancel      a numbered document, which keeps its number and is marked void
 *   delete      the row genuinely goes
 *
 * A button labelled Delete that quietly deactivates is worse than no button,
 * because the user forms a wrong model of their own data.
 */
export type DestructiveKind = 'deactivate' | 'cancel' | 'delete';

interface RowActionsProps {
  /** Detail page, when the record has one. */
  viewHref?: string;
  onEdit?: () => void;
  /** Why editing is unavailable, shown as a tooltip on the disabled button. */
  editDisabledReason?: string;
  onDestructive?: () => void;
  destructiveKind?: DestructiveKind;
  /** Why the destructive action is unavailable, e.g. "invoice has payments". */
  destructiveDisabledReason?: string;
  /** Shown instead of the destructive action when a record is already inactive. */
  onReactivate?: () => void;
  /** Permission needed to edit. Defaults to allowing it. */
  editPermission?: Permission;
  /**
   * Permission needed for the destructive action. Defaults to SETTINGS_MANAGE,
   * which is founder and admin only - deactivating a product mid-quotation is
   * not something every role should be able to do.
   */
  destructivePermission?: Permission;
}

const DESTRUCTIVE_META: Record<
  DestructiveKind,
  { icon: typeof Trash2; label: string; className: string }
> = {
  deactivate: { icon: Ban, label: 'Deactivate', className: 'text-amber-600' },
  cancel: { icon: Ban, label: 'Cancel', className: 'text-amber-600' },
  delete: { icon: Trash2, label: 'Delete', className: 'text-red-600' },
};

export default function RowActions({
  viewHref,
  onEdit,
  editDisabledReason,
  onDestructive,
  destructiveKind = 'delete',
  destructiveDisabledReason,
  onReactivate,
  editPermission,
  destructivePermission = 'SETTINGS_MANAGE',
}: RowActionsProps) {
  const { user } = useAuthStore();
  const role = user?.role as any;

  const mayEdit = !editPermission || can(role, editPermission);
  const mayDestroy = can(role, destructivePermission);

  const meta = DESTRUCTIVE_META[destructiveKind];
  const DestructiveIcon = meta.icon;

  return (
    <div className="inline-flex items-center gap-1 justify-end">
      {viewHref && (
        <Link to={viewHref} className="btn btn-ghost btn-sm" title="View details">
          <Eye className="w-4 h-4" />
        </Link>
      )}

      {onEdit && mayEdit && (
        <button
          onClick={onEdit}
          disabled={!!editDisabledReason}
          className="btn btn-ghost btn-sm disabled:opacity-40 disabled:cursor-not-allowed"
          title={editDisabledReason ?? 'Edit'}
          aria-label="Edit"
        >
          <Edit className="w-4 h-4" />
        </button>
      )}

      {/* Reactivate takes the destructive slot for an already-inactive record, so
          the row never offers both. */}
      {onReactivate && mayDestroy ? (
        <button
          onClick={onReactivate}
          className="btn btn-ghost btn-sm text-green-600"
          title="Reactivate"
          aria-label="Reactivate"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      ) : (
        onDestructive &&
        mayDestroy && (
          <button
            onClick={onDestructive}
            disabled={!!destructiveDisabledReason}
            className={`btn btn-ghost btn-sm ${meta.className} disabled:opacity-40 disabled:cursor-not-allowed`}
            title={destructiveDisabledReason ?? meta.label}
            aria-label={meta.label}
          >
            <DestructiveIcon className="w-4 h-4" />
          </button>
        )
      )}
    </div>
  );
}
