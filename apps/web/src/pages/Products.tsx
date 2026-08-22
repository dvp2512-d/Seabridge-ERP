// Enhanced Products Page with CRUD
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productsApi, masterApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { Plus, Search, Edit2, Package } from 'lucide-react';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

export default function Products() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['products', search, categoryFilter],
    queryFn: () => productsApi.list({ 
      search: search || undefined, 
      categoryId: categoryFilter || undefined 
    }),
  });

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const products = data?.data?.data || [];

  const handleSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
  }, 300);

  const openEdit = (product: any) => {
    setEditProduct(product);
    setShowModal(true);
  };

  const openAdd = () => {
    setEditProduct(null);
    setShowModal(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        subtitle={`${products.length} products in catalog`}
        actions={
          <button onClick={openAdd} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </button>
        }
      />

      {/* Filters */}
      <div className="card">
        <div className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products by name, code, or HSN..."
                className="input pl-10"
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <select
              className="select w-full sm:w-48"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {dropdowns?.data?.data?.productCategories?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Products Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : products.length === 0 ? (
        <div className="card">
          <div className="p-12 text-center">
            <Package className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No products found</h3>
            <p className="text-gray-500 mb-4">
              {search || categoryFilter ? 'Try adjusting your filters' : 'Add your first product to get started'}
            </p>
            {!search && !categoryFilter && (
              <button onClick={openAdd} className="btn btn-primary">
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>HSN Code</th>
                <th>Unit</th>
                <th>Status</th>
                <th className="w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product: any) => (
                <tr key={product.id}>
                  <td className="font-medium font-mono">{product.code}</td>
                  <td>
                    <div>
                      <div className="font-medium text-gray-900">{product.name}</div>
                      {product.description && (
                        <div className="text-sm text-gray-500 truncate max-w-xs">{product.description}</div>
                      )}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-navy">{product.category?.name || '-'}</span>
                  </td>
                  <td className="font-mono text-sm">{product.hsnCode || '-'}</td>
                  <td>{product.unit}</td>
                  <td>
                    <span className={`badge ${product.isActive ? 'badge-success' : 'badge-gray'}`}>
                      {product.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <button
                      onClick={() => openEdit(product)}
                      className="text-navy-600 hover:text-navy-800"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <ProductModal
          product={editProduct}
          categories={dropdowns?.data?.data?.productCategories || []}
          units={dropdowns?.data?.data?.units || ['KG', 'MT', 'PCS', 'CTN', 'BAGS']}
          onClose={() => { setShowModal(false); setEditProduct(null); }}
          onSuccess={() => {
            setShowModal(false);
            setEditProduct(null);
            queryClient.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
    </div>
  );
}

// Product Modal
function ProductModal({ 
  product, 
  categories, 
  units,
  onClose, 
  onSuccess 
}: { 
  product: any; 
  categories: any[];
  units: string[];
  onClose: () => void; 
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: product?.name || '',
    description: product?.description || '',
    categoryId: product?.categoryId || '',
    hsnCode: product?.hsnCode || '',
    unit: product?.unit || 'KG',
    isActive: product?.isActive ?? true,
  });

  const mutation = useMutation({
    mutationFn: (data: any) => 
      product ? productsApi.update(product.id, data) : productsApi.create(data),
    onSuccess: () => {
      toast.success(product ? 'Product updated' : 'Product created');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Operation failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title={product ? 'Edit Product' : 'Add Product'} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <FormField
          label="Product Name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter product name"
        />

        <TextareaField
          label="Description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          rows={2}
          placeholder="Optional product description"
        />

        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label="Category"
            required
            value={formData.categoryId}
            onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
            options={categories.map((c: any) => ({ value: c.id, label: c.name }))}
            placeholder="Select Category"
          />

          <FormField
            label="HSN Code"
            value={formData.hsnCode}
            onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
            placeholder="e.g., 09041100"
          />

          <SelectField
            label="Unit"
            value={formData.unit}
            onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
            options={units.map((u) => ({ value: u, label: u }))}
          />

          {product && (
            <div className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded border-gray-300"
              />
              <label htmlFor="isActive" className="text-sm">Active</label>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : product ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
