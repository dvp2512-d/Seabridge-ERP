// New Quotation - pricing is built up from configurable components per line item
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  quotationsApi,
  inquiriesApi,
  buyersApi,
  masterApi,
  productsApi,
  getApiErrorMessage,
} from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, cn } from '@/lib/utils';
import {
  calculateLinePricing,
  CALC_TYPE_OPTIONS,
  describeCalcType,
  type PricingCalcType,
  type PricingComponent,
} from '@/lib/pricing';
import {
  Plus, Trash2, Calculator, AlertCircle, Package, FileText, Percent, Settings2,
} from 'lucide-react';

interface QuotationItem {
  id: string;
  productId: string;
  productName: string;
  productCode: string;
  quantity: string;
  unit: string;
  specifications: string;
  components: PricingComponent[];
  // Derived, kept for display in the items table
  totalPrice: number;
  totalCost: number;
  margin: number;
  marginPercent: number;
  unitPrice: number;
}

export default function NewQuotation() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inquiryId = searchParams.get('inquiryId');

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

  const [items, setItems] = useState<QuotationItem[]>([]);
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<QuotationItem | null>(null);

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const { data: buyersData } = useQuery({
    queryKey: ['buyers-list'],
    queryFn: () => buyersApi.list({ limit: 200 }),
  });

  // The master pricing structure. New line items start from this.
  const { data: parameters = [] } = useQuery({
    queryKey: ['pricing-parameters'],
    queryFn: async () => (await masterApi.getPricingParameters()).data?.data ?? [],
  });

  const { data: inquiryData } = useQuery({
    queryKey: ['inquiry', inquiryId],
    queryFn: () => inquiriesApi.get(inquiryId!),
    enabled: !!inquiryId,
  });

  // Pre-fill from an inquiry
  useEffect(() => {
    const inquiry = inquiryData?.data?.data;
    if (!inquiry) return;
    setBuyerId(inquiry.buyerId);
    if (inquiry.buyer?.currencyId) setCurrencyId(inquiry.buyer.currencyId);
  }, [inquiryData]);

  useEffect(() => {
    if (currencyId) return;
    const currencies = dropdowns?.data?.data?.currencies ?? [];
    if (currencies.length === 0) return;
    const preferred = currencies.find((c: any) => c.code === 'USD') ?? currencies[0];
    if (preferred) setCurrencyId(preferred.id);
  }, [dropdowns, currencyId]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, i) => sum + i.totalPrice, 0);
    const totalCost = items.reduce((sum, i) => sum + i.totalCost, 0);
    const totalMargin = items.reduce((sum, i) => sum + i.margin, 0);
    return {
      subtotal,
      totalCost,
      totalMargin,
      marginPercent: subtotal > 0 ? (totalMargin / subtotal) * 100 : 0,
      grandTotal: subtotal,
    };
  }, [items]);

  const mutation = useMutation({
    mutationFn: (data: any) => quotationsApi.create(data),
    onSuccess: (response) => {
      toast.success('Quotation created');
      navigate(`/quotations/${response.data?.data?.id}`);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to create quotation')),
  });

  const handleSubmit = () => {
    if (!buyerId) return toast.error('Please select a buyer');
    if (!currencyId || !incotermId) return toast.error('Please select currency and incoterm');
    if (items.length === 0) return toast.error('Please add at least one item');

    mutation.mutate({
      inquiryId: inquiryId || undefined,
      buyerId,
      currencyId,
      incotermId,
      validUntil,
      paymentTerms,
      deliveryTerms,
      notes,
      termsConditions,
      // Only the inputs are sent - the API recalculates every price itself.
      items: items.map((item) => ({
        productId: item.productId,
        quantity: parseFloat(item.quantity) || 0,
        unit: item.unit,
        specifications: item.specifications,
        components: item.components.map((c) => ({
          parameterId: c.parameterId ?? null,
          name: c.name,
          calcType: c.calcType,
          isMargin: c.isMargin,
          sortOrder: c.sortOrder,
          value: parseFloat(c.value) || 0,
        })),
      })),
    });
  };

  const selectedCurrency = dropdowns?.data?.data?.currencies?.find(
    (c: any) => c.id === currencyId
  );
  const currencyCode = selectedCurrency?.code;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Quotation"
        subtitle={inquiryId ? 'From inquiry' : 'New quotation'}
        actions={
          <div className="flex gap-2">
            <button onClick={() => navigate(-1)} className="btn btn-secondary">Cancel</button>
            <button
              onClick={handleSubmit}
              className="btn btn-primary"
              disabled={mutation.isPending || items.length === 0}
            >
              {mutation.isPending ? 'Creating...' : 'Create Quotation'}
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Basic info */}
          <div className="card">
            <div className="card-header"><h2 className="font-semibold">Basic Information</h2></div>
            <div className="card-body">
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Buyer" required value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                  options={(buyersData?.data?.data || []).map((b: any) => ({
                    value: b.id, label: `${b.code} - ${b.companyName}`,
                  }))}
                  placeholder="Select Buyer" className="col-span-2"
                />
                <SelectField
                  label="Currency" required value={currencyId}
                  onChange={(e) => setCurrencyId(e.target.value)}
                  options={(dropdowns?.data?.data?.currencies || []).map((c: any) => ({
                    value: c.id, label: `${c.code} (${c.symbol})`,
                  }))}
                  placeholder="Select Currency"
                />
                <SelectField
                  label="Incoterm" required value={incotermId}
                  onChange={(e) => setIncotermId(e.target.value)}
                  options={(dropdowns?.data?.data?.incoterms || []).map((i: any) => ({
                    value: i.id, label: `${i.code} - ${i.name}`,
                  }))}
                  placeholder="Select Incoterm"
                />
                <FormField
                  label="Valid Until" required type="date" value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
                <FormField
                  label="Payment Terms" value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="e.g. 30% advance, 70% against BL"
                />
                <FormField
                  label="Delivery Terms" value={deliveryTerms}
                  onChange={(e) => setDeliveryTerms(e.target.value)}
                  placeholder="e.g. 4-6 weeks from order confirmation"
                  className="col-span-2"
                />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <div>
                <h2 className="font-semibold flex items-center gap-2">
                  <Package className="w-5 h-5" /> Line Items
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Each line's price is built from the pricing structure, then divided by quantity.
                </p>
              </div>
              <button
                onClick={() => { setEditingItem(null); setShowItemModal(true); }}
                className="btn btn-secondary py-1 text-sm"
              >
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Cost/Unit</th>
                    <th className="text-right">Margin</th>
                    <th className="text-right">Price/Unit</th>
                    <th className="text-right">Line Total</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div className="font-medium">{item.productName}</div>
                        <div className="text-xs text-gray-500">{item.productCode}</div>
                        <div className="text-xs text-gray-400">
                          {item.components.length} pricing component{item.components.length === 1 ? '' : 's'}
                        </div>
                      </td>
                      <td className="text-right">{item.quantity} {item.unit}</td>
                      <td className="text-right text-gray-600">
                        {formatCurrency(item.totalCost / (parseFloat(item.quantity) || 1), currencyCode)}
                      </td>
                      <td className="text-right">
                        <span className={cn(
                          'font-medium',
                          item.marginPercent >= 15 ? 'text-green-600'
                            : item.marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
                        )}>
                          {item.marginPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="text-right font-medium">
                        {formatCurrency(item.unitPrice, currencyCode)}
                      </td>
                      <td className="text-right font-semibold">
                        {formatCurrency(item.totalPrice, currencyCode)}
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditingItem(item); setShowItemModal(true); }}
                            className="text-navy-600 hover:text-navy-800 p-1"
                            aria-label="Edit pricing"
                          >
                            <Calculator className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setItems(items.filter((i) => i.id !== item.id))}
                            className="text-red-500 hover:text-red-700 p-1"
                            aria-label="Remove item"
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
                        No items yet. Click "Add Item" to build a price.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Notes & terms */}
          <div className="card">
            <div className="card-header"><h2 className="font-semibold">Notes &amp; Terms</h2></div>
            <div className="card-body space-y-4">
              <TextareaField
                label="Notes" value={notes} rows={2}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special notes for this quotation..."
              />
              <TextareaField
                label="Terms & Conditions" value={termsConditions} rows={4}
                onChange={(e) => setTermsConditions(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-6">
          <div className="card sticky top-6">
            <div className="card-header bg-navy-900 text-white rounded-t-xl">
              <h2 className="font-semibold flex items-center gap-2">
                <Calculator className="w-5 h-5" /> Quotation Summary
              </h2>
            </div>
            <div className="card-body space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Cost</span>
                <span>{formatCurrency(totals.totalCost, currencyCode)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Margin</span>
                <span className={cn(
                  'font-medium',
                  totals.marginPercent >= 15 ? 'text-green-600'
                    : totals.marginPercent >= 10 ? 'text-yellow-600' : 'text-red-600'
                )}>
                  {formatCurrency(totals.totalMargin, currencyCode)} ({totals.marginPercent.toFixed(1)}%)
                </span>
              </div>
              <hr />
              <div className="flex justify-between text-lg">
                <span className="font-semibold">Grand Total</span>
                <span className="font-bold text-navy-900">
                  {formatCurrency(totals.grandTotal, currencyCode)}
                </span>
              </div>
              <p className="text-xs text-gray-500">
                All costs are already included in the line prices.
              </p>

              {items.length > 0 && totals.marginPercent < 10 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="text-sm text-red-700">
                    <strong>Low margin.</strong> Overall margin is below 10%.
                  </div>
                </div>
              )}

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

      {showItemModal && (
        <ItemPricingModal
          item={editingItem}
          parameters={parameters}
          currencyCode={currencyCode}
          onClose={() => { setShowItemModal(false); setEditingItem(null); }}
          onSave={(saved) => {
            setItems((prev) =>
              editingItem
                ? prev.map((i) => (i.id === saved.id ? saved : i))
                : [...prev, saved]
            );
            setShowItemModal(false);
            setEditingItem(null);
          }}
        />
      )}
    </div>
  );
}



