// Enhanced Transporters Page with CRUD and Rates
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { transportersApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { Plus, Search, Edit2, Star, Eye, Truck, DollarSign } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

export default function Transporters() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editTransporter, setEditTransporter] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedTransporter, setSelectedTransporter] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['transporters', search, serviceFilter],
    queryFn: () => transportersApi.list({ search: search || undefined, serviceType: serviceFilter || undefined }),
  });

  const transporters = data?.data?.data || [];

  const handleSearch = useDebouncedCallback((value: string) => setSearch(value), 300);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transporters"
        subtitle="Logistics & Transportation Partners"
        actions={
          <button onClick={() => { setEditTransporter(null); setShowModal(true); }} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Transporter
          </button>
        }
      />

      <div className="card p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search transporters..." className="input pl-10" onChange={(e) => handleSearch(e.target.value)} />
          </div>
          <select className="select w-full sm:w-40" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
            <option value="">All Types</option>
            <option value="ROAD">Road</option>
            <option value="RAIL">Rail</option>
            <option value="SEA">Sea</option>
            <option value="AIR">Air</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : transporters.length === 0 ? (
        <div className="card p-12 text-center">
          <Truck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No transporters found</h3>
          <button onClick={() => setShowModal(true)} className="btn btn-primary mt-4">
            <Plus className="w-4 h-4 mr-2" />Add Transporter
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Service Type</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Rating</th>
                <th>Status</th>
                <th className="w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {transporters.map((t: any) => (
                <tr key={t.id}>
                  <td className="font-mono font-medium">{t.code}</td>
                  <td className="font-medium">{t.name}</td>
                  <td><span className="badge badge-navy">{t.serviceType}</span></td>
                  <td>{t.contactPerson || '-'}</td>
                  <td>{t.phone || '-'}</td>
                  <td>
                    <div className="flex gap-0.5">
                      {[1,2,3,4,5].map((i) => (
                        <Star key={i} className={`w-4 h-4 ${i <= (t.rating || 0) ? 'text-gold-500 fill-gold-500' : 'text-gray-300'}`} />
                      ))}
                    </div>
                  </td>
                  <td><span className={`badge ${t.isActive ? 'badge-success' : 'badge-gray'}`}>{t.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => { setSelectedTransporter(t); setShowDetailModal(true); }} className="text-navy-600"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => { setEditTransporter(t); setShowModal(true); }} className="text-gray-400"><Edit2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TransporterModal
          transporter={editTransporter}
          onClose={() => { setShowModal(false); setEditTransporter(null); }}
          onSuccess={() => { setShowModal(false); setEditTransporter(null); queryClient.invalidateQueries({ queryKey: ['transporters'] }); }}
        />
      )}

      {showDetailModal && selectedTransporter && (
        <TransporterDetailModal
          transporterId={selectedTransporter.id}
          onClose={() => { setShowDetailModal(false); setSelectedTransporter(null); }}
        />
      )}
    </div>
  );
}

