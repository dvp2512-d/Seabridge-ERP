// Exchange Rates - CBIC notified rates used for customs valuation
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { exchangeRatesApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatDate } from '@/lib/utils';
import { AlertTriangle, Plus, Info } from 'lucide-react';

/**
 * CBIC notifies rates for 22 currencies twice a month, effective from midnight
 * of the following day, with separate import and export rates. There is no
 * reliable machine-readable feed, so rates are entered from the notification.
 */
export default function ExchangeRates() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canEdit = can(user?.role as any, 'MASTER_MANAGE');

  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));
  const [direction, setDirection] = useState<'EXPORT' | 'IMPORT'>('EXPORT');
  const [showEntry, setShowEntry] = useState(false);
  const [historyFor, setHistoryFor] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['exchange-rates', asOf, direction],
    queryFn: () => exchangeRatesApi.current({ date: asOf, direction }).then((r: any) => r.data.data),
  });

  const rates = data?.rates ?? [];
  const baseCode = data?.baseCurrency?.code ?? '';
  const missingCount = data?.missingCount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Exchange Rates</h1>
          <p className="text-sm text-gray-500 mt-1">
            Notified rates used to value export documents and to convert totals into{' '}
            <strong>{baseCode || 'the base currency'}</strong>.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => setShowEntry(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" />
            Enter Notification
          </button>
        )}
      </div>

      {/* Rates are meaningless without knowing which date and direction */}
      <div className="card">
        <div className="card-body flex flex-wrap gap-4 items-end">
          <FormField
            label="Rates in force on"
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            hint="Customs values a shipping bill using the rate in force on its date"
          />
          <SelectField
            label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as any)}
            options={[
              { value: 'EXPORT', label: 'Export (applies to our shipping bills)' },
              { value: 'IMPORT', label: 'Import' },
            ]}
          />
        </div>
      </div>

      {missingCount > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <strong>
              {missingCount} {missingCount === 1 ? 'currency has' : 'currencies have'} no rate for
              this date.
            </strong>{' '}
            Documents in those currencies cannot be valued, and totals that include them will be
            reported as incomplete rather than shown as a smaller number.
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold">
            Rates as at {formatDate(asOf)} &middot; {direction === 'EXPORT' ? 'Export' : 'Import'}
          </h2>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Currency</th>
                  <th className="text-right">Notified Rate</th>
                  <th>Effective From</th>
                  <th>Age</th>
                  <th>Notification</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r: any) => (
                  <RateRow
                    key={r.currencyId}
                    rate={r}
                    baseCode={baseCode}
                    onHistory={() => setHistoryFor(r)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showEntry && (
        <NotificationModal
          currencies={rates.filter((r: any) => !r.isBaseCurrency)}
          baseCode={baseCode}
          onClose={() => setShowEntry(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
            setShowEntry(false);
          }}
        />
      )}

      {historyFor && (
        <HistoryModal
          currency={historyFor}
          baseCode={baseCode}
          canEdit={canEdit}
          onClose={() => setHistoryFor(null)}
        />
      )}
    </div>
  );
}