/**
 * Builds one line item's price from a list of components.
 *
 * Components come from the master pricing structure but are fully editable
 * here - rows can be added, renamed, retyped or removed per line, and the
 * totals recalculate on every keystroke.
 */
function ItemPricingModal({
  item,
  parameters,
  currencyCode,
  onClose,
  onSave,
}: {
  item: QuotationItem | null;
  parameters: any[];
  currencyCode?: string;
  onClose: () => void;
  onSave: (item: QuotationItem) => void;
}) {
  const [productId, setProductId] = useState(item?.productId ?? '');
  const [quantity, setQuantity] = useState(item?.quantity ?? '');
  const [unit, setUnit] = useState(item?.unit ?? 'KG');
  const [specifications, setSpecifications] = useState(item?.specifications ?? '');

  // Start from the master structure for a new line; keep the snapshot when editing.
  const [components, setComponents] = useState<PricingComponent[]>(() => {
    if (item) return item.components.map((c) => ({ ...c }));
    return parameters.map((p, index) => ({
      key: `${p.id}-${index}`,
      parameterId: p.id,
      name: p.name,
      calcType: p.calcType as PricingCalcType,
      isMargin: Boolean(p.isMargin),
      sortOrder: p.sortOrder ?? index,
      value: p.defaultValue != null ? String(p.defaultValue) : '',
    }));
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await productsApi.list({ limit: 500 })).data?.data ?? [],
  });

  const { data: productDetail } = useQuery({
    queryKey: ['product', productId],
    queryFn: async () => (await productsApi.get(productId)).data?.data ?? null,
    enabled: !!productId,
  });

  const selectedProduct = products.find((p: any) => p.id === productId);
  const supplierPrices = productDetail?.supplierPrices ?? [];

  // Follow the product's own unit unless the user has overridden it.
  useEffect(() => {
    if (selectedProduct?.unit) setUnit(selectedProduct.unit);
  }, [selectedProduct?.unit]);

  const pricing = useMemo(
    () => calculateLinePricing(quantity, components),
    [quantity, components]
  );

  const updateComponent = (key: string, patch: Partial<PricingComponent>) => {
    setComponents((prev) => prev.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  };

  const addComponent = () => {
    setComponents((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        parameterId: null,
        name: '',
        calcType: 'FIXED',
        isMargin: false,
        sortOrder: prev.length > 0 ? Math.max(...prev.map((c) => c.sortOrder)) + 1 : 0,
        value: '',
      },
    ]);
  };

  /** Prefill the supplier component from the product's supplier price list. */
  const applySupplierPrice = (price: number) => {
    const supplierRow =
      components.find((c) => /supplier/i.test(c.name)) ?? components[0];
    if (!supplierRow) return;
    updateComponent(supplierRow.key, {
      value: String(price),
      calcType: 'PER_UNIT',
    });
    toast.success(`Applied ${formatCurrency(price, currencyCode)} per unit`);
  };

  const handleSave = () => {
    if (!productId) return toast.error('Please select a product');
    const qty = parseFloat(quantity);
    if (!qty || qty <= 0) return toast.error('Quantity must be greater than zero');
    if (components.some((c) => !c.name.trim())) {
      return toast.error('Every pricing component needs a name');
    }
    if (pricing.totalPrice <= 0) {
      return toast.error('Enter at least one price component');
    }

    onSave({
      id: item?.id ?? crypto.randomUUID(),
      productId,
      productName: selectedProduct?.name ?? item?.productName ?? '',
      productCode: selectedProduct?.code ?? item?.productCode ?? '',
      quantity,
      unit,
      specifications,
      components,
      totalPrice: pricing.totalPrice,
      totalCost: pricing.totalCost,
      margin: pricing.margin,
      marginPercent: pricing.marginPercent,
      unitPrice: pricing.unitPrice,
    });
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={item ? 'Edit Line Item Pricing' : 'Add Line Item'}
      size="xl"
    >
      <div className="p-6 space-y-6">
        {/* Product + quantity */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <SelectField
            label="Product" required value={productId}
            onChange={(e) => setProductId(e.target.value)}
            options={products.map((p: any) => ({
              value: p.id, label: `${p.code} - ${p.name}`,
            }))}
            placeholder="Select Product"
            className="md:col-span-2"
          />
          <FormField
            label="Quantity" required type="number" step="0.01" min={0}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <SelectField
            label="Unit" value={unit}
            onChange={(e) => setUnit(e.target.value)}
            options={['KG', 'MT', 'LBS', 'PCS', 'CTN', 'BAGS', 'DRUMS'].map((u) => ({
              value: u, label: u,
            }))}
          />
        </div>

        {/* Supplier price shortcut */}
        {supplierPrices.length > 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="text-sm text-blue-900 font-medium mb-2">
              Supplier prices on record for this product
            </div>
            <div className="flex flex-wrap gap-2">
              {supplierPrices.map((sp: any) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => applySupplierPrice(Number(sp.price))}
                  className="text-xs px-2 py-1 bg-white border rounded hover:bg-blue-100"
                >
                  {sp.supplier?.name}: {formatCurrency(sp.price, sp.currency)}/{sp.unit}
                </button>
              ))}
            </div>
            <p className="text-xs text-blue-600 mt-2">
              Click one to fill the supplier component.
            </p>
          </div>
        )}

        {/* Pricing structure */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-navy-600" /> Pricing Structure
            </h3>
            <button type="button" onClick={addComponent} className="btn btn-secondary py-1 text-sm">
              <Plus className="w-4 h-4 mr-1" /> Add Component
            </button>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8">#</th>
                  <th>Component</th>
                  <th className="w-40">Type</th>
                  <th className="w-28 text-right">Value</th>
                  <th className="w-16 text-center">Margin</th>
                  <th className="w-32 text-right">Amount</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {pricing.components.map((component, index) => (
                  <tr key={component.key}>
                    <td className="text-gray-400">{index + 1}</td>
                    <td>
                      <input
                        className="input py-1"
                        value={component.name}
                        placeholder="Component name"
                        onChange={(e) => updateComponent(component.key, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="select py-1"
                        value={component.calcType}
                        onChange={(e) =>
                          updateComponent(component.key, {
                            calcType: e.target.value as PricingCalcType,
                          })
                        }
                      >
                        {CALC_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {describeCalcType(component.calcType)}
                      </div>
                    </td>
                    <td>
                      <input
                        className="input py-1 text-right"
                        type="number"
                        step="0.0001"
                        value={component.value}
                        placeholder="0"
                        onChange={(e) => updateComponent(component.key, { value: e.target.value })}
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={component.isMargin}
                        onChange={(e) =>
                          updateComponent(component.key, { isMargin: e.target.checked })
                        }
                        aria-label="Counts as margin, not cost"
                        className="rounded"
                      />
                    </td>
                    <td className={cn(
                      'text-right font-medium',
                      component.isMargin ? 'text-green-700' : 'text-gray-900'
                    )}>
                      {formatCurrency(component.amount, currencyCode)}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          setComponents((prev) => prev.filter((c) => c.key !== component.key))
                        }
                        className="text-red-500 hover:text-red-700 p-1"
                        aria-label="Remove component"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {components.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center py-6 text-gray-500">
                      No components. Click "Add Component" to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            "% of cost" applies to the total of the absolute cost components, so percentages
            never compound and the order of rows cannot change the result.
          </p>
        </div>

        {/* Live totals */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Percent className="w-5 h-5" /> Calculated Price
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500">Total Cost</div>
              <div className="text-lg font-semibold">
                {formatCurrency(pricing.totalCost, currencyCode)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Margin</div>
              <div className="text-lg font-semibold text-green-700">
                {formatCurrency(pricing.margin, currencyCode)}
                <span className="text-sm font-normal text-gray-500 ml-1">
                  ({pricing.marginPercent.toFixed(1)}%)
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Line Total</div>
              <div className="text-lg font-bold text-navy-900">
                {formatCurrency(pricing.totalPrice, currencyCode)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Per Unit Final Price</div>
              <div className="text-lg font-bold text-navy-900">
                {formatCurrency(pricing.unitPrice, currencyCode)}
              </div>
              <div className="text-xs text-gray-400">
                {formatCurrency(pricing.totalPrice, currencyCode)} ÷ {quantity || 0} {unit}
              </div>
            </div>
          </div>
        </div>

        <TextareaField
          label="Specifications"
          value={specifications}
          rows={2}
          onChange={(e) => setSpecifications(e.target.value)}
          placeholder="Quality specs, packaging requirements..."
        />

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
