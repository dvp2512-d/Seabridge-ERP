import { TrendingUp, TrendingDown, AlertTriangle, Info } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

/**
 * Net position: total income less total expenses.
 *
 * Shows every component rather than just the answer, because a single net figure
 * invites the question "made up of what?" and the user should not have to go
 * hunting for it.
 *
 * Cash-based on purpose. Income counted is money received, expenses counted are
 * expenses paid, so the net says what is left rather than what is expected.
 * Committed expenses and pending income are shown beneath the line rather than
 * inside it - mixing them would give a figure that is neither a cash position nor
 * a profit.
 */
export default function NetPositionPanel({ net, periodLabel }: { net: any; periodLabel?: string }) {
  if (!net) return null;

  const currency = net.currency ?? 'INR';
  const isPositive = net.netBalance >= 0;

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <h2 className="font-semibold">Net Position</h2>
        <span className="text-xs text-gray-500">{periodLabel ?? 'year to date'} &middot; {currency}</span>
      </div>
      <div className="card-body space-y-3">
        {/* The two income components, so the total is traceable */}
        <Row
          label="Export revenue"
          hint="Payments received against invoices"
          value={formatCurrency(net.exportRevenue ?? 0, currency)}
        />
        <Row
          label="Other income"
          hint="Drawback, RoDTEP, interest, forex gain"
          value={formatCurrency(net.otherIncome ?? 0, currency)}
        />

        <div className="flex justify-between items-center pt-2 border-t font-medium">
          <span>Total income</span>
          <span className="text-green-700">{formatCurrency(net.totalIncome ?? 0, currency)}</span>
        </div>

        <Row
          label="Total expenses"
          hint="Expenses marked paid"
          value={`- ${formatCurrency(net.totalExpenses ?? 0, currency)}`}
          negative
        />

        <div
          className={`flex justify-between items-center pt-3 border-t-2 ${
            isPositive ? 'border-green-200' : 'border-red-200'
          }`}
        >
          <span className="font-semibold flex items-center gap-2">
            {isPositive ? (
              <TrendingUp className="w-4 h-4 text-green-600" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-600" />
            )}
            Remaining balance
          </span>
          <span className={`text-2xl font-bold ${isPositive ? 'text-green-700' : 'text-red-700'}`}>
            {formatCurrency(net.netBalance ?? 0, currency)}
          </span>
        </div>

        {/* Stated outside the calculation so the net is not mistaken for the
            complete picture. */}
        {(net.expensesCommitted > 0 || net.incomePending > 0) && (
          <div className="flex items-start gap-2 pt-2 text-xs text-gray-500 border-t">
            <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <div>Not included above:</div>
              {net.expensesCommitted > 0 && (
                <div>
                  {formatCurrency(net.expensesCommitted, currency)} approved but not yet paid
                </div>
              )}
              {net.incomePending > 0 && (
                <div>{formatCurrency(net.incomePending, currency)} income still pending</div>
              )}
            </div>
          </div>
        )}

        {net.unconvertedExpenses > 0 && (
          <div className="flex items-start gap-2 p-2 rounded bg-amber-50 text-xs text-amber-800">
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              {net.unconvertedExpenses}{' '}
              {net.unconvertedExpenses === 1 ? 'expense is' : 'expenses are'} missing from this
              total &mdash; no exchange rate on record for {net.unconvertedExpenses === 1 ? 'its' : 'their'}{' '}
              currency.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  value,
  negative,
}: {
  label: string;
  hint?: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="flex justify-between items-start">
      <div>
        <div className="text-sm text-gray-700">{label}</div>
        {hint && <div className="text-xs text-gray-400">{hint}</div>}
      </div>
      <span className={`text-sm ${negative ? 'text-red-600' : 'text-gray-900'}`}>{value}</span>
    </div>
  );
}
