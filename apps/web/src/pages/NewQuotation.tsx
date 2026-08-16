// New Quotation Page with Automatic Costing Calculatorimport { useState, useEffect, useMemo } from 'react';import { useNavigate, useSearchParams } from 'react-router-dom';import { useQuery, useMutation } from '@tanstack/react-query';import toast from 'react-hot-toast';import {
  quotationsApi,
  inquiriesApi,
  buyersApi,
  masterApi,
  productsApi,
  chaApi,
  transportersApi,
} from '@/lib/api';import PageHeader from '@/components/ui/PageHeader';import Modal from '@/components/ui/Modal';import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';import { formatCurrency, cn } from '@/lib/utils';import {
  Plus,
  Trash2,
  Calculator,
  TrendingUp,
  AlertCircle,
  Package,
  DollarSign,
  Percent,
  FileText,
} from 'lucide-react';

interface QuotationItem {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  quantity: number;
  unit: string;
  supplierPrice: number;
  supplierId: string;
  supplierName: string;
  unitCost: number;
  margin: number;
  unitPrice: number;
  totalCost: number;
  totalPrice: number;
  specifications: string;
}

interface AdditionalCost {
  id: string;
  costType: string;
  description: string;
  amount: number;
  currency: string;
}

export default function NewQuotation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inquiryId = searchParams.get('inquiryId');

  // Form state
  const [buyerId, setBuyerId] = useState('');
  const [currencyId, setCurrencyId] = useState('');
  const [incotermId, setIncotermId] = useState('');
  const [validUntil, setValidUntil] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().split('T')[0];
  });
  const [paymentTerms, setPaymentTerms] = useState('');
  const [deliveryTerms, setDeliveryTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [termsConditions, setTermsConditions] = useState(
    '1. Prices are valid for the validity period mentioned above.\n' +
    '2. Payment as per agreed terms.\n' +
    '3. Delivery timeline subject to order confirmation.\n' +
    '4. Quality as per standard specifications unless specified.'
  );

  // Items and costs
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [additionalCosts, setAdditionalCosts] = useState<AdditionalCost[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showCostModal, setShowCostModal] = useState(false);
  const [editingItem, setEditingItem] = useState<QuotationItem | null>(null);

  // Data queries
  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const { data: buyersData } = useQuery({
    queryKey: ['buyers-list'],
    queryFn: () => buyersApi.list({ limit: 200 }),
  });

  const { data: inquiryData } = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: () => inquiriesApi.get(inquiryId!),
    enabled: !!inquiryId,
  });

  // Pre-fill from inquiry
  useEffect(() => {
    if (inquiryData?.data?.data) {
      const inquiry = inquiryData.data.data;
      setBuyerId(inquiry.buyerId);
      if (inquiry.buyer?.currencyId) {
        setCurrencyId(inquiry.buyer.currencyId);
      }
      // Convert inquiry items to quotation items (without pricing yet)
      if (inquiry.items?.length > 0) {
        setItems(inquiry.items.map((item: any) => ({
          id: crypto.randomUUID(),
          productId: item.productId,
          productName: item.product?.name || '',
          productCode: item.product?.code || '',
          quantity: parseFloat(item.quantity),
          unit: item.unit,
          supplierPrice: 0,
          supplierId: '',
          supplierName: '',
          unitCost: 0,
          margin: 20, // Default 20% margin
          unitPrice: 0,
          totalCost: 0,
          totalPrice: 0,
          specifications: item.specifications || '',
        })));
      }
    }
  }, [inquiryData]);

  // Default the currency to USD when the master data loads
  useEffect(() => {
    if (currencyId) return;
    const currencies = dropdowns?.data?.data?.currencies ?? [];
    if (currencies.length === 0) return;
    const preferred =
      currencies.find((c: any) => c.code === 'USD') ?? currencies[0];
    if (preferred) setCurrencyId(preferred.id);
  }, [dropdowns, currencyId]);

  // Calculate totals
  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const itemsCost = items.reduce((sum, item) => sum + item.totalCost, 0);
    const additionalCostsTotal = additionalCosts.reduce((sum, cost) => sum + cost.amount, 0);

    // Additional costs sit under total cost and are billed on to the buyer, but
    // they do not earn margin. Margin comes from the line items only, so adding
    // a shipment cost never reduces it.
    const totalCost = itemsCost + additionalCostsTotal;
    const totalMargin = itemsSubtotal - itemsCost;
    const marginPercent = itemsSubtotal > 0 ? (totalMargin / itemsSubtotal) * 100 : 0;

    return {
      itemsSubtotal,
      itemsCost,
      additionalCostsTotal,
      totalCost,
      totalMargin,
      marginPercent,
      grandTotal: itemsSubtotal + additionalCostsTotal,
    };
  }, [items, additionalCosts]);

  // Create quotation
  const mutation = useMutation({
    mutationFn: (data: any) => quotationsApi.create(data),
    onSuccess: (response) => {
      toast.success('Quotation created successfully');
      navigate(`/quotations/${response.data?.data?.id}`);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create quotation');
    },
  });

  const handleSubmit = () => {
    if (!buyerId) {
      toast.error('Please select a buyer');
      return;
    }
    if (!currencyId || !incotermId) {
      toast.error('Please select currency and incoterm');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    const data = {
      inquiryId: inquiryId || undefined,
      buyerId,
      currencyId,
      incotermId,
      validUntil,
      paymentTerms,
      deliveryTerms,
      notes,
      termsConditions,
      items: items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unit: item.unit,
        unitCost: item.unitCost,
        unitPrice: item.unitPrice,
        specifications: item.specifications,
      })),
      costs: additionalCosts.map(cost => ({
        costType: cost.costType,
        description: cost.description,
        amount: cost.amount,
        currency: cost.currency,
      })),
    };

    mutation.mutate(data);
  };

  const selectedCurrency = dropdowns?.data?.data?.currencies?.find((c: any) => c.id === currencyId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Quotation"
        subtitle={inquiryId ? `From Inquiry` : 'New quotation'}
        actions={
          <div className="flex gap-2">
            <button onClick={() => navigate(-1)} className="btn btn-secondary">
              Cancel
            </button>
            <button onClick={handleSubmit} className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating...' : 'Create Quotation'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Basic Information</h2>
            </div>
            <div className="card-body">
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Buyer"
                  required
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  options={(buyersData?.data?.data || []).map((b: any) => ({
                    value: b.id,
                    label: `${b.code} - ${b.companyName}`,
                  }))}
                  placeholder="Select Buyer"
                  className="col-span-2"
                />
                <SelectField
                  label="Currency"
                  required
                  value={currencyId}
                  onChange={(e) => setCurrencyId(e.target.value)}
                  options={(dropdowns?.data?.data?.currencies || []).map((c: any) => ({
                    value: c.id,
                    label: `${c.code} (${c.symbol})`,
                  }))}
                  placeholder="Select Currency"
                />
                <SelectField
                  label="Incoterm"
                  required
                  value={incotermId}
                  onChange={(e) => setIncotermId(e.target.value)}
                  options={(dropdowns?.data?.data?.incoterms || []).map((i: any) => ({
                    value: i.id,
                    label: `${i.code} - ${i.name}`,
                  }))}
                  placeholder="Select Incoterm"
                />
                <FormField
                  label="Valid Until"
                  required
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
                <FormField
                  label="Payment Terms"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="e.g., 30% Advance, 70% against BL"
                />
                <FormField
                  label="Delivery Terms"
                  value={deliveryTerms}
                  onChange={(e) => setDeliveryTerms(e.target.value)}
                  placeholder="e.g., 4-6 weeks from order confirmation"
                  className="col-span-2"
                />
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Package className="w-5 h-5" />
                Line Items
              </h2>
              <button onClick={() => { setEditingItem(null); setShowItemModal(true); }} className="btn btn-secondary py-1 text-sm">
                <Plus className="w-4 h-4 mr-1" />
                Add Item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th>Unit Cost</th>
                    <th>Margin %</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-gray-500">{item.productCode}</div>
                        {item.supplierName && (
                          <div className="text-xs text-blue-600">Supplier: {item.supplierName}</div>
                        )}
                      </td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{formatCurrency(item.unitCost, selectedCurrency?.code)}</td>
                      <td>
                        <span className={cn(
                          'font-medium',
                          item.margin >= 20 ? 'text-green-600' :
                          item.margin >= 15 ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {item.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="font-medium">{formatCurrency(item.unitPrice, selectedCurrency?.code)}</td>
                      <td className="font-medium">{formatCurrency(item.totalPrice, selectedCurrency?.code)}</td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingItem(item); setShowItemModal(true); }}
                            className="text-navy-600 hover:text-navy-800 p-1"
                          >
                            <Calculator className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setItems(items.filter(i => i.id !== item.id))}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center py-8 text-gray-500">
                        No items added yet. Click "Add Item" to start.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Additional Costs */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                Additional Costs
              </h2>
              <button onClick={() => setShowCostModal(true)} className="btn btn-secondary py-1 text-sm">
                <Plus className="w-4 h-4 mr-1" />
                Add Cost
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {additionalCosts.map((cost) => (
                    <tr key={cost.id}>
                      <td>
                        <span className="badge badge-navy">{cost.costType}</span>
                      </td>
                      <td>{cost.description}</td>
                      <td className="font-medium">{formatCurrency(cost.amount, cost.currency)}</td>
                      <td>
                        <button
                          onClick={() => setAdditionalCosts(additionalCosts.filter(c => c.id !== cost.id))}
                          className="text-red-500 hover:text-red-700 p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {additionalCosts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center py-4 text-gray-500 text-sm">
                        No additional costs (CHA, Transport, etc.)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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
                placeholder="Any special notes for this quotation..."
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
          {/* Costing Summary */}
          <div className="card sticky top-6">
            <div className="card-header bg-navy-900 text-white rounded-t-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <Calculator className="w-5 h-5" />
                Costing Summary
              </h2>
            </div>
            <div className="card-body space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Items Subtotal</span>
                  <span className="font-medium">{formatCurrency(totals.itemsSubtotal, selectedCurrency?.code)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Items Cost</span>
                  <span>{formatCurrency(totals.itemsCost, selectedCurrency?.code)}</span>
                </div>
                {totals.additionalCostsTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Additional Costs</span>
                    <span>{formatCurrency(totals.additionalCostsTotal, selectedCurrency?.code)}</span>
                  </div>
                )}
                <hr />
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Cost</span>
                  <span className="font-medium">{formatCurrency(totals.totalCost, selectedCurrency?.code)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Margin</span>
                  <span className={cn(
                    'font-bold',
                    totals.marginPercent >= 15 ? 'text-green-600' :
                    totals.marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
                  )}>
                    {formatCurrency(totals.totalMargin, selectedCurrency?.code)} ({totals.marginPercent.toFixed(1)}%)
                  </span>
                </div>
                <hr />
                <div className="flex justify-between text-lg">
                  <span className="font-semibold">Grand Total</span>
                  <span className="font-bold text-navy-900">{formatCurrency(totals.grandTotal, selectedCurrency?.code)}</span>
                </div>
              </div>

              {/* Margin Alert */}
              {items.length > 0 && totals.marginPercent < 10 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">
                    <strong>Low margin warning!</strong> Overall margin is below 10%. Consider adjusting prices.
                  </div>
                </div>
              )}

              {/* Create Button */}
              <button
                onClick={handleSubmit}
                className="btn btn-primary w-full py-3"
                disabled={mutation.isPending || items.length === 0}
              >
                <FileText className="w-4 h-4 mr-2" />
                {mutation.isPending ? 'Creating...' : 'Create Quotation'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Add/Edit Item Modal */}
      {showItemModal && (
        <ItemCostingModal
          item={editingItem}
          currency={selectedCurrency}
          onClose={() => { setShowItemModal(false); setEditingItem(null); }}
          onSave={(item) => {
            if (editingItem) {
              setItems(items.map(i => i.id === item.id ? item : i));
            } else {
              setItems([...items, item]);
            }
            setShowItemModal(false);
            setEditingItem(null);
          }}
        />
      )}

      {/* Add Cost Modal */}
      {showCostModal && (
        <AddCostModal
          currency={selectedCurrency}
          onClose={() => setShowCostModal(false)}
          onSave={(cost) => {
            setAdditionalCosts([...additionalCosts, cost]);
            setShowCostModal(false);
          }}
        />
      )}
    </div>
  );
}



// Item Costing Modal - The core pricing engine
function ItemCostingModal({ 
  item, 
  currency, 
  onClose, 
  onSave 
}: { 
  item: QuotationItem | null; 
  currency: any;
  onClose: () => void; 
  onSave: (item: QuotationItem) => void;
}) {
  const [formData, setFormData] = useState({
    productId: item?.productId || '',
    quantity: item?.quantity?.toString() || '',
    unit: item?.unit || 'KG',
    supplierId: item?.supplierId || '',
    supplierPrice: item?.supplierPrice?.toString() || '',
    additionalCost: '0', // Packaging, handling, etc.
    margin: item?.margin?.toString() || '20',
    specifications: item?.specifications || '',
  });

  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);

  // Fetch products (via the authenticated API client)
  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await productsApi.list({ limit: 500 })).data?.data ?? [],
  });

  // Fetch supplier prices for the selected product
  const { data: productDetail } = useQuery({
    queryKey: ['product', formData.productId],
    queryFn: async () => (await productsApi.get(formData.productId)).data?.data ?? null,
    enabled: !!formData.productId,
  });

  // Update selected product
  useEffect(() => {
    if (formData.productId && products.length > 0) {
      const product = products.find((p: any) => p.id === formData.productId);
      setSelectedProduct(product ?? null);
      if (product?.unit) {
        setFormData(f => ({ ...f, unit: product.unit }));
      }
    }
  }, [formData.productId, products]);

  // Auto-fill supplier price when supplier is selected
  useEffect(() => {
    if (formData.supplierId && productDetail?.supplierPrices) {
      const price = productDetail.supplierPrices.find(
        (p: any) => p.supplierId === formData.supplierId
      );
      if (price) {
        setFormData(f => ({ ...f, supplierPrice: String(price.price) }));
        setSelectedSupplier(price.supplier);
      }
    }
  }, [formData.supplierId, productDetail]);

  // Calculate pricing
  const calculations = useMemo(() => {
    const quantity = parseFloat(formData.quantity) || 0;
    const supplierPrice = parseFloat(formData.supplierPrice) || 0;
    const additionalCost = parseFloat(formData.additionalCost) || 0;
    const margin = parseFloat(formData.margin) || 0;

    const unitCost = supplierPrice + additionalCost;
    const totalCost = unitCost * quantity;

    // Selling price is derived from margin-on-price: price = cost / (1 - margin).
    // A margin of 100% would divide by zero (and >100% flips the sign), so the
    // value is clamped to a range that always yields a sane price.
    const safeMargin = Math.min(Math.max(margin, 0), 99);
    const unitPrice = unitCost / (1 - safeMargin / 100);
    const totalPrice = unitPrice * quantity;
    const profit = totalPrice - totalCost;

    const round2 = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

    return {
      unitCost: round2(unitCost),
      totalCost: round2(totalCost),
      unitPrice: round2(unitPrice),
      totalPrice: round2(totalPrice),
      profit: round2(profit),
      marginClamped: margin !== safeMargin,
      safeMargin,
    };
  }, [formData.quantity, formData.supplierPrice, formData.additionalCost, formData.margin]);

  const handleSave = () => {
    if (!formData.productId || !formData.quantity) {
      toast.error('Please select a product and enter a quantity');
      return;
    }
    if (parseFloat(formData.quantity) <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }
    if (calculations.unitPrice <= 0) {
      toast.error('Enter a supplier price so a selling price can be calculated');
      return;
    }

    const newItem: QuotationItem = {
      id: item?.id || crypto.randomUUID(),
      productId: formData.productId,
      productName: selectedProduct?.name || '',
      productCode: selectedProduct?.code || '',
      quantity: parseFloat(formData.quantity),
      unit: formData.unit,
      supplierPrice: parseFloat(formData.supplierPrice) || 0,
      supplierId: formData.supplierId,
      supplierName: selectedSupplier?.name || '',
      unitCost: calculations.unitCost,
      margin: calculations.safeMargin,
      unitPrice: calculations.unitPrice,
      totalCost: calculations.totalCost,
      totalPrice: calculations.totalPrice,
      specifications: formData.specifications,
    };

    onSave(newItem);
  };

  const supplierPrices = productDetail?.supplierPrices || [];

  return (
    <Modal isOpen onClose={onClose} title={item ? 'Edit Item Costing' : 'Add Item with Costing'} size="lg">
      <div className="p-6 space-y-6">
        {/* Product Selection */}
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Product"
            required
            value={formData.productId}
            onChange={(e) => setFormData({ ...formData, productId: e.target.value, supplierId: '', supplierPrice: '' })}
            options={products.map((p: any) => ({ value: p.id, label: `${p.code} - ${p.name}` }))}
            placeholder="Select Product"
            className="col-span-2"
          />
          <FormField
            label="Quantity"
            required
            type="number"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
          />
          <SelectField
            label="Unit"
            value={formData.unit}
            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
            options={[
              { value: 'KG', label: 'KG' },
              { value: 'MT', label: 'MT' },
              { value: 'PCS', label: 'PCS' },
              { value: 'CTN', label: 'CTN' },
            ]}
          />
        </div>

        {/* Supplier Pricing */}
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Supplier Pricing
          </h3>
          
          {supplierPrices.length > 0 ? (
            <div className="space-y-3">
              <SelectField
                label="Select Supplier"
                value={formData.supplierId}
                onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                options={supplierPrices.map((sp: any) => ({
                  value: sp.supplierId,
                  label: `${sp.supplier?.name} - ${formatCurrency(sp.price, sp.currency)}/${sp.unit}`,
                }))}
                placeholder="Select from available suppliers"
              />
              <div className="text-xs text-blue-600">
                {supplierPrices.length} supplier(s) available with pricing
              </div>
            </div>
          ) : formData.productId ? (
            <div className="text-sm text-blue-700">
              No supplier pricing found for this product. Enter manually below.
            </div>
          ) : (
            <div className="text-sm text-blue-600">
              Select a product to see available supplier pricing.
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mt-3">
            <FormField
              label="Supplier Price (per unit)"
              required
              type="number"
              step="0.01"
              value={formData.supplierPrice}
              onChange={(e) => setFormData({ ...formData, supplierPrice: e.target.value })}
              placeholder="Cost from supplier"
            />
            <FormField
              label="Additional Cost (per unit)"
              type="number"
              step="0.01"
              value={formData.additionalCost}
              onChange={(e) => setFormData({ ...formData, additionalCost: e.target.value })}
              placeholder="Packaging, handling..."
              hint="Packaging, processing, etc."
            />
          </div>
        </div>

        {/* Margin & Pricing */}
        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
            <Percent className="w-5 h-5" />
            Margin & Selling Price
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <FormField
              label="Margin %"
              type="number"
              step="0.1"
              min={0}
              max={99}
              value={formData.margin}
              onChange={(e) => setFormData({ ...formData, margin: e.target.value })}
              hint={calculations.marginClamped ? `Using ${calculations.safeMargin}%` : undefined}
            />
            <div>
              <label className="label">Unit Price</label>
              <div className="input bg-gray-100 font-bold text-green-700">
                {formatCurrency(calculations.unitPrice, currency?.code)}
              </div>
            </div>
            <div>
              <label className="label">Total Price</label>
              <div className="input bg-gray-100 font-bold text-green-700">
                {formatCurrency(calculations.totalPrice, currency?.code)}
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Calculation Summary</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Unit Cost:</span>
            <span className="text-right font-medium">{formatCurrency(calculations.unitCost, currency?.code)}</span>
            <span className="text-gray-500">Total Cost:</span>
            <span className="text-right">{formatCurrency(calculations.totalCost, currency?.code)}</span>
            <span className="text-gray-500">Unit Price:</span>
            <span className="text-right font-medium">{formatCurrency(calculations.unitPrice, currency?.code)}</span>
            <span className="text-gray-500">Total Price:</span>
            <span className="text-right font-bold">{formatCurrency(calculations.totalPrice, currency?.code)}</span>
            <span className="text-gray-500">Profit:</span>
            <span className={cn(
              'text-right font-bold',
              calculations.profit >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {formatCurrency(calculations.profit, currency?.code)}
            </span>
          </div>
        </div>

        {/* Specifications */}
        <TextareaField
          label="Specifications"
          value={formData.specifications}
          onChange={(e) => setFormData({ ...formData, specifications: e.target.value })}
          rows={2}
          placeholder="Quality specs, packaging requirements..."
        />

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">
            {item ? 'Update Item' : 'Add Item'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Add Cost Modal (CHA, Transport, etc.)
function AddCostModal({ 
  currency, 
  onClose, 
  onSave 
}: { 
  currency: any; 
  onClose: () => void; 
  onSave: (cost: AdditionalCost) => void;
}) {
  const [formData, setFormData] = useState({
    costType: 'CHA',
    description: '',
    amount: '',
  });

  // Fetch CHAs and Transporters for quick reference
  const { data: chas = [] } = useQuery({
    queryKey: ['chas-all'],
    queryFn: async () => (await chaApi.list({ limit: 100 })).data?.data ?? [],
  });

  const { data: transporters = [] } = useQuery({
    queryKey: ['transporters-all'],
    queryFn: async () => (await transportersApi.list({ limit: 100 })).data?.data ?? [],
  });

  const handleSave = () => {
    if (!formData.description || !formData.amount) {
      toast.error('Please fill in all fields');
      return;
    }

    onSave({
      id: crypto.randomUUID(),
      costType: formData.costType,
      description: formData.description,
      amount: parseFloat(formData.amount),
      currency: currency?.code || 'USD',
    });
  };

  return (
    <Modal isOpen onClose={onClose} title="Add Additional Cost" size="md">
      <div className="p-6 space-y-4">
        <SelectField
          label="Cost Type"
          value={formData.costType}
          onChange={(e) => setFormData({ ...formData, costType: e.target.value })}
          options={[
            { value: 'CHA', label: 'CHA / Customs' },
            { value: 'TRANSPORT', label: 'Transportation' },
            { value: 'PACKAGING', label: 'Packaging' },
            { value: 'INSURANCE', label: 'Insurance' },
            { value: 'INSPECTION', label: 'Inspection' },
            { value: 'COMMISSION', label: 'Commission' },
            { value: 'OTHER', label: 'Other' },
          ]}
        />

        {/* Quick select from masters */}
        {formData.costType === 'CHA' && chas.length > 0 && (
          <div className="bg-gray-50 rounded p-3">
            <div className="text-sm text-gray-600 mb-2">Quick select from CHA masters:</div>
            <div className="flex flex-wrap gap-2">
              {chas.slice(0, 5).map((cha: any) => (
                <button
                  key={cha.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, description: cha.name })}
                  className="text-xs px-2 py-1 bg-white border rounded hover:bg-gray-100"
                >
                  {cha.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {formData.costType === 'TRANSPORT' && transporters.length > 0 && (
          <div className="bg-gray-50 rounded p-3">
            <div className="text-sm text-gray-600 mb-2">Quick select from Transporters:</div>
            <div className="flex flex-wrap gap-2">
              {transporters.slice(0, 5).map((t: any) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setFormData({ ...formData, description: t.name })}
                  className="text-xs px-2 py-1 bg-white border rounded hover:bg-gray-100"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <FormField
          label="Description"
          required
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="e.g., Customs clearance charges"
        />

        <FormField
          label={`Amount (${currency?.code || 'USD'})`}
          required
          type="number"
          step="0.01"
          value={formData.amount}
          onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
        />

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">Add Cost</button>
        </div>
      </div>
    </Modal>
  );
}
