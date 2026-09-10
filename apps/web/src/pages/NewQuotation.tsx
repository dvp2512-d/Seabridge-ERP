// New Quotation Page with Automatic Costing Calculatorimport { useState, useEffect, useMemo } from 'react';import { useNavigate, useSearchParams } from 'react-router-dom';import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';import toast from 'react-hot-toast';import {
  quotationsApi,
  inquiriesApi,
  buyersApi,
  masterApi,
  productsApi,
  chaApi,
  transportersApi,
} from '@/lib/api';import PageHeader from '@/components/ui/PageHeader';import Modal from '@/components/ui/Modal';import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';import { formatCurrency, cn } from '@/lib/utils';
import { refreshAggregates } from '@/lib/queryKeys';import {
  Plus,
  Trash2,
  Calculator,
  TrendingUp,
  AlertCircle,
  Package,
  IndianRupee,
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
  /**
   * Per-unit packaging/handling added on top of the supplier price.
   * Persisted on the line because unitCost is supplierPrice + additionalCost:
   * without it, reopening the calculator reset this to 0 and silently reduced
   * the line's cost, shifting margin and grand total.
   */
  additionalCost: number;
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
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const inquiryId = searchParams.get('inquiryId');

  // Form state
  const [buyerId, setBuyerId] = useState('');
  const [incotermId, setIncotermId] = useState('');
  const [portOfLoadingId, setPortOfLoadingId] = useState('');
  const [portOfDischargeId, setPortOfDischargeId] = useState('');
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
          additionalCost: 0,
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

  // Quotation totals. Each line already carries its own selling price, derived
  // from its own margin in the item modal, so the rollup only has to add up.
  //
  //   itemsSubtotal = sum of line totalPrice     the goods, as quoted
  //   itemsCost     = sum of line totalCost      what the goods cost us
  //   totalCost     = itemsCost + additionalCosts
  //   totalMargin   = itemsSubtotal - itemsCost  margin from line items only
  //   grandTotal    = itemsSubtotal + additionalCosts
  //
  // Additional costs sit under total cost and are billed on to the buyer, but
  // they do not earn margin. Margin comes from the line items only, so adding
  // a shipment cost never reduces it.
  const totals = useMemo(() => {
    const itemsSubtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const itemsCost = items.reduce((sum, item) => sum + item.totalCost, 0);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const additionalCostsTotal = additionalCosts.reduce((sum, cost) => sum + cost.amount, 0);

    const totalCost = itemsCost + additionalCostsTotal;
    const totalMargin = itemsSubtotal - itemsCost;
    // Gross margin: measured against revenue, matching price = cost / (1 - margin).
    const marginPercent = itemsSubtotal > 0 ? (totalMargin / itemsSubtotal) * 100 : 0;

    return {
      itemsSubtotal,
      itemsCost,
      totalQuantity,
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
      refreshAggregates(queryClient);
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
    if (!incotermId) {
      toast.error('Please select an incoterm');
      return;
    }
    if (items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    // Lines prefilled from an inquiry arrive with no pricing, and the API rejects
    // a unitPrice of 0. Without this the user got a bare "Validation failed" from
    // the server with no indication of which line was at fault.
    const unpriced = items.filter((i) => !(i.unitPrice > 0));
    if (unpriced.length > 0) {
      toast.error(
        unpriced.length === items.length
          ? 'Set a supplier price and margin on each line before saving.'
          : `${unpriced.length} line${unpriced.length > 1 ? 's have' : ' has'} no price yet: ${unpriced
              .map((i) => i.productName || 'item')
              .join(', ')}`
      );
      return;
    }

    const data = {
      inquiryId: inquiryId || undefined,
      buyerId,
      incotermId,
      portOfLoadingId: portOfLoadingId || undefined,
      portOfDischargeId: portOfDischargeId || undefined,
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
      })),
    };

    mutation.mutate(data);
  };

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
                <SelectField
                  label="Port of Loading"
                  value={portOfLoadingId}
                  onChange={(e) => setPortOfLoadingId(e.target.value)}
                  options={(dropdowns?.data?.data?.ports || []).map((p: any) => ({
                    value: p.id,
                    label: `${p.name} (${p.code})`,
                  }))}
                  placeholder="Select Port of Loading"
                />
                <SelectField
                  label="Port of Discharge"
                  value={portOfDischargeId}
                  onChange={(e) => setPortOfDischargeId(e.target.value)}
                  options={(dropdowns?.data?.data?.ports || []).map((p: any) => ({
                    value: p.id,
                    label: `${p.name} (${p.code})`,
                  }))}
                  placeholder="Select Port of Discharge"
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
                      <td>{formatCurrency(item.unitCost)}</td>
                      <td>
                        <span className={cn(
                          'font-medium',
                          item.margin >= 20 ? 'text-green-600' :
                          item.margin >= 15 ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {item.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className="font-medium">{formatCurrency(item.unitPrice)}</td>
                      <td className="font-medium">{formatCurrency(item.totalPrice)}</td>
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
                <IndianRupee className="w-5 h-5" />
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
                  <span className="font-medium">{formatCurrency(totals.itemsSubtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Items Cost</span>
                  <span>{formatCurrency(totals.itemsCost)}</span>
                </div>
                {totals.additionalCostsTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Additional Costs</span>
                    <span>{formatCurrency(totals.additionalCostsTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total Cost</span>
                  <span className="font-medium">{formatCurrency(totals.totalCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Margin</span>
                  <span className={cn(
                    'font-bold',
                    totals.marginPercent >= 15 ? 'text-green-600' :
                    totals.marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
                  )}>
                    {formatCurrency(totals.totalMargin)} ({totals.marginPercent.toFixed(1)}%)
                  </span>
                </div>
                <hr />
                <div className="flex justify-between text-lg">
                  <span className="font-semibold">Grand Total</span>
                  <span className="font-bold text-navy-900">{formatCurrency(totals.grandTotal)}</span>
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
  onClose, 
  onSave 
}: { 
  item: QuotationItem | null; 
  onClose: () => void; 
  onSave: (item: QuotationItem) => void;
}) {
  const [formData, setFormData] = useState({
    productId: item?.productId || '',
    quantity: item?.quantity?.toString() || '',
    unit: item?.unit || 'KG',
    supplierId: item?.supplierId || '',
    supplierPrice: item?.supplierPrice?.toString() || '',
    additionalCost: item?.additionalCost?.toString() || '0', // Packaging, handling, etc.
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
      additionalCost: parseFloat(formData.additionalCost) || 0,
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

          <div className="mt-3">
            <FormField
              label="Supplier Price (per unit)"
              required
              type="number"
              step="0.01"
              value={formData.supplierPrice}
              onChange={(e) => setFormData({ ...formData, supplierPrice: e.target.value })}
              placeholder="Cost from supplier"
            />
          </div>
        </div>

        {/* Additional Cost, Margin & Pricing */}
        <div className="bg-green-50 rounded-lg p-4">
          <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
            <Percent className="w-5 h-5" />
            Additional Cost, Margin &amp; Selling Price
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <FormField
              label="Additional Cost (per unit)"
              type="number"
              step="0.01"
              min={0}
              value={formData.additionalCost}
              onChange={(e) => setFormData({ ...formData, additionalCost: e.target.value })}
              placeholder="0.00"
              hint="Packaging, handling, processing"
            />
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
                {formatCurrency(calculations.unitPrice)}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                Cost {formatCurrency(calculations.unitCost)}/unit
              </p>
            </div>
            <div>
              <label className="label">Total Price</label>
              <div className="input bg-gray-100 font-bold text-green-700">
                {formatCurrency(calculations.totalPrice)}
              </div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Calculation Summary</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">Unit Cost:</span>
            <span className="text-right font-medium">{formatCurrency(calculations.unitCost)}</span>
            <span className="text-gray-500">Total Cost:</span>
            <span className="text-right">{formatCurrency(calculations.totalCost)}</span>
            <span className="text-gray-500">Unit Price:</span>
            <span className="text-right font-medium">{formatCurrency(calculations.unitPrice)}</span>
            <span className="text-gray-500">Total Price:</span>
            <span className="text-right font-bold">{formatCurrency(calculations.totalPrice)}</span>
            <span className="text-gray-500">Profit:</span>
            <span className={cn(
              'text-right font-bold',
              calculations.profit >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {formatCurrency(calculations.profit)}
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
  onClose, 
  onSave 
}: { 
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
      currency: 'INR',
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
          label="Amount (INR)"
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
