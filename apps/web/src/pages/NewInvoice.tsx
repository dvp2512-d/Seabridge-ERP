// New Invoice Page - Create invoice from order
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { invoicesApi, ordersApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, formatDate } from '@/lib/utils';
import {
  Receipt,
  Package,
  Building2,
  DollarSign,
} from 'lucide-react';

export default function NewInvoice() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedOrderId = searchParams.get('orderId');

  const [orderId, setOrderId] = useState(preselectedOrderId || '');
  const [type, setType] = useState<'EXPORT' | 'PROFORMA'>('EXPORT');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
  });
  const [taxAmount, setTaxAmount] = useState('0');
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState(
    '1. Payment should be made within the due date.\n' +
    '2. Bank charges to be borne by the remitter.\n' +
    '3. Interest will be charged on overdue payments.\n' +
    '4. Goods remain property of seller until full payment.'
  );

  // Fetch orders for dropdown
  const { data: ordersData } = useQuery({
    queryKey: ['orders-for-invoice'],
    queryFn: () => ordersApi.list({ limit: 200 }),
  });

  // Fetch selected order details
  const { data: orderData } = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => ordersApi.get(orderId),
    enabled: !!orderId,
  });

  const order = orderData?.data?.data;
  const orders = ordersData?.data?.data || [];

  // Filter orders that don't have invoices yet (or show all for simplicity)
  const availableOrders = orders.filter((o: any) => 
    ['CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED'].includes(o.status)
  );

  // Calculate totals
  const subtotal = order ? parseFloat(order.totalValue || order.grandTotal || 0) : 0;
  const tax = parseFloat(taxAmount) || 0;
  const total = subtotal + tax;
  const currency = order?.currency?.code || order?.currency || 'USD';

  // Create mutation
  const mutation = useMutation({
    mutationFn: (data: any) => invoicesApi.create(data),
    onSuccess: (response) => {
      toast.success('Invoice created successfully');
      navigate(`/invoices/${response.data?.data?.id}`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create invoice');
    },
  });

  const handleSubmit = () => {
    if (!orderId) {
      toast.error('Please select an order');
      return;
    }
    if (!dueDate) {
      toast.error('Please set a due date');
      return;
    }

    mutation.mutate({
      orderId,
      type,
      invoiceDate,
      dueDate,
      taxAmount: parseFloat(taxAmount) || 0,
      notes,
      termsConditions,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Invoice"
        subtitle="Generate invoice from order"
        actions={
          <div className="flex gap-2">
            <button onClick={() => navigate(-1)} className="btn btn-secondary">
              Cancel
            </button>
            <button 
              onClick={handleSubmit} 
              className="btn btn-primary" 
              disabled={mutation.isPending || !orderId}
            >
              {mutation.isPending ? 'Creating...' : 'Create Invoice'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Selection */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="w-5 h-5" />
                Select Order
              </h2>
            </div>
            <div className="card-body">
              <SelectField
                label="Order"
                required
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                options={availableOrders.map((o: any) => ({
                  value: o.id,
                  label: `${o.orderNumber} - ${o.buyer?.companyName} (${formatCurrency(o.totalValue || o.grandTotal)})`,
                }))}
                placeholder="Select an order to invoice"
              />
            </div>
          </div>

          {/* Order Preview */}
          {order && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Order Details
                </h2>
              </div>
              <div className="card-body">
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-sm text-gray-500">Order Number</div>
                    <div className="font-medium">{order.orderNumber}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Buyer</div>
                    <div className="font-medium">{order.buyer?.companyName}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Order Date</div>
                    <div className="font-medium">{formatDate(order.orderDate)}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Order Value</div>
                    <div className="font-medium">{formatCurrency(subtotal, currency)}</div>
                  </div>
                </div>

                {/* Order Items */}
                <div className="border rounded-lg overflow-hidden">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th className="text-right">Qty</th>
                        <th className="text-right">Price</th>
                        <th className="text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items?.map((item: any) => (
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
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Invoice Details */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                Invoice Details
              </h2>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Invoice Type"
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  options={[
                    { value: 'EXPORT', label: 'Export Invoice' },
                    { value: 'PROFORMA', label: 'Proforma Invoice' },
                  ]}
                />
                <FormField
                  label="Invoice Date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
                <FormField
                  label="Due Date"
                  required
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
                <FormField
                  label={`Tax Amount (${currency})`}
                  type="number"
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  hint="Usually 0 for export invoices"
                />
              </div>
            </div>
          </div>

          {/* Notes & Terms */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Notes & Terms</h2>
            </div>
            <div className="card-body space-y-4">
              <TextareaField
                label="Notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any special notes for this invoice..."
              />
              <TextareaField
                label="Terms & Conditions"
                value={termsConditions}
                onChange={(e) => setTermsConditions(e.target.value)}
                rows={4}
              />
            </div>
          </div>
        </div>

        {/* Summary Sidebar */}
        <div className="space-y-6">
          <div className="card sticky top-6">
            <div className="card-header bg-navy-900 text-white rounded-t-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Invoice Summary
              </h2>
            </div>
            <div className="card-body space-y-4">
              {order ? (
                <>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Subtotal</span>
                      <span className="font-medium">{formatCurrency(subtotal, currency)}</span>
                    </div>
                    {tax > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Tax</span>
                        <span>{formatCurrency(tax, currency)}</span>
                      </div>
                    )}
                    <hr />
                    <div className="flex justify-between text-lg">
                      <span className="font-semibold">Total</span>
                      <span className="font-bold text-navy-900">{formatCurrency(total, currency)}</span>
                    </div>
                  </div>

                  <div className="pt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Buyer</span>
                      <span className="font-medium">{order.buyer?.companyName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Due Date</span>
                      <span className="font-medium">{formatDate(dueDate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Type</span>
                      <span className="font-medium">{type === 'PROFORMA' ? 'Proforma' : 'Export'}</span>
                    </div>
                  </div>

                  <button
                    onClick={handleSubmit}
                    className="btn btn-primary w-full py-3 mt-4"
                    disabled={mutation.isPending}
                  >
                    <Receipt className="w-4 h-4 mr-2" />
                    {mutation.isPending ? 'Creating...' : 'Create Invoice'}
                  </button>
                </>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Receipt className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                  <p>Select an order to see invoice summary</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
