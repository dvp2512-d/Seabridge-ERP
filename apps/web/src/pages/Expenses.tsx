// Expenses - costs incurred running the export business
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { expensesApi, masterApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import UnconvertedNotice from '@/components/ui/UnconvertedNotice';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { formatCurrency, formatDate } from '@/lib/utils';
import { refreshAggregates } from '@/lib/queryKeys';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Plus, Receipt, Search, Check, X, Trash2, Edit } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  FREIGHT: 'Freight',
  CHA: 'CHA / Customs',
  PACKAGING: 'Packaging',
  TRANSPORT: 'Transport',
  INSPECTION: 'Inspection',
  CERTIFICATION: 'Certification',
  TRAVEL: 'Travel',
  OFFICE: 'Office',
  BANK_CHARGES: 'Bank Charges',
  OTHER: 'Other',
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
};

/**
 * Expenses are recorded in whatever currency they were paid in, so each row
 * shows its own currency while the summary cards are converted into the base
 * currency. Mixing those two would make the numbers impossible to reconcile.
 */
export default function Expenses() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canManage = can(user?.role as any, 'FINANCE_MANAGE');
  // Deleting is founder-only and deliberately narrower than managing: recording
  // and approving an expense is routine finance work, removing one is not.
  const canDelete = can(user?.role as any, 'RECORD_DELETE');

  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  // Held while the confirmation is open, so the row is only removed once the
  // backend confirms the delete succeeded.
  const [pendingDelete, setPendingDelete] = useState<any>(null);

  const debouncedSearch = useDebouncedCallback((value: string) => setSearch(value), 350);

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', search, category, status],
    queryFn: () =>
      expensesApi
        .list({ search: search || undefined, category: category || undefined, status: status || undefined })
        .then((r) => r.data),
  });

  const expenses = data?.data ?? [];
  const summary = data?.summary;
  const baseCode = summary?.baseCurrency?.code;

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => expensesApi.setStatus(id, next),
    onSuccess: () => {
      toast.success('Status updated');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      // Totals and the dashboard read this data, so refresh them too
      refreshAggregates(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Could not update'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      toast.success('Expense deleted');
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      // Totals and the dashboard read this data, so refresh them too
      refreshAggregates(queryClient);
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Could not delete'),
  });

  return (
    <div className="space-y-6">
      <UnconvertedNotice count={summary?.unconvertedRecords ?? 0} baseCode={baseCode} />

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">
            Freight, CHA, packaging and other costs. Totals are shown in{' '}
            {baseCode ?? 'the base currency'}.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="btn btn-primary"
          >
            <Plus className="w-4 h-4" />
            Record Expense
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Total Spend"
          value={formatCurrency(summary?.totalSpend ?? 0, baseCode)}
          hint="Excludes rejected"
        />
        <SummaryCard
          label="Awaiting Approval"
          value={formatCurrency(summary?.pendingApproval ?? 0, baseCode)}
          hint={`${summary?.countByStatus?.PENDING ?? 0} pending`}
          emphasis={(summary?.countByStatus?.PENDING ?? 0) > 0}
        />
        <SummaryCard
          label="Paid"
          value={String(summary?.countByStatus?.PAID ?? 0)}
          hint="Cannot be edited or deleted"
        />
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Description, vendor, reference..."
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  debouncedSearch(e.target.value);
                }}
              />
            </div>
          </div>
          <SelectField
            label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="All categories"
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={['PENDING', 'APPROVED', 'PAID', 'REJECTED'].map((s) => ({
              value: s,
              label: s.charAt(0) + s.slice(1).toLowerCase(),
            }))}
          />
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : expenses.length === 0 ? (
            <div className="p-12 text-center">
              <Receipt className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No expenses match these filters.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Vendor</th>
                  <th className="text-right">Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((e: any) => (
                  <tr key={e.id}>
                    <td className="font-mono text-xs">{e.expenseNumber}</td>
                    <td className="text-sm">{formatDate(e.expenseDate)}</td>
                    <td className="text-sm">{CATEGORY_LABELS[e.category] ?? e.category}</td>
                    <td className="max-w-[240px] truncate" title={e.description}>
                      {e.description}
                    </td>
                    <td className="text-sm text-gray-500">{e.vendorName || '-'}</td>
                    <td className="text-right font-medium">
                      {/* Each row shows the currency it was actually paid in */}
                      {formatCurrency(e.amount, e.currency)}
                    </td>
                    <td>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          STATUS_STYLES[e.status] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {canManage && (
                        <ExpenseActions
                          expense={e}
                          canDelete={canDelete}
                          onApprove={() => setStatusMutation.mutate({ id: e.id, next: 'APPROVED' })}
                          onReject={() => setStatusMutation.mutate({ id: e.id, next: 'REJECTED' })}
                          onPay={() => setStatusMutation.mutate({ id: e.id, next: 'PAID' })}
                          onEdit={() => {
                            setEditing(e);
                            setShowForm(true);
                          }}
                          onDelete={() => setPendingDelete(e)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <ExpenseFormModal
          expense={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['expenses'] });
      // Totals and the dashboard read this data, so refresh them too
      refreshAggregates(queryClient);
            setShowForm(false);
          }}
        />
      )}

      {/* Uses the shared dialog rather than window.confirm, so the wording
          matches every other section. The row is only removed after the backend
          confirms, so a failed delete leaves the list untouched. */}
      {pendingDelete && (
        <ConfirmDialog
          isOpen
          title={`Delete ${pendingDelete.expenseNumber}?`}
          message="Are you sure you want to delete this record? This action cannot be undone."
          consequences={['It will drop out of spend totals and the dashboard']}
          tone="permanent"
          confirmLabel="Delete"
          isPending={remove.isPending}
          onConfirm={() =>
            remove.mutate(pendingDelete.id, { onSettled: () => setPendingDelete(null) })
          }
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="card">
      <div className="card-body">
        <div className="text-sm text-gray-500">{label}</div>
        <div className={`text-2xl font-bold ${emphasis ? 'text-amber-600' : 'text-navy-900'}`}>
          {value}
        </div>
        {hint && <div className="text-xs text-gray-400 mt-1">{hint}</div>}
      </div>
    </div>
  );
}

/**
 * Only the transitions the server allows are offered, so the UI cannot present
 * an action that will be rejected.
 */
function ExpenseActions({
  expense,
  canDelete,
  onApprove,
  onReject,
  onPay,
  onEdit,
  onDelete,
}: {
  expense: any;
  canDelete: boolean;
  onApprove: () => void;
  onReject: () => void;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  if (expense.status === 'PAID') {
    return <span className="text-xs text-gray-400">final</span>;
  }

  return (
    <div className="inline-flex gap-1">
      {expense.status === 'PENDING' && (
        <>
          <button onClick={onApprove} className="btn btn-ghost btn-sm text-blue-600" title="Approve">
            <Check className="w-4 h-4" />
          </button>
          <button onClick={onReject} className="btn btn-ghost btn-sm text-red-600" title="Reject">
            <X className="w-4 h-4" />
          </button>
        </>
      )}
      {expense.status === 'APPROVED' && (
        <button onClick={onPay} className="btn btn-ghost btn-sm text-green-600" title="Mark paid">
          <Check className="w-4 h-4" />
          Pay
        </button>
      )}
      <button onClick={onEdit} className="btn btn-ghost btn-sm" title="Edit">
        <Edit className="w-4 h-4" />
      </button>
      {/* Hidden for non-founders. The API also refuses, so this is presentation
          rather than the security boundary. */}
      {canDelete && (
        <button onClick={onDelete} className="btn btn-ghost btn-sm text-red-600" title="Delete">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function ExpenseFormModal({
  expense,
  onClose,
  onSaved,
}: {
  expense: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!expense;

  const { data: currenciesData } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => masterApi.getCurrencies(),
  });
  const currencies = currenciesData?.data?.data ?? [];

  const [form, setForm] = useState({
    category: expense?.category ?? 'FREIGHT',
    description: expense?.description ?? '',
    amount: expense?.amount ? String(expense.amount) : '',
    // Default to the company's own currency, since most expenses are domestic
    currency: expense?.currency ?? '',
    expenseDate: expense?.expenseDate
      ? new Date(expense.expenseDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    vendorName: expense?.vendorName ?? '',
    invoiceRef: expense?.invoiceRef ?? '',
    notes: expense?.notes ?? '',
  });

  const save = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? expensesApi.update(expense.id, payload) : expensesApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Expense updated' : 'Expense recorded');
      onSaved();
    },
    onError: (error: any) => {
      const errors = error.response?.data?.errors;
      toast.error(errors?.[0]?.message || error.response?.data?.message || 'Could not save');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!form.description.trim()) {
      toast.error('Enter a description');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }

    const payload: any = {
      category: form.category,
      description: form.description,
      amount,
      expenseDate: form.expenseDate,
      vendorName: form.vendorName || undefined,
      invoiceRef: form.invoiceRef || undefined,
      notes: form.notes || undefined,
    };
    // Currency cannot change after creation - it would invalidate the recorded
    // figure, so it is only sent when creating.
    if (!isEdit && form.currency) payload.currency = form.currency;

    save.mutate(payload);
  };

  const baseCurrency = currencies.find((c: any) => c.isBaseCurrency);

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Expense' : 'Record Expense'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Category"
            required
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FormField
            label="Date"
            required
            type="date"
            value={form.expenseDate}
            onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
          />
          <div className="col-span-2">
            <FormField
              label="Description"
              required
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Ocean freight Nhava Sheva to Jebel Ali"
            />
          </div>
          <FormField
            label="Amount"
            required
            type="number"
            step="0.01"
            min="0"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          {isEdit ? (
            <FormField
              label="Currency"
              value={form.currency}
              disabled
              hint="Currency cannot change after recording"
            />
          ) : (
            <SelectField
              label="Currency"
              value={form.currency}
              onChange={(e) => setForm({ ...form, currency: e.target.value })}
              placeholder={baseCurrency ? `${baseCurrency.code} (default)` : 'Base currency'}
              options={currencies.map((c: any) => ({
                value: c.code,
                label: `${c.code} - ${c.name}`,
              }))}
              hint="Leave blank to use the company's own currency"
            />
          )}
          <FormField
            label="Vendor"
            value={form.vendorName}
            onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
          />
          <FormField
            label="Invoice Reference"
            value={form.invoiceRef}
            onChange={(e) => setForm({ ...form, invoiceRef: e.target.value })}
          />
          <div className="col-span-2">
            <TextareaField
              label="Notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Record Expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
