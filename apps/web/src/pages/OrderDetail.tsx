// Enhanced OrderDetail Page - Complete Export Operations Management
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ordersApi, chaApi, transportersApi, suppliersApi, masterApi, buyersApi, attachmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';
import Modal from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/ErrorState';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import DeleteRecordButton from '@/components/DeleteRecordButton';
import { formatCurrency, formatDate, getStatusColor, isPastDue, cn, BASE_CURRENCY_CODE } from '@/lib/utils';
import { refreshAggregates } from '@/lib/queryKeys';
import { PACKAGE_TYPE_OPTIONS, packageCountLabel } from '@/lib/packageTypes';
import {
  ArrowLeft,
  Package,
  Ship,
  FileText,
  CheckCircle,
  Circle,
  Clock,
  Building2,
  MapPin,
  Phone,
  Mail,
  Calendar,
  IndianRupee,
  Truck,
  Anchor,
  Plus,
  Edit,
  Edit2,
  AlertTriangle,
  AlertCircle,
  Loader2,
  FileCheck,
  ClipboardList,
  Receipt,
  Download,
  Upload,
  Trash2,
  Paperclip,
} from 'lucide-react';

const ORDER_STAGES = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'];

// CANCELLED is a real OrderStatus but not a step in the progress tracker, so it
// belongs in the status dropdown only. Without it, opening the status modal on a
// cancelled order showed CONFIRMED and saving silently un-cancelled the order.
const ORDER_STATUS_OPTIONS = [...ORDER_STAGES, 'CANCELLED'];

