// Founder Dashboard - Complete Business Overview with Analytics
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import { formatCurrency, formatDate, getStatusColor, cn } from '@/lib/utils';
import UnconvertedNotice from '@/components/ui/UnconvertedNotice';
import NetPositionPanel from '@/components/ui/NetPositionPanel';
import {
  TrendingUp,
  Users,
  FileText,
  ShoppingCart,
  Ship,
  DollarSign,
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
} from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuthStore();
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'quarter' | 'year'>('month');

  // Each dashboard endpoint is permission-gated on the API. Only request the
  // ones this role can actually read, otherwise the page fills with 403s.
  const canViewFull = can(user?.role, 'DASHBOARD_FULL');
  const canViewSales = can(user?.role, 'DASHBOARD_SALES');
  const canViewFinance = can(user?.role, 'DASHBOARD_FINANCE');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getMain(),
    enabled: canViewFull,
  });

  // Sales data for charts
  const { data: salesData } = useQuery({
    queryKey: ['dashboard-sales'],
    queryFn: () => dashboardApi.getSales(),
    enabled: canViewSales,
  });

  // Finance data
  const { data: financeData } = useQuery({
    queryKey: ['dashboard-finance'],
    queryFn: () => dashboardApi.getFinance(),
    enabled: canViewFinance,
  });

  const dashboard = data?.data?.data;
  const sales = salesData?.data?.data;
  const finance = financeData?.data?.data;

  if (canViewFull && isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
      </div>
    );
  }

  // Roles without full dashboard access get a focused starting point instead of
  // a page of empty widgets.
  if (!canViewFull) {
    return <ScopedDashboard role={user?.role} firstName={user?.firstName} />;
  }

  const kpis = dashboard?.kpis || {};
  // Every money KPI is converted into this currency before being summed, so it
  // must be labelled with it rather than defaulting to USD.
  const baseCode: string | undefined = dashboard?.baseCurrency?.code;
  // Non-zero means some records had no exchange rate for today and are missing
  // from the totals, which has to be stated rather than shown as a clean figure.
  const unconvertedRecords: number = dashboard?.unconvertedRecords ?? 0;
  // Always INR: income is converted when recorded, so nothing here needs a rate.
  const otherIncome = dashboard?.otherIncome ?? { received: 0, pending: 0, byCategory: [] };
  // Total income less expenses paid, with every component shown on the panel.
  const netPosition = dashboard?.netPosition;

  return (
    <div className="space-y-6">
      <UnconvertedNotice count={unconvertedRecords} baseCode={baseCode} />
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
          <select 
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value as any)}
            className="select py-1.5 text-sm"
          >
            <option value="week">This Week</option>
            <option value="month">This Month</option>
            <option value="quarter">This Quarter</option>
            <option value="year">This Year</option>
          </select>
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
          trend={12.5}
          trendLabel="vs last month"
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
          icon={DollarSign}
          iconBg={kpis.overdueReceivables > 0 ? "bg-red-100" : "bg-green-100"}
          iconColor={kpis.overdueReceivables > 0 ? "text-red-600" : "text-green-600"}
          alert={kpis.overdueReceivables > 0}
        />
        {/* Separate from Revenue on purpose: drawback, RoDTEP, interest and forex
            gain are real receipts but not export sales, and folding them in would
            flatter sales performance. Always INR - converted when recorded. */}
        <KPICard
          title="Other Income"
          value={formatCurrency(otherIncome.received || 0, 'INR')}
          subtitle={
            otherIncome.pending > 0
              ? `${formatCurrency(otherIncome.pending, 'INR')} pending`
              : 'Drawback, RoDTEP, interest'
          }
          icon={TrendingUp}
          iconBg="bg-teal-100"
          iconColor="text-teal-600"
        />
      </div>

      {/* Total income less expenses paid. Placed above the pipeline detail because
          it answers the question most often asked of a dashboard. */}
      {netPosition && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NetPositionPanel net={netPosition} />
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
            <PipelineChart data={sales?.inquiriesByStage || []} />
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
                    <div className="font-medium text-sm">{formatCurrency(order.totalValue || order.grandTotal)}</div>
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

        {/* Receivables Aging */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <h2 className="font-semibold">Receivables Aging</h2>
            <Link to="/invoices" className="text-sm text-navy-600 hover:underline flex items-center gap-1">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="card-body">
            <ReceivablesAging data={finance?.receivablesSummary || []} />
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                    <td className="text-right font-medium">{formatCurrency(buyer.totalRevenue)}</td>
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
function PipelineChart({ data }: { data: any[] }) {
  const stages = [
    { key: 'NEW', label: 'New', color: 'bg-blue-500' },
    { key: 'REQUIREMENT_GATHERED', label: 'Requirements', color: 'bg-indigo-500' },
    { key: 'PRICING_IN_PROGRESS', label: 'Pricing', color: 'bg-purple-500' },
    { key: 'QUOTATION_SENT', label: 'Quoted', color: 'bg-yellow-500' },
    { key: 'NEGOTIATION', label: 'Negotiation', color: 'bg-orange-500' },
    { key: 'WON', label: 'Won', color: 'bg-green-500' },
    { key: 'LOST', label: 'Lost', color: 'bg-red-500' },
  ];

  // Each row is { key, count, value } from the collapsed analytics response, and
  // value is already converted into the base currency.
  const totalValue = data.reduce((sum, d) => sum + (d.value || 0), 0);

  return (
    <div className="space-y-3">
      {stages.map(stage => {
        const stageData = data.find(d => d.key === stage.key);
        const count = stageData?.count || 0;
        const value = stageData?.value || 0;
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
              <div className="text-xs text-gray-400">{formatCurrency(value)}</div>
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

// Receivables Aging Component
function ReceivablesAging({ data }: { data: any[] }) {
  const agingBuckets = [
    { key: 'current', label: 'Current', color: 'bg-green-500' },
    { key: '1-30 days', label: '1-30 Days', color: 'bg-yellow-500' },
    { key: '31-60 days', label: '31-60 Days', color: 'bg-orange-500' },
    { key: '61-90 days', label: '61-90 Days', color: 'bg-red-400' },
    { key: '90+ days', label: '90+ Days', color: 'bg-red-600' },
  ];

  const totalReceivables = data.reduce((sum, d) => sum + parseFloat(d.total || 0), 0);

  return (
    <div className="space-y-4">
      {/* Stacked Bar */}
      <div className="h-8 bg-gray-100 rounded-full overflow-hidden flex">
        {agingBuckets.map(bucket => {
          const bucketData = data.find(d => d.aging === bucket.key);
          const value = parseFloat(bucketData?.total || 0);
          const percentage = totalReceivables > 0 ? (value / totalReceivables) * 100 : 0;
          
          if (percentage === 0) return null;
          
          return (
            <div
              key={bucket.key}
              className={cn('h-full', bucket.color)}
              style={{ width: `${percentage}%` }}
              title={`${bucket.label}: ${formatCurrency(value)}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="space-y-2">
        {agingBuckets.map(bucket => {
          const bucketData = data.find(d => d.aging === bucket.key);
          const value = parseFloat(bucketData?.total || 0);
          const count = parseInt(bucketData?.count || 0);
          
          if (value === 0) return null;
          
          return (
            <div key={bucket.key} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div className={cn('w-3 h-3 rounded', bucket.color)} />
                <span className="text-gray-600">{bucket.label}</span>
                <span className="text-gray-400">({count})</span>
              </div>
              <span className="font-medium">{formatCurrency(value)}</span>
            </div>
          );
        })}
      </div>

      {data.length === 0 && (
        <div className="text-center py-4 text-gray-500 text-sm">
          <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
          No outstanding receivables
        </div>
      )}
    </div>
  );
}

// Helper function to calculate conversion rate
function calculateConversionRate(inquiriesByStage: any[]): string {
  // The analytics endpoint groups by currency internally and collapses the result,
  // so each row is { key, count, value } rather than Prisma's raw
  // { stage, _count, _sum }. Reading the old shape silently produced zero.
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
