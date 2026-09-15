/**
 * Delete Record Button - Founder Only
 * 
 * A button that allows founders to permanently delete records.
 * Shows a confirmation dialog with cascade preview before deletion.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { recordsApi } from '@/lib/api';
import { refreshAggregates } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import Modal from '@/components/ui/Modal';
import { Trash2, AlertTriangle, Loader2, Info } from 'lucide-react';

interface DeleteRecordButtonProps {
  /** Resource type: quotation, order, invoice, inquiry, expense, income, task, buyer, product, supplier, cha, transporter */
  resourceType: 'quotation' | 'order' | 'invoice' | 'inquiry' | 'expense' | 'income' | 'task' | 'buyer' | 'product' | 'supplier' | 'cha' | 'transporter';
  /** Record ID to delete */
  recordId: string;
  /** Display name for the record (e.g., "Quotation Q-2024-001") */
  recordName: string;
  /** Where to navigate after successful deletion (empty string to stay on page) */
  redirectTo: string;
  /** Optional: Button size */
  size?: 'sm' | 'md';
  /** Optional: Show only icon without text */
  iconOnly?: boolean;
  /** Optional: Callback after successful deletion (instead of redirect) */
  onSuccess?: () => void;
}

export default function DeleteRecordButton({
  resourceType,
  recordId,
  recordName,
  redirectTo,
  size = 'md',
  iconOnly = false,
  onSuccess,
}: DeleteRecordButtonProps) {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Only founders can delete
  if (user?.role !== 'FOUNDER') {
    return null;
  }

  // Fetch cascade preview when modal opens
  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['record-delete-preview', resourceType, recordId],
    queryFn: () => recordsApi.preview(resourceType, recordId).then((r: any) => r.data.data),
    enabled: showConfirm,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: () => recordsApi.delete(resourceType, recordId),
    onSuccess: () => {
      toast.success(`${recordName} permanently deleted`);
      setShowConfirm(false);
      // Deleting a record changes every aggregate, so the dashboard has to be
      // refetched rather than left showing totals that include the deleted row.
      refreshAggregates(queryClient);
      if (onSuccess) {
        onSuccess();
      } else if (redirectTo) {
        navigate(redirectTo);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete record');
    },
  });

  const handleDelete = () => {
    if (confirmText !== 'DELETE') {
      toast.error('Please type DELETE to confirm');
      return;
    }
    deleteMutation.mutate();
  };

  const btnClass = iconOnly
    ? 'p-1.5 text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded transition-colors inline-flex items-center justify-center'
    : size === 'sm' 
      ? 'btn btn-sm text-red-600 hover:bg-red-50 border-red-200'
      : 'btn text-red-600 hover:bg-red-50 border-red-200';

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className={btnClass}
        title="Permanently delete this record"
        aria-label={`Delete ${recordName}`}
      >
        <Trash2 className="w-4 h-4" />
        {!iconOnly && size !== 'sm' && <span className="ml-1">Delete</span>}
      </button>

      {showConfirm && (
        <Modal
          isOpen
          onClose={() => {
            setShowConfirm(false);
            setConfirmText('');
          }}
          title="⚠️ Permanent Deletion"
          size="md"
        >
          <div className="p-6 space-y-5">
            {/* Warning Banner */}
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-red-800">
                  This action cannot be undone!
                </p>
                <p className="text-sm text-red-700 mt-1">
                  You are about to permanently delete <strong className="font-semibold">{recordName}</strong>. This will remove all data associated with this record.
                </p>
              </div>
            </div>

            {/* Cascade Preview */}
            {previewLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading preview...</span>
              </div>
            ) : preview?.cascadeDeletes && preview.cascadeDeletes.length > 0 ? (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-amber-800 text-sm">
                    The following related records will also be deleted:
                  </p>
                  <ul className="list-disc list-inside text-sm text-amber-700 mt-1 space-y-0.5">
                    {preview.cascadeDeletes.map((item: any, idx: number) => (
                      <li key={idx}>
                        {item.count} {item.label}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                No related records will be affected.
              </p>
            )}

            {/* Confirmation Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type <strong className="text-red-600 font-semibold">DELETE</strong> to confirm:
              </label>
              <input
                type="text"
                className="input w-full"
                placeholder="Type DELETE"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setConfirmText('');
                }}
                className="btn btn-secondary"
                disabled={deleteMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={confirmText !== 'DELETE' || deleteMutation.isPending}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
