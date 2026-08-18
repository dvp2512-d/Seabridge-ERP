import { AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Warns that a summary total excludes records whose currency has no exchange
 * rate on record.
 *
 * Totals are converted into the base currency before being summed. When a rate
 * is missing the record is left out rather than added at face value, because
 * adding dollars to rupees produces a meaningless number. That makes the total
 * understated, so it has to be said plainly instead of showing a clean figure
 * the user would take as complete.
 */
export default function UnconvertedNotice({
  count,
  baseCode,
}: {
  count: number;
  baseCode?: string;
}) {
  if (!count) return null;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
      <div className="text-sm text-amber-800">
        <strong>
          {count} {count === 1 ? 'record is' : 'records are'} missing from these totals.
        </strong>{' '}
        {count === 1 ? 'Its' : 'Their'} currency has no exchange rate for today, so{' '}
        {count === 1 ? 'it' : 'they'} could not be converted
        {baseCode ? ` into ${baseCode}` : ''}.{' '}
        <Link to="/exchange-rates" className="underline font-medium">
          Add the missing rates
        </Link>
        .
      </div>
    </div>
  );
}
