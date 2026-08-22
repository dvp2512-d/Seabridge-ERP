// Enhanced Buyers Page
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { buyersApi, masterApi } from '@/lib/api';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { Plus, Search, Eye, Building2, MapPin, TrendingUp } from 'lucide-react';

export default function Buyers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['buyers', search, statusFilter, countryFilter, page],
    queryFn: () => buyersApi.list({ 
      search: search || undefined, 
      status: statusFilter || undefined,
      countryId: countryFilter || undefined,
      page,
      limit: 20
    }),
  });

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const buyers = data?.data?.data || [];
  const pagination = data?.data?.pagination;

  const handleSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, 300);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buyers"
        subtitle={`${pagination?.total || 0} total buyers`}
        actions={
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Buyer
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
                placeholder="Search by name, code, or trade name..."
                className="input pl-10"
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <select
              className="select w-full sm:w-40"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              {dropdowns?.data?.data?.buyerStatuses?.map((status: string) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <select
              className="select w-full sm:w-48"
              value={countryFilter}
              onChange={(e) => { setCountryFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Countries</option>
              {dropdowns?.data?.data?.countries?.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Buyers Grid/List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : buyers.length === 0 ? (
        <div className="card">
          <div className="p-12 text-center">
            <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-1">No buyers found</h3>
            <p className="text-gray-500 mb-4">
              {search || statusFilter || countryFilter
                ? 'Try adjusting your filters'
                : 'Get started by adding your first buyer'}
            </p>
            {!search && !statusFilter && !countryFilter && (
              <button onClick={() => setShowModal(true)} className="btn btn-primary">
                <Plus className="w-4 h-4 mr-2" />
                Add Buyer
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* Table View */}
          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th>Revenue</th>
                  <th>Orders</th>
                  <th>Last Order</th>
                  <th className="w-20"></th>
                </tr>
              </thead>
              <tbody>
                {buyers.map((buyer: any) => (
                  <tr 
                    key={buyer.id} 
                    className="cursor-pointer"
                    onClick={() => navigate(`/buyers/${buyer.id}`)}
                  >
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-navy-100 text-navy-600 flex items-center justify-center font-semibold">
                          {buyer.companyName?.[0]}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900">{buyer.companyName}</div>
                          <div className="text-sm text-gray-500">{buyer.code}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1 text-gray-600">
                        <MapPin className="w-4 h-4" />
                        {buyer.country?.name || '-'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${getStatusColor(buyer.status)}`}>
                        {buyer.status}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <TrendingUp className="w-4 h-4 text-green-500" />
                        {formatCurrency(buyer.totalRevenue || 0)}
                      </div>
                    </td>
                    <td>{buyer.totalOrders || 0}</td>
                    <td className="text-gray-500">
                      {buyer.lastOrderDate ? formatDate(buyer.lastOrderDate) : 'Never'}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link
                        to={`/buyers/${buyer.id}`}
                        className="btn btn-secondary py-1 px-2"
                      >
                        <Eye className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pagination && pagination.total > pagination.limit && (
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-500">
                Showing {((pagination.page - 1) * pagination.limit) + 1} to{' '}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="btn btn-secondary"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage(p => p + 1)}
                  disabled={page * pagination.limit >= pagination.total}
                  className="btn btn-secondary"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Buyer Modal */}
      {showModal && (
        <AddBuyerModal
          dropdowns={dropdowns?.data?.data}
          onClose={() => setShowModal(false)}
          onSuccess={(newBuyer) => {
            setShowModal(false);
            queryClient.invalidateQueries({ queryKey: ['buyers'] });
            if (newBuyer?.id) {
              navigate(`/buyers/${newBuyer.id}`);
            }
          }}
        />
      )}
    </div>
  );
}

// Add Buyer Modal
function AddBuyerModal({ dropdowns, onClose, onSuccess }: { dropdowns: any; onClose: () => void; onSuccess: (buyer?: any) => void }) {
  const [formData, setFormData] = useState({
    companyName: '',
    tradeName: '',
    countryId: '',
    address: '',
    city: '',
    website: '',
    industry: '',
    status: 'LEAD',
    source: '',
    currencyId: '',
    paymentTerms: '',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => buyersApi.create(data),
    onSuccess: (response) => {
      toast.success('Buyer created successfully');
      onSuccess(response.data?.data);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create buyer');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title="Add New Buyer" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField 
            label="Company Name" 
            required 
            value={formData.companyName} 
            onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
            placeholder="Enter company name"
          />
          <FormField 
            label="Trade Name" 
            value={formData.tradeName} 
            onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })}
            placeholder="Optional trade name"
          />
          <SelectField 
            label="Country" 
            required 
            value={formData.countryId} 
            onChange={(e) => setFormData({ ...formData, countryId: e.target.value })}
            options={(dropdowns?.countries || []).map((c: any) => ({ value: c.id, label: c.name }))}
            placeholder="Select Country"
          />
          <SelectField 
            label="Status" 
            value={formData.status} 
            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            options={(dropdowns?.buyerStatuses || []).map((s: string) => ({ value: s, label: s }))}
          />
          <FormField 
            label="Address" 
            className="sm:col-span-2"
            value={formData.address} 
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          />
          <FormField 
            label="City" 
            value={formData.city} 
            onChange={(e) => setFormData({ ...formData, city: e.target.value })}
          />
          <FormField 
            label="Website" 
            value={formData.website} 
            onChange={(e) => setFormData({ ...formData, website: e.target.value })}
            placeholder="https://"
          />
          <FormField 
            label="Industry" 
            value={formData.industry} 
            onChange={(e) => setFormData({ ...formData, industry: e.target.value })}
          />
          <FormField 
            label="Source" 
            value={formData.source} 
            onChange={(e) => setFormData({ ...formData, source: e.target.value })}
            placeholder="EXHIBITION, REFERRAL, WEBSITE, etc."
          />
          <SelectField 
            label="Currency" 
            value={formData.currencyId} 
            onChange={(e) => setFormData({ ...formData, currencyId: e.target.value })}
            options={(dropdowns?.currencies || []).map((c: any) => ({ value: c.id, label: `${c.code} (${c.symbol})` }))}
            placeholder="Select Currency"
          />
          <FormField 
            label="Payment Terms" 
            value={formData.paymentTerms} 
            onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })}
            placeholder="e.g., Net 30, LC at sight"
          />
          <TextareaField 
            label="Notes" 
            className="sm:col-span-2"
            value={formData.notes} 
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            rows={3}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating...' : 'Create Buyer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
