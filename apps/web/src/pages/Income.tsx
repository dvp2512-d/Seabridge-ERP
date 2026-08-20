// Other Income - receipts that do not arrive through an export invoice
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { incomeApi, invoicesApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import Modal from '@/components/ui/Modal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { refreshAggregates } from '@/lib/queryKeys';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { Plus, TrendingUp, Search, Check, Trash2, Edit, Info, Link2 } from 'lucide-react';

const CATEGORY_LABELS: Record<string, string> = {
  DUTY_DRAWBACK: 'Duty Drawback',
  RODTEP_MEIS: 'RoDTEP / MEIS',
  INTEREST: 'Interest',
  FOREX_GAIN: 'Forex Gain',
  COMMISSION: 'Commission',
  SCRAP_SALES: 'Scrap / By-product Sales',
  SAMPLE_CHARGES: 'Sample Charges Recovered',
  OTHER: 'Other',
};

/** Categories that realistically arrive in foreign currency. */
const FOREIGN_CURRENCY_LIKELY = ['INTEREST', 'COMMISSION'];

const STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  RECEIVED: 'bg-green-100 text-green-800',
};

/**
 * Every figure in the summary is in rupees, because that is the only way a mixed
 * currency set can be added up. Individual rows show both what was received and
 * what it converted to, so the rate applied is never hidden.
 */
