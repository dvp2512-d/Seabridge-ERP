// Enhanced CHAs Page with CRUD and Rates
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { chaApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { Plus, Search, Edit2, Star, Eye, Anchor, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

export default function CHAs() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editCha, setEditCha] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedCha, setSelectedCha] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['chas', search],
    queryFn: () => chaApi.list({ search: search || undefined }),
  });

  const chas = data?.data?.data || [];

  const handleSearch = useDebouncedCallback((value: string) => setSearch(value), 300);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CHA Agents"
        subtitle="Customs Handling Agents"
        actions={
          <button onClick={() => { setEditCha(null); setShowModal(true); }} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add CHA
          </button>
        }
      />

      <div className="card p-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search CHA agents..." className="input pl-10" onChange={(e) => handleSearch(e.target.value)} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : chas.length === 0 ? (
        <div className="card p-12 text-center">
          <Anchor className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No CHA agents found</h3>
          <button onClick={() => setShowModal(true)} className="btn btn-primary mt-4">
            <Plus className="w-4 h-4 mr-2" />Add CHA
          </button>
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
                <th>License No.</th>
                <th>Rating</th>
                <th>Status</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {chas.map((cha: any) => (
                <tr key={cha.id}>
                  <td className="font-mono font-medium">{cha.code}</td>
                  <td className="font-medium">{cha.name}</td>
                  <td>{cha.contactPerson || '-'}</td>
                  <td>{cha.phone || '-'}</td>
                  <td>{cha.licenseNumber || '-'}</td>
                  <td>
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map((i) => (
                        <Star key={i} className={`w-4 h-4 ${i <= (cha.rating || 0) ? 'text-gold-500 fill-gold-500' : 'text-gray-300'}`} />
                      ))}
                    </div>
                  </td>
                  <td><span className={`badge ${cha.isActive ? 'badge-success' : 'badge-gray'}`}>{cha.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => { setSelectedCha(cha); setShowDetailModal(true); }} className="text-navy-600"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => { setEditCha(cha); setShowModal(true); }} className="text-gray-400"><Edit2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CHAModal
          cha={editCha}
          onClose={() => { setShowModal(false); setEditCha(null); }}
          onSuccess={() => { setShowModal(false); setEditCha(null); queryClient.invalidateQueries({ queryKey: ['chas'] }); }}
        />
      )}

      {showDetailModal && selectedCha && (
        <CHADetailModal
          chaId={selectedCha.id}
          onClose={() => { setShowDetailModal(false); setSelectedCha(null); }}
        />
      )}
    </div>
  );
}

function CHAModal({ cha, onClose, onSuccess }: { cha: any; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: cha?.name || '',
    contactPerson: cha?.contactPerson || '',
    email: cha?.email || '',
    phone: cha?.phone || '',
    address: cha?.address || '',
    licenseNumber: cha?.licenseNumber || '',
    rating: cha?.rating || 0,
    notes: cha?.notes || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => cha ? chaApi.update(cha.id, data) : chaApi.create(data),
    onSuccess: () => { toast.success(cha ? 'CHA updated' : 'CHA created'); onSuccess(); },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Operation failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title={cha ? 'Edit CHA' : 'Add CHA'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <FormField label="Name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Contact Person" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} />
          <FormField label="License Number" value={formData.licenseNumber} onChange={(e) => setFormData({ ...formData, licenseNumber: e.target.value })} />
          <FormField label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
          <FormField label="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
        </div>
        <FormField label="Address" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
        <div>
          <label className="label">Rating</label>
          <div className="flex gap-1">
            {[1,2,3,4,5].map((i) => (
              <button key={i} type="button" onClick={() => setFormData({ ...formData, rating: i })}>
                <Star className={`w-6 h-6 ${i <= formData.rating ? 'text-gold-500 fill-gold-500' : 'text-gray-300'}`} />
              </button>
            ))}
          </div>
        </div>
        <TextareaField label="Notes" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={2} />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : cha ? 'Update' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CHADetailModal({ chaId, onClose }: { chaId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showRateModal, setShowRateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['cha', chaId],
    queryFn: () => chaApi.get(chaId),
  });

  const cha = data?.data?.data;

  return (
    <Modal isOpen onClose={onClose} title={cha?.name || 'CHA Details'} size="lg">
      {isLoading ? (
        <div className="p-6 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" /></div>
      ) : (
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Code:</span> <span className="font-medium">{cha?.code}</span></div>
            <div><span className="text-gray-500">License:</span> <span className="font-medium">{cha?.licenseNumber || '-'}</span></div>
            <div><span className="text-gray-500">Contact:</span> <span className="font-medium">{cha?.contactPerson || '-'}</span></div>
            <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{cha?.phone || '-'}</span></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" />Service Rates</h3>
              <button onClick={() => setShowRateModal(true)} className="btn btn-secondary py-1 text-sm"><Plus className="w-4 h-4 mr-1" />Add Rate</button>
            </div>
            {cha?.chaRates?.length > 0 ? (
              <table className="table">
                <thead><tr><th>Service Type</th><th>Rate</th><th>Container</th><th>Valid From</th></tr></thead>
                <tbody>
                  {cha.chaRates.map((rate: any) => (
                    <tr key={rate.id}>
                      <td>{rate.serviceType}</td>
                      <td className="font-medium">{formatCurrency(rate.rate, rate.currency)}</td>
                      <td>{rate.containerType || 'All'}</td>
                      <td>{formatDate(rate.validFrom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg">No rates added</div>
            )}
          </div>
        </div>
      )}

      {showRateModal && (
        <AddCHARateModal
          chaId={chaId}
          onClose={() => setShowRateModal(false)}
          onSuccess={() => { setShowRateModal(false); queryClient.invalidateQueries({ queryKey: ['cha', chaId] }); }}
        />
      )}
    </Modal>
  );
}

function AddCHARateModal({ chaId, onClose, onSuccess }: { chaId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    serviceType: '',
    rate: '',
    currency: 'INR',
    containerType: '',
    validFrom: new Date().toISOString().split('T')[0],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => chaApi.addRate(chaId, { ...data, rate: parseFloat(data.rate) }),
    onSuccess: () => { toast.success('Rate added'); onSuccess(); },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Add CHA Rate" size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <SelectField label="Service Type" required value={formData.serviceType} onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })} options={[
          { value: 'CUSTOMS_CLEARANCE', label: 'Customs Clearance' },
          { value: 'DOCUMENTATION', label: 'Documentation' },
          { value: 'EXAMINATION', label: 'Examination Charges' },
          { value: 'HANDLING', label: 'Handling Charges' },
          { value: 'OTHER', label: 'Other' },
        ]} placeholder="Select Service" />
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Rate" required type="number" step="0.01" value={formData.rate} onChange={(e) => setFormData({ ...formData, rate: e.target.value })} />
          <SelectField label="Currency" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]} />
          <SelectField label="Container Type" value={formData.containerType} onChange={(e) => setFormData({ ...formData, containerType: e.target.value })} options={[
            { value: '', label: 'All Types' },
            { value: '20FT', label: '20FT' },
            { value: '40FT', label: '40FT' },
            { value: '40HC', label: '40HC' },
            { value: 'LCL', label: 'LCL' },
          ]} />
          <FormField label="Valid From" required type="date" value={formData.validFrom} onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })} />
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Adding...' : 'Add Rate'}</button>
        </div>
      </form>
    </Modal>
  );
}
