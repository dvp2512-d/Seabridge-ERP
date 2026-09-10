// Invoice Detail Page - Complete Payment Management
import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoicesApi, masterApi, incomeApi, getApiErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import DeleteRecordButton from '@/components/DeleteRecordButton';
import GenerateDocumentDialog from '@/components/modals/GenerateDocumentDialog';
import {
  INVOICE_TYPE_BADGE_CLASS,
  INVOICE_TYPE_EXPLANATIONS,
  INVOICE_TYPE_LABELS,
  INVOICE_TYPE_SHORT_LABELS,
  isDocumentOnlyInvoice,
} from '@/lib/invoiceTypes';
import { formatCurrency, formatDate, downloadFile, isPastDue, cn } from '@/lib/utils';
import { refreshAggregates } from '@/lib/queryKeys';
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
  IndianRupee,
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

/**
 * What a foreign remittance was worth in rupees, or null when it arrived in INR.
 *
 * Kept as a helper because the applied figure and the remittance are deliberately
 * different numbers: only the invoice value clears the receivable.
 */
function paymentWorth(payment: any): number | null {
  if (!payment?.receivedAmount || !payment?.exchangeRate) return null;
  return Math.round((Number(payment.receivedAmount) * Number(payment.exchangeRate) + Number.EPSILON) * 100) / 100;
}

/**
 * Rupees received over and above what was applied to the invoice.
 *
 * This is a realised exchange gain: the buyer sent the agreed foreign amount and
 * the rate had moved in the exporter's favour. Anything under a rupee is rounding.
 */
function paymentSurplus(payment: any): number {
  const worth = paymentWorth(payment);
  if (worth === null) return 0;
  const diff = Math.round((worth - Number(payment.amount) + Number.EPSILON) * 100) / 100;
  return diff > 1 ? diff : 0;
}

/**
 * The income entry already booked for a payment's exchange gain, if any.
 *
 * Matched on the payment number, which is what the booking records as its
 * reference. Used to show the gain as recorded rather than offering to book it a
 * second time.
 */
