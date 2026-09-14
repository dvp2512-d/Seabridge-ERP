// Founder Dashboard - Clean Business Overview
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import { formatCurrency, formatDate, getStatusColor, cn, BASE_CURRENCY_CODE } from '@/lib/utils';
import NetPositionPanel from '@/components/ui/NetPositionPanel';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  TrendingUp,
  Users,
  FileText,
  ShoppingCart,
  IndianRupee,
  AlertCircle,
  Target,
  CheckCircle,
  Receipt,
  Activity,
  Wallet,
} from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuthStore();

  const canViewFull = can(user?.role, 'DASHBOARD_FULL');
  const canViewSales = can(user?.role, 'DASHBOARD_SALES');
  const canViewFinance = can(user?.role, 'DASHBOARD_FINANCE');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getMain(),
    enabled: canViewFull,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: salesData, refetch: refetchSales } = useQuery({
    queryKey: ['dashboard-sales'],
    queryFn: () => dashboardApi.getSales(),
    enabled: canViewSales,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: _financeData, refetch: refetchFinance } = useQuery({
    queryKey: ['dashboard-finance'],
    queryFn: () => dashboardApi.getFinance(),
    enabled: canViewFinance,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const dashboard = data?.data?.data;
  const sales = salesData?.data?.data;

  if (canViewFull && isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
      </div>
    );
  }

  if (canViewFull && isError) {
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          refetch();
          refetchSales();
          refetchFinance();
        }}
      />
    );
  }

  if (!canViewFull) {
    return <ScopedDashboard role={user?.role} firstName={user?.firstName} />;
  }

  const kpis = dashboard?.kpis || {};
  const baseCode = dashboard?.baseCurrency?.code;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.firstName}!
          </h1>
          <p className="text-sm text-gray-500">
            {formatDate(new Date(), 'dddd, DD MMMM YYYY')}
            {dashboard?.period?.label && ` • ${dashboard.period.label}`}
          </p>
        </div>
      </div>

      {/* Alerts - Compact single row */}
      {dashboard?.alerts && dashboard.alerts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {dashboard.alerts.map((alert: any, index: number) => (
            <Link
              key={index}
              to={alert.link || '#'}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                alert.type === 'error' 
                  ? 'bg-red-100 text-red-800 hover:bg-red-200' 
                  : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              )}
            >
              <AlertCircle className="w-4 h-4" />
              {alert.message}
            </Link>
          ))}
        </div>
      )}

      {/* Primary KPIs - 4 equal cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Revenue (Month)"
          value={formatCurrency(kpis.monthlyRevenue || 0, baseCode)}
          subtitle={`YTD: ${formatCurrency(kpis.yearlyRevenue || 0, baseCode)}`}
          icon={TrendingUp}
          color="green"
        />
        <KPICard
          title="Pipeline"
          value={formatCurrency(kpis.pipelineValue || 0, baseCode)}
          subtitle={`${kpis.openInquiries || 0} open inquiries`}
          icon={Target}
          color="blue"
        />
        <KPICard
          title="Active Orders"
          value={kpis.activeOrders || 0}
          subtitle={`${kpis.totalOrders || 0} total YTD`}
          icon={ShoppingCart}
          color="purple"
        />
        <KPICard
          title="Receivables"
          value={formatCurrency(kpis.totalReceivables || 0, baseCode)}
          subtitle={kpis.overdueReceivables > 0 
            ? `${formatCurrency(kpis.overdueReceivables, baseCode)} overdue` 
            : 'All current'}
          icon={IndianRupee}
          color={kpis.overdueReceivables > 0 ? "red" : "green"}
        />
      </div>

      {/* Secondary Stats - Single row */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <StatBadge label="Inquiries" value={kpis.openInquiries || 0} />
        <StatBadge label="Quotes" value={kpis.pendingQuotations || 0} />
        <StatBadge label="Production" value={kpis.activeOrders || 0} />
        <StatBadge label="Shipments" value={kpis.activeShipments || 0} />
        <StatBadge label="Buyers" value={`${kpis.activeBuyers || 0}/${kpis.totalBuyers || 0}`} />
        <StatBadge 
          label="Conversion" 
          value={sales?.inquiriesByStage ? calculateConversionRate(sales.inquiriesByStage) : '-'} 
        />
      </div>

      {/* Financial Overview - 2 columns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Net Position */}
        {dashboard?.netPosition && (
          <NetPositionPanel net={dashboard.netPosition} />
        )}

        {/* Expenses Summary */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-gray-400" />
              Expenses
            </h2>
            <Link to="/expenses" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="card-body">
            <ExpensesWidget data={dashboard?.expenses} currency={baseCode} />
          </div>
        </div>
      </div>

      {/* Activity Section - 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Recent Inquiries */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Recent Inquiries</h2>
            <Link to="/inquiries" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y">
            {dashboard?.recent?.inquiries?.slice(0, 4).map((inquiry: any) => (
              <Link
                key={inquiry.id}
                to={`/inquiries/${inquiry.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{inquiry.inquiryNumber}</div>
                  <div className="text-xs text-gray-500 truncate">{inquiry.buyer?.companyName}</div>
                </div>
                <span className={`badge text-xs ml-2 ${getStatusColor(inquiry.stage)}`}>
                  {inquiry.stage.replace(/_/g, ' ')}
                </span>
              </Link>
            ))}
            {(!dashboard?.recent?.inquiries || dashboard.recent.inquiries.length === 0) && (
              <EmptyState message="No recent inquiries" />
            )}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Recent Orders</h2>
            <Link to="/orders" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y">
            {dashboard?.recent?.orders?.slice(0, 4).map((order: any) => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{order.orderNumber}</div>
                  <div className="text-xs text-gray-500 truncate">{order.buyer?.companyName}</div>
                </div>
                <div className="text-right ml-2">
                  <div className="font-medium text-sm">{formatCurrency(order.totalValue, BASE_CURRENCY_CODE)}</div>
                  <span className={`badge text-xs ${getStatusColor(order.status)}`}>
                    {order.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </Link>
            ))}
            {(!dashboard?.recent?.orders || dashboard.recent.orders.length === 0) && (
              <EmptyState message="No recent orders" />
            )}
          </div>
        </div>

        {/* Pending Tasks */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Pending Tasks</h2>
            <Link to="/tasks" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="divide-y">
            {dashboard?.pendingTasks?.slice(0, 4).map((task: any) => (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <div className={cn(
                  'w-2 h-2 rounded-full flex-shrink-0',
                  task.priority === 'URGENT' ? 'bg-red-500' :
                  task.priority === 'HIGH' ? 'bg-orange-500' :
                  task.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-gray-400'
                )} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{task.title}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {task.assignee?.firstName} {task.assignee?.lastName}
                    {task.dueDate && ` • ${formatDate(task.dueDate)}`}
                  </div>
                </div>
              </div>
            ))}
            {(!dashboard?.pendingTasks || dashboard.pendingTasks.length === 0) && (
              <div className="px-4 py-6 text-center">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                <p className="text-sm text-gray-500">All tasks completed!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Buyers */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-400" />
            Top Buyers by Revenue
          </h2>
          <Link to="/buyers" className="text-sm text-navy-600 hover:underline">
            View all →
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Buyer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Country</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Orders</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sales?.topBuyers?.slice(0, 5).map((buyer: any) => (
                <tr key={buyer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/buyers/${buyer.id}`} className="font-medium text-navy-600 hover:underline">
                      {buyer.companyName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{buyer.country?.name || '-'}</td>
                  <td className="px-4 py-3 text-right">{buyer.totalOrders}</td>
                  <td className="px-4 py-3 text-right font-medium">
                    {formatCurrency(buyer.totalRevenue, sales?.baseCurrency?.code)}
                  </td>
                </tr>
              ))}
              {(!sales?.topBuyers || sales.topBuyers.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No buyer data available
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================
// COMPONENTS
// ============================================

// KPI Card - Clean design
function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  color: 'green' | 'blue' | 'purple' | 'red' | 'gray';
}) {
  const colorStyles = {
    green: 'bg-green-50 border-green-200 text-green-600',
    blue: 'bg-blue-50 border-blue-200 text-blue-600',
    purple: 'bg-purple-50 border-purple-200 text-purple-600',
    red: 'bg-red-50 border-red-200 text-red-600',
    gray: 'bg-gray-50 border-gray-200 text-gray-600',
  };

  const iconColors = {
    green: 'text-green-500',
    blue: 'text-blue-500',
    purple: 'text-purple-500',
    red: 'text-red-500',
    gray: 'text-gray-500',
  };

  return (
    <div className={cn('rounded-xl border p-4', colorStyles[color])}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-600">{title}</span>
        <Icon className={cn('w-5 h-5', iconColors[color])} />
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {subtitle && (
        <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
      )}
    </div>
  );
}

// Stat Badge - Compact stat display
function StatBadge({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border rounded-lg px-3 py-2 text-center">
      <div className="text-lg font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

// Empty State
function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-6 text-center text-gray-500 text-sm">
      {message}
    </div>
  );
}

// Expenses Widget - Simplified
function ExpensesWidget({ data, currency }: { data: any; currency?: string }) {
  if (!data) {
    return <EmptyState message="No expense data" />;
  }

  const topCategories = (data.byCategory || []).slice(0, 5);
  const totalYTD = data.yearToDate || 0;

  const formatCategory = (cat: string) =>
    cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const categoryColors: Record<string, string> = {
    SUPPLIER_PAYMENT: 'bg-blue-500',
    FREIGHT: 'bg-indigo-500',
    CHA: 'bg-purple-500',
    TRANSPORT: 'bg-amber-500',
    PACKAGING: 'bg-green-500',
    INSPECTION: 'bg-orange-500',
    OTHER: 'bg-gray-400',
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">This Month</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(data.thisMonth || 0, currency)}
          </div>
          {(data.thisMonthBalance || 0) > 0 && (
            <div className="text-xs text-orange-600 mt-1">
              {formatCurrency(data.thisMonthBalance, currency)} unpaid
            </div>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">Year to Date</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(data.yearToDate || 0, currency)}
          </div>
          {(data.yearToDateBalance || 0) > 0 && (
            <div className="text-xs text-orange-600 mt-1">
              {formatCurrency(data.yearToDateBalance, currency)} unpaid
            </div>
          )}
        </div>
      </div>

      {/* Pending Approval */}
      {data.pendingApproval?.count > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-sm text-amber-800">
            {data.pendingApproval.count} pending approval ({formatCurrency(data.pendingApproval.amount || 0, currency)})
          </span>
        </div>
      )}

      {/* Category Breakdown */}
      {topCategories.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium">By Category (YTD)</div>
          {topCategories.map((cat: any) => {
            const percentage = totalYTD > 0 ? (cat.amount / totalYTD) * 100 : 0;
            return (
              <div key={cat.category} className="flex items-center gap-2">
                <div className="w-20 text-xs text-gray-600 truncate">
                  {formatCategory(cat.category)}
                </div>
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', categoryColors[cat.category] || 'bg-gray-400')}
                    style={{ width: `${Math.max(percentage, 3)}%` }}
                  />
                </div>
                <div className="w-16 text-right text-xs font-medium text-gray-700">
                  {formatCurrency(cat.amount, currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Calculate conversion rate
function calculateConversionRate(inquiriesByStage: any[]): string {
  const won = inquiriesByStage.find(s => s.key === 'WON')?.count || 0;
  const lost = inquiriesByStage.find(s => s.key === 'LOST')?.count || 0;
  const total = won + lost;
  if (total === 0) return '-';
  return `${((won / total) * 100).toFixed(0)}%`;
}

// Scoped Dashboard for non-admin roles
function ScopedDashboard({
  role,
  firstName,
}: {
  role?: string;
  firstName?: string;
}) {
  const shortcuts: Record<string, { label: string; to: string; icon: any; description: string }[]> = {
    SALES: [
      { label: 'Inquiries', to: '/inquiries', icon: FileText, description: 'Track your pipeline' },
      { label: 'Quotations', to: '/quotations', icon: FileText, description: 'Price and send quotes' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Manage relationships' },
    ],
    OPERATIONS: [
      { label: 'Orders', to: '/orders', icon: ShoppingCart, description: 'Production & shipping' },
      { label: 'Inquiries', to: '/inquiries', icon: FileText, description: 'Upcoming work' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Contact details' },
    ],
    FINANCE: [
      { label: 'Invoices', to: '/invoices', icon: Receipt, description: 'Billing & receivables' },
      { label: 'Expenses', to: '/expenses', icon: Wallet, description: 'Track costs' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Credit & history' },
    ],
  };

  const items = shortcuts[role ?? ''] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome{firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className="text-sm text-gray-500">
          {formatDate(new Date(), 'dddd, DD MMMM YYYY')}
          {role && ` • ${role}`}
        </p>
      </div>

      {items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="card p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-navy-100">
                  <item.icon className="w-6 h-6 text-navy-700" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{item.label}</div>
                  <div className="text-xs text-gray-500">{item.description}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center">
          <Activity className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">Use the navigation to get started.</p>
        </div>
      )}
    </div>
  );
}
