// Invoice Detail Page - Complete Payment Management
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoicesApi, getApiErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, formatDate, downloadFile, isPastDue, cn } from '@/lib/utils';
import {
  ArrowLeft,
  Receipt,
  Download,
  Send,
  CheckCircle,
  Clock,
  AlertTriangle,
  Building2,
  MapPin,
  Phone,
  Mail,
  Calendar,
  DollarSign,
  CreditCard,
  Plus,
  Package,
  FileText,
  Banknote,
} from 'lucide-react';

const STATUS_CONFIG: Record<string, { color: string; bg: string; icon: any }> = {
  DRAFT: { color: 'text-gray-700', bg: 'bg-gray-100', icon: FileText },
  SENT: { color: 'text-blue-700', bg: 'bg-blue-100', icon: Send },
  PARTIALLY_PAID: { color: 'text-yellow-700', bg: 'bg-yellow-100', icon: Clock },
  PAID: { color: 'text-green-700', bg: 'bg-green-100', icon: CheckCircle },
  OVERDUE: { color: 'text-red-700', bg: 'bg-red-100', icon: AlertTriangle },
  CANCELLED: { color: 'text-gray-700', bg: 'bg-gray-100', icon: FileText },
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'items' | 'payments'>('items');

  // Fetch invoice details
  const { data: response, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => invoicesApi.get(id!),
    enabled: !!id,
  });

  const invoice = response?.data?.data;

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (data: any) => invoicesApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice updated');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to update invoice')),
  });

  // Download PDF
  const handleDownloadPdf = async () => {
    try {
      const response = await invoicesApi.downloadPdf(id!);
      downloadFile(response.data, `${invoice?.invoiceNumber}.pdf`);
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

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Invoice not found</h2>
        <button onClick={() => navigate('/invoices')} className="btn btn-primary mt-4">
          Back to Invoices
        </button>
      </div>
    );
  }

  const currency = invoice.currency?.code || 'USD';
  const isOverdue =
    !['PAID', 'CANCELLED'].includes(invoice.status) && isPastDue(invoice.dueDate);
  const displayStatus = isOverdue ? 'OVERDUE' : invoice.status;
  const statusConfig = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.DRAFT;
  const StatusIcon = statusConfig.icon;

  const totalAmount = parseFloat(invoice.totalAmount || 0);
  const paidAmount = parseFloat(invoice.paidAmount || 0);
  const balanceAmount = parseFloat(invoice.balanceAmount || 0);
  const paidPercent = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/invoices')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
              <span className={cn(
                'px-3 py-1 rounded-full text-sm font-medium flex items-center gap-1',
                statusConfig.bg, statusConfig.color
              )}>
                <StatusIcon className="w-4 h-4" />
                {displayStatus.replace(/_/g, ' ')}
              </span>
              {invoice.type === 'PROFORMA' && (
                <span className="badge badge-info">Proforma</span>
              )}
            </div>
            <p className="text-gray-500 mt-1">
              Issued {formatDate(invoice.invoiceDate)} • Due {formatDate(invoice.dueDate)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownloadPdf} className="btn btn-secondary">
            <Download className="w-4 h-4 mr-2" />
            Download PDF
          </button>
          {invoice.status === 'DRAFT' && (
            <button 
              onClick={() => updateStatusMutation.mutate({ status: 'SENT' })} 
              className="btn btn-primary"
            >
              <Send className="w-4 h-4 mr-2" />
              Mark as Sent
            </button>
          )}
          {['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && (
            <button onClick={() => setShowPaymentModal(true)} className="btn btn-gold">
              <CreditCard className="w-4 h-4 mr-2" />
              Record Payment
            </button>
          )}
        </div>
      </div>

      {/* Overdue Alert */}
      {isOverdue && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-800">Payment Overdue</h3>
            <p className="text-sm text-red-600">
              This invoice was due on {formatDate(invoice.dueDate)}. Balance: {formatCurrency(balanceAmount, currency)}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Buyer Info Card */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                Bill To
              </h2>
              <Link to={`/buyers/${invoice.buyer?.id}`} className="text-sm text-navy-600 hover:underline">
                View Buyer →
              </Link>
            </div>
            <div className="card-body">
              <div className="flex justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{invoice.buyer?.companyName}</h3>
                  <p className="text-gray-500">{invoice.buyer?.code}</p>
                  {invoice.buyer?.address && (
                    <p className="text-sm text-gray-600 mt-2 flex items-start gap-1">
                      <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      {invoice.buyer.address}, {invoice.buyer.city}, {invoice.buyer.country?.name}
                    </p>
                  )}
                </div>
                <div className="text-right text-sm">
                  {invoice.buyer?.email && (
                    <p className="flex items-center justify-end gap-1 text-gray-600">
                      <Mail className="w-4 h-4" /> {invoice.buyer.email}
                    </p>
                  )}
                  {invoice.buyer?.phone && (
                    <p className="flex items-center justify-end gap-1 text-gray-600 mt-1">
                      <Phone className="w-4 h-4" /> {invoice.buyer.phone}
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
                  { key: 'items', label: 'Invoice Items', icon: Package },
                  { key: 'payments', label: 'Payment History', icon: CreditCard, count: invoice.payments?.length },
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
                    {tab.count !== undefined && tab.count > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-gray-100">
                        {tab.count}
                      </span>
                    )}
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
                      <th>Description</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Unit Price</th>
                      <th className="text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.order?.items?.map((item: any) => (
                      <tr key={item.id}>
                        <td>
                          <div className="font-medium">{item.product?.name}</div>
                          <div className="text-xs text-gray-500">{item.product?.code}</div>
                        </td>
                        <td className="text-right">{item.quantity} {item.unit}</td>
                        <td className="text-right">{formatCurrency(item.unitPrice, currency)}</td>
                        <td className="text-right font-medium">{formatCurrency(item.totalPrice, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="text-right text-gray-500">Subtotal</td>
                      <td className="text-right font-medium">{formatCurrency(invoice.subtotal, currency)}</td>
                    </tr>
                    {parseFloat(invoice.taxAmount || 0) > 0 && (
                      <tr>
                        <td colSpan={3} className="text-right text-gray-500">Tax</td>
                        <td className="text-right">{formatCurrency(invoice.taxAmount, currency)}</td>
                      </tr>
                    )}
                    <tr className="bg-navy-50">
                      <td colSpan={3} className="text-right font-semibold">Total</td>
                      <td className="text-right font-bold text-lg">{formatCurrency(totalAmount, currency)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Payments Tab */}
            {activeTab === 'payments' && (
              <div>
                <div className="p-4 border-b flex justify-between items-center">
                  <div className="text-sm text-gray-500">
                    {invoice.payments?.length || 0} payment(s) recorded
                  </div>
                  {['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && (
                    <button onClick={() => setShowPaymentModal(true)} className="btn btn-secondary py-1 text-sm">
                      <Plus className="w-4 h-4 mr-1" /> Record Payment
                    </button>
                  )}
                </div>
                
                {invoice.payments?.length > 0 ? (
                  <div className="divide-y">
                    {invoice.payments.map((payment: any) => (
                      <div key={payment.id} className="p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium">{payment.paymentNumber}</div>
                            <div className="text-sm text-gray-500">{payment.paymentMode}</div>
                            {payment.reference && (
                              <div className="text-xs text-gray-400 mt-1">Ref: {payment.reference}</div>
                            )}
                          </div>
                          <div className="text-right">
                            <div className="font-semibold text-green-600">
                              +{formatCurrency(payment.amount, payment.currency || currency)}
                            </div>
                            <div className="text-sm text-gray-500">{formatDate(payment.paymentDate)}</div>
                          </div>
                        </div>
                        {payment.notes && (
                          <div className="mt-2 text-sm text-gray-600 bg-gray-50 p-2 rounded">
                            {payment.notes}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center text-gray-500">
                    <Banknote className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                    <p>No payments recorded yet</p>
                    {['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && (
                      <button onClick={() => setShowPaymentModal(true)} className="btn btn-primary mt-3">
                        <Plus className="w-4 h-4 mr-1" /> Record First Payment
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes & Terms */}
          {(invoice.notes || invoice.termsConditions) && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Notes & Terms</h2>
              </div>
              <div className="card-body space-y-4">
                {invoice.notes && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Notes</h3>
                    <p className="text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
                  </div>
                )}
                {invoice.termsConditions && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1">Terms & Conditions</h3>
                    <p className="text-gray-700 whitespace-pre-wrap text-sm">{invoice.termsConditions}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Payment Summary */}
          <div className="card">
            <div className="card-header bg-navy-900 text-white rounded-t-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Payment Summary
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Invoice Total</span>
                <span className="font-bold text-lg">{formatCurrency(totalAmount, currency)}</span>
              </div>
              <div className="flex justify-between text-green-600">
                <span>Amount Paid</span>
                <span className="font-semibold">{formatCurrency(paidAmount, currency)}</span>
              </div>
              <hr />
              <div className="flex justify-between">
                <span className="text-gray-500">Balance Due</span>
                <span className={cn(
                  'font-bold text-xl',
                  balanceAmount > 0 ? 'text-red-600' : 'text-green-600'
                )}>
                  {formatCurrency(balanceAmount, currency)}
                </span>
              </div>

              {/* Payment Progress */}
              <div className="pt-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">Payment Progress</span>
                  <span className="font-medium">{paidPercent.toFixed(0)}%</span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className={cn(
                      'h-full rounded-full transition-all',
                      paidPercent === 100 ? 'bg-green-500' : paidPercent > 0 ? 'bg-yellow-500' : 'bg-gray-300'
                    )}
                    style={{ width: `${paidPercent}%` }}
                  />
                </div>
              </div>

              {/* Record Payment Button */}
              {balanceAmount > 0 && ['SENT', 'PARTIALLY_PAID'].includes(invoice.status) && (
                <button 
                  onClick={() => setShowPaymentModal(true)}
                  className="btn btn-gold w-full mt-4"
                >
                  <CreditCard className="w-4 h-4 mr-2" />
                  Record Payment
                </button>
              )}
            </div>
          </div>

          {/* Quick Info */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Invoice Details</h2>
            </div>
            <div className="card-body space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Invoice Date</div>
                  <div className="font-medium">{formatDate(invoice.invoiceDate)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Due Date</div>
                  <div className={cn('font-medium', isOverdue && 'text-red-600')}>
                    {formatDate(invoice.dueDate)}
                    {isOverdue && ' (Overdue)'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Receipt className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Invoice Type</div>
                  <div className="font-medium">{invoice.type || 'Export Invoice'}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Related Order */}
          {invoice.order && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Related Order</h2>
              </div>
              <div className="card-body">
                <Link
                  to={`/orders/${invoice.order.id}`}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50"
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <Package className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-medium">{invoice.order.orderNumber}</div>
                    <div className="text-xs text-gray-500">
                      {formatCurrency(invoice.order.totalValue || invoice.order.grandTotal, currency)}
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && (
        <PaymentModal
          invoiceId={id!}
          balanceAmount={balanceAmount}
          currency={currency}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoice', id] });
            setShowPaymentModal(false);
          }}
        />
      )}
    </div>
  );
}



// Payment Modal Component
function PaymentModal({
  invoiceId,
  balanceAmount,
  currency,
  onClose,
  onSuccess,
}: {
  invoiceId: string;
  balanceAmount: number;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    amount: balanceAmount.toString(),
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMode: 'WIRE_TRANSFER',
    reference: '',
    bankDetails: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => invoicesApi.addPayment(invoiceId, data),
    onSuccess: () => {
      toast.success('Payment recorded successfully');
      onSuccess();
    },
    onError: () => toast.error('Failed to record payment'),
  });

  const handleSubmit = () => {
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }
    if (parseFloat(formData.amount) > balanceAmount) {
      toast.error('Amount cannot exceed balance due');
      return;
    }
    
    mutation.mutate({
      ...formData,
      amount: parseFloat(formData.amount),
      currency,
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Record Payment" size="md">
      <div className="p-6 space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center">
            <span className="text-green-700">Balance Due</span>
            <span className="font-bold text-green-800 text-lg">
              {formatCurrency(balanceAmount, currency)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label={`Payment Amount (${currency})`}
            required
            type="number"
            step="0.01"
            max={balanceAmount}
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          />
          <FormField
            label="Payment Date"
            required
            type="date"
            value={formData.paymentDate}
            onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
          />
        </div>

        <SelectField
          label="Payment Mode"
          required
          value={formData.paymentMode}
          onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value })}
          options={[
            { value: 'WIRE_TRANSFER', label: 'Wire Transfer / TT' },
            { value: 'LC', label: 'Letter of Credit (L/C)' },
            { value: 'CHECK', label: 'Check' },
            { value: 'CASH', label: 'Cash' },
            { value: 'CREDIT_CARD', label: 'Credit Card' },
            { value: 'OTHER', label: 'Other' },
          ]}
        />

        <FormField
          label="Reference / Transaction ID"
          value={formData.reference}
          onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
          placeholder="Bank reference number, check number, etc."
        />

        <FormField
          label="Bank Details"
          value={formData.bankDetails}
          onChange={(e) => setFormData({ ...formData, bankDetails: e.target.value })}
          placeholder="Bank name, account details"
        />

        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
          placeholder="Any additional payment notes..."
        />

        {/* Quick amount buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setFormData({ ...formData, amount: balanceAmount.toString() })}
            className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            Full Amount
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, amount: (balanceAmount * 0.5).toFixed(2) })}
            className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            50%
          </button>
          <button
            type="button"
            onClick={() => setFormData({ ...formData, amount: (balanceAmount * 0.3).toFixed(2) })}
            className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
          >
            30%
          </button>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button 
            onClick={handleSubmit} 
            className="btn btn-primary" 
            disabled={mutation.isPending}
          >
            <CreditCard className="w-4 h-4 mr-2" />
            {mutation.isPending ? 'Recording...' : 'Record Payment'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