function bookedGainFor(invoice: any, payment: any): any | null {
  return (
    (invoice?.incomeEntries ?? []).find(
      (e: any) => e.category === 'FOREX_GAIN' && e.reference === payment.paymentNumber
    ) ?? null
  );
}

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

  /**
   * Book a payment's exchange gain as other income.
   *
   * Deliberately an explicit action rather than something that happens on save:
   * this writes to the books, and whether a gain is recognised now is the
   * operator's call. Already in rupees, so it is recorded at a rate of 1.
   */
  const bookGain = useMutation({
    mutationFn: (payment: any) =>
      incomeApi.create({
        category: 'FOREX_GAIN',
        description: `Exchange gain on ${invoice?.invoiceNumber} (${payment.paymentNumber})`,
        originalAmount: paymentSurplus(payment),
        originalCurrency: 'INR',
        exchangeRate: 1,
        receivedDate: payment.paymentDate,
        reference: payment.reference || payment.paymentNumber,
        linkedInvoiceId: invoice?.id,
        status: 'RECEIVED',
      }),
    onSuccess: () => {
      toast.success('Exchange gain recorded under Other Income');
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      refreshAggregates(queryClient);
      queryClient.invalidateQueries({ queryKey: ['income'] });
    },
    onError: (err: any) => toast.error(getApiErrorMessage(err, 'Could not record the gain')),
  });

  // Update status mutation
  const updateStatusMutation = useMutation({
    mutationFn: (data: any) => invoicesApi.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      refreshAggregates(queryClient);
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success('Invoice updated');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to update invoice')),
  });

  // Generate the PDF in a chosen currency and rate. Amounts are stored in rupees,
  // so the buyer's copy is a conversion and the dialog collects both.
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGeneratePdf = async (pdfCurrency: string, rate: number) => {
    setIsGenerating(true);
    try {
      const response = await invoicesApi.downloadPdf(id!, pdfCurrency, rate);
      downloadFile(response.data, `${invoice?.invoiceNumber}-${pdfCurrency}.pdf`);
      toast.success(`PDF generated in ${pdfCurrency}`);
      setShowPdfDialog(false);
      queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      refreshAggregates(queryClient);
    } catch (error: any) {
      let message = 'Failed to generate PDF';
      const data = error?.response?.data;
      if (data instanceof Blob) {
        try {
          message = JSON.parse(await data.text())?.message ?? message;
        } catch {
          /* keep the fallback */
        }
      } else if (data?.message) {
        message = data.message;
      }
      toast.error(message);
    } finally {
      setIsGenerating(false);
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
  const isOverdue =
    !['PAID', 'CANCELLED'].includes(invoice.status) && isPastDue(invoice.dueDate);
  const displayStatus = isOverdue ? 'OVERDUE' : invoice.status;
  const statusConfig = STATUS_CONFIG[displayStatus] || STATUS_CONFIG.DRAFT;
  const StatusIcon = statusConfig.icon;

  const totalAmount = parseFloat(invoice.totalAmount || 0);
  const paidAmount = parseFloat(invoice.paidAmount || 0);
  const balanceAmount = parseFloat(invoice.balanceAmount || 0);
  const paidPercent = totalAmount > 0 ? (paidAmount / totalAmount) * 100 : 0;
  /**
   * Proforma and sample invoices are issued for documentation - opening an LC,
   * arranging an advance, clearing a sample shipment through customs - and carry no
   * receivable, so no payment can be recorded against them. The commercial invoice
   * that follows takes the money.
   */
  const isDocumentOnly = isDocumentOnlyInvoice(invoice.type);
  const typeLabel = INVOICE_TYPE_LABELS[invoice.type] ?? invoice.type;
  const acceptsPayment =
    !isDocumentOnly && ['SENT', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status);
  // Realised exchange gain across all payments on this invoice.
  const totalExchangeGain = Math.round(
    ((invoice.payments ?? []).reduce((sum: number, p: any) => sum + paymentSurplus(p), 0) +
      Number.EPSILON) * 100
  ) / 100;

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
              {isDocumentOnly && (
                <span className={`badge ${INVOICE_TYPE_BADGE_CLASS[invoice.type] ?? 'badge-info'}`}>
                  {INVOICE_TYPE_SHORT_LABELS[invoice.type] ?? invoice.type}
                </span>
              )}
            </div>
            <p className="text-gray-500 mt-1">
              Issued {formatDate(invoice.invoiceDate)} • Due {formatDate(invoice.dueDate)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <DeleteRecordButton
            resourceType="invoice"
            recordId={id!}
            recordName={`Invoice ${invoice.invoiceNumber}`}
            redirectTo="/invoices"
          />
          <button onClick={() => setShowPdfDialog(true)} className="btn btn-secondary">
            <Download className="w-4 h-4 mr-2" />
            Generate PDF
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
          {acceptsPayment && (
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
              This invoice was due on {formatDate(invoice.dueDate)}. Balance: {formatCurrency(balanceAmount)}
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
                        <td className="text-right">{formatCurrency(item.unitPrice)}</td>
                        <td className="text-right font-medium">{formatCurrency(item.totalPrice)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="text-right text-gray-500">Subtotal</td>
                      <td className="text-right font-medium">{formatCurrency(invoice.subtotal)}</td>
                    </tr>
                    {parseFloat(invoice.taxAmount || 0) > 0 && (
                      <tr>
                        <td colSpan={3} className="text-right text-gray-500">Tax</td>
                        <td className="text-right">{formatCurrency(invoice.taxAmount)}</td>
                      </tr>
                    )}
                    <tr className="bg-navy-50">
                      <td colSpan={3} className="text-right font-semibold">Total</td>
                      <td className="text-right font-bold text-lg">{formatCurrency(totalAmount)}</td>
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
                  {acceptsPayment && (
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
                              +{formatCurrency(payment.amount)}
                            </div>
                            {/* What arrived before conversion, and what it was
                                worth. Showing only the applied figure next to a
                                foreign amount that multiplies out to something
                                larger looks like an arithmetic error. */}
                            {payment.receivedCurrency && payment.receivedAmount && (
                              <div className="text-xs text-gray-500">
                                {formatCurrency(payment.receivedAmount, payment.receivedCurrency)}
                                {payment.exchangeRate ? ` @ ${Number(payment.exchangeRate)}` : ''}
                                {paymentWorth(payment) !== null &&
                                  ` = ${formatCurrency(paymentWorth(payment)!)}`}
                              </div>
                            )}
                            <div className="text-sm text-gray-500">{formatDate(payment.paymentDate)}</div>
                          </div>
                        </div>

                        {/* The receivable is only cleared to the invoice value; any
                            excess rupees are an exchange gain recorded as other
                            income. Stating the split is what makes the two figures
                            reconcile. */}
                        {paymentSurplus(payment) > 0 && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded p-2">
                            <span className="text-emerald-800">
                              {formatCurrency(payment.amount)} applied to this invoice ·{' '}
                              <strong>{formatCurrency(paymentSurplus(payment))} exchange gain</strong>
                              {bookedGainFor(invoice, payment) && (
                                <>
                                  {' '}· recorded as{' '}
                                  <Link to="/income" className="underline font-medium">
                                    {bookedGainFor(invoice, payment)!.incomeNumber}
                                  </Link>{' '}
                                  in Other Income
                                </>
                              )}
                            </span>
                            {/* Only offered for payments recorded before gains were
                                booked automatically. */}
                            {!bookedGainFor(invoice, payment) && (
                              <button
                                type="button"
                                onClick={() => bookGain.mutate(payment)}
                                disabled={bookGain.isPending}
                                className="btn btn-secondary py-1 px-2 text-xs"
                              >
                                {bookGain.isPending ? 'Booking...' : 'Book as other income'}
                              </button>
                            )}
                          </div>
                        )}
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
                    {isDocumentOnly ? (
                      <>
                        <p>{typeLabel}s are not paid</p>
                        <p className="text-sm mt-1 max-w-md mx-auto">
                          {INVOICE_TYPE_EXPLANATIONS[invoice.type]}
                        </p>
                      </>
                    ) : (
                      <>
                        <p>No payments recorded yet</p>
                        {acceptsPayment && (
                          <button onClick={() => setShowPaymentModal(true)} className="btn btn-primary mt-3">
                            <Plus className="w-4 h-4 mr-1" /> Record First Payment
                          </button>
                        )}
                      </>
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
                <IndianRupee className="w-5 h-5" />
                {isDocumentOnly ? 'Document Summary' : 'Payment Summary'}
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-500">{isDocumentOnly ? 'Document Value' : 'Invoice Total'}</span>
                <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
              </div>

              {/* A document-only invoice carries no receivable, so Amount Paid,
                  Balance Due and a progress bar would all be meaningless here. */}
              {isDocumentOnly && (
                <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                  Issued for documentation only. It creates no receivable and is left
                  out of outstanding totals and the dashboard.
                </div>
              )}
              {!isDocumentOnly && (
                <>
              <div className="flex justify-between text-green-600">
                <span>Amount Paid</span>
                <span className="font-semibold">{formatCurrency(paidAmount)}</span>
              </div>
              {/* Rupees received beyond the invoice value. Not part of the
                  receivable, so it is shown separately rather than folded into
                  Amount Paid - which would make paid exceed the invoice total. */}
              {totalExchangeGain > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Exchange gain</span>
                  <span className="font-semibold">{formatCurrency(totalExchangeGain)}</span>
                </div>
              )}
              <hr />
              <div className="flex justify-between">
                <span className="text-gray-500">Balance Due</span>
                <span className={cn(
                  'font-bold text-xl',
                  balanceAmount > 0 ? 'text-red-600' : 'text-green-600'
                )}>
                  {formatCurrency(balanceAmount)}
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
                </>
              )}

              {/* Record Payment Button */}
              {balanceAmount > 0 && acceptsPayment && (
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
                      {formatCurrency(invoice.order.totalValue || invoice.order.grandTotal)}
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
          invoiceCurrency={invoice.pdfCurrency}
          invoiceRate={invoice.pdfExchangeRate ? Number(invoice.pdfExchangeRate) : null}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      refreshAggregates(queryClient);
            setShowPaymentModal(false);
          }}
        />
      )}
      {showPdfDialog && (
        <GenerateDocumentDialog
          title={`Generate PDF - ${invoice.invoiceNumber}`}
          documentTotalINR={totalAmount}
          initialCurrency={invoice.pdfCurrency}
          initialRate={invoice.pdfExchangeRate ? Number(invoice.pdfExchangeRate) : null}
          onClose={() => setShowPdfDialog(false)}
          onGenerate={handleGeneratePdf}
          isGenerating={isGenerating}
        />
      )}
    </div>
  );
}



// Payment Modal Component
//
// A payment is stored in rupees, because the rupee sum the bank credited is what
// is actually realised and it is what every total uses. But an export remittance
// usually arrives in the buyer's currency, so this offers a converter: enter what
// was received and at what rate, and the rupee figure is derived. Those two inputs
// are also kept on the record so a bank advice can be reconciled against it.
function PaymentModal({
  invoiceId,
  balanceAmount,
  /** Currency the invoice was issued in, if it was printed in a foreign currency. */
  invoiceCurrency,
  /** Rate the invoice was issued at, used as the starting point for the converter. */
  invoiceRate,
  onClose,
  onSuccess,
}: {
  invoiceId: string;
  balanceAmount: number;
  invoiceCurrency?: string | null;
  invoiceRate?: number | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: currenciesData } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => masterApi.getCurrencies(),
  });
  const currencies = currenciesData?.data?.data ?? [];

  /**
   * The currency the remittance arrived in.
   *
   * A free choice, defaulting to whatever the invoice was issued in. It is not
   * gated on the invoice having a currency: an invoice whose PDF has never been
   * generated has none recorded, and that previously meant no converter was
   * offered at all.
   */
  const [code, setCode] = useState(invoiceCurrency || 'INR');
  const isForeign = code !== 'INR';

  /**
   * The balance restated in a foreign currency at a given rate.
   *
   * Floored rather than rounded: a foreign amount can only be entered to two
   * decimals, and rounding the last paisa UP makes `foreign x rate` come out
   * higher than the balance, which the overpayment guard then rejected with
   * "amount cannot exceed the balance due" on an untouched form.
   */
  const balanceAt = (r: number | null | undefined) =>
    r && r > 0 ? Math.floor((balanceAmount / r) * 100) / 100 : null;

  /** What the invoice asked for, when it was issued in this same currency. */
  const invoicedInSameCurrency = Boolean(invoiceCurrency && invoiceRate && invoiceCurrency === code);
  const balanceAtInvoicedRate = invoicedInSameCurrency ? balanceAt(invoiceRate) : null;

  const [rate, setRate] = useState(invoiceRate ? String(invoiceRate) : '');
  const [foreignAmount, setForeignAmount] = useState(
    balanceAtInvoicedRate !== null ? balanceAtInvoicedRate.toFixed(2) : ''
  );

  const [formData, setFormData] = useState({
    amount: balanceAmount.toFixed(2),
    paymentDate: new Date().toISOString().split('T')[0],
    paymentMode: 'WIRE_TRANSFER',
    reference: '',
    bankDetails: '',
    notes: '',
  });

  const numericRate = parseFloat(rate);
  const numericForeign = parseFloat(foreignAmount);
  const rateValid = Number.isFinite(numericRate) && numericRate > 0;
  const conversionValid =
    rateValid && Number.isFinite(numericForeign) && numericForeign > 0;

  /**
   * What the buyer must actually remit at the rate entered here.
   *
   * The rupee balance is fixed, so a weaker rate means more foreign currency is
   * needed to clear the same invoice. Showing this is the point of the rate field:
   * otherwise the operator has to work out for themselves why the amount received
   * does not match what was invoiced.
   */
  const balanceAtEnteredRate = rateValid ? balanceAt(numericRate) : null;
  const foreignDelta =
    balanceAtEnteredRate !== null && balanceAtInvoicedRate !== null
      ? Math.round((balanceAtEnteredRate - balanceAtInvoicedRate) * 100) / 100
      : 0;

  // In converter mode the rupee figure is derived, never typed, so the stored
  // amount and the remittance details can never contradict each other.
  const rawDerived = conversionValid
    ? Math.round((numericForeign * numericRate + Number.EPSILON) * 100) / 100
    : 0;

  /**
   * Absorb sub-rupee rounding, and treat a surplus on a full remittance as a
   * forex gain rather than an overpayment.
   *
   * A foreign amount carries two decimals, so `foreign x rate` lands a few paise
   * either side of the balance; neither direction is a real discrepancy. Separately,
   * if the buyer sends the agreed 10,000 USD and the rate has moved in your favour,
   * the rupees received exceed the rupee balance - the invoice is still settled in
   * full and the surplus is a realised exchange gain, which belongs in Other Income
   * rather than being refused as "amount cannot exceed the balance due".
   */
  const roundingTolerance = Math.max(1, (numericRate || 1) * 0.01);
  const surplusINR =
    conversionValid && rawDerived - balanceAmount > roundingTolerance
      ? Math.round((rawDerived - balanceAmount) * 100) / 100
      : 0;
  const settlesBalance =
    conversionValid &&
    (Math.abs(rawDerived - balanceAmount) <= roundingTolerance || surplusINR > 0);
  const derivedINR = settlesBalance ? balanceAmount : rawDerived;

  const amountINR = isForeign ? derivedINR : parseFloat(formData.amount);

  const shortfall = Number.isFinite(amountINR) ? amountINR - balanceAmount : 0;

  const mutation = useMutation({
    mutationFn: (data: any) => invoicesApi.addPayment(invoiceId, data),
    onSuccess: () => {
      toast.success('Payment recorded');
      onSuccess();
    },
    onError: (err: any) =>
      toast.error(err.response?.data?.message || 'Failed to record payment'),
  });

  const handleSubmit = () => {
    if (!Number.isFinite(amountINR) || amountINR <= 0) {
      toast.error(
        isForeign ? 'Enter the amount received and the rate' : 'Enter a valid amount'
      );
      return;
    }
    // In converter mode the figure is already capped at the balance, so this can
    // only trigger when a rupee amount was typed directly.
    if (amountINR > balanceAmount + 0.01) {
      toast.error(
        `That is more than the ${formatCurrency(balanceAmount)} outstanding. Reduce it, or record the excess as other income.`
      );
      return;
    }

    mutation.mutate({
      ...formData,
      amount: amountINR,
      // Reference only; the rupee amount above is what totals use.
      ...(isForeign && conversionValid
        ? {
            receivedCurrency: code,
            receivedAmount: numericForeign,
            exchangeRate: numericRate,
          }
        : {}),
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Record Payment" size="md">
      <div className="p-6 space-y-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          {/* The rupee balance is what must be cleared; the foreign figure is what
              the buyer actually has to send, and that moves with the rate. */}
          <div className="flex justify-between items-center">
            <span className="text-green-700">Balance Due</span>
            <span className="font-bold text-green-800 text-lg">
              {formatCurrency(balanceAmount)}
            </span>
          </div>

          {isForeign && balanceAtInvoicedRate !== null && (
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-green-200 text-sm">
              <span className="text-green-700">Invoiced at {invoiceRate}</span>
              <span className="font-medium text-green-800">
                {formatCurrency(balanceAtInvoicedRate, code)}
              </span>
            </div>
          )}

          {isForeign && balanceAtEnteredRate !== null && (
            <div className="flex justify-between items-baseline mt-1 text-sm">
              <span className="text-green-700">
                Buyer must send at {numericRate}
              </span>
              <span className="text-right">
                <span className="font-bold text-green-900">
                  {formatCurrency(balanceAtEnteredRate, code)}
                </span>
                {Math.abs(foreignDelta) >= 0.01 && (
                  <span
                    className={cn(
                      'ml-2 text-xs',
                      foreignDelta > 0 ? 'text-amber-700' : 'text-green-700'
                    )}
                  >
                    {foreignDelta > 0 ? '+' : '-'}
                    {formatCurrency(Math.abs(foreignDelta), code)}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Why the figure above moved, stated plainly rather than left to be
            inferred from two numbers that disagree. */}
        {isForeign && Math.abs(foreignDelta) >= 0.01 && (
          <p className="text-xs text-gray-600">
            {foreignDelta > 0
              ? `The rupee has strengthened against the ${code} since invoicing, so ${formatCurrency(
                  Math.abs(foreignDelta),
                  code
                )} more is needed to clear the same ${formatCurrency(balanceAmount)}.`
              : `The rupee has weakened against the ${code} since invoicing, so ${formatCurrency(
                  Math.abs(foreignDelta),
                  code
                )} less clears the same ${formatCurrency(balanceAmount)}.`}
          </p>
        )}

        {/* A free choice rather than a two-way toggle: the buyer may remit in a
            currency the document was not printed in, and an invoice whose PDF has
            never been generated has no currency recorded at all. */}
        <SelectField
          label="Received In"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          options={currencies.map((c: any) => ({
            value: c.code,
            label: `${c.code} - ${c.name}`,
          }))}
          hint={
            invoiceCurrency && invoiceCurrency !== 'INR'
              ? `This invoice was issued in ${invoiceCurrency}`
              : 'Pick a currency to enter the amount in, and give the rate'
          }
        />

        {isForeign ? (
          <>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                label={`Rate (1 ${code} = ? INR)`}
                required
                type="number"
                step="0.0001"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                hint={invoicedInSameCurrency ? `Invoiced at ${invoiceRate}` : undefined}
              />
              <FormField
                label={`Amount Received (${code})`}
                required
                type="number"
                step="0.01"
                value={foreignAmount}
                onChange={(e) => setForeignAmount(e.target.value)}
              />
            </div>
            {/* Fills the amount that clears the invoice at the rate above, so the
                two fields are always consistent with the balance. */}
            {balanceAtEnteredRate !== null && (
              <button
                type="button"
                onClick={() => setForeignAmount(balanceAtEnteredRate.toFixed(2))}
                className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200"
              >
                Settle in full ({formatCurrency(balanceAtEnteredRate, code)} at {numericRate})
              </button>
            )}
            <div className="rounded-lg bg-gray-50 border p-4 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Worth in rupees</span>
                <span className="font-medium">
                  {conversionValid ? formatCurrency(rawDerived) : '-'}
                </span>
              </div>
              {conversionValid && (
                <div className="text-xs text-gray-500">
                  {numericForeign} {code} x {numericRate}
                </div>
              )}
              <div className="flex justify-between pt-2 mt-1 border-t">
                <span className="text-gray-500">Recorded against this invoice</span>
                <span className="font-bold text-navy-900">
                  {conversionValid ? formatCurrency(derivedINR) : '-'}
                </span>
              </div>
              {conversionValid && (
                <p className="text-xs text-gray-600">
                  {surplusINR > 0
                    ? `Settles the invoice in full. ${formatCurrency(surplusINR)} more arrived than was invoiced - a realised exchange gain, recorded automatically under Other Income as Forex Gain.`
                    : settlesBalance
                      ? 'Settles the invoice in full.'
                      : `${formatCurrency(balanceAmount - derivedINR)} will remain outstanding.`}
                </p>
              )}
              <p className="text-xs text-gray-500 pt-1">
                The rupee figure is what gets recorded. The {code} amount and rate are
                kept for reconciliation.
              </p>
            </div>
          </>
        ) : (
          <FormField
            label="Payment Amount (INR)"
            required
            type="number"
            step="0.01"
            max={balanceAmount}
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
          />
        )}

        {/* A shortfall against the invoiced rupee value is a realised forex loss,
            which is worth seeing before the entry is saved rather than after. A
            surplus is explained in the conversion panel instead. */}
        {Number.isFinite(amountINR) && amountINR > 0 && shortfall < -1 && (
          <p className="text-sm text-amber-700">
            {formatCurrency(Math.abs(shortfall))} less than the invoiced value - a forex
            loss if this settles the invoice.
          </p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Payment Date"
            required
            type="date"
            value={formData.paymentDate}
            onChange={(e) => setFormData({ ...formData, paymentDate: e.target.value })}
          />
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
        </div>

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

        {!isForeign && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, amount: balanceAmount.toFixed(2) })}
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
        )}

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
