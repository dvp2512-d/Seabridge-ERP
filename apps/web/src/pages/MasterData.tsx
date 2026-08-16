import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { masterApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormFields';
import { Plus, Edit2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type TabType = 'countries' | 'currencies' | 'incoterms' | 'categories' | 'ports';

const tabs: { id: TabType; label: string }[] = [
  { id: 'countries', label: 'Countries' },
  { id: 'currencies', label: 'Currencies' },
  { id: 'incoterms', label: 'Incoterms' },
  { id: 'categories', label: 'Product Categories' },
  { id: 'ports', label: 'Ports' },
];

export default function MasterData() {
  const [activeTab, setActiveTab] = useState<TabType>('countries');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data"
        subtitle="Manage dropdown values and reference data"
        actions={
          <button onClick={() => { setEditItem(null); setShowModal(true); }} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add {tabs.find(t => t.id === activeTab)?.label.slice(0, -1)}
          </button>
        }
      />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-4 -mb-px">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'py-3 px-1 border-b-2 font-medium text-sm transition-colors',
                activeTab === tab.id
                  ? 'border-navy-900 text-navy-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      {activeTab === 'countries' && <CountriesTab onEdit={(item) => { setEditItem(item); setShowModal(true); }} />}
      {activeTab === 'currencies' && <CurrenciesTab onEdit={(item) => { setEditItem(item); setShowModal(true); }} />}
      {activeTab === 'incoterms' && <IncotermsTab onEdit={(item) => { setEditItem(item); setShowModal(true); }} />}
      {activeTab === 'categories' && <CategoriesTab onEdit={(item) => { setEditItem(item); setShowModal(true); }} />}
      {activeTab === 'ports' && <PortsTab onEdit={(item) => { setEditItem(item); setShowModal(true); }} />}

      {/* Add/Edit Modal */}
      {showModal && (
        <MasterDataModal
          type={activeTab}
          item={editItem}
          onClose={() => { setShowModal(false); setEditItem(null); }}
        />
      )}
    </div>
  );
}

// Countries Tab
function CountriesTab({ onEdit }: { onEdit: (item: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['countries'],
    queryFn: () => masterApi.getCountries(),
  });

  const countries = data?.data?.data || [];

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Region</th>
            <th>Status</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5} className="text-center py-8">Loading...</td></tr>
          ) : countries.length === 0 ? (
            <tr><td colSpan={5} className="text-center py-8 text-gray-500">No countries found</td></tr>
          ) : (
            countries.map((c: any) => (
              <tr key={c.id}>
                <td className="font-medium">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.region || '-'}</td>
                <td><span className={`badge ${c.isActive ? 'badge-success' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button onClick={() => onEdit(c)} className="text-navy-600 hover:text-navy-800">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Currencies Tab
function CurrenciesTab({ onEdit }: { onEdit: (item: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['currencies'],
    queryFn: () => masterApi.getCurrencies(),
  });

  const currencies = data?.data?.data || [];

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Symbol</th>
            <th>Exchange Rate (to USD)</th>
            <th>Status</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="text-center py-8">Loading...</td></tr>
          ) : currencies.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-8 text-gray-500">No currencies found</td></tr>
          ) : (
            currencies.map((c: any) => (
              <tr key={c.id}>
                <td className="font-medium">{c.code}</td>
                <td>{c.name}</td>
                <td>{c.symbol}</td>
                <td>{c.exchangeRate}</td>
                <td><span className={`badge ${c.isActive ? 'badge-success' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button onClick={() => onEdit(c)} className="text-navy-600 hover:text-navy-800">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Incoterms Tab
function IncotermsTab({ onEdit }: { onEdit: (item: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['incoterms'],
    queryFn: () => masterApi.getIncoterms(),
  });

  const incoterms = data?.data?.data || [];

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Description</th>
            <th>Status</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={5} className="text-center py-8">Loading...</td></tr>
          ) : incoterms.length === 0 ? (
            <tr><td colSpan={5} className="text-center py-8 text-gray-500">No incoterms found</td></tr>
          ) : (
            incoterms.map((i: any) => (
              <tr key={i.id}>
                <td className="font-medium">{i.code}</td>
                <td>{i.name}</td>
                <td className="max-w-xs truncate">{i.description || '-'}</td>
                <td><span className={`badge ${i.isActive ? 'badge-success' : 'badge-gray'}`}>{i.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button onClick={() => onEdit(i)} className="text-navy-600 hover:text-navy-800">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Categories Tab
function CategoriesTab({ onEdit }: { onEdit: (item: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['productCategories'],
    queryFn: () => masterApi.getProductCategories(),
  });

  const categories = data?.data?.data || [];

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Status</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={4} className="text-center py-8">Loading...</td></tr>
          ) : categories.length === 0 ? (
            <tr><td colSpan={4} className="text-center py-8 text-gray-500">No categories found</td></tr>
          ) : (
            categories.map((c: any) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td>{c.description || '-'}</td>
                <td><span className={`badge ${c.isActive ? 'badge-success' : 'badge-gray'}`}>{c.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button onClick={() => onEdit(c)} className="text-navy-600 hover:text-navy-800">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Ports Tab
function PortsTab({ onEdit }: { onEdit: (item: any) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['ports'],
    queryFn: () => masterApi.getPorts(),
  });

  const ports = data?.data?.data || [];

  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Country</th>
            <th>Type</th>
            <th>Status</th>
            <th className="w-20">Actions</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <tr><td colSpan={6} className="text-center py-8">Loading...</td></tr>
          ) : ports.length === 0 ? (
            <tr><td colSpan={6} className="text-center py-8 text-gray-500">No ports found</td></tr>
          ) : (
            ports.map((p: any) => (
              <tr key={p.id}>
                <td className="font-medium">{p.code}</td>
                <td>{p.name}</td>
                <td>{p.country?.name || '-'}</td>
                <td><span className="badge badge-navy">{p.type}</span></td>
                <td><span className={`badge ${p.isActive ? 'badge-success' : 'badge-gray'}`}>{p.isActive ? 'Active' : 'Inactive'}</span></td>
                <td>
                  <button onClick={() => onEdit(p)} className="text-navy-600 hover:text-navy-800">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Modal for adding/editing master data
function MasterDataModal({ type, item, onClose }: { type: TabType; item: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState(item || {});

  const { data: countries } = useQuery({
    queryKey: ['countries'],
    queryFn: () => masterApi.getCountries(),
    enabled: type === 'ports',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => {
      // When `item` is set we are editing, so use the update endpoint.
      // Previously every type except currencies called create, which either
      // produced a duplicate row or failed on a unique constraint.
      const isEdit = Boolean(item?.id);
      switch (type) {
        case 'countries':
          return isEdit ? masterApi.updateCountry(item.id, data) : masterApi.createCountry(data);
        case 'currencies':
          return isEdit ? masterApi.updateCurrency(item.id, data) : masterApi.createCurrency(data);
        case 'incoterms':
          return isEdit ? masterApi.updateIncoterm(item.id, data) : masterApi.createIncoterm(data);
        case 'categories':
          return isEdit
            ? masterApi.updateProductCategory(item.id, data)
            : masterApi.createProductCategory(data);
        case 'ports':
          return isEdit ? masterApi.updatePort(item.id, data) : masterApi.createPort(data);
        default:
          throw new Error('Unknown type');
      }
    },
    onSuccess: () => {
      toast.success(item ? 'Updated successfully' : 'Created successfully');
      queryClient.invalidateQueries({ queryKey: [type === 'categories' ? 'productCategories' : type] });
      // Dropdowns elsewhere in the app are built from this master data.
      queryClient.invalidateQueries({ queryKey: ['dropdowns'] });
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Operation failed');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  const titles: Record<TabType, string> = {
    countries: 'Country',
    currencies: 'Currency',
    incoterms: 'Incoterm',
    categories: 'Product Category',
    ports: 'Port',
  };

  return (
    <Modal isOpen onClose={onClose} title={`${item ? 'Edit' : 'Add'} ${titles[type]}`} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        {type === 'countries' && (
          <>
            <FormField label="Code" required value={formData.code || ''} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., US" maxLength={2} />
            <FormField label="Name" required value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., United States" />
            <FormField label="Region" value={formData.region || ''} onChange={(e) => setFormData({ ...formData, region: e.target.value })} placeholder="e.g., North America" />
          </>
        )}

        {type === 'currencies' && (
          <>
            <FormField label="Code" required value={formData.code || ''} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., USD" maxLength={3} disabled={!!item} />
            <FormField label="Name" required value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., US Dollar" disabled={!!item} />
            <FormField label="Symbol" required value={formData.symbol || ''} onChange={(e) => setFormData({ ...formData, symbol: e.target.value })} placeholder="e.g., $" disabled={!!item} />
            <FormField label="Exchange Rate (to USD)" required type="number" step="0.0001" value={formData.exchangeRate || ''} onChange={(e) => setFormData({ ...formData, exchangeRate: parseFloat(e.target.value) })} />
          </>
        )}

        {type === 'incoterms' && (
          <>
            <FormField label="Code" required value={formData.code || ''} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., FOB" />
            <FormField label="Name" required value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Free on Board" />
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={3} value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
          </>
        )}

        {type === 'categories' && (
          <>
            <FormField label="Name" required value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Spices" />
            <div>
              <label className="label">Description</label>
              <textarea className="input" rows={3} value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
            </div>
          </>
        )}

        {type === 'ports' && (
          <>
            <FormField label="Code" required value={formData.code || ''} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., INMUN" />
            <FormField label="Name" required value={formData.name || ''} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Mundra Port" />
            <SelectField
              label="Country"
              required
              value={formData.countryId || ''}
              onChange={(e) => setFormData({ ...formData, countryId: e.target.value })}
              options={(countries?.data?.data || []).map((c: any) => ({ value: c.id, label: c.name }))}
              placeholder="Select Country"
            />
            <SelectField
              label="Type"
              value={formData.type || 'SEA'}
              onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              options={[
                { value: 'SEA', label: 'Sea Port' },
                { value: 'AIR', label: 'Airport' },
                { value: 'LAND', label: 'Land Border' },
              ]}
            />
          </>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : item ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
