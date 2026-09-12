// Founder Dashboard - Complete Business Overview with Analytics
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
  Ship,
  IndianRupee,
  AlertCircle,
  ArrowRight,
  Clock,
  Package,
  Target,
  Percent,
  BarChart3,
  PieChart,
  CheckCircle,
  Receipt,
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
} from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuthStore();

  // Each dashboard endpoint is permission-gated on the API. Only request the
  // ones this role can actually read, otherwise the page fills with 403s.
  const canViewFull = can(user?.role, 'DASHBOARD_FULL');
  const canViewSales = can(user?.role, 'DASHBOARD_SALES');
  const canViewFinance = can(user?.role, 'DASHBOARD_FINANCE');

  /**
   * Always refetched on mount.
   *
   * These are aggregates over every record, so anything the user did on another
   * screen changes them. The global staleTime of five minutes, combined with
   * refetchOnWindowFocus being off, meant arriving at the dashboard could show
   * figures from before an invoice was raised or a payment recorded - the numbers
   * looked simply wrong. Mutations invalidate these keys too (see
   * lib/queryKeys.ts), but refetching on mount is the safety net that does not
   * depend on every screen remembering to.
   */
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getMain(),
    enabled: canViewFull,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Sales data for charts
  const { data: salesData, refetch: refetchSales } = useQuery({
    queryKey: ['dashboard-sales'],
    queryFn: () => dashboardApi.getSales(),
    enabled: canViewSales,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Finance data
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

  // Roles without full dashboard access get a focused starting point instead of
  // a page of empty widgets.
  if (!canViewFull) {
    return <ScopedDashboard role={user?.role} firstName={user?.firstName} />;
  }

  const kpis = dashboard?.kpis || {};
  // Every money figure on this page is already converted into the base currency
  // by the API, so it must be formatted as that currency rather than the USD
  // default that formatCurrency falls back to.
  const baseCode = dashboard?.baseCurrency?.code;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.firstName}!
          </h1>
          <p className="text-gray-500">
            Here's your business overview for {formatDate(new Date(), 'MMMM YYYY')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* The API reports the period it actually used (Indian financial year).
              Showing it is honest; the old selector was never sent to the server. */}
          {dashboard?.period?.label && (
            <span className="text-sm text-gray-500">{dashboard.period.label}</span>
          )}
          <div className="text-sm text-gray-500">
            {formatDate(new Date(), 'dddd, DD MMMM YYYY')}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {dashboard?.alerts && dashboard.alerts.length > 0 && (
        <div className="space-y-2">
          {dashboard.alerts.map((alert: any, index: number) => (
            <div
              key={index}
              className={cn(
                'flex items-center gap-3 p-4 rounded-lg',
                alert.type === 'error' ? 'bg-red-50 border border-red-200' :
                alert.type === 'warning' ? 'bg-yellow-50 border border-yellow-200' :
                'bg-blue-50 border border-blue-200'
              )}
            >
              <AlertCircle className={cn(
                'w-5 h-5 flex-shrink-0',
                alert.type === 'error' ? 'text-red-500' :
                alert.type === 'warning' ? 'text-yellow-500' : 'text-blue-500'
              )} />
              <span className={cn(
                'flex-1',
                alert.type === 'error' ? 'text-red-800' :
                alert.type === 'warning' ? 'text-yellow-800' : 'text-blue-800'
              )}>{alert.message}</span>
              {alert.link && (
                <Link to={alert.link} className="text-sm font-medium hover:underline">
                  View →
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Primary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Monthly Revenue"
          value={formatCurrency(kpis.monthlyRevenue || 0, baseCode)}
          subtitle={`YTD: ${formatCurrency(kpis.yearlyRevenue || 0, baseCode)}`}
          icon={TrendingUp}
          iconBg="bg-green-100"
          iconColor="text-green-600"
        />
        <KPICard
          title="Pipeline Value"
          value={formatCurrency(kpis.pipelineValue || 0, baseCode)}
          subtitle={`${kpis.openInquiries || 0} open inquiries`}
          icon={Target}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />
        <KPICard
          title="Active Orders"
          value={kpis.activeOrders || 0}
          subtitle={`${kpis.totalOrders || 0} total this year`}
          icon={ShoppingCart}
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
        />
        <KPICard
          title="Total Receivables"
          value={formatCurrency(kpis.totalReceivables || 0, baseCode)}
          subtitle={kpis.overdueReceivables > 0 ? `${formatCurrency(kpis.overdueReceivables, baseCode)} overdue` : 'All current'}
          icon={IndianRupee}
          iconBg={kpis.overdueReceivables > 0 ? "bg-red-100" : "bg-green-100"}
          iconColor={kpis.overdueReceivables > 0 ? "text-red-600" : "text-green-600"}
          alert={kpis.overdueReceivables > 0}
        />
      </div>

      {/* Remaining Balance - Total income less expenses paid */}
      {dashboard?.netPosition && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NetPositionPanel net={dashboard.netPosition} />
        </div>
      )}

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
        <MiniKPICard title="Open Inquiries" value={kpis.openInquiries || 0} icon={FileText} />
        <MiniKPICard title="Pending Quotes" value={kpis.pendingQuotations || 0} icon={FileText} />
        <MiniKPICard title="In Production" value={kpis.activeOrders || 0} icon={Package} />
        <MiniKPICard title="Active Shipments" value={kpis.activeShipments || 0} icon={Ship} />
        <MiniKPICard title="Active Buyers" value={`${kpis.activeBuyers || 0}/${kpis.totalBuyers || 0}`} icon={Users} />
        <MiniKPICard 
          title="Conversion Rate" 
          value={sales?.inquiriesByStage ? calculateConversionRate(sales.inquiriesByStage) : '-%'} 
          icon={Percent} 
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Pipeline */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <PieChart className="w-5 h-5 text-navy-600" />
              Sales Pipeline
            </h2>
            <Link to="/inquiries" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="card-body">
            <PipelineChart data={sales?.inquiriesByStage || []} baseCode={sales?.baseCurrency?.code} />
          </div>
        </div>

        {/* Order Status */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-navy-600" />
              Order Status
            </h2>
            <Link to="/orders" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="card-body">
            <OrderStatusChart data={dashboard?.recent?.orders || []} />
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Inquiries */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Recent Inquiries</h2>
            <Link to="/inquiries" className="text-sm text-navy-600 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y">
            {dashboard?.recent?.inquiries?.slice(0, 5).map((inquiry: any) => (
              <Link
                key={inquiry.id}
                to={`/inquiries/${inquiry.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{inquiry.inquiryNumber}</div>
                    <div className="text-xs text-gray-500">{inquiry.buyer?.companyName}</div>
                  </div>
                  <span className={`badge text-xs ${getStatusColor(inquiry.stage)}`}>
                    {inquiry.stage.replace(/_/g, ' ')}
                  </span>
                </div>
              </Link>
            ))}
            {(!dashboard?.recent?.inquiries || dashboard.recent.inquiries.length === 0) && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">
                No recent inquiries
              </div>
            )}
          </div>
        </div>

        {/* Recent Orders */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Recent Orders</h2>
            <Link to="/orders" className="text-sm text-navy-600 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y">
            {dashboard?.recent?.orders?.slice(0, 5).map((order: any) => (
              <Link
                key={order.id}
                to={`/orders/${order.id}`}
                className="block px-4 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{order.orderNumber}</div>
                    <div className="text-xs text-gray-500">{order.buyer?.companyName}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-sm">{formatCurrency(order.totalValue || order.grandTotal, BASE_CURRENCY_CODE)}</div>
                    <span className={`badge text-xs ${getStatusColor(order.status)}`}>
                      {order.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
            {(!dashboard?.recent?.orders || dashboard.recent.orders.length === 0) && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">
                No recent orders
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expenses Summary */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Wallet className="w-5 h-5 text-navy-600" />
              Expenses Overview
            </h2>
            <Link to="/expenses" className="text-sm text-navy-600 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="card-body">
            <ExpensesWidget data={dashboard?.expenses} currency={baseCode} />
          </div>
        </div>

        {/* Top Buyers */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-navy-600" />
              Top Buyers by Revenue
            </h2>
            <Link to="/buyers" className="text-sm text-navy-600 hover:underline">
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Country</th>
                  <th className="text-right">Orders</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {sales?.topBuyers?.slice(0, 5).map((buyer: any) => (
                  <tr key={buyer.id}>
                    <td>
                      <Link to={`/buyers/${buyer.id}`} className="font-medium text-navy-600 hover:underline">
                        {buyer.companyName}
                      </Link>
                    </td>
                    <td className="text-gray-500">{buyer.country?.name || '-'}</td>
                    <td className="text-right">{buyer.totalOrders}</td>
                    <td className="text-right font-medium">{formatCurrency(buyer.totalRevenue, sales?.baseCurrency?.code)}</td>
                  </tr>
                ))}
                {(!sales?.topBuyers || sales.topBuyers.length === 0) && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gray-500">
                      No buyer data available
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tasks Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Tasks */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2">
              <Clock className="w-5 h-5 text-navy-600" />
              Pending Tasks
            </h2>
          </div>
          <div className="divide-y">
            {dashboard?.pendingTasks?.slice(0, 5).map((task: any) => (
              <div key={task.id} className="px-4 py-3 flex items-center gap-3">
                <div className={cn(
                  'w-2 h-2 rounded-full',
                  task.priority === 'URGENT' ? 'bg-red-500' :
                  task.priority === 'HIGH' ? 'bg-orange-500' :
                  task.priority === 'MEDIUM' ? 'bg-yellow-500' : 'bg-gray-400'
                )} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{task.title}</div>
                  <div className="text-xs text-gray-500">
                    {task.assignee?.firstName} {task.assignee?.lastName}
                    {task.dueDate && ` • Due ${formatDate(task.dueDate)}`}
                  </div>
                </div>
                <span className={cn(
                  'badge text-xs',
                  task.priority === 'URGENT' ? 'badge-danger' :
                  task.priority === 'HIGH' ? 'badge-warning' : 'badge-gray'
                )}>
                  {task.priority}
                </span>
              </div>
            ))}
            {(!dashboard?.pendingTasks || dashboard.pendingTasks.length === 0) && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">
                <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
                All tasks completed!
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



// KPI Card Component
function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconBg,
  iconColor,
  trend,
  trendLabel,
  alert,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: any;
  iconBg: string;
  iconColor: string;
  trend?: number;
  trendLabel?: string;
  alert?: boolean;
}) {
  return (
    <div className={cn('card p-5', alert && 'border-red-200 bg-red-50')}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm text-gray-500">{title}</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
          {subtitle && (
            <div className={cn('text-xs mt-1', alert ? 'text-red-600' : 'text-gray-500')}>
              {subtitle}
            </div>
          )}
          {trend !== undefined && (
            <div className={cn(
              'flex items-center gap-1 text-xs mt-2',
              trend >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {trend >= 0 ? (
                <ArrowUpRight className="w-3 h-3" />
              ) : (
                <ArrowDownRight className="w-3 h-3" />
              )}
              {Math.abs(trend)}% {trendLabel}
            </div>
          )}
        </div>
        <div className={`p-3 rounded-lg ${iconBg}`}>
          <Icon className={`w-6 h-6 ${iconColor}`} />
        </div>
      </div>
    </div>
  );
}

// Mini KPI Card
function MiniKPICard({
  title,
  value,
  icon: Icon,
}: {
  title: string;
  value: string | number;
  icon: any;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-gray-400" />
        <div>
          <div className="text-lg font-bold text-gray-900">{value}</div>
          <div className="text-xs text-gray-500">{title}</div>
        </div>
      </div>
    </div>
  );
}

// Pipeline Chart (Visual representation)
//
// The API collapses its groupBy into one row per stage shaped
// { key, count, value, unconvertedCount } - see collapseByCurrency in
// routes/dashboard.ts. It does not return Prisma's raw _count/_sum wrappers.
function PipelineChart({ data, baseCode }: { data: any[]; baseCode?: string }) {
  const stages = [
    { key: 'NEW', label: 'New', color: 'bg-blue-500' },
    { key: 'REQUIREMENT_GATHERED', label: 'Requirements', color: 'bg-indigo-500' },
    { key: 'PRICING_IN_PROGRESS', label: 'Pricing', color: 'bg-purple-500' },
    { key: 'QUOTATION_SENT', label: 'Quoted', color: 'bg-yellow-500' },
    { key: 'NEGOTIATION', label: 'Negotiation', color: 'bg-orange-500' },
    { key: 'WON', label: 'Won', color: 'bg-green-500' },
    { key: 'LOST', label: 'Lost', color: 'bg-red-500' },
  ];

  const totalValue = data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

  return (
    <div className="space-y-3">
      {stages.map(stage => {
        const stageData = data.find(d => d.key === stage.key);
        const count = stageData?.count || 0;
        const value = Number(stageData?.value) || 0;
        const percentage = totalValue > 0 ? (value / totalValue) * 100 : 0;

        if (count === 0 && !['NEW', 'WON', 'LOST'].includes(stage.key)) return null;

        return (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-24 text-sm text-gray-600">{stage.label}</div>
            <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className={cn('h-full rounded-full', stage.color)}
                style={{ width: `${Math.max(percentage, count > 0 ? 5 : 0)}%` }}
              />
            </div>
            <div className="w-20 text-right">
              <div className="text-sm font-medium">{count}</div>
              <div className="text-xs text-gray-400">{formatCurrency(value, baseCode)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Order Status Chart
function OrderStatusChart({ data }: { data: any[] }) {
  const statuses = [
    { key: 'CONFIRMED', label: 'Confirmed', color: 'bg-blue-500' },
    { key: 'IN_PRODUCTION', label: 'In Production', color: 'bg-yellow-500' },
    { key: 'READY_TO_SHIP', label: 'Ready to Ship', color: 'bg-orange-500' },
    { key: 'SHIPPED', label: 'Shipped', color: 'bg-purple-500' },
    { key: 'DELIVERED', label: 'Delivered', color: 'bg-green-500' },
  ];

  // Count orders by status
  const statusCounts = statuses.map(s => ({
    ...s,
    count: data.filter(o => o.status === s.key).length,
    value: data.filter(o => o.status === s.key).reduce((sum, o) => sum + parseFloat(o.totalValue || o.grandTotal || 0), 0),
  }));

  const totalOrders = data.length;

  return (
    <div className="space-y-3">
      {statusCounts.map(status => {
        const percentage = totalOrders > 0 ? (status.count / totalOrders) * 100 : 0;
        
        return (
          <div key={status.key} className="flex items-center gap-3">
            <div className="w-28 text-sm text-gray-600">{status.label}</div>
            <div className="flex-1 h-6 bg-gray-100 rounded-full overflow-hidden">
              <div 
                className={cn('h-full rounded-full flex items-center justify-end pr-2', status.color)}
                style={{ width: `${Math.max(percentage, status.count > 0 ? 10 : 0)}%` }}
              >
                {status.count > 0 && (
                  <span className="text-xs text-white font-medium">{status.count}</span>
                )}
              </div>
            </div>
            <div className="w-24 text-right text-sm text-gray-500">
              {formatCurrency(status.value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Helper function to calculate conversion rate
// Reads the { key, count } shape returned by collapseByCurrency in routes/dashboard.ts.
function calculateConversionRate(inquiriesByStage: any[]): string {
  const won = inquiriesByStage.find(s => s.key === 'WON')?.count || 0;
  const lost = inquiriesByStage.find(s => s.key === 'LOST')?.count || 0;
  const total = won + lost;
  
  if (total === 0) return '-';
  return `${((won / total) * 100).toFixed(0)}%`;
}


/**
 * Landing page for roles that don't have full-company dashboard access
 * (SALES / OPERATIONS / FINANCE). Points them at the areas they own rather
 * than rendering widgets backed by requests they aren't allowed to make.
 */
function ScopedDashboard({
  role,
  firstName,
}: {
  role?: string;
  firstName?: string;
}) {
  const shortcutsByRole: Record<
    string,
    { label: string; to: string; icon: any; description: string }[]
  > = {
    SALES: [
      { label: 'Inquiries', to: '/inquiries', icon: FileText, description: 'Track and progress your pipeline' },
      { label: 'Quotations', to: '/quotations', icon: FileText, description: 'Price and send quotations' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Manage buyer relationships' },
    ],
    OPERATIONS: [
      { label: 'Orders', to: '/orders', icon: ShoppingCart, description: 'Move orders through production' },
      { label: 'Inquiries', to: '/inquiries', icon: FileText, description: 'See what is coming next' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Buyer contact details' },
    ],
    FINANCE: [
      { label: 'Invoices', to: '/invoices', icon: Receipt, description: 'Billing and receivables' },
      { label: 'Orders', to: '/orders', icon: ShoppingCart, description: 'Orders ready to invoice' },
      { label: 'Buyers', to: '/buyers', icon: Users, description: 'Credit limits and history' },
    ],
  };

  const shortcuts = shortcutsByRole[role ?? ''] ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back{firstName ? `, ${firstName}` : ''}!
        </h1>
        <p className="text-gray-500">
          {formatDate(new Date(), 'dddd, DD MMMM YYYY')}
          {role ? ` · ${role} workspace` : ''}
        </p>
      </div>

      {shortcuts.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {shortcuts.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="card p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-lg bg-navy-100">
                  <s.icon className="w-6 h-6 text-navy-700" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{s.label}</div>
                  <div className="text-xs text-gray-500">{s.description}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card p-8 text-center text-gray-500">
          <Activity className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p>Use the navigation on the left to get started.</p>
        </div>
      )}
    </div>
  );
}

// Expenses Widget for Dashboard
function ExpensesWidget({ data, currency }: { data: any; currency?: string }) {
  if (!data) {
    return (
      <div className="text-center py-4 text-gray-500 text-sm">
        No expense data available
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    FREIGHT: 'bg-blue-500',
    CHA: 'bg-purple-500',
    PACKAGING: 'bg-green-500',
    TRANSPORT: 'bg-yellow-500',
    INSPECTION: 'bg-orange-500',
    CERTIFICATION: 'bg-pink-500',
    TRAVEL: 'bg-indigo-500',
    OFFICE: 'bg-gray-500',
    BANK_CHARGES: 'bg-red-400',
    OTHER: 'bg-gray-400',
  };

  const formatCategory = (cat: string) =>
    cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const topCategories = (data.byCategory || []).slice(0, 5);
  const totalYTD = data.yearToDate || 0;

  return (
    <div className="space-y-4">
      {/* Summary KPIs - This Month */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">This Month</div>
          <div className="text-lg font-bold text-gray-900">
            {formatCurrency(data.thisMonth || 0, currency)}
          </div>
          <div className="text-xs text-gray-400">
            {data.thisMonthCount || 0} expenses
          </div>
          {/* Show paid vs outstanding for this month */}
          {(data.thisMonth || 0) > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Paid</span>
                <span className="text-green-600 font-medium">{formatCurrency(data.thisMonthPaid || 0, currency)}</span>
              </div>
              {(data.thisMonthBalance || 0) > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-orange-600">Outstanding</span>
                  <span className="text-orange-600 font-medium">{formatCurrency(data.thisMonthBalance, currency)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs text-gray-500">Year to Date</div>
          <div className="text-lg font-bold text-gray-900">
            {formatCurrency(data.yearToDate || 0, currency)}
          </div>
          {/* Show paid vs outstanding for YTD */}
          {(data.yearToDate || 0) > 0 && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-green-600">Paid</span>
                <span className="text-green-600 font-medium">{formatCurrency(data.yearToDatePaid || 0, currency)}</span>
              </div>
              {(data.yearToDateBalance || 0) > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-orange-600">Outstanding</span>
                  <span className="text-orange-600 font-medium">{formatCurrency(data.yearToDateBalance, currency)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Pending Approval Alert */}
      {data.pendingApproval?.count > 0 && (
        <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
          <AlertCircle className="w-4 h-4 text-yellow-600" />
          <div className="flex-1">
            <span className="text-sm text-yellow-800 font-medium">
              {data.pendingApproval.count} expense{data.pendingApproval.count > 1 ? 's' : ''} pending approval
            </span>
            <span className="text-sm text-yellow-600 ml-2">
              ({formatCurrency(data.pendingApproval.amount || 0, currency)})
            </span>
          </div>
        </div>
      )}

      {/* Category Breakdown */}
      {topCategories.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium uppercase">By Category (YTD)</div>
          {topCategories.map((cat: any) => {
            const percentage = totalYTD > 0 ? (cat.amount / totalYTD) * 100 : 0;
            return (
              <div key={cat.category} className="flex items-center gap-2">
                <div className="w-24 text-xs text-gray-600 truncate">
                  {formatCategory(cat.category)}
                </div>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', categoryColors[cat.category] || 'bg-gray-400')}
                    style={{ width: `${Math.max(percentage, cat.count > 0 ? 5 : 0)}%` }}
                  />
                </div>
                <div className="w-20 text-right text-xs font-medium text-gray-700">
                  {formatCurrency(cat.amount, currency)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {topCategories.length === 0 && (
        <div className="text-center py-4 text-gray-500 text-sm">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
          No expenses recorded this year
        </div>
      )}
    </div>
  );
}