const STAGE_ICONS: Record<string, any> = {
  CONFIRMED: CheckCircle,
  IN_PRODUCTION: Package,
  READY_TO_SHIP: Package,
  SHIPPED: Ship,
  DELIVERED: CheckCircle,
};

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'items' | 'procurement' | 'documents' | 'shipments' | 'invoices'>('items');
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  /** The header fields every document raised against this order prints. */
  const [showDocumentDetails, setShowDocumentDetails] = useState(false);
  const [showProcurementModal, setShowProcurementModal] = useState(false);
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<any>(null);

  // Fetch order details
  const { data: response, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order', id],
    queryFn: () => ordersApi.get(id!),
    enabled: !!id,
  });

  const order = response?.data?.data;

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (data: any) => ordersApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order', id] });
      refreshAggregates(queryClient);
      toast.success('Order status updated');
      setShowStatusModal(false);
    },
    onError: () => toast.error('Failed to update status'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-600"></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <button onClick={() => navigate('/orders')} className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Back to Orders
        </button>
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Order not found</h2>
        <button onClick={() => navigate('/orders')} className="btn btn-primary mt-4">
          Back to Orders
        </button>
      </div>
    );
  }

  const currentStageIndex = ORDER_STAGES.indexOf(order.status);
  // Order amounts are INR. ExportOrder no longer carries a currency column, so the
  // old `order.currency || 'USD'` fallback always won and showed dollars.
  const currency = BASE_CURRENCY_CODE;
  const isOverdue =
    !['DELIVERED', 'CANCELLED'].includes(order.status) && isPastDue(order.expectedDate);

  // Calculate document progress
  const docsTotal = order.documents?.length || 0;
  const docsCompleted = order.documents?.filter((d: any) => d.status === 'COMPLETED').length || 0;
  const docsProgress = docsTotal > 0 ? (docsCompleted / docsTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/orders')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{order.orderNumber}</h1>
              <span className={`badge ${getStatusColor(order.status)}`}>
                {order.status.replace(/_/g, ' ')}
              </span>
              {isOverdue && (
                <span className="badge badge-danger flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Overdue
                </span>
              )}
            </div>
            <p className="text-gray-500 mt-1">
              Created {formatDate(order.createdAt)} • Expected {formatDate(order.expectedDate)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <DeleteRecordButton
            resourceType="order"
            recordId={id!}
            recordName={`Order ${order.orderNumber}`}
            redirectTo="/orders"
          />
          {/* Edit button - only when not delivered or cancelled */}
          {!['DELIVERED', 'CANCELLED'].includes(order.status) && (
            <button onClick={() => setShowEditModal(true)} className="btn btn-secondary">
              <Edit2 className="w-4 h-4 mr-2" />
              Edit
            </button>
          )}
          <button onClick={() => setShowDocumentDetails(true)} className="btn btn-secondary">
            <FileText className="w-4 h-4 mr-2" />
            Document Details
          </button>
          <button onClick={() => setShowStatusModal(true)} className="btn btn-secondary">
            <Edit className="w-4 h-4 mr-2" />
            Update Status
          </button>
          {order.status !== 'CANCELLED' && (
            <button onClick={() => setShowShipmentModal(true)} className="btn btn-primary">
              <Ship className="w-4 h-4 mr-2" />
              Add Shipment
            </button>
          )}
        </div>
      </div>

      {/* Status Progress Bar */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          {ORDER_STAGES.map((stage, i) => {
            const StageIcon = STAGE_ICONS[stage];
            const isCompleted = currentStageIndex >= i;
            const isCurrent = currentStageIndex === i;
            
            return (
              <div key={stage} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'flex items-center justify-center w-10 h-10 rounded-full transition-all',
                    isCompleted ? 'bg-navy-900 text-white' : 'bg-gray-200 text-gray-400',
                    isCurrent && 'ring-4 ring-navy-200'
                  )}>
                    <StageIcon className="w-5 h-5" />
                  </div>
                  <span className={cn(
                    'mt-2 text-xs font-medium',
                    isCompleted ? 'text-navy-900' : 'text-gray-400'
                  )}>
                    {stage.replace(/_/g, ' ')}
                  </span>
                </div>
                {i < ORDER_STAGES.length - 1 && (
                  <div className={cn(
                    'flex-1 h-1 mx-2',
                    currentStageIndex > i ? 'bg-navy-900' : 'bg-gray-200'
                  )} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Buyer Info Card */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Buyer Information
              </h2>
              <Link to={`/buyers/${order.buyer?.id}`} className="text-sm text-navy-600 hover:underline">
                View Details →
              </Link>
            </div>
            <div className="card-body">
              <div className="flex justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{order.buyer?.companyName}</h3>
                  <p className="text-gray-500">{order.buyer?.code}</p>
                  {order.buyer?.address && (
                    <p className="text-sm text-gray-600 mt-2 flex items-start gap-1">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      {order.buyer.address}, {order.buyer.city}, {order.buyer.country?.name}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  {order.buyer?.email && (
                    <p className="flex items-center justify-end gap-1 text-gray-600">
                      <Mail className="w-4 h-4" /> {order.buyer.email}
                    </p>
                  )}
                  {order.buyer?.phone && (
                    <p className="flex items-center justify-end gap-1 text-gray-600 mt-1">
                      <Phone className="w-4 h-4" /> {order.buyer.phone}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="card">
            <div className="border-b">
              <nav className="flex -mb-px overflow-x-auto">
                {[
                  { key: 'items', label: 'Order Items', icon: Package, count: order.items?.length },
                  { key: 'procurement', label: 'Procurement', icon: ClipboardList, count: order.procurements?.length },
                  { key: 'documents', label: 'Documents', icon: FileText, count: order.documents?.length },
                  { key: 'shipments', label: 'Shipments', icon: Ship, count: order.shipments?.length },
                  { key: 'invoices', label: 'Invoices', icon: Receipt, count: order.invoices?.length },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
                      activeTab === tab.key
                        ? 'border-navy-600 text-navy-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {tab.count !== undefined && tab.count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-100">
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            </div>

            {/* Tab Content */}
            <div className="p-0">
              {activeTab === 'items' && <OrderItemsTab order={order} currency={currency} />}
              {activeTab === 'procurement' && (
                <ProcurementTab 
                  order={order} 
                  currency={currency}
                  onAdd={() => setShowProcurementModal(true)}
                />
              )}
              {activeTab === 'documents' && (
                <DocumentsTab 
                  order={order}
                  onUpdate={(doc) => { setSelectedDocument(doc); setShowDocumentModal(true); }}
                />
              )}
              {activeTab === 'shipments' && (
                <ShipmentsTab 
                  order={order}
                  onAdd={() => setShowShipmentModal(true)}
                />
              )}
              {activeTab === 'invoices' && <InvoicesTab order={order} currency={currency} />}
            </div>
          </div>

          {/* Notes */}
          {order.notes && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Notes</h2>
              </div>
              <div className="card-body">
                <p className="text-gray-700 whitespace-pre-wrap">{order.notes}</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Order Summary */}
          <div className="card">
            <div className="card-header bg-navy-900 text-white rounded-t-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <IndianRupee className="w-5 h-5" />
                Order Summary
              </h2>
            </div>
            <div className="card-body space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-500">Order Value</span>
                <span className="font-bold text-lg">{formatCurrency(order.totalValue || order.grandTotal, currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Items</span>
                <span>{order.items?.length || 0} products</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Incoterm</span>
                <span className="font-medium">{order.incoterm?.code || '-'}</span>
              </div>
              <hr />
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Payment Terms</span>
                <span>{order.paymentTerms || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Delivery Terms</span>
                <span>{order.deliveryTerms || '-'}</span>
              </div>
            </div>
          </div>

          {/* Document Progress */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2">
                <FileCheck className="w-5 h-5" />
                Documentation Progress
              </h2>
            </div>
            <div className="card-body">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">{docsCompleted} of {docsTotal} completed</span>
                <span className="text-sm font-medium">{docsProgress.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className={cn(
                    'h-full rounded-full transition-all',
                    docsProgress === 100 ? 'bg-green-500' : docsProgress > 50 ? 'bg-yellow-500' : 'bg-navy-500'
                  )}
                  style={{ width: `${docsProgress}%` }}
                />
              </div>
              <button 
                onClick={() => setActiveTab('documents')}
                className="text-sm text-navy-600 hover:underline mt-2"
              >
                View all documents →
              </button>
            </div>
          </div>

          {/* Quick Info */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Quick Info</h2>
            </div>
            <div className="card-body space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Order Date</div>
                  <div className="font-medium">{formatDate(order.orderDate)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Expected Delivery</div>
                  <div className={cn('font-medium', isOverdue && 'text-red-600')}>
                    {formatDate(order.expectedDate)}
                    {isOverdue && ' (Overdue)'}
                  </div>
                </div>
              </div>
              {order.poNumber && (
                <div className="flex items-center gap-3">
                  <FileText className="w-4 h-4 text-gray-400" />
                  <div>
                    <div className="text-xs text-gray-500">Customer PO</div>
                    <div className="font-medium">{order.poNumber}</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Related Records */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Related Records</h2>
            </div>
            <div className="card-body space-y-2">
              {order.quotation && (
                <Link
                  to={`/quotations/${order.quotation.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
                >
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Quotation</div>
                    <div className="text-xs text-gray-500">{order.quotation.quotationNumber}</div>
                  </div>
                </Link>
              )}
              {order.invoices?.length > 0 && (
                <Link
                  to={`/invoices/${order.invoices[0].id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
                >
                  <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
                    <Receipt className="w-4 h-4 text-green-600" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Invoice</div>
                    <div className="text-xs text-gray-500">{order.invoices[0].invoiceNumber}</div>
                  </div>
                </Link>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="card">
            <div className="card-body space-y-2">
              <button 
                onClick={() => setShowProcurementModal(true)}
                className="btn btn-secondary w-full justify-start"
              >
                <ClipboardList className="w-4 h-4 mr-2" />
                Add Procurement
              </button>
              <button 
                onClick={() => setShowShipmentModal(true)}
                className="btn btn-secondary w-full justify-start"
              >
                <Ship className="w-4 h-4 mr-2" />
                Add Shipment
              </button>
              <button 
                onClick={() => navigate(`/invoices/new?orderId=${id}`)}
                className="btn btn-gold w-full justify-start"
              >
                <Receipt className="w-4 h-4 mr-2" />
                Create Invoice
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showStatusModal && (
        <StatusUpdateModal
          currentStatus={order.status}
          onClose={() => setShowStatusModal(false)}
          onSave={(status) => updateStatusMutation.mutate({ status })}
          isLoading={updateStatusMutation.isPending}
        />
      )}

      {showEditModal && (
        <EditOrderModal
          order={order}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            queryClient.invalidateQueries({ queryKey: ['order', id] });
          }}
        />
      )}

      {showDocumentDetails && (
        <DocumentDetailsModal
          order={order}
          onClose={() => setShowDocumentDetails(false)}
          onSaved={() => {
            setShowDocumentDetails(false);
            queryClient.invalidateQueries({ queryKey: ['order', id] });
          }}
        />
      )}

      {showProcurementModal && (
        <ProcurementModal
          orderId={id!}
          currency={currency}
          onClose={() => setShowProcurementModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['order', id] });
      refreshAggregates(queryClient);
            setShowProcurementModal(false);
          }}
        />
      )}

      {showShipmentModal && (
        <ShipmentModal
          orderId={id!}
          defaultOriginPortId={order?.portOfLoadingId}
          defaultDestinationPortId={order?.portOfDischargeId}
          quotationCosts={order?.quotation?.costs}
          onClose={() => setShowShipmentModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['order', id] });
      refreshAggregates(queryClient);
            setShowShipmentModal(false);
          }}
        />
      )}

      {showDocumentModal && selectedDocument && (
        <DocumentUpdateModal
          orderId={id!}
          document={selectedDocument}
          onClose={() => { setShowDocumentModal(false); setSelectedDocument(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['order', id] });
      refreshAggregates(queryClient);
            setShowDocumentModal(false);
            setSelectedDocument(null);
          }}
        />
      )}
    </div>
  );
}



// Order Items Tab
function OrderItemsTab({ order, currency }: { order: any; currency: string }) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const canManage = can(user?.role as any, 'OPERATIONS_MANAGE');
  const [editingItem, setEditingItem] = useState<any>(null);

  const items: any[] = order.items ?? [];

  /**
   * Column totals for the packing figures.
   *
   * Null rather than zero when no line carries a figure, so an unweighed order reads
   * "—" instead of a confident 0.00 kg. These are the same totals the weight block
   * on the invoice prints.
   */
  const totals = {
    packages: items.some((i) => i.numberOfPackages != null)
      ? items.reduce((sum, i) => sum + Number(i.numberOfPackages ?? 0), 0)
      : null,
    net: items.some((i) => i.netWeight != null)
      ? items.reduce((sum, i) => sum + Number(i.netWeight ?? 0), 0)
      : null,
    gross: items.some((i) => i.grossWeight != null)
      ? items.reduce((sum, i) => sum + Number(i.grossWeight ?? 0), 0)
      : null,
  };

  const incomplete = items.filter((i) => i.netWeight == null || i.grossWeight == null).length;

  /**
   * Fill the whole order's packing from what is already on file.
   *
   * For orders created before the packaging fields existed, or whose products had no
   * standard pack at the time. Only fills empty lines, so anything weighed by hand
   * stands.
   */
  const fillPacking = useMutation({
    mutationFn: (overwrite: boolean) => ordersApi.fillPacking(order.id, overwrite),
    onSuccess: (response: any) => {
      const r = response?.data?.data;
      if ((r?.filled ?? 0) > 0) {
        toast.success(`Packing filled on ${r.filled} line${r.filled === 1 ? '' : 's'}`);
      } else {
        toast.error(
          r?.unavailable?.length
            ? `No packaging on file for ${r.unavailable.join(', ')}. Set a default pack on the product.`
            : 'Nothing to fill'
        );
      }
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Could not fill the packing figures'),
  });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">Quantity</th>
              <th className="text-right">Unit Price</th>
              <th className="text-right">Total</th>
              {/* The four packing figures are the Packing List, and they fill the
                  weight block on every invoice. Shown here because they belong to
                  the line, not to the shipment. */}
              <th className="text-right">Packages</th>
              <th className="text-right">Per Pack</th>
              <th className="text-right">Net Wt</th>
              <th className="text-right">Gross Wt</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {order.items?.map((item: any) => (
              <tr key={item.id}>
                <td>
                  <div className="font-medium">{item.product?.name}</div>
                  <div className="text-xs text-gray-500">{item.product?.code}</div>
                  {item.specifications && (
                    <div className="text-xs text-gray-400 mt-1">{item.specifications}</div>
                  )}
                </td>
                <td className="text-right">{item.quantity} {item.unit}</td>
                <td className="text-right">{formatCurrency(item.unitPrice, currency)}</td>
                <td className="text-right font-semibold">
                  {formatCurrency(item.totalPrice, currency)}
                </td>
                <td className="text-right text-sm">
                  {/* Count with its type, e.g. "40 Bags" - the count alone is not
                      something the packing list can be checked against. */}
                  {item.numberOfPackages != null ? (
                    packageCountLabel(
                      item.numberOfPackages,
                      item.packageType
                    )
                  ) : (
                    <span className="text-amber-600">—</span>
                  )}
                </td>
                <td className="text-right text-sm">
                  {item.packageWeight ? `${Number(item.packageWeight)} kg` : <span className="text-amber-600">—</span>}
                </td>
                <td className="text-right text-sm">
                  {item.netWeight ? `${Number(item.netWeight)} kg` : <span className="text-amber-600">—</span>}
                </td>
                <td className="text-right text-sm">
                  {item.grossWeight ? `${Number(item.grossWeight)} kg` : <span className="text-amber-600">—</span>}
                </td>
                <td className="text-right">
                  {canManage && (
                    <button
                      onClick={() => setEditingItem(item)}
                      className="btn btn-ghost btn-sm"
                      title="Edit packing figures"
                    >
                      <Package className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50">
              <td colSpan={3} className="text-right font-semibold">Order Total</td>
              <td className="text-right font-bold text-lg">
                {formatCurrency(order.totalValue || order.grandTotal, currency)}
              </td>
              <td className="text-right font-semibold text-sm">{totals.packages ?? '—'}</td>
              <td></td>
              <td className="text-right font-semibold text-sm">
                {totals.net === null ? '—' : `${totals.net.toFixed(2)} kg`}
              </td>
              <td className="text-right font-semibold text-sm">
                {totals.gross === null ? '—' : `${totals.gross.toFixed(2)} kg`}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* A packing list with blank weights is refused at the port, so the gap is
          stated here rather than discovered when the document is sent. */}
      {incomplete > 0 && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-2">
            <div>
              {incomplete} of {items.length} lines have no packing figures. The Packing List
              and the weight block on invoices will print blank for those lines.
            </div>
            {canManage && (
              <button
                onClick={() => fillPacking.mutate(false)}
                disabled={fillPacking.isPending}
                className="btn btn-secondary btn-sm"
              >
                {fillPacking.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Package className="w-4 h-4" />
                )}
                Fill from quotation &amp; product defaults
              </button>
            )}
          </div>
        </div>
      )}

      {editingItem && (
        <PackingModal
          orderId={order.id}
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            queryClient.invalidateQueries({ queryKey: ['order', order.id] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Edit one line's packing figures.
 *
 * Quantity and price are not editable here: they came from the accepted quotation
 * and changing them would put the order total, the invoice and the quotation out of
 * step. The API refuses them too.
 */
function PackingModal({
  orderId,
  item,
  onClose,
  onSaved,
}: {
  orderId: string;
  item: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    numberOfPackages: item.numberOfPackages ? String(item.numberOfPackages) : '',
    packageType: item.packageType || '',
    packageWeight: item.packageWeight ? String(Number(item.packageWeight)) : '',
    netWeight: item.netWeight ? String(Number(item.netWeight)) : '',
    grossWeight: item.grossWeight ? String(Number(item.grossWeight)) : '',
    specifications: item.specifications || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.updateOrderItem(orderId, item.id, data),
    onSuccess: () => {
      toast.success('Packing figures saved');
      onSaved();
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Could not save the packing figures'),
  });

  /** Blank clears the figure: "not yet weighed" is different from zero. */
  const numberOrNull = (value: string) => {
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const net = numberOrNull(form.netWeight);
  const gross = numberOrNull(form.grossWeight);
  const grossTooLow = net !== null && gross !== null && gross < net;

  return (
    <Modal isOpen onClose={onClose} title={`Packing - ${item.product?.name ?? 'line'}`} size="md">
      <div className="p-6 space-y-4">
        <div className="rounded-lg bg-gray-50 p-3 text-sm flex justify-between">
          <span className="text-gray-500">Ordered</span>
          <span className="font-medium">
            {item.quantity} {item.unit}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="No. of Packages"
            type="number"
            min="0"
            step="1"
            value={form.numberOfPackages}
            onChange={(e: any) => setForm({ ...form, numberOfPackages: e.target.value })}
          />
          {/* The count and the type belong together: "40" is not a figure a shipping
              line or customs officer can act on. */}
          <SelectField
            label="Package Type"
            value={form.packageType}
            onChange={(e: any) => setForm({ ...form, packageType: e.target.value })}
            placeholder="Not set"
            options={PACKAGE_TYPE_OPTIONS}
          />
          <FormField
            label="Weight per Package (KG)"
            type="number"
            min="0"
            step="0.001"
            value={form.packageWeight}
            onChange={(e: any) => setForm({ ...form, packageWeight: e.target.value })}
          />
          <FormField
            label="Net Weight (KG)"
            type="number"
            min="0"
            step="0.001"
            value={form.netWeight}
            onChange={(e: any) => setForm({ ...form, netWeight: e.target.value })}
          />
          <FormField
            label="Gross Weight (KG)"
            type="number"
            min="0"
            step="0.001"
            value={form.grossWeight}
            onChange={(e: any) => setForm({ ...form, grossWeight: e.target.value })}
          />
        </div>

        <TextareaField
          label="Specifications"
          value={form.specifications}
          onChange={(e: any) => setForm({ ...form, specifications: e.target.value })}
          rows={2}
          placeholder="Product specifications for this order..."
        />

        {grossTooLow && (
          <p className="text-xs text-red-600">
            Gross weight cannot be less than net weight — gross includes the packaging.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={grossTooLow || mutation.isPending}
            onClick={() =>
              mutation.mutate({
                numberOfPackages:
                  form.numberOfPackages === '' ? null : Number(form.numberOfPackages),
                packageType: form.packageType || null,
                packageWeight: numberOrNull(form.packageWeight),
                netWeight: net,
                grossWeight: gross,
                specifications: form.specifications || null,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The header fields every document raised against this order prints.
 *
 * They live on the order rather than on each document because they describe the
 * shipment, not the paperwork: a commercial invoice, a packing list and a proforma
 * for the same order must all state the same dispatch method and destination. The
 * columns existed and the PDFs read them, but nothing could set them, so these
 * boxes printed whatever could be inferred from the port - or empty.
 */
function DocumentDetailsModal({
  order,
  onClose,
  onSaved,
}: {
  order: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    dispatchMethod: order.dispatchMethod || '',
    shipmentType: order.shipmentType || '',
    variationPercent: order.variationPercent != null ? String(Number(order.variationPercent)) : '',
    billToBuyerId: order.billToBuyerId || '',
    paymentTerms: order.paymentTerms || '',
    deliveryTerms: order.deliveryTerms || '',
    portOfLoadingId: order.portOfLoadingId || '',
    portOfDischargeId: order.portOfDischargeId || '',
  });

  const { data: buyersData } = useQuery({
    queryKey: ['buyers-list'],
    queryFn: () => buyersApi.list({ limit: 200 }),
  });

  const { data: portsData } = useQuery({
    queryKey: ['ports-all'],
    queryFn: () => masterApi.getPorts({ limit: 500, includeInactive: true }),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.update(order.id, data),
    onSuccess: () => {
      toast.success('Document details saved');
      onSaved();
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Could not save the document details'),
  });

  const ports = portsData?.data?.data || [];
  // The consignee cannot also be the bill-to party; leaving it empty is how "same
  // party" is expressed, which is what the master draft shows.
  const buyers = (buyersData?.data?.data || []).filter((b: any) => b.id !== order.buyerId);

  return (
    <Modal isOpen onClose={onClose} title="Document Details" size="lg">
      <div className="p-6 space-y-4">
        <p className="text-sm text-gray-500">
          Printed on the quotation, invoices and packing list raised against this order.
        </p>

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Method of Dispatch"
            value={form.dispatchMethod}
            onChange={(e: any) => setForm({ ...form, dispatchMethod: e.target.value })}
            placeholder="Not set"
            options={[
              { value: 'SEA', label: 'Sea' },
              { value: 'AIR', label: 'Air' },
              { value: 'ROAD', label: 'Road' },
            ]}
          />
          <SelectField
            label="Type of Shipment"
            value={form.shipmentType}
            onChange={(e: any) => setForm({ ...form, shipmentType: e.target.value })}
            placeholder="Not set"
            options={[
              { value: 'FCL', label: 'FCL - Full Container Load' },
              { value: 'LCL', label: 'LCL - Less than Container Load' },
              { value: 'BREAK_BULK', label: 'Break Bulk' },
              { value: 'AIR_CARGO', label: 'Air Cargo' },
            ]}
          />
          <SelectField
            label="Port of Loading"
            value={form.portOfLoadingId}
            onChange={(e: any) => setForm({ ...form, portOfLoadingId: e.target.value })}
            placeholder="Not set"
            options={ports.map((p: any) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          />
          <SelectField
            label="Port of Discharge"
            value={form.portOfDischargeId}
            onChange={(e: any) => setForm({ ...form, portOfDischargeId: e.target.value })}
            placeholder="Not set"
            options={ports.map((p: any) => ({ value: p.id, label: `${p.name} (${p.code})` }))}
          />
        </div>

        <SelectField
          label="Buyer (if other than consignee)"
          value={form.billToBuyerId}
          onChange={(e: any) => setForm({ ...form, billToBuyerId: e.target.value })}
          placeholder="Same as consignee"
          options={buyers.map((b: any) => ({ value: b.id, label: b.companyName }))}
        />
        <p className="-mt-2 text-xs text-gray-500">
          Set only when the goods are consigned to one party and invoiced to another.
        </p>

        <FormField
          label="Variation % +/- (proforma invoice)"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={form.variationPercent}
          onChange={(e: any) => setForm({ ...form, variationPercent: e.target.value })}
          placeholder="e.g. 10"
        />

        <TextareaField
          label="Payment Terms"
          rows={2}
          value={form.paymentTerms}
          onChange={(e: any) => setForm({ ...form, paymentTerms: e.target.value })}
          placeholder="e.g. 30% advance, balance against BL copy"
        />
        <TextareaField
          label="Delivery Terms"
          rows={2}
          value={form.deliveryTerms}
          onChange={(e: any) => setForm({ ...form, deliveryTerms: e.target.value })}
        />

        <div className="flex justify-end gap-2 pt-2 border-t">
          <button className="btn btn-secondary" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate({
                // Empty string clears the field rather than leaving the old value.
                dispatchMethod: form.dispatchMethod || null,
                shipmentType: form.shipmentType || null,
                variationPercent:
                  form.variationPercent === '' ? null : Number(form.variationPercent),
                billToBuyerId: form.billToBuyerId || null,
                paymentTerms: form.paymentTerms || null,
                deliveryTerms: form.deliveryTerms || null,
                portOfLoadingId: form.portOfLoadingId || null,
                portOfDischargeId: form.portOfDischargeId || null,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Procurement Tab
function ProcurementTab({ 
  order, 
  currency, 
  onAdd 
}: { 
  order: any; 
  currency: string; 
  onAdd: () => void;
}) {
  const procurements = order.procurements || [];

  const handleDownloadPdf = async (po: any) => {
    try {
      const response = await ordersApi.downloadProcurementPdf(order.id, po.id);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${po.poNumber || 'PO-DRAFT'}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Purchase Order PDF downloaded');
    } catch (error) {
      toast.error('Failed to download PDF');
    }
  };
  
  return (
    <div>
      <div className="p-4 border-b flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {procurements.length} procurement order(s)
        </div>
        <button onClick={onAdd} className="btn btn-secondary py-1 text-sm">
          <Plus className="w-4 h-4 mr-1" /> Add PO
        </button>
      </div>
      
      {procurements.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No procurement orders yet</p>
          <button onClick={onAdd} className="btn btn-primary mt-3">
            <Plus className="w-4 h-4 mr-1" /> Create Purchase Order
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {procurements.map((po: any) => (
            <div key={po.id} className="p-4">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{po.poNumber}</div>
                  <div className="text-sm text-gray-500">{po.supplier?.name}</div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => handleDownloadPdf(po)}
                    className="btn btn-secondary py-1 px-2 text-sm"
                    title="Download PDF"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <div className="text-right">
                    <div className="font-semibold">{formatCurrency(po.totalAmount, po.currency || currency)}</div>
                    <span className={`badge ${getStatusColor(po.status)}`}>{po.status}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3 text-sm text-gray-500">
                <div>Order Date: {formatDate(po.orderDate)}</div>
                <div>Expected: {formatDate(po.expectedDate)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Documents Tab
function DocumentsTab({ 
  order, 
  onUpdate 
}: { 
  order: any; 
  onUpdate: (doc: any) => void;
}) {
  const documents = order.documents || [];
  
  const docTypeLabels: Record<string, string> = {
    COMMERCIAL_INVOICE: 'Commercial Invoice',
    PACKING_LIST: 'Packing List',
    BILL_OF_LADING: 'Bill of Lading',
    CERTIFICATE_OF_ORIGIN: 'Certificate of Origin',
    PHYTOSANITARY: 'Phytosanitary Certificate',
    FUMIGATION: 'Fumigation Certificate',
    QUALITY_CERTIFICATE: 'Quality Certificate',
    INSURANCE: 'Insurance Certificate',
    CUSTOMS_DECLARATION: 'Customs Declaration',
  };
  
  return (
    <div>
      {/* What each printable document would contain if generated now. Shown above
          the checklist because the checklist tracks whether a document has been
          obtained, while this tracks whether ours would print complete. */}
      <DocumentReadinessPanel orderId={order.id} />

      <div className="divide-y border-t">
        {documents.map((doc: any) => (
        <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center',
              doc.status === 'COMPLETED' ? 'bg-green-100' :
              doc.status === 'IN_PROGRESS' ? 'bg-yellow-100' : 'bg-gray-100'
            )}>
              {doc.status === 'COMPLETED' ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : doc.status === 'IN_PROGRESS' ? (
                <Clock className="w-5 h-5 text-yellow-600" />
              ) : (
                <Circle className="w-5 h-5 text-gray-400" />
              )}
            </div>
            <div>
              <div className="font-medium">{docTypeLabels[doc.documentType] || doc.documentType.replace(/_/g, ' ')}</div>
              {doc.documentNo && <div className="text-sm text-gray-500">Doc #: {doc.documentNo}</div>}
              {doc.completedAt && (
                <div className="text-xs text-gray-400">Completed: {formatDate(doc.completedAt)}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`badge ${getStatusColor(doc.status)}`}>{doc.status}</span>
            <button 
              onClick={() => onUpdate(doc)}
              className="text-navy-600 hover:text-navy-800 p-1"
            >
              <Edit className="w-4 h-4" />
            </button>
          </div>
        </div>
        ))}
      </div>

      {/* Attachments Section */}
      <AttachmentsSection orderId={order.id} />
    </div>
  );
}

/**
 * Per-document readiness.
 *
 * A document with an empty box still renders and downloads, so the gap is otherwise
 * found by whoever receives it - a bank rejecting an LC presentation, or customs
 * holding a consignment over a missing gross weight. Each row says how many of the
 * printed boxes would be filled, and expands to name the ones that would not be and
 * where to enter them.
 *
 * Fetched from the server rather than computed here, because the rules have to move
 * together with the PDF renderer; see services/documentReadiness.ts.
 */
function DocumentReadinessPanel({ orderId }: { orderId: string }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['document-readiness', orderId],
    queryFn: () => ordersApi.documentReadiness(orderId).then((r: any) => r.data),
  });

  if (isLoading) {
    return <div className="p-4 text-sm text-gray-500">Checking document readiness...</div>;
  }

  const documents = data?.data?.documents ?? [];
  if (documents.length === 0) return null;

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-navy-900">Document Readiness</h3>
        <span className="text-xs text-gray-500">
          What would print if generated now
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {documents.map((doc: any) => {
          const isOpen = expanded === doc.document;
          const missing = doc.fields.filter((f: any) => !f.ready);

          return (
            <div
              key={doc.document}
              className={cn(
                'rounded-lg border text-sm',
                doc.complete ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'
              )}
            >
              <button
                className="w-full flex items-center justify-between gap-2 p-3 text-left"
                onClick={() => setExpanded(isOpen ? null : doc.document)}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {doc.complete ? (
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                  )}
                  <span className="font-medium truncate">{doc.label}</span>
                </span>
                <span
                  className={cn(
                    'text-xs whitespace-nowrap',
                    doc.complete ? 'text-green-700' : 'text-amber-700'
                  )}
                >
                  {doc.readyCount} of {doc.totalCount} ready
                </span>
              </button>

              {/* Recorded on every generation but never shown before, so there was
                  no way to tell whether the copy a buyer holds is the current one. */}
              {doc.lastGeneratedAt && (
                <div className="px-3 pb-2 -mt-1 text-xs text-gray-500">
                  Last generated {formatDate(doc.lastGeneratedAt)}
                  {doc.lastCurrency ? ` in ${doc.lastCurrency}` : ''}
                </div>
              )}

              {isOpen && (
                <div className="px-3 pb-3 space-y-1 border-t border-white/60 pt-2">
                  {missing.length === 0 ? (
                    <p className="text-xs text-green-700">
                      Every printed field has a value.
                    </p>
                  ) : (
                    missing.map((f: any) => (
                      <div key={f.label} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-amber-900">{f.label}</span>
                        <span className="text-gray-500 whitespace-nowrap">{f.where}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Shipments Tab
function ShipmentsTab({ 
  order, 
  onAdd 
}: { 
  order: any; 
  onAdd: () => void;
}) {
  const shipments = order.shipments || [];
  
  return (
    <div>
      <div className="p-4 border-b flex justify-between items-center">
        <div className="text-sm text-gray-500">
          {shipments.length} shipment(s)
        </div>
        <button onClick={onAdd} className="btn btn-secondary py-1 text-sm">
          <Plus className="w-4 h-4 mr-1" /> Add Shipment
        </button>
      </div>
      
      {shipments.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <Ship className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No shipments created yet</p>
          <button onClick={onAdd} className="btn btn-primary mt-3">
            <Plus className="w-4 h-4 mr-1" /> Create Shipment
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {shipments.map((shipment: any) => (
            <div key={shipment.id} className="p-4">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="font-medium">{shipment.shipmentNumber}</div>
                  <span className={`badge ${getStatusColor(shipment.status)}`}>{shipment.status}</span>
                </div>
                <div className="text-right text-sm">
                  {shipment.containerNumber && (
                    <div className="font-mono">{shipment.containerNumber}</div>
                  )}
                  {shipment.containerType && (
                    <div className="text-gray-500">{shipment.containerType}</div>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">Origin</div>
                  <div className="font-medium">{shipment.originPort?.name || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">Destination</div>
                  <div className="font-medium">{shipment.destinationPort?.name || '-'}</div>
                </div>
                <div>
                  <div className="text-gray-500">ETD</div>
                  <div className="font-medium">{formatDate(shipment.etd)}</div>
                </div>
                <div>
                  <div className="text-gray-500">ETA</div>
                  <div className="font-medium">{formatDate(shipment.eta)}</div>
                </div>
              </div>
              
              {(shipment.cha || shipment.transporter) && (
                <div className="grid grid-cols-2 gap-4 mt-3 pt-3 border-t text-sm">
                  {shipment.cha && (
                    <div className="flex items-center gap-2">
                      <Anchor className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">CHA: {shipment.cha.name}</span>
                    </div>
                  )}
                  {shipment.transporter && (
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-600">Transport: {shipment.transporter.name}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Invoices Tab
function InvoicesTab({ order, currency }: { order: any; currency: string }) {
  const invoices = order.invoices || [];
  const navigate = useNavigate();
  
  return (
    <div>
      {invoices.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p>No invoices created yet</p>
          <button 
            onClick={() => navigate(`/invoices/new?orderId=${order.id}`)}
            className="btn btn-primary mt-3"
          >
            <Plus className="w-4 h-4 mr-1" /> Create Invoice
          </button>
        </div>
      ) : (
        <div className="divide-y">
          {invoices.map((invoice: any) => (
            <Link 
              key={invoice.id} 
              to={`/invoices/${invoice.id}`}
              className="p-4 flex items-center justify-between hover:bg-gray-50 block"
            >
              <div>
                <div className="font-medium">{invoice.invoiceNumber}</div>
                <div className="text-sm text-gray-500">
                  {formatDate(invoice.invoiceDate)} • Due: {formatDate(invoice.dueDate)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(invoice.totalAmount, currency)}</div>
                <span className={`badge ${getStatusColor(invoice.status)}`}>{invoice.status}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}



// Status Update Modal
function StatusUpdateModal({
  currentStatus,
  onClose,
  onSave,
  isLoading,
}: {
  currentStatus: string;
  onClose: () => void;
  onSave: (status: string) => void;
  isLoading: boolean;
}) {
  const [status, setStatus] = useState(currentStatus);

  return (
    <Modal isOpen onClose={onClose} title="Update Order Status" size="sm">
      <div className="p-6 space-y-4">
        <SelectField
          label="New Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={ORDER_STATUS_OPTIONS.map(s => ({ value: s, label: s.replace(/_/g, ' ') }))}
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={() => onSave(status)} className="btn btn-primary" disabled={isLoading}>
            {isLoading ? 'Updating...' : 'Update'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Procurement Modal
function ProcurementModal({
  orderId,
  currency,
  onClose,
  onSuccess,
}: {
  orderId: string;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    supplierId: '',
    totalAmount: '',
    expectedDate: '',
    notes: '',
    // The PO sheet boxes that had no field behind them.
    deliveryAddress: '',
    modeOfDelivery: '',
    paymentMode: '',
    pickupLocation: '',
    destination: '',
    packingInstructions: '',
    qualityRequirement: '',
    variationPercent: '',
  });

  /**
   * Purchase order lines, at the supplier's price.
   *
   * Fetched when a supplier is chosen: the products and quantities come from the
   * export order, the rate from that supplier's price list and the GST from the
   * product. Every figure stays editable, because a price list is a starting point
   * and the rate is what gets negotiated.
   */
  const [lines, setLines] = useState<any[]>([]);
  const [missingPrices, setMissingPrices] = useState<string[]>([]);

  const suggest = useMutation({
    mutationFn: (supplierId: string) => ordersApi.suggestProcurement(orderId, supplierId),
    onSuccess: (response: any) => {
      const data = response?.data?.data;
      setLines(
        (data?.lines ?? []).map((l: any) => ({
          productId: l.productId,
          productName: l.productName,
          productCode: l.productCode,
          quantity: String(l.quantity),
          unit: l.unit,
          rate: String(l.rate ?? 0),
          taxPercent: l.taxPercent === null ? '' : String(l.taxPercent),
          buyerUnitPrice: l.buyerUnitPrice,
          priceFound: l.priceFound,
        }))
      );
      setMissingPrices(data?.missingPrices ?? []);
      // Standing terms from the supplier, unless the operator has already typed
      // something for this order.
      setFormData((prev) => ({
        ...prev,
        paymentMode: prev.paymentMode || data?.defaults?.paymentMode || '',
        pickupLocation: prev.pickupLocation || data?.defaults?.pickupLocation || '',
      }));
    },
    onError: (error: any) =>
      toast.error(error?.response?.data?.message || 'Could not load supplier prices'),
  });

  /**
   * Totals, computed the same way the server does: rate x quantity per line, GST on
   * each line, summed. Shown live so the figure is never a surprise, but the server
   * recomputes on save - the total is never taken from the browser.
   */
  const totals = lines.reduce(
    (acc, line) => {
      const amount = Math.round((Number(line.quantity) || 0) * (Number(line.rate) || 0) * 100) / 100;
      const pct = line.taxPercent === '' ? null : Number(line.taxPercent);
      const tax = pct === null ? 0 : Math.round(((amount * pct) / 100) * 100) / 100;
      return {
        subtotal: acc.subtotal + amount,
        tax: acc.tax + tax,
        untaxed: acc.untaxed + (pct === null ? 1 : 0),
      };
    },
    { subtotal: 0, tax: 0, untaxed: 0 }
  );
  const grandTotal = Math.round((totals.subtotal + totals.tax) * 100) / 100;

  const setLine = (index: number, key: string, value: string) =>
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => suppliersApi.list({ limit: 200 }),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.addProcurement(orderId, data),
    onSuccess: (response: any) => {
      // The payable is raised with the order, so say so - otherwise a new row in
      // Expenses looks like it appeared from nowhere.
      const raised = response?.data?.expenseSync?.action === 'created';
      toast.success(
        raised
          ? 'Purchase order created. Supplier payment added to Expenses.'
          : 'Procurement order created'
      );
      onSuccess();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Failed to create procurement order';
      toast.error(message);
    },
  });

  const handleSubmit = () => {
    // Either priced lines or a typed total - the order needs a value one way or the
    // other, and the server enforces the same rule.
    if (!formData.supplierId) {
      toast.error('Choose a supplier');
      return;
    }
    if (lines.length === 0 && !formData.totalAmount) {
      toast.error('Add line items, or enter the agreed total amount');
      return;
    }
    mutation.mutate({
      supplierId: formData.supplierId,
      // The total is computed from these on the server. A purchase order with no
      // lines still accepts a typed total, for a one-off purchase with nothing to
      // itemise.
      ...(lines.length > 0
        ? {
            items: lines.map((l) => ({
              productId: l.productId,
              quantity: Number(l.quantity) || 0,
              unit: l.unit,
              rate: Number(l.rate) || 0,
              taxPercent: l.taxPercent === '' ? null : Number(l.taxPercent),
            })),
          }
        : { totalAmount: parseFloat(formData.totalAmount) }),
      currency,
      expectedDate: formData.expectedDate || undefined,
      notes: formData.notes || undefined,
      // The PO sheet boxes. Sent only when filled, so an untouched box stays empty
      // on the printed order rather than writing an empty string.
      deliveryAddress: formData.deliveryAddress || undefined,
      modeOfDelivery: formData.modeOfDelivery || undefined,
      paymentMode: formData.paymentMode || undefined,
      pickupLocation: formData.pickupLocation || undefined,
      destination: formData.destination || undefined,
      packingInstructions: formData.packingInstructions || undefined,
      qualityRequirement: formData.qualityRequirement || undefined,
      variationPercent:
        formData.variationPercent === '' ? undefined : Number(formData.variationPercent),
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Create Purchase Order" size="lg">
      <div className="p-6 space-y-4">
        <SelectField
          label="Supplier"
          required
          value={formData.supplierId}
          onChange={(e) => {
            const supplierId = e.target.value;
            setFormData({ ...formData, supplierId });
            // Loading the supplier's prices is the whole point of choosing one, so it
            // happens here rather than behind a separate button.
            setLines([]);
            setMissingPrices([]);
            if (supplierId) suggest.mutate(supplierId);
          }}
          options={(suppliersData?.data?.data || []).map((s: any) => ({
            value: s.id,
            label: s.name,
          }))}
          placeholder="Select supplier"
        />
        {/*
          Lines at the supplier's price, fetched when a supplier is chosen. The total
          is rate x quantity per line plus GST, so it is computed rather than typed -
          which is also why the printed order and its total can no longer disagree.
        */}
        {lines.length > 0 ? (
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
              <h4 className="text-sm font-medium text-navy-900">Items at Supplier Price</h4>
              {suggest.isPending && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
            </div>
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right w-28">Rate ({currency})</th>
                  <th className="text-right w-20">GST %</th>
                  <th className="text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => {
                  const amount =
                    Math.round((Number(line.quantity) || 0) * (Number(line.rate) || 0) * 100) / 100;
                  return (
                    <tr key={line.productId}>
                      <td>
                        <div className="font-medium">{line.productName}</div>
                        <div className="text-xs text-gray-500">
                          {line.productCode}
                          {/* Shown while negotiating: what this product is being sold
                              to the buyer for. Never printed on the supplier's copy. */}
                          {line.buyerUnitPrice ? (
                            <span className="ml-2 text-gray-400">
                              sells at {formatCurrency(line.buyerUnitPrice, currency)}
                            </span>
                          ) : null}
                        </div>
                        {!line.priceFound && (
                          <div className="text-xs text-amber-700">No price on file</div>
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {line.quantity} {line.unit}
                      </td>
                      <td>
                        <input
                          className="input text-right py-1"
                          type="number"
                          step="0.01"
                          min="0"
                          value={line.rate}
                          onChange={(e) => setLine(i, 'rate', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="input text-right py-1"
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          placeholder="—"
                          value={line.taxPercent}
                          onChange={(e) => setLine(i, 'taxPercent', e.target.value)}
                        />
                      </td>
                      <td className="text-right font-medium whitespace-nowrap">
                        {formatCurrency(amount, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right text-gray-600">Taxable Value</td>
                  <td className="text-right">{formatCurrency(totals.subtotal, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="text-right text-gray-600">GST</td>
                  <td className="text-right">{formatCurrency(totals.tax, currency)}</td>
                </tr>
                <tr className="bg-gray-50">
                  <td colSpan={4} className="text-right font-semibold">Total</td>
                  <td className="text-right font-bold">{formatCurrency(grandTotal, currency)}</td>
                </tr>
              </tfoot>
            </table>
            {(missingPrices.length > 0 || totals.untaxed > 0) && (
              <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 space-y-1">
                {missingPrices.length > 0 && (
                  <div>
                    No supplier price on file for {missingPrices.join(', ')} — enter the agreed
                    rate, and add it to the supplier's price list to save typing next time.
                  </div>
                )}
                {totals.untaxed > 0 && (
                  <div>
                    {totals.untaxed} line{totals.untaxed === 1 ? '' : 's'} have no GST rate. Set it
                    on the product to have it filled in automatically.
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          // No lines: either no supplier chosen yet, or a one-off purchase with
          // nothing to itemise, which can still be recorded as a single figure.
          <FormField
            label={`Total Amount (${currency})`}
            type="number"
            step="0.01"
            value={formData.totalAmount}
            onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
            hint={
              formData.supplierId
                ? 'This order has no line items to price. Enter the agreed total.'
                : 'Choose a supplier to load items at their prices.'
            }
          />
        )}

        <FormField
          label="Expected Delivery Date"
          type="date"
          value={formData.expectedDate}
          onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
        />

        {/*
          The boxes printed on the purchase order sheet. Each was blank on every PO
          before, so a supplier received an order without a delivery point, packing
          specification or quality clause. All optional - a repeat local pickup needs
          few of them.
        */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-medium text-navy-900">Delivery &amp; Payment</h4>
            <p className="text-xs text-gray-500 mt-0.5">Printed on the purchase order.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="Mode of Delivery"
              value={formData.modeOfDelivery}
              onChange={(e) => setFormData({ ...formData, modeOfDelivery: e.target.value })}
              placeholder="Road / Ex-factory pickup"
            />
            <FormField
              label="Expected Mode of Payment"
              value={formData.paymentMode}
              onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value })}
              placeholder="50% advance, 50% on delivery"
            />
            <FormField
              label="Pickup Location"
              value={formData.pickupLocation}
              onChange={(e) => setFormData({ ...formData, pickupLocation: e.target.value })}
              placeholder="Factory, Unjha"
            />
            <FormField
              label="Destination"
              value={formData.destination}
              onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
              placeholder="Warehouse / Mundra Port ICD"
            />
          </div>
          <TextareaField
            label="Delivery / Consignment Address"
            rows={2}
            value={formData.deliveryAddress}
            onChange={(e) => setFormData({ ...formData, deliveryAddress: e.target.value })}
            placeholder="Only if goods go somewhere other than your own address"
          />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <h4 className="text-sm font-medium text-navy-900">Packing &amp; Quality</h4>
          <TextareaField
            label="Packing Instructions"
            rows={2}
            value={formData.packingInstructions}
            onChange={(e) => setFormData({ ...formData, packingInstructions: e.target.value })}
            placeholder="e.g. 25kg HDPE bags with inner liner"
          />
          <TextareaField
            label="Quality Requirement"
            rows={2}
            value={formData.qualityRequirement}
            onChange={(e) => setFormData({ ...formData, qualityRequirement: e.target.value })}
            placeholder="e.g. Batch-wise COA required with delivery (purity, moisture, microbial)"
          />
          <FormField
            label="Variation % +/-"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={formData.variationPercent}
            onChange={(e) => setFormData({ ...formData, variationPercent: e.target.value })}
            placeholder="e.g. 5"
          />
        </div>

        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating...' : 'Create PO'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Shipment Modal
function ShipmentModal({
  orderId,
  defaultOriginPortId,
  defaultDestinationPortId,
  quotationCosts,
  onClose,
  onSuccess,
}: {
  orderId: string;
  defaultOriginPortId?: string;
  defaultDestinationPortId?: string;
  /** Additional costs from the quotation, used to prefill shipment costs */
  quotationCosts?: Array<{ costType: string; description: string; amount: any }>;
  onClose: () => void;
  onSuccess: () => void;
}) {
  /**
   * Extract cost amounts from quotation costs by type.
   * Quotation costType values: CHA, TRANSPORT, FREIGHT, PACKAGING, OTHER
   */
  const getQuotedCost = (types: string[]) => {
    if (!quotationCosts) return '';
    const cost = quotationCosts.find((c) =>
      types.some((t) => c.costType.toUpperCase().includes(t))
    );
    return cost ? String(Number(cost.amount)) : '';
  };

  const [formData, setFormData] = useState({
    chaId: '',
    transporterId: '',
    originPortId: defaultOriginPortId || '',
    destinationPortId: defaultDestinationPortId || '',
    containerNumber: '',
    containerType: '20FT',
    // Printed on the invoice and packing list.
    vesselName: '',
    blNumber: '',
    // Costs. Each one entered raises the matching expense automatically, so these
    // are the fields that populate the Expenses module.
    // Pre-filled from quotation additional costs when available.
    freightCost: getQuotedCost(['FREIGHT', 'SHIPPING']),
    chaCharges: getQuotedCost(['CHA', 'CUSTOMS', 'CLEARANCE']),
    transportCharges: getQuotedCost(['TRANSPORT', 'TRUCKING', 'LOGISTICS']),
    etd: '',
    eta: '',
    notes: '',
  });

  const { data: chasData } = useQuery({
    queryKey: ['chas-list'],
    queryFn: () => chaApi.list({ limit: 100 }),
  });

  const { data: transportersData } = useQuery({
    queryKey: ['transporters-list'],
    queryFn: () => transportersApi.list({ limit: 100 }),
  });

  const { data: portsData } = useQuery({
    queryKey: ['ports-all'],
    queryFn: () => masterApi.getPorts({ limit: 500, includeInactive: true }),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.addShipment(orderId, data),
    onSuccess: (response: any) => {
      // Say so when costs were entered, otherwise the expenses appearing in the
      // finance section looks like something nobody asked for.
      const raised = (response?.data?.expenseSync ?? []).filter(
        (r: any) => r?.action === 'created'
      ).length;
      toast.success(
        raised > 0
          ? `Shipment created. ${raised} expense${raised === 1 ? '' : 's'} added to Expenses.`
          : 'Shipment created'
      );
      onSuccess();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Failed to create shipment';
      toast.error(message);
    },
  });

  /** Blank stays blank: an empty cost is unknown, not zero. */
  const numberOrUndefined = (value: string) => {
    if (value === '' || value === null) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  };

  const handleSubmit = () => {
    mutation.mutate({
      chaId: formData.chaId || undefined,
      transporterId: formData.transporterId || undefined,
      originPortId: formData.originPortId || undefined,
      destinationPortId: formData.destinationPortId || undefined,
      containerNumber: formData.containerNumber || undefined,
      containerType: formData.containerType || undefined,
      vesselName: formData.vesselName || undefined,
      blNumber: formData.blNumber || undefined,
      freightCost: numberOrUndefined(formData.freightCost),
      chaCharges: numberOrUndefined(formData.chaCharges),
      transportCharges: numberOrUndefined(formData.transportCharges),
      etd: formData.etd || undefined,
      eta: formData.eta || undefined,
      notes: formData.notes || undefined,
    });
  };

  const ports = portsData?.data?.data || [];

  return (
    <Modal isOpen onClose={onClose} title="Create Shipment" size="lg">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="CHA (Customs House Agent)"
            value={formData.chaId}
            onChange={(e) => setFormData({ ...formData, chaId: e.target.value })}
            options={(chasData?.data?.data || []).map((c: any) => ({
              value: c.id,
              label: c.name,
            }))}
            placeholder="Select CHA"
          />
          <SelectField
            label="Transporter"
            value={formData.transporterId}
            onChange={(e) => setFormData({ ...formData, transporterId: e.target.value })}
            options={(transportersData?.data?.data || []).map((t: any) => ({
              value: t.id,
              label: t.name,
            }))}
            placeholder="Select transporter"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Origin Port"
            value={formData.originPortId}
            onChange={(e) => setFormData({ ...formData, originPortId: e.target.value })}
            options={ports.map((p: any) => ({
              value: p.id,
              label: `${p.name} (${p.code})`,
            }))}
            placeholder="Select origin port"
          />
          <SelectField
            label="Destination Port"
            value={formData.destinationPortId}
            onChange={(e) => setFormData({ ...formData, destinationPortId: e.target.value })}
            options={ports.map((p: any) => ({
              value: p.id,
              label: `${p.name} (${p.code})`,
            }))}
            placeholder="Select destination port"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Container Number"
            value={formData.containerNumber}
            onChange={(e) => setFormData({ ...formData, containerNumber: e.target.value })}
            placeholder="e.g., MSCU1234567"
          />
          <SelectField
            label="Container Type"
            value={formData.containerType}
            onChange={(e) => setFormData({ ...formData, containerType: e.target.value })}
            options={[
              { value: '20FT', label: '20 FT Standard' },
              { value: '40FT', label: '40 FT Standard' },
              { value: '40HC', label: '40 FT High Cube' },
              { value: '20RF', label: '20 FT Reefer' },
              { value: '40RF', label: '40 FT Reefer' },
              { value: 'LCL', label: 'LCL (Less than Container)' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="ETD (Estimated Time of Departure)"
            type="date"
            value={formData.etd}
            onChange={(e) => setFormData({ ...formData, etd: e.target.value })}
          />
          <FormField
            label="ETA (Estimated Time of Arrival)"
            type="date"
            value={formData.eta}
            onChange={(e) => setFormData({ ...formData, eta: e.target.value })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Vessel / Flight No"
            value={formData.vesselName}
            onChange={(e) => setFormData({ ...formData, vesselName: e.target.value })}
            placeholder="MV Maersk Cabinda"
          />
          <FormField
            label="BL / AWB Number"
            value={formData.blNumber}
            onChange={(e) => setFormData({ ...formData, blNumber: e.target.value })}
          />
        </div>

        {/*
          Costs. Each figure entered here raises a matching expense in the Expenses
          section, against the CHA or transporter named above, so the payable does
          not have to be typed a second time. Leave one blank if it is not yet known
          and fill it in later - blank means unknown, not zero.
        */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div>
            <h4 className="text-sm font-medium text-navy-900">Costs</h4>
            <p className="text-xs text-gray-500 mt-0.5">
              Each amount entered is added to Expenses automatically and tracked until paid.
            </p>
            {quotationCosts && quotationCosts.length > 0 && (
              <p className="text-xs text-green-600 mt-1">
                ✓ Pre-filled from quotation additional costs. Adjust if needed.
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-4">
            <FormField
              label="Freight (₹)"
              type="number"
              step="0.01"
              min="0"
              value={formData.freightCost}
              onChange={(e) => setFormData({ ...formData, freightCost: e.target.value })}
            />
            <FormField
              label="CHA Charges (₹)"
              type="number"
              step="0.01"
              min="0"
              value={formData.chaCharges}
              onChange={(e) => setFormData({ ...formData, chaCharges: e.target.value })}
            />
            <FormField
              label="Transport (₹)"
              type="number"
              step="0.01"
              min="0"
              value={formData.transportCharges}
              onChange={(e) => setFormData({ ...formData, transportCharges: e.target.value })}
            />
          </div>
        </div>

        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
          placeholder="Shipping line, booking reference..."
        />

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={mutation.isPending}>
            <Ship className="w-4 h-4 mr-2" />
            {mutation.isPending ? 'Creating...' : 'Create Shipment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Document Update Modal
function DocumentUpdateModal({
  orderId,
  document,
  onClose,
  onSuccess,
}: {
  orderId: string;
  document: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    status: document.status,
    documentNo: document.documentNo || '',
    notes: document.notes || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.updateDocument(orderId, document.id, data),
    onSuccess: () => {
      toast.success('Document updated');
      onSuccess();
    },
    onError: () => toast.error('Failed to update document'),
  });

  const docTypeLabels: Record<string, string> = {
    COMMERCIAL_INVOICE: 'Commercial Invoice',
    PACKING_LIST: 'Packing List',
    BILL_OF_LADING: 'Bill of Lading',
    CERTIFICATE_OF_ORIGIN: 'Certificate of Origin',
    PHYTOSANITARY: 'Phytosanitary Certificate',
    FUMIGATION: 'Fumigation Certificate',
    QUALITY_CERTIFICATE: 'Quality Certificate',
    INSURANCE: 'Insurance Certificate',
    CUSTOMS_DECLARATION: 'Customs Declaration',
  };

  return (
    <Modal isOpen onClose={onClose} title={`Update: ${docTypeLabels[document.documentType] || document.documentType}`} size="md">
      <div className="p-6 space-y-4">
        <SelectField
          label="Status"
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          options={[
            { value: 'PENDING', label: 'Pending' },
            { value: 'IN_PROGRESS', label: 'In Progress' },
            { value: 'COMPLETED', label: 'Completed' },
          ]}
        />
        <FormField
          label="Document Number"
          value={formData.documentNo}
          onChange={(e) => setFormData({ ...formData, documentNo: e.target.value })}
          placeholder="Enter document reference number"
        />
        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button 
            onClick={() => mutation.mutate(formData)} 
            className="btn btn-primary" 
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Attachments Section - allows uploading and managing file attachments
function AttachmentsSection({ orderId }: { orderId: string }) {
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);

  // Fetch attachments
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['attachments', 'ORDER', orderId],
    queryFn: () => attachmentsApi.list('ORDER', orderId),
  });

  const attachments = data?.data?.data || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => attachmentsApi.delete(id),
    onSuccess: () => {
      toast.success('Attachment deleted');
      refetch();
    },
    onError: () => toast.error('Failed to delete attachment'),
  });

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB');
      return;
    }

    setIsUploading(true);
    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(',')[1];
        
        await attachmentsApi.upload({
          entityType: 'ORDER',
          entityId: orderId,
          fileName: file.name,
          mimeType: file.type,
          fileData: base64,
        });

        toast.success('File uploaded successfully');
        refetch();
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to upload file');
    } finally {
      setIsUploading(false);
      // Reset input
      if (e.target) e.target.value = '';
    }
  };

  // Handle download
  const handleDownload = async (attachment: any) => {
    try {
      const response = await attachmentsApi.download(attachment.id);
      const blob = new Blob([response.data], { type: attachment.mimeType });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.originalName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      toast.error('Failed to download file');
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="mt-6 border-t pt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium flex items-center gap-2">
          <Paperclip className="w-4 h-4" />
          Attachments
        </h3>
        <label className="btn btn-secondary btn-sm cursor-pointer">
          <Upload className="w-4 h-4 mr-2" />
          {isUploading ? 'Uploading...' : 'Upload File'}
          <input
            type="file"
            className="hidden"
            onChange={handleFileSelect}
            disabled={isUploading}
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif"
          />
        </label>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500 text-center py-4">Loading attachments...</div>
      ) : attachments.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-4 border border-dashed rounded-lg">
          <Paperclip className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          No attachments yet. Upload BL, CoO, certificates, or other documents.
        </div>
      ) : (
        <div className="space-y-2">
          {attachments.map((attachment: any) => (
            <div
              key={attachment.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="w-8 h-8 text-navy-600 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{attachment.originalName}</div>
                  <div className="text-xs text-gray-500">
                    {formatFileSize(attachment.fileSize)} • {formatDate(attachment.createdAt)}
                    {attachment.uploadedBy && (
                      <span> • {attachment.uploadedBy.firstName}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(attachment)}
                  className="p-2 text-navy-600 hover:bg-navy-100 rounded"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm('Delete this attachment?')) {
                      deleteMutation.mutate(attachment.id);
                    }
                  }}
                  className="p-2 text-red-600 hover:bg-red-100 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



// Edit Order Modal
function EditOrderModal({
  order,
  onClose,
  onSuccess,
}: {
  order: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    expectedDate: order.expectedDate?.split('T')[0] || '',
    poNumber: order.poNumber || '',
    notes: order.notes || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.update(order.id, data),
    onSuccess: () => {
      toast.success('Order updated successfully');
      onSuccess();
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to update order'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit Order" size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <FormField
          label="Expected Delivery Date"
          type="date"
          required
          value={formData.expectedDate}
          onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
        />

        <FormField
          label="Customer PO Number"
          value={formData.poNumber}
          onChange={(e) => setFormData({ ...formData, poNumber: e.target.value })}
          placeholder="Buyer's purchase order reference"
        />

        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={3}
          placeholder="Internal notes..."
        />

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}