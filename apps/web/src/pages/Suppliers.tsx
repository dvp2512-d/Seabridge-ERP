// Enhanced Suppliers Page with CRUD and Pricing
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { suppliersApi, masterApi, productsApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { Plus, Search, Star, Eye, Building2, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import RowActions from '@/components/ui/RowActions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';

export default function Suppliers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  // Deactivate / cancel flow, shared with every other list so the
  // wording and confirmations stay consistent.
  const lifecycle = useLifecycleActions(['suppliers']);
  // Deactivated rows are hidden by default. Revealing them is what makes a
  // deactivation reversible without database access.
  const [showInactive, setShowInactive] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, showInactive],
    queryFn: () => suppliersApi.list({
      isActive: showInactive ? undefined : true, search: search || undefined }),
  });

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const suppliers = data?.data?.data || [];

  const handleSearch = useDebouncedCallback((value: string) => setSearch(value), 300);

  const viewDetails = (supplier: any) => {
    setSelectedSupplier(supplier);
    setShowDetailModal(true);
  };

  return (
    <div className="space-y-6">
      {/* Confirmation for deactivate, cancel and delete */}
      {lifecycle.dialog && (
        <ConfirmDialog
          isOpen
          title={lifecycle.dialog.title}
          message={lifecycle.dialog.message}
          consequences={lifecycle.dialog.consequences}
          tone={lifecycle.dialog.tone}
          requireTyping={lifecycle.dialog.requireTyping}
          confirmLabel={lifecycle.dialog.confirmLabel}
          isPending={lifecycle.isPending}
          onConfirm={lifecycle.confirm}
          onCancel={lifecycle.dismiss}
        />
      )}
      <PageHeader
        title="Suppliers"
        subtitle={`${suppliers.length} suppliers`}
        actions={
          <button onClick={() => { setEditSupplier(null); setShowModal(true); }} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </button>
        }
      />

      <div className="card">
        <div className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search suppliers..."
              className="input pl-10"
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="card p-12 text-center">
          <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No suppliers found</h3>
          <p className="text-gray-500 mb-4">Add your first supplier to get started</p>
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Supplier
          </button>
            <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-gray-300"
              />
              Show inactive
            </label>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Country</th>
                <th>Rating</th>
                <th>Status</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier: any) => (
                <tr key={supplier.id}>
                  <td className="font-medium font-mono">{supplier.code}</td>
                  <td>
                    <div className="font-medium text-gray-900">{supplier.name}</div>
                  </td>
                  <td>{supplier.contactPerson || '-'}</td>
                  <td>{supplier.phone || '-'}</td>
                  <td>{supplier.country?.name || '-'}</td>
                  <td>
                    <div className="flex items-center gap-0.5">
                      {[1,2,3,4,5].map((i) => (
                        <Star key={i} className={`w-4 h-4 ${i <= (supplier.rating || 0) ? 'text-gold-500 fill-gold-500' : 'text-gray-300'}`} />
                      ))}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${supplier.isActive ? 'badge-success' : 'badge-gray'}`}>
                      {supplier.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button onClick={() => viewDetails(supplier)} className="text-navy-600 hover:text-navy-800">
                        <Eye className="w-4 h-4" />
                      </button>
                      <RowActions
                        onEdit={() => { setEditSupplier(supplier); setShowModal(true); }}
                        editPermission="MASTER_MANAGE"
                        destructiveKind="deactivate"
                        // Price lists and procurements reference suppliers with
                        // RESTRICT, so deactivating is the only safe removal.
                        onDestructive={
                          supplier.isActive
                            ? () =>
                                lifecycle.request(
                                  { kind: 'deactivate', resource: 'suppliers' },
                                  supplier.id,
                                  supplier.companyName ?? supplier.name
                                )
                            : undefined
                        }
                        onReactivate={
                          !supplier.isActive
                            ? () =>
                                lifecycle.request(
                                  { kind: 'reactivate', resource: 'suppliers' },
                                  supplier.id,
                                  supplier.companyName ?? supplier.name
                                )
                            : undefined
                        }
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SupplierModal
          supplier={editSupplier}
          countries={dropdowns?.data?.data?.countries || []}
          onClose={() => { setShowModal(false); setEditSupplier(null); }}
          onSuccess={() => {
            setShowModal(false);
            setEditSupplier(null);
            queryClient.invalidateQueries({ queryKey: ['suppliers'] });
          }}
        />
      )}

      {showDetailModal && selectedSupplier && (
        <SupplierDetailModal
          supplierId={selectedSupplier.id}
          onClose={() => { setShowDetailModal(false); setSelectedSupplier(null); }}
        />
      )}
    </div>
  );
}

// Supplier Form Modal
function SupplierModal({ supplier, countries, onClose, onSuccess }: { supplier: any; countries: any[]; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: supplier?.name || '',
    contactPerson: supplier?.contactPerson || '',
    email: supplier?.email || '',
    phone: supplier?.phone || '',
    address: supplier?.address || '',
    countryId: supplier?.countryId || '',
    gstNumber: supplier?.gstNumber || '',
    panNumber: supplier?.panNumber || '',
    bankDetails: supplier?.bankDetails || '',
    paymentTerms: supplier?.paymentTerms || '',
    rating: supplier?.rating || 0,
    notes: supplier?.notes || '',
    isActive: supplier?.isActive ?? true,
  });

  const mutation = useMutation({
    mutationFn: (data: any) => supplier ? suppliersApi.update(supplier.id, data) : suppliersApi.create(data),
    onSuccess: () => {
      toast.success(supplier ? 'Supplier updated' : 'Supplier created');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Operation failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title={supplier ? 'Edit Supplier' : 'Add Supplier'} size="lg">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="col-span-2" />
          <FormField label="Contact Person" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} />
          <FormField label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
          <FormField label="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
          <SelectField label="Country" value={formData.countryId} onChange={(e) => setFormData({ ...formData, countryId: e.target.value })} options={countries.map((c: any) => ({ value: c.id, label: c.name }))} placeholder="Select Country" />
          <FormField label="Address" className="col-span-2" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
          <FormField label="GST Number" value={formData.gstNumber} onChange={(e) => setFormData({ ...formData, gstNumber: e.target.value })} />
          <FormField label="PAN Number" value={formData.panNumber} onChange={(e) => setFormData({ ...formData, panNumber: e.target.value })} />
          <FormField label="Payment Terms" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} />
          <div>
            <label className="label">Rating</label>
            <div className="flex items-center gap-1">
              {[1,2,3,4,5].map((i) => (
                <button key={i} type="button" onClick={() => setFormData({ ...formData, rating: i })} className="focus:outline-none">
                  <Star className={`w-6 h-6 ${i <= formData.rating ? 'text-gold-500 fill-gold-500' : 'text-gray-300'}`} />
                </button>
              ))}
            </div>
          </div>
          <TextareaField label="Bank Details" className="col-span-2" value={formData.bankDetails} onChange={(e) => setFormData({ ...formData, bankDetails: e.target.value })} rows={2} />
          <TextareaField label="Notes" className="col-span-2" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : supplier ? 'Update' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

// Supplier Detail Modal with Pricing
function SupplierDetailModal({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showPriceModal, setShowPriceModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['supplier', supplierId],
    queryFn: () => suppliersApi.get(supplierId),
  });

  const supplier = data?.data?.data;

  if (isLoading) {
    return (
      <Modal isOpen onClose={onClose} title="Supplier Details" size="lg">
        <div className="p-6 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" /></div>
      </Modal>
    );
  }

  return (
    <Modal isOpen onClose={onClose} title={supplier?.name || 'Supplier Details'} size="lg">
      <div className="p-6 space-y-6">
        {/* Supplier Info */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-gray-500">Code:</span> <span className="font-medium">{supplier?.code}</span></div>
          <div><span className="text-gray-500">Contact:</span> <span className="font-medium">{supplier?.contactPerson || '-'}</span></div>
          <div><span className="text-gray-500">Email:</span> <span className="font-medium">{supplier?.email || '-'}</span></div>
          <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{supplier?.phone || '-'}</span></div>
          <div><span className="text-gray-500">Country:</span> <span className="font-medium">{supplier?.country?.name || '-'}</span></div>
          <div><span className="text-gray-500">Payment Terms:</span> <span className="font-medium">{supplier?.paymentTerms || '-'}</span></div>
        </div>

        {/* Price List */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <DollarSign className="w-4 h-4" />
              Product Pricing
            </h3>
            <button onClick={() => setShowPriceModal(true)} className="btn btn-secondary py-1 text-sm">
              <Plus className="w-4 h-4 mr-1" />
              Add Price
            </button>
          </div>
          
          {supplier?.supplierPrices?.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Unit</th>
                  <th>Valid From</th>
                  <th>Valid To</th>
                </tr>
              </thead>
              <tbody>
                {supplier.supplierPrices.map((price: any) => (
                  <tr key={price.id}>
                    <td>{price.product?.name}</td>
                    <td className="font-medium">{formatCurrency(price.price, price.currency)}</td>
                    <td>{price.unit}</td>
                    <td>{formatDate(price.validFrom)}</td>
                    <td>{price.validTo ? formatDate(price.validTo) : 'Ongoing'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">
              No pricing added yet
            </div>
          )}
        </div>
      </div>

      {showPriceModal && (
        <AddPriceModal
          supplierId={supplierId}
          onClose={() => setShowPriceModal(false)}
          onSuccess={() => {
            setShowPriceModal(false);
            queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
          }}
        />
      )}
    </Modal>
  );
}

// Add Price Modal
function AddPriceModal({ supplierId, onClose, onSuccess }: { supplierId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    productId: '',
    price: '',
    currency: 'INR',
    unit: 'KG',
    validFrom: new Date().toISOString().split('T')[0],
    validTo: '',
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await productsApi.list({ limit: 500 })).data?.data ?? [],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => suppliersApi.addPrice(supplierId, {
      ...data,
      price: parseFloat(data.price),
      validFrom: data.validFrom,
      validTo: data.validTo || undefined,
    }),
    onSuccess: () => {
      toast.success('Price added');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed to add price'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Add Product Price" size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <SelectField
          label="Product"
          required
          value={formData.productId}
          onChange={(e) => setFormData({ ...formData, productId: e.target.value })}
          options={products.map((p: any) => ({ value: p.id, label: `${p.code} - ${p.name}` }))}
          placeholder="Select Product"
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Price" required type="number" step="0.01" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} />
          <SelectField label="Currency" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} options={[
            { value: 'INR', label: 'INR (₹)' },
            { value: 'USD', label: 'USD ($)' },
          ]} />
          <SelectField label="Unit" value={formData.unit} onChange={(e) => setFormData({ ...formData, unit: e.target.value })} options={[
            { value: 'KG', label: 'KG' },
            { value: 'MT', label: 'MT' },
            { value: 'PCS', label: 'PCS' },
          ]} />
          <FormField label="Valid From" required type="date" value={formData.validFrom} onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })} />
          <FormField label="Valid To (Optional)" type="date" value={formData.validTo} onChange={(e) => setFormData({ ...formData, validTo: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Adding...' : 'Add Price'}</button>
        </div>
      </form>
    </Modal>
  );
}