function TransporterModal({ transporter, onClose, onSuccess }: { transporter: any; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    name: transporter?.name || '',
    contactPerson: transporter?.contactPerson || '',
    email: transporter?.email || '',
    phone: transporter?.phone || '',
    address: transporter?.address || '',
    serviceType: transporter?.serviceType || 'ROAD',
    rating: transporter?.rating || 0,
    notes: transporter?.notes || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => transporter ? transportersApi.update(transporter.id, data) : transportersApi.create(data),
    onSuccess: () => { toast.success(transporter ? 'Transporter updated' : 'Transporter created'); onSuccess(); },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Operation failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title={transporter ? 'Edit Transporter' : 'Add Transporter'} size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <FormField label="Name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Service Type" value={formData.serviceType} onChange={(e) => setFormData({ ...formData, serviceType: e.target.value })} options={[
            { value: 'ROAD', label: 'Road Transport' },
            { value: 'RAIL', label: 'Rail Transport' },
            { value: 'SEA', label: 'Sea Freight' },
            { value: 'AIR', label: 'Air Freight' },
          ]} />
          <FormField label="Contact Person" value={formData.contactPerson} onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })} />
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
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>{mutation.isPending ? 'Saving...' : transporter ? 'Update' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

function TransporterDetailModal({ transporterId, onClose }: { transporterId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [showRateModal, setShowRateModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['transporter', transporterId],
    queryFn: () => transportersApi.get(transporterId),
  });

  const transporter = data?.data?.data;

  return (
    <Modal isOpen onClose={onClose} title={transporter?.name || 'Transporter Details'} size="lg">
      {isLoading ? (
        <div className="p-6 flex justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" /></div>
      ) : (
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Code:</span> <span className="font-medium">{transporter?.code}</span></div>
            <div><span className="text-gray-500">Service Type:</span> <span className="badge badge-navy">{transporter?.serviceType}</span></div>
            <div><span className="text-gray-500">Contact:</span> <span className="font-medium">{transporter?.contactPerson || '-'}</span></div>
            <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{transporter?.phone || '-'}</span></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><DollarSign className="w-4 h-4" />Transport Rates</h3>
              <button onClick={() => setShowRateModal(true)} className="btn btn-secondary py-1 text-sm"><Plus className="w-4 h-4 mr-1" />Add Rate</button>
            </div>
            {transporter?.transportRates?.length > 0 ? (
              <table className="table">
                <thead><tr><th>Route</th><th>Rate</th><th>Container</th><th>Transit Days</th><th>Valid From</th></tr></thead>
                <tbody>
                  {transporter.transportRates.map((rate: any) => (
                    <tr key={rate.id}>
                      <td>{rate.origin} → {rate.destination}</td>
                      <td className="font-medium">{formatCurrency(rate.rate, rate.currency)}</td>
                      <td>{rate.containerType || 'All'}</td>
                      <td>{rate.transitDays ? `${rate.transitDays} days` : '-'}</td>
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
        <AddTransportRateModal
          transporterId={transporterId}
          onClose={() => setShowRateModal(false)}
          onSuccess={() => { setShowRateModal(false); queryClient.invalidateQueries({ queryKey: ['transporter', transporterId] }); }}
        />
      )}
    </Modal>
  );
}

function AddTransportRateModal({ transporterId, onClose, onSuccess }: { transporterId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    origin: '',
    destination: '',
    rate: '',
    currency: 'INR',
    containerType: '',
    transitDays: '',
    validFrom: new Date().toISOString().split('T')[0],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => transportersApi.addRate(transporterId, {
      ...data,
      rate: parseFloat(data.rate),
      transitDays: data.transitDays ? parseInt(data.transitDays) : undefined,
    }),
    onSuccess: () => { toast.success('Rate added'); onSuccess(); },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Add Transport Rate" size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Origin" required value={formData.origin} onChange={(e) => setFormData({ ...formData, origin: e.target.value })} placeholder="e.g., Mumbai" />
          <FormField label="Destination" required value={formData.destination} onChange={(e) => setFormData({ ...formData, destination: e.target.value })} placeholder="e.g., Mundra Port" />
          <FormField label="Rate" required type="number" step="0.01" value={formData.rate} onChange={(e) => setFormData({ ...formData, rate: e.target.value })} />
          <SelectField label="Currency" value={formData.currency} onChange={(e) => setFormData({ ...formData, currency: e.target.value })} options={[{ value: 'INR', label: 'INR' }, { value: 'USD', label: 'USD' }]} />
          <SelectField label="Container Type" value={formData.containerType} onChange={(e) => setFormData({ ...formData, containerType: e.target.value })} options={[
            { value: '', label: 'All Types' },
            { value: '20FT', label: '20FT' },
            { value: '40FT', label: '40FT' },
            { value: '40HC', label: '40HC' },
          ]} />
          <FormField label="Transit Days" type="number" value={formData.transitDays} onChange={(e) => setFormData({ ...formData, transitDays: e.target.value })} />
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
