// Enhanced OrderDetail Page - Complete Export Operations Management
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ordersApi, chaApi, transportersApi, suppliersApi, masterApi } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, formatDate, getStatusColor, isPastDue, cn } from '@/lib/utils';
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
  DollarSign,
  Truck,
  Anchor,
  Plus,
  Edit,
  AlertTriangle,
  FileCheck,
  ClipboardList,
  Receipt,
  Boxes,
  Download,
} from 'lucide-react';

const ORDER_STAGES = ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'];

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

  const [activeTab, setActiveTab] = useState<'items' | 'packing' | 'procurement' | 'documents' | 'shipments' | 'invoices'>('items');
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showProcurementModal, setShowProcurementModal] = useState(false);
  const [showShipmentModal, setShowShipmentModal] = useState(false);
  const [showDocumentModal, setShowDocumentModal] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState<any>(null);

  // Fetch order details
  const { data: response, isLoading } = useQuery({
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
  const currency = order.currency?.code || order.currency || 'USD';
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
                  { key: 'packing', label: 'Packing', icon: Boxes, count: order.items?.filter((i: any) => i.numberOfPackages).length },
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
            {activeTab === 'packing' && <PackingTab order={order} />}
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
                <DollarSign className="w-5 h-5" />
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

      {showProcurementModal && (
        <ProcurementModal
          orderId={id!}
          currency={currency}
          onClose={() => setShowProcurementModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['order', id] });
            setShowProcurementModal(false);
          }}
        />
      )}

      {showShipmentModal && (
        <ShipmentModal
          orderId={id!}
          onClose={() => setShowShipmentModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['order', id] });
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
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th className="text-right">Quantity</th>
            <th className="text-right">Unit Price</th>
            <th className="text-right">Total</th>
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
              <td className="text-right font-semibold">{formatCurrency(item.totalPrice, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50">
            <td colSpan={3} className="text-right font-semibold">Order Total</td>
            <td className="text-right font-bold text-lg">
              {formatCurrency(order.totalValue || order.grandTotal, currency)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Packing figures per order line. These drive the Packing List document and the
 * weight summary printed on the commercial and proforma invoices, so the
 * Packing List stays empty until they are filled in.
 */
function PackingTab({ order }: { order: any }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({
    numberOfPackages: '',
    packageWeight: '',
    netWeight: '',
    grossWeight: '',
  });
  const [downloading, setDownloading] = useState(false);

  const savePacking = useMutation({
    mutationFn: ({ itemId, data }: { itemId: string; data: any }) =>
      ordersApi.updateItemPacking(order.id, itemId, data),
    onSuccess: () => {
      toast.success('Packing details saved');
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      setEditing(null);
    },
    onError: (error: any) =>
      toast.error(error.response?.data?.message || 'Could not save packing details'),
  });

  const startEdit = (item: any) => {
    setEditing(item.id);
    setForm({
      numberOfPackages: item.numberOfPackages?.toString() ?? '',
      // Fall back to the product's default packing so it need not be retyped
      packageWeight: (item.packageWeight ?? item.product?.packageNetWeight)?.toString() ?? '',
      netWeight: item.netWeight?.toString() ?? '',
      grossWeight: item.grossWeight?.toString() ?? '',
    });
  };

  const submit = (itemId: string) => {
    // Only send fields that were actually filled, so blanks do not overwrite
    // existing values with nulls.
    const data: Record<string, number> = {};
    if (form.numberOfPackages) data.numberOfPackages = parseInt(form.numberOfPackages);
    if (form.packageWeight) data.packageWeight = parseFloat(form.packageWeight);
    if (form.netWeight) data.netWeight = parseFloat(form.netWeight);
    if (form.grossWeight) data.grossWeight = parseFloat(form.grossWeight);

    if (Object.keys(data).length === 0) {
      toast.error('Enter at least one packing value');
      return;
    }
    if (data.netWeight && data.grossWeight && data.grossWeight < data.netWeight) {
      toast.error('Gross weight cannot be less than net weight');
      return;
    }
    savePacking.mutate({ itemId, data });
  };

  const downloadPackingList = async () => {
    setDownloading(true);
    try {
      const response = await ordersApi.downloadPackingList(order.id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `PackingList-${order.orderNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Could not generate the packing list');
    } finally {
      setDownloading(false);
    }
  };

  const items = order.items ?? [];
  const totals = items.reduce(
    (acc: any, i: any) => ({
      packages: acc.packages + Number(i.numberOfPackages || 0),
      net: acc.net + Number(i.netWeight || 0),
      gross: acc.gross + Number(i.grossWeight || 0),
    }),
    { packages: 0, net: 0, gross: 0 }
  );
  const anyPacking = items.some((i: any) => i.numberOfPackages || i.netWeight);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm text-gray-500">
          Cartons and weights for the Packing List and invoice weight summary.
        </p>
        <button
          onClick={downloadPackingList}
          disabled={downloading || !anyPacking}
          className="btn btn-secondary"
          title={anyPacking ? 'Download the Packing List' : 'Enter packing details first'}
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Generating...' : 'Packing List'}
        </button>
      </div>

      {!anyPacking && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            No packing details recorded yet. The Packing List needs the number of packages and
            net/gross weights for each line.
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th className="text-right">No. of Packages</th>
              <th className="text-right">Bag / Carton per KG</th>
              <th className="text-right">Net Weight</th>
              <th className="text-right">Gross Weight</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item: any) => {
              const isEditing = editing === item.id;
              return (
                <tr key={item.id}>
                  <td>
                    <div className="font-medium">{item.product?.name}</div>
                    <div className="text-xs text-gray-500">
                      {item.product?.hsnCode || item.product?.code} &middot; {item.quantity} {item.unit}
                    </div>
                  </td>
                  {isEditing ? (
                    <>
                      <td>
                        <input
                          type="number"
                          min="1"
                          className="input text-right w-24"
                          value={form.numberOfPackages}
                          onChange={(e) => setForm({ ...form, numberOfPackages: e.target.value })}
                          aria-label="Number of packages"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="input text-right w-24"
                          value={form.packageWeight}
                          onChange={(e) => setForm({ ...form, packageWeight: e.target.value })}
                          aria-label="Weight per package in kg"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="input text-right w-24"
                          value={form.netWeight}
                          onChange={(e) => setForm({ ...form, netWeight: e.target.value })}
                          aria-label="Net weight"
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min="0"
                          step="0.001"
                          className="input text-right w-24"
                          value={form.grossWeight}
                          onChange={(e) => setForm({ ...form, grossWeight: e.target.value })}
                          aria-label="Gross weight"
                        />
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          onClick={() => submit(item.id)}
                          disabled={savePacking.isPending}
                          className="btn btn-primary btn-sm"
                        >
                          Save
                        </button>
                        <button onClick={() => setEditing(null)} className="btn btn-ghost btn-sm ml-1">
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="text-right">{item.numberOfPackages ?? '-'}</td>
                      <td className="text-right">
                        {item.packageWeight ?? item.product?.packageNetWeight ?? '-'}
                      </td>
                      <td className="text-right">{item.netWeight ?? '-'}</td>
                      <td className="text-right">{item.grossWeight ?? '-'}</td>
                      <td className="text-right">
                        <button onClick={() => startEdit(item)} className="btn btn-ghost btn-sm">
                          <Edit className="w-4 h-4" />
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 font-semibold">
              <td className="text-right">TOTAL</td>
              <td className="text-right">{totals.packages || '-'}</td>
              <td></td>
              <td className="text-right">{totals.net ? `${totals.net} KGS` : '-'}</td>
              <td className="text-right">{totals.gross ? `${totals.gross} KGS` : '-'}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
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
                <div className="text-right">
                  <div className="font-semibold">{formatCurrency(po.totalAmount, po.currency || currency)}</div>
                  <span className={`badge ${getStatusColor(po.status)}`}>{po.status}</span>
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
    <div className="divide-y">
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
          options={ORDER_STAGES.map(s => ({ value: s, label: s.replace(/_/g, ' ') }))}
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
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => suppliersApi.list({ limit: 200 }),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.addProcurement(orderId, data),
    onSuccess: () => {
      toast.success('Procurement order created');
      onSuccess();
    },
    onError: () => toast.error('Failed to create procurement order'),
  });

  const handleSubmit = () => {
    if (!formData.supplierId || !formData.totalAmount) {
      toast.error('Please fill required fields');
      return;
    }
    mutation.mutate({
      ...formData,
      totalAmount: parseFloat(formData.totalAmount),
      currency,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Create Purchase Order" size="md">
      <div className="p-6 space-y-4">
        <SelectField
          label="Supplier"
          required
          value={formData.supplierId}
          onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
          options={(suppliersData?.data?.data || []).map((s: any) => ({
            value: s.id,
            label: s.name,
          }))}
          placeholder="Select supplier"
        />
        <FormField
          label={`Total Amount (${currency})`}
          required
          type="number"
          step="0.01"
          value={formData.totalAmount}
          onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
        />
        <FormField
          label="Expected Delivery Date"
          type="date"
          value={formData.expectedDate}
          onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
        />
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
  onClose,
  onSuccess,
}: {
  orderId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    chaId: '',
    transporterId: '',
    originPortId: '',
    destinationPortId: '',
    containerNumber: '',
    containerType: '20FT',
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
    queryKey: ['ports'],
    queryFn: () => masterApi.getPorts({ limit: 200 }),
  });

  const mutation = useMutation({
    mutationFn: (data: any) => ordersApi.addShipment(orderId, data),
    onSuccess: () => {
      toast.success('Shipment created');
      onSuccess();
    },
    onError: () => toast.error('Failed to create shipment'),
  });

  const handleSubmit = () => {
    mutation.mutate({
      ...formData,
      chaId: formData.chaId || undefined,
      transporterId: formData.transporterId || undefined,
      originPortId: formData.originPortId || undefined,
      destinationPortId: formData.destinationPortId || undefined,
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

        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
          placeholder="Shipping line, vessel name, booking reference..."
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
