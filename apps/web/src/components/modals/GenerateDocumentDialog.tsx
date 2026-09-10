import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exchangeRatesApi, masterApi } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormFields';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, Lock } from 'lucide-react';

const BASE_CODE = 'INR';

/**
 * Choose the currency and exchange rate a document is printed in.
 *
 * Amounts are held in rupees. A buyer's copy is expressed in their currency at a
 * rate stated here, and both are recorded on the document so a reprint reproduces
 * what was sent. The rate is typed rather than looked up: it is a commercial
 * decision, and a stored rate that drifts would silently re-price documents that
 * have already gone out.
 *
 * The live market rate is offered as a hint only, which is what makes a
 * transposed digit obvious before the document leaves.
 */
export default function GenerateDocumentDialog({
  title,
  documentTotalINR,
  /** Currency and rate already recorded, if this document has been generated before. */
  initialCurrency,
  initialRate,
  /** When set, the currency and rate cannot be changed and the reason is shown. */
  lockedReason,
  onClose,
  onGenerate,
  isGenerating,
}: {
  title: string;
  documentTotalINR: number;
  initialCurrency?: string | null;
  initialRate?: number | null;
  lockedReason?: string | null;
  onClose: () => void;
  onGenerate: (currency: string, rate: number) => void;
  isGenerating?: boolean;
}) {
  const [code, setCode] = useState(initialCurrency || BASE_CODE);
  const [rate, setRate] = useState(
    initialRate != null ? String(initialRate) : '1'
  );

  const { data: currenciesData } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => masterApi.getCurrencies(),
  });

  // Advisory only, and deliberately not awaited before the form is usable.
  const { data: marketData } = useQuery({
    queryKey: ['market-check'],
    queryFn: () => exchangeRatesApi.marketCheck().then((r: any) => r.data.data),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });

  const currencies = currenciesData?.data?.data ?? [];
  const isBase = code === BASE_CODE;
  const marketRate: number | undefined = marketData?.available
    ? marketData.ratesPerForeignUnit?.[code]
    : undefined;

  // The base currency is 1 by definition, so the field is pinned rather than
  // left editable and then rejected by the server.
  useEffect(() => {
    if (isBase) setRate('1');
  }, [isBase]);

  const numericRate = parseFloat(rate);
  const rateIsValid =
    Number.isFinite(numericRate) &&
    numericRate > 0 &&
    (isBase ? Math.abs(numericRate - 1) < 0.000001 : Math.abs(numericRate - 1) > 0.000001);

  const converted = useMemo(() => {
    if (!rateIsValid) return null;
    return documentTotalINR / numericRate;
  }, [documentTotalINR, numericRate, rateIsValid]);

  // A rate wildly away from the market is usually a typo or an inverted rate.
  const looksOff =
    !isBase && marketRate !== undefined && rateIsValid
      ? numericRate / marketRate > 1.25 || numericRate / marketRate < 0.8
      : false;

  const locked = Boolean(lockedReason);

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="p-6 space-y-4">
        {locked && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">{lockedReason}</p>
          </div>
        )}

        <SelectField
          label="Currency"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={locked}
          options={currencies.map((c: any) => ({
            value: c.code,
            label: `${c.code} - ${c.name}`,
          }))}
          hint="The currency the buyer's copy is expressed in"
        />

        <FormField
          label={isBase ? 'Exchange Rate' : `Exchange Rate (1 ${code} = ? ${BASE_CODE})`}
          required
          type="number"
          step="0.0001"
          min="0"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          disabled={locked || isBase}
          hint={
            isBase
              ? 'Amounts are already in rupees, so no conversion applies.'
              : marketRate !== undefined
                ? `Market rate today is about ${marketRate.toFixed(4)}.`
                : 'Enter the rate agreed with the buyer.'
          }
        />

        {!isBase && marketRate !== undefined && !locked && (
          <button
            type="button"
            onClick={() => setRate(String(marketRate))}
            className="inline-flex items-center gap-1.5 text-sm text-navy-600 hover:underline"
          >
            <TrendingUp className="w-4 h-4" />
            Use today's market rate ({marketRate.toFixed(4)})
          </button>
        )}

        {looksOff && (
          <p className="text-sm text-amber-700">
            That is a long way from the market rate. Check the figure is not inverted
            before sending this to a buyer.
          </p>
        )}

        <div className="rounded-lg bg-gray-50 border p-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Document total (stored)</span>
            <span className="font-medium">{formatCurrency(documentTotalINR)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Prints as</span>
            <span className="font-bold text-navy-900">
              {converted !== null ? formatCurrency(converted, code) : '-'}
            </span>
          </div>
          {!isBase && rateIsValid && (
            <p className="text-xs text-gray-500 pt-1">
              The PDF will state the rate used, so the figures can be reconciled.
            </p>
          )}
        </div>

        {!rateIsValid && (
          <p className="text-sm text-red-600">
            {isBase
              ? 'The rate must be 1 for rupee documents.'
              : `Enter how many ${BASE_CODE} one ${code} is worth. A rate of 1 would mean they are equal.`}
          </p>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onGenerate(code, numericRate)}
            className="btn btn-primary"
            disabled={!rateIsValid || isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate PDF'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
