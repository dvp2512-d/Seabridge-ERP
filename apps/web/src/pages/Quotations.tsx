// Enhanced Quotations Page
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { quotationsApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { formatCurrency, formatDate, getStatusColor, downloadFile, isPastDue, cn } from '@/lib/utils';
import UnconvertedNotice from '@/components/ui/UnconvertedNotice';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import RowActions from '@/components/ui/RowActions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';
import { Plus, Search, Eye, Download, FileText, Clock, CheckCircle } from 'lucide-react';

const STATUSES = [
  { id: 'DRAFT', label: 'Draft', color: 'bg-gray-500' },
  { id: 'SENT', label: 'Sent', color: 'bg-blue-500' },
  { id: 'REVISED', label: 'Revised', color: 'bg-yellow-500' },
  { id: 'ACCEPTED', label: 'Accepted', color: 'bg-green-500' },
  { id: 'REJECTED', label: 'Rejected', color: 'bg-red-500' },
  { id: 'EXPIRED', label: 'Expired', color: 'bg-gray-400' },
];

export default function Quotations() {
  const navigate = useNavigate();  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Deactivate / cancel flow, shared with every other list so the

  // wording and confirmations stay consistent.

  const lifecycle = useLifecycleActions(['quotations']);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['quotations', search, statusFilter, page],
    queryFn: () => quotationsApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      page,
      limit: 20,
    }),
  });

  const quotations = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  // Counts/totals come from the API so they aren't limited to this page.
  const summary = data?.data?.summary;
  // Summary money is converted into the company's base currency, so it must
  // be labelled with that rather than each record's own currency.
  const baseCode = summary?.baseCurrency?.code;
  // Non-zero means some records had no exchange rate and are excluded.
  const unconvertedRecords = summary?.unconvertedRecords ?? 0;

  const handleSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, 300);

  const countByStatus: Record<string, number> = summary?.countByStatus ?? {};
  const stats = {
    draft: countByStatus.DRAFT ?? 0,
    sent: countByStatus.SENT ?? 0,
    accepted: countByStatus.ACCEPTED ?? 0,
    totalValue: summary?.totalValue ?? 0,
  };

  const downloadPdf = async (quotation: any) => {
    try {
      const response = await quotationsApi.downloadPdf(quotation.id);
      downloadFile(response.data, `${quotation.quotationNumber}.pdf`);
      toast.success('PDF downloaded');
    } catch (error) {
      toast.error('Failed to download PDF');
    }
  };

  return (
    <div className="space-y-6">
      {/* Confirmation for deactivate, cancel and delete */}
      {lifecycle.dialog && (
        <ConfirmDialog
          isOpen
          title={lifecycle.dialog.title}
          message={lifecycle.dialog.message}
          consequences={lifecycle.dialog.consequences}
          tone={lifecycle.dialog.tone}
          requireTyping={lifecycle.dialog.requireTyping}
          confirmLabel={lifecycle.dialog.confirmLabel}
          isPending={lifecycle.isPending}
          onConfirm={lifecycle.confirm}
          onCancel={lifecycle.dismiss}
        />
      )}
      <UnconvertedNotice count={unconvertedRecords} baseCode={baseCode} />
      <PageHeader
        title="Quotations"
        subtitle={`${pagination?.total || quotations.length} quotations`}
        actions={
          <Link to="/quotations/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Quotation
          </Link>
        }
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-gray-500 mb-1">
            <FileText className="w-4 h-4" />
            <span className="text-sm">Drafts</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.draft}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-blue-500 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm">Sent/Pending</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.sent}</div>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-green-500 mb-1">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm">Accepted</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.accepted}</div>
        </div>
        <div className="card p-4">
          <div className="text-sm text-gray-500 mb-1">Total Value</div>
          <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalValue, baseCode)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by quotation number or buyer..."
                className="input pl-10"
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <select
              className="select w-full sm:w-40"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quotations Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : quotations.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No quotations found</h3>
          <p className="text-gray-500 mb-4">Create your first quotation to get started</p>
          <Link to="/quotations/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Quotation
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Quotation #</th>
                <th>Buyer</th>
                <th>Status</th>
                <th>Items</th>
                <th>Total</th>
                <th>Margin</th>
                <th>Valid Until</th>
                <th>Created</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {quotations.map((q: any) => (
                <tr key={q.id} className="cursor-pointer" onClick={() => navigate(`/quotations/${q.id}`)}>
                  <td className="font-medium font-mono">{q.quotationNumber}</td>
                  <td>
                    <div className="font-medium text-gray-900">{q.buyer?.companyName}</div>
                    <div className="text-xs text-gray-500">{q.buyer?.code}</div>
                  </td>
                  <td>
                    <span className={`badge ${getStatusColor(q.status)}`}>{q.status}</span>
                  </td>
                  <td>{q._count?.items || 0}</td>
                  <td className="font-medium">{formatCurrency(q.grandTotal, q.currency?.code)}</td>
                  {(() => {
                    // Guard against null/undefined margins on older records,
                    // which would otherwise render as "null%" or "NaN%".
                    const pct = Number(q.marginPercent);
                    const hasMargin = Number.isFinite(pct);
                    return (
                      <td className={cn(
                        'font-medium',
                        !hasMargin ? 'text-gray-400' :
                        pct >= 15 ? 'text-green-600' :
                        pct >= 10 ? 'text-yellow-600' : 'text-red-600'
                      )}>
                        {hasMargin ? `${pct.toFixed(1)}%` : '-'}
                      </td>
                    );
                  })()}
                  <td className={cn(
                    isPastDue(q.validUntil) && q.status === 'SENT' ? 'text-red-600 font-medium' : 'text-gray-600'
                  )}>
                    {formatDate(q.validUntil)}
                  </td>
                  <td className="text-gray-500">{formatDate(q.createdAt)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/quotations/${q.id}`)}
                        className="text-navy-600 hover:text-navy-800"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => downloadPdf(q)}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <RowActions
                        destructivePermission="RECORD_DELETE"
                        // A draft has not been sent to a buyer and nothing
                        // references it, so it can be removed outright. Anything
                        // beyond draft keeps its number and is cancelled.
                        destructiveKind={q.status === 'DRAFT' ? 'delete' : 'cancel'}
                        onDestructive={() =>
                          lifecycle.request(
                            q.status === 'DRAFT'
                              ? { kind: 'deleteDraftQuotation' }
                              : { kind: 'cancelQuotation' },
                            q.id,
                            q.quotationNumber
                          )
                        }
                        destructiveDisabledReason={
                          q.status === 'REJECTED'
                            ? 'Already cancelled'
                            : q.orders?.length
                            ? 'Converted to an order - cancel that first'
                            : undefined
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Page {pagination.page} of {Math.ceil(pagination.total / pagination.limit)}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn btn-secondary">
              Previous
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * pagination.limit >= pagination.total} className="btn btn-secondary">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
