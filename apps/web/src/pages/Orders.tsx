// Enhanced Orders Page - Export Operations Management
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ordersApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { formatCurrency, formatDate, getStatusColor, isPastDue, cn } from '@/lib/utils';
import UnconvertedNotice from '@/components/ui/UnconvertedNotice';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import RowActions from '@/components/ui/RowActions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';
import {
  Search,
  Package,
  Ship,
  CheckCircle,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';

const ORDER_STATUSES = [
  { id: 'CONFIRMED', label: 'Confirmed', color: 'bg-blue-500', icon: CheckCircle },
  { id: 'IN_PRODUCTION', label: 'In Production', color: 'bg-yellow-500', icon: Package },
  { id: 'READY_TO_SHIP', label: 'Ready to Ship', color: 'bg-orange-500', icon: Package },
  { id: 'SHIPPED', label: 'Shipped', color: 'bg-purple-500', icon: Ship },
  { id: 'DELIVERED', label: 'Delivered', color: 'bg-green-500', icon: CheckCircle },
  { id: 'CANCELLED', label: 'Cancelled', color: 'bg-red-500', icon: AlertTriangle },
];

export default function Orders() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  // Deactivate / cancel flow, shared with every other list so the

  // wording and confirmations stay consistent.

  const lifecycle = useLifecycleActions(['orders']);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['orders', search, statusFilter, page],
    queryFn: () => ordersApi.list({
      search: search || undefined,
      status: statusFilter || undefined,
      page,
      limit: 20,
    }),
  });

  const orders = data?.data?.data || [];
  const pagination = data?.data?.pagination;
  // Pipeline figures come from the API so they reflect all matching orders
  // rather than only the current page.
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
    confirmed: countByStatus.CONFIRMED ?? 0,
    inProduction: countByStatus.IN_PRODUCTION ?? 0,
    readyToShip: countByStatus.READY_TO_SHIP ?? 0,
    shipped: countByStatus.SHIPPED ?? 0,
    totalValue: summary?.totalValue ?? 0,
  };

  const overdueCount = summary?.overdueCount ?? 0;
  // Overdue orders visible on this page, used for the example list in the banner.
  const overdueOrders = orders.filter(
    (o: any) => !['DELIVERED', 'CANCELLED'].includes(o.status) && isPastDue(o.expectedDate)
  );

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
        title="Export Orders"
        subtitle={`${pagination?.total || orders.length} orders • Track order lifecycle from confirmation to delivery`}
      />

      {/* Pipeline Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="card p-4 border-l-4 border-blue-500">
          <div className="flex items-center gap-2 text-blue-600 mb-1">
            <CheckCircle className="w-4 h-4" />
            <span className="text-sm font-medium">Confirmed</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.confirmed}</div>
        </div>
        <div className="card p-4 border-l-4 border-yellow-500">
          <div className="flex items-center gap-2 text-yellow-600 mb-1">
            <Package className="w-4 h-4" />
            <span className="text-sm font-medium">In Production</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.inProduction}</div>
        </div>
        <div className="card p-4 border-l-4 border-orange-500">
          <div className="flex items-center gap-2 text-orange-600 mb-1">
            <Package className="w-4 h-4" />
            <span className="text-sm font-medium">Ready to Ship</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.readyToShip}</div>
        </div>
        <div className="card p-4 border-l-4 border-purple-500">
          <div className="flex items-center gap-2 text-purple-600 mb-1">
            <Ship className="w-4 h-4" />
            <span className="text-sm font-medium">Shipped</span>
          </div>
          <div className="text-2xl font-bold text-gray-900">{stats.shipped}</div>
        </div>
        <div className="card p-4 border-l-4 border-green-500">
          <div className="flex items-center gap-2 text-green-600 mb-1">
            <TrendingUp className="w-4 h-4" />
            <span className="text-sm font-medium">Total Value</span>
          </div>
          <div className="text-xl font-bold text-gray-900">{formatCurrency(stats.totalValue, baseCode)}</div>
        </div>
      </div>

      {/* Overdue Alert */}
      {overdueCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-red-800">
              {overdueCount} Overdue Order{overdueCount > 1 ? 's' : ''}
            </h3>
            <p className="text-sm text-red-600 mt-1">
              {overdueOrders.length > 0
                ? overdueOrders.slice(0, 3).map((o: any) => o.orderNumber).join(', ')
                : 'Past their expected delivery date.'}
              {overdueCount > 3 && ` and ${overdueCount - 3} more`}
            </p>
          </div>
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
                placeholder="Search by order number or buyer..."
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
              {ORDER_STATUSES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Orders Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : orders.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No orders found</h3>
          <p className="text-gray-500">Orders are created from accepted quotations</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Buyer</th>
                <th>Status</th>
                <th>Items</th>
                <th>Value</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th>Shipments</th>
                <th>Docs</th>
                <th className="w-16">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => {
                const isOverdue =
                  !['DELIVERED', 'CANCELLED'].includes(order.status) &&
                  isPastDue(order.expectedDate);
                
                return (
                  <tr 
                    key={order.id} 
                    className={cn('cursor-pointer hover:bg-gray-50', isOverdue && 'bg-red-50')}
                    onClick={() => navigate(`/orders/${order.id}`)}
                  >
                    <td className="font-medium font-mono">{order.orderNumber}</td>
                    <td>
                      <div className="font-medium text-gray-900">{order.buyer?.companyName}</div>
                      <div className="text-xs text-gray-500">{order.buyer?.code}</div>
                    </td>
                    <td>
                      <span className={`badge ${getStatusColor(order.status)}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>{order._count?.items || order.items?.length || 0}</td>
                    <td className="font-medium">
                      {formatCurrency(order.totalValue || order.grandTotal, order.currency?.code || order.currency)}
                    </td>
                    <td className="text-gray-600">{formatDate(order.orderDate)}</td>
                    <td className={cn(isOverdue ? 'text-red-600 font-medium' : 'text-gray-600')}>
                      {formatDate(order.expectedDate)}
                      {isOverdue && <span className="ml-1 text-xs">⚠️</span>}
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Ship className="w-4 h-4 text-gray-400" />
                        <span>{order._count?.shipments || 0}</span>
                      </div>
                    </td>
                    <td>
                      <DocProgress documents={order.documents} count={order._count?.documents} />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        destructivePermission="RECORD_DELETE"
                        viewHref={`/orders/${order.id}`}
                        destructiveKind="delete"
                        // Cancelling keeps the order number. Blocked once the goods
                        // have shipped or an invoice exists, because from that
                        // point the order records what actually happened.
                        onDestructive={() =>
                          lifecycle.request({ kind: 'delete', resource: 'orders' }, order.id, order.orderNumber)
                        }
                      />
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

// Document Progress Mini Component
function DocProgress({ documents, count }: { documents?: any[]; count?: number }) {
  if (!documents && !count) return <span className="text-gray-400">-</span>;
  
  const total = documents?.length || count || 0;
  const completed = documents?.filter((d: any) => d.status === 'COMPLETED').length || 0;
  const percentage = total > 0 ? (completed / total) * 100 : 0;
  
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className={cn(
            'h-full rounded-full',
            percentage === 100 ? 'bg-green-500' : percentage > 0 ? 'bg-yellow-500' : 'bg-gray-300'
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs text-gray-500">{completed}/{total}</span>
    </div>
  );
}
