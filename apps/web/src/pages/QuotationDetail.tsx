// Quotation Detail Page - Comprehensive view with costing analysis
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { quotationsApi } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, formatDate, cn } from '@/lib/utils';
import {
  ArrowLeft,
  FileText,
  Download,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  Building2,
  Package,
  DollarSign,
  TrendingUp,
  Edit,
  ShoppingCart,
  Calculator,
  AlertCircle,
  Mail,
  Phone,
  MapPin,
  Calendar,
  FileCheck,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  DRAFT: { color: 'text-gray-700', bg: 'bg-gray-100', icon: FileText },
  SENT: { color: 'text-blue-700', bg: 'bg-blue-100', icon: Send },
  VIEWED: { color: 'text-purple-700', bg: 'bg-purple-100', icon: FileCheck },
  ACCEPTED: { color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle },
  REJECTED: { color: 'text-red-700', bg: 'bg-red-100', icon: XCircle },
  EXPIRED: { color: 'text-orange-700', bg: 'bg-orange-100', icon: Clock },
  REVISED: { color: 'text-yellow-700', bg: 'bg-yellow-100', icon: Edit },
};

export default function QuotationDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showConvertModal, setShowConvertModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'items' | 'costs'>('items');

  // Fetch quotation details
  const { data: response, isLoading } = useQuery({
    queryKey: ['quotation', id],
    queryFn: () => quotationsApi.get(id!),
    enabled: !!id,
  });

  const quotation = response?.data?.data;

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
      quotationsApi.updateStatus(id!, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quotation', id] });
      toast.success('Status updated successfully');
      setShowStatusModal(false);
    },
    onError: () => toast.error('Failed to update status'),
  });

  // Download PDF
  const handleDownloadPdf = async () => {
    try {
      const response = await quotationsApi.downloadPdf(id!);
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Quotation-${quotation?.quotationNumber}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('PDF downloaded');
    } catch {
      toast.error('Failed to download PDF');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-600"></div>
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Quotation not found</h2>
        <button onClick={() => navigate('/quotations')} className="btn btn-primary mt-4">
          Back to Quotations
        </button>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[quotation.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = statusConfig.icon;
  const currency = quotation.currency?.code || 'USD';

  // A quotation can only ever be converted into one order; the API returns the
  // relation as an array so take the first entry if it exists.
  const linkedOrder = quotation.orders?.[0] ?? null;

  // Totals come straight from the stored line figures. Every cost component is
  // already inside each line's price, so nothing is added again here.
  const itemsTotal = quotation.items?.reduce((sum: number, item: any) => sum + Number(item.totalPrice || 0), 0) || 0;
  const totalCost = quotation.items?.reduce((sum: number, item: any) => sum + Number(item.totalCost || 0), 0) || 0;
  const margin = quotation.items?.reduce((sum: number, item: any) => sum + Number(item.margin || 0), 0) || 0;
  const marginPercent = itemsTotal > 0 ? (margin / itemsTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/quotations')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{quotation.quotationNumber}</h1>
              <span className={cn('px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1', statusConfig.bg, statusConfig.color)}>
                <StatusIcon className="w-4 h-4" />
                {quotation.status}
              </span>
            </div>
            <p className="text-gray-500 mt-1">
              Created {formatDate(quotation.createdAt)} • Valid until {formatDate(quotation.validUntil)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadPdf} className="btn btn-secondary">
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </button>
          {quotation.status === 'DRAFT' && (
            <button onClick={() => updateStatusMutation.mutate({ status: 'SENT' })} className="btn btn-primary">
              <Send className="w-4 h-4 mr-2" />
              Mark as Sent
            </button>
          )}
          {quotation.status === 'SENT' && (
            <button onClick={() => setShowStatusModal(true)} className="btn btn-gold">
              <CheckCircle className="w-4 h-4 mr-2" />
              Update Status
            </button>
          )}
          {quotation.status === 'ACCEPTED' && linkedOrder == null && (
            <button onClick={() => setShowConvertModal(true)} className="btn btn-primary">
              <ShoppingCart className="w-4 h-4 mr-2" />
              Convert to Order
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Buyer Info Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Buyer Information
              </h2>
            </div>
            <div className="card-body">
              <div className="flex justify-between">
                <div>
                  <Link to={`/buyers/${quotation.buyer?.id}`} className="text-lg font-semibold text-navy-600 hover:underline">
                    {quotation.buyer?.companyName}
                  </Link>
                  <p className="text-gray-500">{quotation.buyer?.code}</p>
                  {quotation.buyer?.address && (
                    <p className="text-sm text-gray-600 mt-2 flex items-start gap-1">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      {quotation.buyer.address}, {quotation.buyer.city}, {quotation.buyer.country?.name}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  {quotation.buyer?.email && (
                    <p className="flex items-center justify-end gap-1 text-gray-600">
                      <Mail className="w-4 h-4" />
                      {quotation.buyer.email}
                    </p>
                  )}
                  {quotation.buyer?.phone && (
                    <p className="flex items-center justify-end gap-1 text-gray-600 mt-1">
                      <Phone className="w-4 h-4" />
                      {quotation.buyer.phone}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="card">
            <div className="border-b">
              <nav className="flex -mb-px">
                {[
                  { key: 'items', label: 'Line Items', icon: Package },
                  { key: 'costs', label: 'Additional Costs', icon: DollarSign },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key as any)}
                    className={cn(
                      'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px',
                      activeTab === tab.key
                        ? 'border-navy-600 text-navy-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    )}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Items Tab */}
            {activeTab === 'items' && (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit Cost</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Margin</th>
                      <th className="text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotation.items?.map((item: any, idx: number) => {
                      const itemMargin = item.totalPrice - item.totalCost;
                      const itemMarginPct = item.totalPrice > 0 ? (itemMargin / item.totalPrice) * 100 : 0;
                      return (
                        <tr key={idx}>
                          <td>
                            <div className="font-medium">{item.product?.name}</div>
                            <div className="text-xs text-gray-500">{item.product?.code}</div>
                            {item.specifications && (
                              <div className="text-xs text-gray-400 mt-1">{item.specifications}</div>
                            )}
                          </td>
                          <td className="text-right">{item.quantity} {item.unit}</td>
                          <td className="text-right text-gray-600">{formatCurrency(item.unitCost, currency)}</td>
                          <td className="text-right font-medium">{formatCurrency(item.unitPrice, currency)}</td>
                          <td className="text-right">
                            <span className={cn(
                              'font-medium',
                              itemMarginPct >= 20 ? 'text-green-600' :
                              itemMarginPct >= 15 ? 'text-yellow-600' : 'text-red-600'
                            )}>
                              {itemMarginPct.toFixed(1)}%
                            </span>
                          </td>
                          <td className="text-right font-semibold">{formatCurrency(item.totalPrice, currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50">
                      <td colSpan={5} className="text-right font-semibold">Items Subtotal</td>
                      <td className="text-right font-bold">{formatCurrency(itemsTotal, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Pricing breakdown - internal only, never shown to the buyer */}
            {activeTab === 'costs' && (
              <div className="card-body space-y-6">
                <p className="text-sm text-gray-500">
                  How each line price was built. This breakdown is internal and does not
                  appear on the PDF sent to the buyer.
                </p>

                {quotation.items?.map((item: any) => {
                  const qty = Number(item.quantity) || 0;
                  return (
                    <div key={item.id} className="border rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
                        <div>
                          <span className="font-medium">{item.product?.name}</span>
                          <span className="text-sm text-gray-500 ml-2">
                            {qty} {item.unit}
                          </span>
                        </div>
                        <span className="text-sm font-semibold">
                          {formatCurrency(item.totalPrice, currency)}
                        </span>
                      </div>
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Component</th>
                            <th>Basis</th>
                            <th className="text-right">Value</th>
                            <th className="text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {item.costs?.length > 0 ? (
                            item.costs.map((component: any) => (
                              <tr key={component.id}>
                                <td>
                                  {component.name}
                                  {component.isMargin && (
                                    <span className="badge badge-success ml-2 text-xs">margin</span>
                                  )}
                                </td>
                                <td className="text-gray-500 text-xs">
                                  {component.calcType === 'PER_UNIT' ? 'per unit'
                                    : component.calcType === 'PERCENT_OF_COST' ? '% of cost'
                                    : 'fixed'}
                                </td>
                                <td className="text-right text-gray-600">
                                  {component.calcType === 'PERCENT_OF_COST'
                                    ? `${Number(component.value)}%`
                                    : formatCurrency(component.value, currency)}
                                </td>
                                <td className={cn(
                                  'text-right font-medium',
                                  component.isMargin ? 'text-green-700' : ''
                                )}>
                                  {formatCurrency(component.amount, currency)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="text-center py-4 text-gray-500 text-sm">
                                No component breakdown stored for this line.
                              </td>
                            </tr>
                          )}
                        </tbody>
                        <tfoot>
                          <tr className="bg-gray-50">
                            <td colSpan={3} className="text-right text-gray-500">Cost</td>
                            <td className="text-right">{formatCurrency(item.totalCost, currency)}</td>
                          </tr>
                          <tr className="bg-gray-50">
                            <td colSpan={3} className="text-right text-gray-500">Margin</td>
                            <td className="text-right text-green-700">
                              {formatCurrency(item.margin, currency)}
                            </td>
                          </tr>
                          <tr className="bg-navy-50">
                            <td colSpan={3} className="text-right font-semibold">
                              Line total ÷ {qty} {item.unit} =
                            </td>
                            <td className="text-right font-bold">
                              {formatCurrency(item.unitPrice, currency)}/unit
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  );
                })}

                {(!quotation.items || quotation.items.length === 0) && (
                  <p className="text-center py-8 text-gray-500">No line items.</p>
                )}
              </div>
            )}

          </div>

          {/* Terms & Notes */}
          {(quotation.notes || quotation.termsConditions) && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Notes & Terms</h2>
              </div>
              <div className="card-body space-y-4">
                {quotation.notes && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Notes</h3>
                    <p className="text-gray-700 whitespace-pre-wrap">{quotation.notes}</p>
                  </div>
                )}
                {quotation.termsConditions && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Terms & Conditions</h3>
                    <p className="text-gray-700 whitespace-pre-wrap text-sm">{quotation.termsConditions}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Costing Summary */}
          <CostingSummaryCard
            itemsTotal={itemsTotal}
            totalCost={totalCost}
            margin={margin}
            marginPercent={marginPercent}
            currency={currency}
          />

          {/* Quick Info */}
          <QuickInfoCard quotation={quotation} />

          {/* Related Records */}
          <RelatedRecordsCard quotation={quotation} />
        </div>
      </div>

      {/* Status Update Modal */}
      {showStatusModal && (
        <StatusUpdateModal
          currentStatus={quotation.status}
          onClose={() => setShowStatusModal(false)}
          onSave={(status, notes) => updateStatusMutation.mutate({ status, notes })}
          isLoading={updateStatusMutation.isPending}
        />
      )}

      {/* Convert to Order Modal */}
      {showConvertModal && (
        <ConvertToOrderModal
          quotation={quotation}
          onClose={() => setShowConvertModal(false)}
        />
      )}
    </div>
  );
}



// Costing Summary Card Component
function CostingSummaryCard({
  itemsTotal,
  totalCost,
  margin,
  marginPercent,
  currency,
}: {
  itemsTotal: number;
  totalCost: number;
  margin: number;
  marginPercent: number;
  currency: string;
}) {
  return (
    <div className="card">
      <div className="card-header bg-navy-900 text-white rounded-t-xl">
        <h2 className="font-semibold flex items-center gap-2">
          <Calculator className="w-5 h-5" />
          Costing Analysis
        </h2>
      </div>
      <div className="card-body space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Grand Total (buyer pays)</span>
          <span className="font-semibold">{formatCurrency(itemsTotal, currency)}</span>
        </div>
        <hr />
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Total Cost</span>
          <span className="font-medium">{formatCurrency(totalCost, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Gross Margin</span>
          <span className={cn(
            'font-bold',
            marginPercent >= 15 ? 'text-green-600' :
            marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {formatCurrency(margin, currency)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Margin %</span>
          <span className={cn(
            'font-bold text-lg',
            marginPercent >= 15 ? 'text-green-600' :
            marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
          )}>
            {marginPercent.toFixed(1)}%
          </span>
        </div>

        {/* Margin Indicator Bar */}
        <div className="mt-4">
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                marginPercent >= 15 ? 'bg-green-500' :
                marginPercent >= 10 ? 'bg-yellow-500' : 'bg-red-500'
              )}
              style={{ width: `${Math.min(marginPercent, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span>Target: 15%</span>
            <span>30%+</span>
          </div>
        </div>

        {marginPercent < 10 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2 mt-4">
            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <div className="text-sm text-red-700">
              Low margin alert! Consider reviewing pricing.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}



// Quick Info Card Component
function QuickInfoCard({ quotation }: { quotation: any }) {
  return (
    <div className="card">
      <div className="card-header">
        <h2 className="font-semibold">Quick Info</h2>
      </div>
      <div className="card-body space-y-3">
        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-gray-400" />
          <div>
            <div className="text-xs text-gray-500">Valid Until</div>
            <div className="font-medium">{formatDate(quotation.validUntil)}</div>
          </div>
        </div>
        {quotation.incoterm && (
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-gray-400" />
            <div>
              <div className="text-xs text-gray-500">Incoterm</div>
              <div className="font-medium">{quotation.incoterm.code} - {quotation.incoterm.name}</div>
            </div>
          </div>
        )}
        {quotation.paymentTerms && (
          <div className="flex items-center gap-3">
            <DollarSign className="w-4 h-4 text-gray-400" />
            <div>
              <div className="text-xs text-gray-500">Payment Terms</div>
              <div className="font-medium">{quotation.paymentTerms}</div>
            </div>
          </div>
        )}
        {quotation.deliveryTerms && (
          <div className="flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            <div>
              <div className="text-xs text-gray-500">Delivery Terms</div>
              <div className="font-medium">{quotation.deliveryTerms}</div>
            </div>
          </div>
        )}
        {quotation.validUntil && new Date(quotation.validUntil) < new Date() && (
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4 text-red-400" />
            <div>
              <div className="text-xs text-gray-500">Validity</div>
              <div className="font-medium text-red-600">Expired</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Related Records Card Component
function RelatedRecordsCard({ quotation }: { quotation: any }) {
  const linkedOrder = quotation.orders?.[0] ?? null;

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="font-semibold">Related Records</h2>
      </div>
      <div className="card-body space-y-3">
        {quotation.inquiry && (
          <Link
            to={`/inquiries/${quotation.inquiry.id}`}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="text-sm font-medium">Inquiry</div>
              <div className="text-xs text-gray-500">{quotation.inquiry.inquiryNumber}</div>
            </div>
          </Link>
        )}
        {linkedOrder && (
          <Link
            to={`/orders/${linkedOrder.id}`}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <ShoppingCart className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <div className="text-sm font-medium">Order</div>
              <div className="text-xs text-gray-500">{linkedOrder.orderNumber}</div>
            </div>
          </Link>
        )}
        {!quotation.inquiry && !linkedOrder && (
          <p className="text-sm text-gray-500 text-center py-2">No related records</p>
        )}
      </div>
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
  onSave: (status: string, notes?: string) => void;
  isLoading: boolean;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [notes, setNotes] = useState('');

  const statusOptions = [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'SENT', label: 'Sent' },
    { value: 'VIEWED', label: 'Viewed by Buyer' },
    { value: 'ACCEPTED', label: 'Accepted' },
    { value: 'REJECTED', label: 'Rejected' },
    { value: 'EXPIRED', label: 'Expired' },
    { value: 'REVISED', label: 'Revision Required' },
  ];

  return (
    <Modal isOpen onClose={onClose} title="Update Quotation Status" size="md">
      <div className="p-6 space-y-4">
        <SelectField
          label="New Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={statusOptions}
        />
        <TextareaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Add any notes about this status change..."
        />
        {status === 'REJECTED' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-700">
              Please add the rejection reason in the notes above for future reference.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => onSave(status, notes)}
            className="btn btn-primary"
            disabled={isLoading}
          >
            {isLoading ? 'Updating...' : 'Update Status'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Convert to Order Modal
function ConvertToOrderModal({
  quotation,
  onClose,
}: {
  quotation: any;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 45);
    return date.toISOString().split('T')[0];
  });
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const response = await quotationsApi.convertToOrder(quotation.id, {
        expectedDeliveryDate,
        poNumber,
        notes,
      });
      return response;
    },
    onSuccess: (response) => {
      toast.success('Order created successfully!');
      navigate(`/orders/${response.data?.data?.id}`);
    },
    onError: () => {
      toast.error('Failed to create order');
    },
  });

  return (
    <Modal isOpen onClose={onClose} title="Convert to Order" size="md">
      <div className="p-6 space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <h3 className="font-semibold text-green-800 mb-2">Order Summary</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-green-700">Buyer:</span>
            <span className="font-medium">{quotation.buyer?.companyName}</span>
            <span className="text-green-700">Items:</span>
            <span className="font-medium">{quotation.items?.length} products</span>
            <span className="text-green-700">Total Value:</span>
            <span className="font-medium">
              {formatCurrency(
                quotation.items?.reduce((s: number, i: any) => s + (i.totalPrice || 0), 0) || 0,
                quotation.currency?.code
              )}
            </span>
          </div>
        </div>

        <FormField
          label="Customer PO Number"
          value={poNumber}
          onChange={(e) => setPoNumber(e.target.value)}
          placeholder="Enter customer's PO reference"
        />

        <FormField
          label="Expected Delivery Date"
          type="date"
          required
          value={expectedDeliveryDate}
          onChange={(e) => setExpectedDeliveryDate(e.target.value)}
        />

        <TextareaField
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Any special instructions..."
        />

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            className="btn btn-primary"
            disabled={mutation.isPending}
          >
            <ShoppingCart className="w-4 h-4 mr-2" />
            {mutation.isPending ? 'Creating...' : 'Create Order'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
