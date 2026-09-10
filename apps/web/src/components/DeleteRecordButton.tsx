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
import { Trash2, AlertTriangle, Loader2 } from 'lucide-react';

interface DeleteRecordButtonProps {
  /** Resource type: quotation, order, invoice, inquiry, expense, income, task */
  resourceType: 'quotation' | 'order' | 'invoice' | 'inquiry' | 'expense' | 'income' | 'task';
  /** Record ID to delete */
  recordId: string;
  /** Display name for the record (e.g., "Quotation Q-2024-001") */
  recordName: string;
  /** Where to navigate after successful deletion */
  redirectTo: string;
  /** Optional: Button size */
  size?: 'sm' | 'md';
}

export default function DeleteRecordButton({
  resourceType,
  recordId,
  recordName,
  redirectTo,
  size = 'md',
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
      navigate(redirectTo);
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

  const btnClass = size === 'sm' 
    ? 'btn btn-sm text-red-600 hover:bg-red-50 border-red-200'
    : 'btn text-red-600 hover:bg-red-50 border-red-200';

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className={btnClass}
        title="Permanently delete this record"
      >
        <Trash2 className={size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'} />
        {size !== 'sm' && <span className="ml-1">Delete</span>}
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
          <div className="space-y-4">
            {/* Warning Banner */}
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
              <AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-red-800">
                  This action cannot be undone!
                </p>
                <p className="text-sm text-red-700 mt-1">
                  You are about to permanently delete <strong>{recordName}</strong>.
                  This will remove all data associated with this record.
                </p>
              </div>
            </div>

            {/* Cascade Preview */}
            {previewLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                <span className="ml-2 text-gray-500">Loading preview...</span>
              </div>
            ) : preview?.cascadeDeletes && preview.cascadeDeletes.length > 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="font-medium text-amber-800 mb-2">
                  The following related records will also be deleted:
                </p>
                <ul className="list-disc list-inside text-sm text-amber-700 space-y-1">
                  {preview.cascadeDeletes.map((item: any, idx: number) => (
                    <li key={idx}>
                      {item.count} {item.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No related records will be affected.
              </p>
            )}

            {/* Confirmation Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Type <strong className="text-red-600">DELETE</strong> to confirm:
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
            <div className="flex justify-end gap-3 pt-2">
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
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Permanently
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