/** One currency's current position. */
function RateRow({
  rate,
  baseCode,
  onHistory,
}: {
  rate: any;
  baseCode: string;
  onHistory: () => void;
}) {
  if (rate.isBaseCurrency) {
    return (
      <tr className="bg-gray-50">
        <td>
          <span className="font-medium">{rate.code}</span>{' '}
          <span className="text-gray-500">{rate.name}</span>
        </td>
        <td colSpan={5} className="text-sm text-gray-500">
          Base currency &mdash; all totals are expressed in {rate.code}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>
        <span className="font-medium">{rate.code}</span>{' '}
        <span className="text-gray-500 text-sm">{rate.name}</span>
      </td>
      <td className="text-right font-medium">
        {rate.rate !== null ? (
          `${rate.rate.toFixed(4)} ${baseCode}`
        ) : (
          <span className="text-amber-600">not set</span>
        )}
      </td>
      <td className="text-sm">{rate.effectiveFrom ? formatDate(rate.effectiveFrom) : '-'}</td>
      <td className="text-sm">
        {rate.ageInDays === null ? (
          '-'
        ) : rate.ageInDays > 21 ? (
          // CBIC notifies fortnightly, so anything older than three weeks has
          // almost certainly been superseded
          <span className="text-amber-700">{rate.ageInDays}d &mdash; likely superseded</span>
        ) : (
          <span className="text-gray-500">{rate.ageInDays}d</span>
        )}
      </td>
      <td className="text-xs text-gray-500 max-w-[180px] truncate" title={rate.notificationRef ?? ''}>
        {rate.notificationRef ?? '-'}
      </td>
      <td className="text-right">
        <button onClick={onHistory} className="btn btn-ghost btn-sm">
          History
        </button>
      </td>
    </tr>
  );
}

/** Enter one notification: an effective date plus a rate per currency. */
function NotificationModal({
  currencies,
  baseCode,
  onClose,
  onSaved,
}: {
  currencies: any[];
  baseCode: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notificationRef, setNotificationRef] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState('CBIC');
  const [notes, setNotes] = useState('');
  const [entries, setEntries] = useState<Record<string, { importRate: string; exportRate: string }>>(
    {}
  );

  const save = useMutation({
    mutationFn: (payload: any) => exchangeRatesApi.createNotification(payload),
    onSuccess: (res: any) => {
      toast.success(`Recorded ${res.data.data.currencyCount} rates`);
      onSaved();
    },
    onError: (error: any) => {
      const errors = error.response?.data?.errors;
      toast.error(errors?.[0]?.message || error.response?.data?.message || 'Could not save');
    },
  });

  const set = (currencyId: string, field: 'importRate' | 'exportRate', value: string) =>
    setEntries((prev) => {
      const existing = prev[currencyId] ?? { importRate: '', exportRate: '' };
      return { ...prev, [currencyId]: { ...existing, [field]: value } };
    });

  /** Only currencies where both rates were typed are submitted. */
  const filled = useMemo(
    () =>
      Object.entries(entries)
        .filter(([, v]) => v.importRate && v.exportRate)
        .map(([currencyId, v]) => ({
          currencyId,
          importRate: parseFloat(v.importRate),
          exportRate: parseFloat(v.exportRate),
        })),
    [entries]
  );

  // Catch swapped columns before the server does, since it is the most likely
  // data-entry mistake and would undervalue every shipping bill in the period.
  const inverted = filled.filter((f) => f.exportRate > f.importRate);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notificationRef.trim()) {
      toast.error('Enter the notification reference');
      return;
    }
    if (filled.length === 0) {
      toast.error('Enter both an import and an export rate for at least one currency');
      return;
    }
    if (inverted.length > 0) {
      toast.error('Export rate cannot exceed the import rate - check the columns');
      return;
    }
    save.mutate({ notificationRef, effectiveFrom, source, notes: notes || undefined, rates: filled });
  };

  return (
    <Modal isOpen onClose={onClose} title="Enter Exchange Rate Notification" size="xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
          <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            Rates are in {baseCode} per one unit of the foreign currency. CBIC notifies the import
            rate higher than the export rate. Entering this closes off the previous period
            automatically.
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <FormField
            label="Notification Reference"
            required
            value={notificationRef}
            onChange={(e) => setNotificationRef(e.target.value)}
            placeholder="e.g. 55/2026-Customs (N.T.)"
          />
          <FormField
            label="Effective From"
            required
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            hint="Midnight of the day after notification"
          />
          <SelectField
            label="Source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            options={[
              { value: 'CBIC', label: 'CBIC (customs)' },
              { value: 'RBI', label: 'RBI reference' },
              { value: 'MARKET', label: 'Market' },
              { value: 'MANUAL', label: 'Manual' },
            ]}
          />
        </div>

        {inverted.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 text-red-800 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              Export rate is above the import rate for{' '}
              {inverted
                .map((i) => currencies.find((c) => c.currencyId === i.currencyId)?.code)
                .join(', ')}
              . The columns are probably swapped.
            </span>
          </div>
        )}

        <div className="overflow-x-auto max-h-[45vh] border rounded-lg">
          <table className="table">
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                <th>Currency</th>
                <th className="text-right">Import Rate</th>
                <th className="text-right">Export Rate</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c: any) => {
                return (
                  <tr key={c.currencyId}>
                    <td>
                      <span className="font-medium">{c.code}</span>{' '}
                      <span className="text-gray-500 text-sm">{c.name}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="input text-right w-28"
                        value={entries[c.currencyId]?.importRate ?? ''}
                        onChange={(e) => set(c.currencyId, 'importRate', e.target.value)}
                        aria-label={`${c.code} import rate`}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        className="input text-right w-28"
                        value={entries[c.currencyId]?.exportRate ?? ''}
                        onChange={(e) => set(c.currencyId, 'exportRate', e.target.value)}
                        aria-label={`${c.code} export rate`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <TextareaField
          label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending
              ? 'Saving...'
              : `Save ${filled.length || ''} ${filled.length === 1 ? 'Rate' : 'Rates'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Past notifications for one currency, so an old document can be explained. */
function HistoryModal({
  currency,
  baseCode,
  canEdit,
  onClose,
}: {
  currency: any;
  baseCode: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['exchange-rate-history', currency.currencyId],
    queryFn: () => exchangeRatesApi.history(currency.currencyId).then((r: any) => r.data.data),
  });

  const remove = useMutation({
    mutationFn: (id: string) => exchangeRatesApi.remove(id),
    onSuccess: () => {
      toast.success('Rate removed and the preceding period reopened');
      queryClient.invalidateQueries({ queryKey: ['exchange-rate-history'] });
      queryClient.invalidateQueries({ queryKey: ['exchange-rates'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Could not remove'),
  });

  const history = data ?? [];

  return (
    <Modal isOpen onClose={onClose} title={`${currency.code} rate history`} size="lg">
      {isLoading ? (
        <div className="p-8 text-center text-gray-500">Loading...</div>
      ) : history.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No rates recorded for {currency.code} yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Effective From</th>
                <th>Until</th>
                <th className="text-right">Import</th>
                <th className="text-right">Export</th>
                <th>Source</th>
                <th>Notification</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.id}>
                  <td>{formatDate(h.effectiveFrom)}</td>
                  <td className="text-gray-500">
                    {h.effectiveTo ? formatDate(h.effectiveTo) : 'in force'}
                  </td>
                  <td className="text-right">
                    {Number(h.importRate).toFixed(4)} {baseCode}
                  </td>
                  <td className="text-right font-medium">
                    {Number(h.exportRate).toFixed(4)} {baseCode}
                  </td>
                  <td className="text-sm">{h.source}</td>
                  <td className="text-xs text-gray-500">{h.notificationRef ?? '-'}</td>
                  {canEdit && (
                    <td className="text-right">
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Remove the ${currency.code} rate effective ${formatDate(
                                h.effectiveFrom
                              )}? Documents dated in that period will fall back to the preceding rate.`
                            )
                          ) {
                            remove.mutate(h.id);
                          }
                        }}
                        className="btn btn-ghost btn-sm text-red-600"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