export default function Income() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canManage = can(user?.role as any, 'FINANCE_MANAGE');
  const canDelete = can(user?.role as any, 'RECORD_DELETE');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [pendingDelete, setPendingDelete] = useState<any>(null);

  const debouncedSearch = useDebouncedCallback((v: string) => setSearch(v), 350);

  const { data, isLoading } = useQuery({
    queryKey: ['income', search, category, status],
    queryFn: () =>
      incomeApi
        .list({
          search: search || undefined,
          category: category || undefined,
          status: status || undefined,
        })
        .then((r) => r.data),
  });

  const entries = data?.data ?? [];
  const summary = data?.summary;

  const setStatusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) => incomeApi.setStatus(id, next),
    onSuccess: () => {
      toast.success('Status updated');
      queryClient.invalidateQueries({ queryKey: ['income'] });
      refreshAggregates(queryClient);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not update'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => incomeApi.remove(id),
    onSuccess: () => {
      toast.success('Income entry deleted');
      queryClient.invalidateQueries({ queryKey: ['income'] });
      refreshAggregates(queryClient);
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Could not delete'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Other Income</h1>
          <p className="text-sm text-gray-500 mt-1">
            Drawback, RoDTEP, interest, forex gain and other receipts outside export
            sales. Totals are in INR.
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
            Record Income
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard
          label="Received"
          value={formatCurrency(summary?.totalReceived ?? 0, 'INR')}
          hint={`${summary?.countByStatus?.RECEIVED ?? 0} entries`}
        />
        <SummaryCard
          label="Pending"
          value={formatCurrency(summary?.totalPending ?? 0, 'INR')}
          hint={`${summary?.countByStatus?.PENDING ?? 0} awaiting receipt`}
          emphasis={(summary?.countByStatus?.PENDING ?? 0) > 0}
        />
        <SummaryCard
          label="Total"
          value={formatCurrency(summary?.totalAll ?? 0, 'INR')}
          hint="Separate from export revenue"
        />
      </div>

      {(summary?.byCategory?.length ?? 0) > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="font-semibold">By category</h2>
          </div>
          <div className="card-body">
            <div className="space-y-2">
              {summary.byCategory.map((c: any) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">
                    {CATEGORY_LABELS[c.category] ?? c.category}
                    <span className="text-gray-400 ml-2">({c.count})</span>
                  </span>
                  <span className="font-medium">{formatCurrency(c.amountINR, 'INR')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-body flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="label">Search</label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="input pl-9"
                placeholder="Description, reference, number..."
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
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'RECEIVED', label: 'Received' },
            ]}
          />
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-12 text-center">
              <TrendingUp className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No income entries match these filters.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Date</th>
                  <th>Category</th>
                  <th>Description</th>
                  {/* Both figures side by side, so the conversion applied is always
                      visible rather than implied. */}
                  <th className="text-right">Received</th>
                  <th className="text-right">Rate</th>
                  <th className="text-right">Amount (INR)</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e: any) => {
                  const isForeign = e.originalCurrency !== 'INR';
                  return (
                    <tr key={e.id}>
                      <td className="font-mono text-xs">{e.incomeNumber}</td>
                      <td className="text-sm">{formatDate(e.receivedDate)}</td>
                      <td className="text-sm">
                        {CATEGORY_LABELS[e.category] ?? e.category}
                        {e.linkedInvoice && (
                          <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <Link2 className="w-3 h-3" />
                            {e.linkedInvoice.invoiceNumber}
                          </div>
                        )}
                      </td>
                      <td className="max-w-[220px] truncate" title={e.description}>
                        {e.description}
                        {e.reference && (
                          <div className="text-xs text-gray-400">{e.reference}</div>
                        )}
                      </td>
                      <td className="text-right text-sm">
                        {Number(e.originalAmount).toLocaleString('en-IN', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className={isForeign ? 'text-amber-700 font-medium' : 'text-gray-400'}>
                          {e.originalCurrency}
                        </span>
                      </td>
                      <td className="text-right text-sm text-gray-500">
                        {isForeign ? Number(e.exchangeRate).toFixed(4) : '-'}
                      </td>
                      <td className="text-right font-medium">
                        {formatCurrency(e.amountINR, 'INR')}
                      </td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[e.status] ?? 'bg-gray-100'
                          }`}
                        >
                          {e.status}
                        </span>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {canManage && (
                          <>
                            {e.status === 'PENDING' && (
                              <button
                                onClick={() =>
                                  setStatusMutation.mutate({ id: e.id, next: 'RECEIVED' })
                                }
                                className="btn btn-ghost btn-sm text-green-600"
                                title="Mark received"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setEditing(e);
                                setShowForm(true);
                              }}
                              className="btn btn-ghost btn-sm"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => setPendingDelete(e)}
                            className="btn btn-ghost btn-sm text-red-600"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showForm && (
        <IncomeFormModal
          entry={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['income'] });
            refreshAggregates(queryClient);
            setShowForm(false);
          }}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          isOpen
          title={`Delete ${pendingDelete.incomeNumber}?`}
          message="Are you sure you want to delete this record? This action cannot be undone."
          consequences={[
            `${formatCurrency(pendingDelete.amountINR, 'INR')} will drop out of Other Income totals`,
          ]}
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

function IncomeFormModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!entry;

  const { data: options } = useQuery({
    queryKey: ['income-options'],
    queryFn: () => incomeApi.options().then((r) => r.data.data),
  });
  const currencies = options?.currencies ?? [];
  const baseCode = currencies.find((c: any) => c.isBaseCurrency)?.code ?? 'INR';

  const [form, setForm] = useState({
    category: entry?.category ?? 'DUTY_DRAWBACK',
    description: entry?.description ?? '',
    originalAmount: entry?.originalAmount ? String(entry.originalAmount) : '',
    originalCurrency: entry?.originalCurrency ?? 'INR',
    exchangeRate: entry?.exchangeRate ? String(entry.exchangeRate) : '1.0000',
    receivedDate: entry?.receivedDate
      ? new Date(entry.receivedDate).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    reference: entry?.reference ?? '',
    linkedInvoiceId: entry?.linkedInvoiceId ?? '',
    status: entry?.status ?? 'PENDING',
    notes: entry?.notes ?? '',
  });

  const isBase = form.originalCurrency === baseCode;
  const isForexGain = form.category === 'FOREX_GAIN';

  // The base currency needs no conversion, so the rate is pinned rather than left
  // for someone to type a wrong value into.
  useEffect(() => {
    if (isBase && form.exchangeRate !== '1.0000') {
      setForm((f) => ({ ...f, exchangeRate: '1.0000' }));
    }
  }, [isBase, form.exchangeRate]);

  // Invoices with a rate recorded, for the forex gain picker.
  const { data: invoicesData } = useQuery({
    queryKey: ['invoices-for-forex'],
    queryFn: () => invoicesApi.list({ limit: 100 }).then((r) => r.data.data),
    enabled: isForexGain,
  });
  const invoices = invoicesData ?? [];

  // Suggested gain from the booked and realised rates on the chosen invoice.
  const { data: forexSuggestion, isFetching: loadingForex } = useQuery({
    queryKey: ['forex-gain', form.linkedInvoiceId],
    queryFn: () => incomeApi.forexGain(form.linkedInvoiceId).then((r) => r.data.data),
    enabled: isForexGain && !!form.linkedInvoiceId,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? incomeApi.update(entry.id, payload) : incomeApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Income updated' : 'Income recorded');
      onSaved();
    },
    onError: (error: any) => {
      const errors = error.response?.data?.errors;
      toast.error(errors?.[0]?.message || error.response?.data?.message || 'Could not save');
    },
  });

  const amount = parseFloat(form.originalAmount);
  const rate = parseFloat(form.exchangeRate);
  const previewINR =
    Number.isFinite(amount) && Number.isFinite(rate) ? Math.round(amount * rate * 100) / 100 : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.description.trim()) {
      toast.error('Enter a description');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount greater than zero');
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Enter an exchange rate greater than zero');
      return;
    }
    if (isForexGain && !form.linkedInvoiceId) {
      toast.error('Choose the invoice this forex gain arose from');
      return;
    }

    save.mutate({
      category: form.category,
      description: form.description,
      originalAmount: amount,
      // Currency cannot change after creation; the recorded conversion would no
      // longer describe what happened.
      ...(isEdit ? {} : { originalCurrency: form.originalCurrency }),
      exchangeRate: rate,
      receivedDate: form.receivedDate,
      reference: form.reference || undefined,
      ...(isEdit ? {} : { linkedInvoiceId: form.linkedInvoiceId || undefined }),
      status: form.status,
      notes: form.notes || undefined,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Income' : 'Record Income'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Category"
            required
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
            hint={
              FOREIGN_CURRENCY_LIKELY.includes(form.category)
                ? 'May arrive in foreign currency'
                : undefined
            }
          />
          <FormField
            label="Date"
            required
            type="date"
            value={form.receivedDate}
            onChange={(e) => setForm({ ...form, receivedDate: e.target.value })}
          />
        </div>

        {isForexGain && (
          <div className="space-y-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="flex items-start gap-2 text-sm text-blue-800">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                A forex gain must be traceable to the invoice it came from, so it
                reconciles with the books rather than floating free.
              </span>
            </div>
            <SelectField
              label="Invoice"
              required
              value={form.linkedInvoiceId}
              onChange={(e) => setForm({ ...form, linkedInvoiceId: e.target.value })}
              disabled={isEdit}
              placeholder="Choose the originating invoice"
              options={invoices.map((i: any) => ({
                value: i.id,
                label: `${i.invoiceNumber} - ${i.buyer?.companyName ?? ''}`,
              }))}
              hint={isEdit ? 'The link cannot be changed after recording' : undefined}
            />
            {loadingForex && <p className="text-xs text-gray-500">Calculating...</p>}
            {forexSuggestion && (
              <div className="text-sm bg-white rounded p-2 space-y-1">
                <div className="text-xs text-gray-500">{forexSuggestion.formula}</div>
                {forexSuggestion.breakdown.map((b: any) => (
                  <div key={b.paymentId} className="flex justify-between text-xs">
                    <span className="text-gray-600">
                      {formatDate(b.paymentDate)}: ({b.realisedRate} &minus; {b.bookedRate}) &times;{' '}
                      {b.amount}
                    </span>
                    <span className={b.gainINR < 0 ? 'text-red-600' : 'text-green-700'}>
                      {formatCurrency(b.gainINR, 'INR')}
                    </span>
                  </div>
                ))}
                <div className="flex justify-between font-medium pt-1 border-t">
                  <span>{forexSuggestion.isLoss ? 'Total loss' : 'Total gain'}</span>
                  <span>{formatCurrency(forexSuggestion.totalGainINR, 'INR')}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setForm({
                      ...form,
                      // Already in rupees, so it is entered at parity rather than
                      // converted a second time.
                      originalAmount: String(Math.abs(forexSuggestion.totalGainINR)),
                      originalCurrency: baseCode,
                      exchangeRate: '1.0000',
                      reference: `${forexSuggestion.invoiceNumber} forex ${
                        forexSuggestion.isLoss ? 'loss' : 'gain'
                      }`,
                    })
                  }
                  className="btn btn-secondary btn-sm w-full mt-1"
                >
                  Use this figure
                </button>
                {forexSuggestion.isLoss && (
                  <p className="text-xs text-red-700">
                    This is a loss, not a gain. Recording it here would overstate income
                    &mdash; book it as an expense instead.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <FormField
          label="Description"
          required
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="e.g. Duty drawback on shipping bill 1234567"
        />

        <div className="grid grid-cols-3 gap-4">
          <FormField
            label="Original Amount"
            required
            type="number"
            step="0.01"
            min="0"
            value={form.originalAmount}
            onChange={(e) => setForm({ ...form, originalAmount: e.target.value })}
          />
          {isEdit ? (
            <FormField
              label="Currency"
              value={form.originalCurrency}
              disabled
              hint="Cannot change after recording"
            />
          ) : (
            <SelectField
              label="Currency"
              value={form.originalCurrency}
              onChange={(e) => setForm({ ...form, originalCurrency: e.target.value })}
              options={currencies.map((c: any) => ({
                value: c.code,
                label: `${c.code} - ${c.name}`,
              }))}
            />
          )}
          <FormField
            label={`Exchange Rate (${baseCode} per unit)`}
            required
            type="number"
            step="0.0001"
            min="0"
            value={form.exchangeRate}
            onChange={(e) => setForm({ ...form, exchangeRate: e.target.value })}
            disabled={isBase}
            hint={isBase ? `${baseCode} needs no conversion` : 'Enter the rate you actually got'}
          />
        </div>

        {/* Shown before saving so the stored figure is never a surprise. */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50 text-sm">
          <span className="text-gray-600">
            Will be recorded as{' '}
            {isBase ? '' : `${form.originalAmount || 0} ${form.originalCurrency} x ${form.exchangeRate} = `}
          </span>
          <span className="font-bold text-navy-900">{formatCurrency(previewINR, 'INR')}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Reference"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Scrip no., shipping bill, payment ref"
          />
          <SelectField
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'RECEIVED', label: 'Received' },
            ]}
          />
        </div>

        <TextareaField
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Record Income'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
