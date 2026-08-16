// Enhanced Invoices Page - Finance Management
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { invoicesApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { formatCurrency, formatDate, getStatusColor, downloadFile, isPastDue, cn } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import {
  Search,
  Eye,
  Download,
  Receipt,
  Clock,
  CheckCircle,
  AlertTriangle,
  Plus,
} from 'lucide-react';

const INVOICE_STATUSES = [
  { id: 'DRAFT', label: 'Draft', color: 'bg-gray-500' },
  { id: 'SENT', label: 'Sent', color: 'bg-blue-500' },
  { id: 'PARTIALLY_PAID', label: 'Partially Paid', color: 'bg-yellow-500' },
  { id: 'PAID', label: 'Paid', color: 'bg-green-500' },
  { id: 'OVERDUE', label: 'Overdue', color: 'bg-red-500' },
  { id: 'CANCELLED', label: 'Cancelled', color: 'bg-gray-400' },
];

export default function Invoices() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['invoices', search, statusFilter, page],
    queryFn: () => invoicesApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      page,
      limit: 20,
    }),
  });

  // Fetch receivables summary
  const { data: receivablesData } = useQuery({
    queryKey: ['receivables'],
    queryFn: () => invoicesApi.getReceivables(),
  });

  const invoices = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  // Summary comes from the API so the figures cover every matching invoice,
  // not just the rows on the current page.
  const summary = data?.data?.summary;
  const receivables = receivablesData?.data?.data;

  const handleSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, 300);

  const countByStatus: Record<string, number> = summary?.countByStatus ?? {};
  const stats = {
    draft: countByStatus.DRAFT ?? 0,
    sent: countByStatus.SENT ?? 0,
    partiallyPaid: countByStatus.PARTIALLY_PAID ?? 0,
    paid: countByStatus.PAID ?? 0,
    overdue: summary?.overdueCount ?? 0,
    totalReceivable:
      summary?.totalOutstanding ?? receivables?.totalOutstanding ?? 0,
    totalPaid: summary?.totalCollected ?? 0,
  };

  const downloadPdf = async (invoice: any) => {
    try {
      const response = await invoicesApi.downloadPdf(invoice.id);
      downloadFile(response.data, `${invoice.invoiceNumber}.pdf`);
      toast.success('PDF downloaded');
    } catch (error) {
      toast.error('Failed to download PDF');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices & Receivables"
        subtitle={`${pagination?.total || invoices.length} invoices • Manage billing and payments`}
        actions={
          <Link to="/invoices/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Invoice
          </Link>
        }
      />

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="card p-4 border-l-4 border-red-500">
          <div className="flex items-center gap-2 text-red-600 mb-1">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm font-medium">Total Receivable</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrency(stats.totalReceivable)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.overdue} overdue
          </div>
        </div>
        <div className="card p-4 border-l-4 border-green-500">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Total Collected</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {formatCurrency(stats.totalPaid)}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.paid} invoices paid
          </div>
        </div>
        <div className="card p-4 border-l-4 border-yellow-500">
          <div className="flex items-center gap-2 text-yellow-600 mb-1">
            <Clock className="w-4 h-4" />
            <span className="text-sm font-medium">Pending</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">
            {stats.sent + stats.partiallyPaid}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {stats.partiallyPaid} partially paid
          </div>
        </div>
        <div className="card p-4 border-l-4 border-blue-500">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <Receipt className="w-4 h-4" />
            <span className="text-sm font-medium">Draft</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.draft}</div>
          <div className="text-xs text-gray-500 mt-1">
            awaiting approval
          </div>
        </div>
      </div>

      {/* Overdue Alert */}
      {stats.overdue > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-800">
              {stats.overdue} Overdue Invoice{stats.overdue > 1 ? 's' : ''}
            </h3>
            <p className="text-sm text-red-600 mt-1">
              These invoices require immediate attention for payment follow-up.
            </p>
          </div>
          <button 
            onClick={() => setStatusFilter('OVERDUE')}
            className="btn btn-secondary py-1 text-sm"
          >
            View Overdue
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by invoice number or buyer..."
                className="input pl-10"
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <select
              className="select w-full sm:w-48"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              {INVOICE_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Invoices Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : invoices.length === 0 ? (
        <div className="card p-12 text-center">
          <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No invoices found</h3>
          <p className="text-gray-500 mb-4">Create invoices from completed orders</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Buyer</th>
                <th>Order</th>
                <th>Status</th>
                <th className="text-right">Total</th>
                <th className="text-right">Paid</th>
                <th className="text-right">Balance</th>
                <th>Due Date</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice: any) => {
                const isOverdue =
                  !['PAID', 'CANCELLED'].includes(invoice.status) && isPastDue(invoice.dueDate);
                const balance = parseFloat(invoice.balanceAmount || 0);
                
                return (
                  <tr 
                    key={invoice.id} 
                    className={cn('cursor-pointer hover:bg-gray-50', isOverdue && 'bg-red-50')}
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                  >
                    <td className="font-medium font-mono">{invoice.invoiceNumber}</td>
                    <td>
                      <div className="font-medium text-gray-900">{invoice.buyer?.companyName}</div>
                      <div className="text-xs text-gray-500">{invoice.buyer?.code}</div>
                    </td>
                    <td>
                      {invoice.order ? (
                        <Link 
                          to={`/orders/${invoice.order.id}`}
                          className="text-navy-600 hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {invoice.order.orderNumber}
                        </Link>
                      ) : '-'}
                    </td>
                    <td>
                      <span className={`badge ${getStatusColor(isOverdue ? 'OVERDUE' : invoice.status)}`}>
                        {isOverdue ? 'OVERDUE' : invoice.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="text-right font-medium">
                      {formatCurrency(invoice.totalAmount, invoice.currency?.code)}
                    </td>
                    <td className="text-right text-green-600">
                      {formatCurrency(invoice.paidAmount || 0, invoice.currency?.code)}
                    </td>
                    <td className={cn(
                      'text-right font-medium',
                      balance > 0 ? 'text-red-600' : 'text-green-600'
                    )}>
                      {formatCurrency(balance, invoice.currency?.code)}
                    </td>
                    <td className={cn(isOverdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
                      {formatDate(invoice.dueDate)}
                      {isOverdue && <span className="ml-1">⚠️</span>}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => navigate(`/invoices/${invoice.id}`)}
                          className="text-navy-600 hover:text-navy-800 p-1"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => downloadPdf(invoice)}
                          className="text-gray-400 hover:text-gray-600 p-1"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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
            <button 
              onClick={() => setPage(p => Math.max(1, p - 1))} 
              disabled={page === 1} 
              className="btn btn-secondary"
            >
              Previous
            </button>
            <button 
              onClick={() => setPage(p => p + 1)} 
              disabled={page * pagination.limit >= pagination.total} 
              className="btn btn-secondary"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
