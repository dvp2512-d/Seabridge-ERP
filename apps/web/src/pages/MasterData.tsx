import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { masterApi, lifecycleApi } from '@/lib/api';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormFields';
import { Plus, Edit2, Search, ChevronLeft, ChevronRight, Power, PowerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { can } from '@/lib/permissions';

type TabType = 'countries' | 'currencies' | 'incoterms' | 'categories' | 'ports';

const tabs: { id: TabType; label: string; singular: string }[] = [
  { id: 'countries', label: 'Countries', singular: 'Country' },
  { id: 'currencies', label: 'Currencies', singular: 'Currency' },
  { id: 'incoterms', label: 'Incoterms', singular: 'Incoterm' },
  { id: 'categories', label: 'Product Categories', singular: 'Product Category' },
  { id: 'ports', label: 'Ports', singular: 'Port' },
];

const PAGE_SIZE = 25;

/**
 * Search, paging and the active/inactive toggle for one master data table.
 *
 * These tables hold worldwide reference data - 250 countries, 179 currencies, 400+
 * ports - so rendering them whole is not usable. Filtering happens on the server
 * rather than in the browser so a search reaches rows that are not on the current
 * page; filtering the page client-side would only ever match the 25 rows already
 * loaded, which looks like missing data.
 */
function useMasterList(
  resource: string,
  fetcher: (params: any) => Promise<any>,
  extraParams: Record<string, any> = {}
) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(false);

  // Debounced so typing does not fire a request per keystroke. Any change resets
  // to page 1, otherwise a narrower search can land the user on an empty page.
  const commitSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, 300);

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    commitSearch(value);
  };

  const extraKey = JSON.stringify(extraParams);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: [resource, { search, page, includeInactive, extraKey }],
    queryFn: () =>
      fetcher({
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(includeInactive ? { includeInactive: true } : {}),
        ...extraParams,
      }),
    // Keeps the previous page visible while the next one loads, instead of
    // collapsing the table to a spinner on every page change.
    placeholderData: (previous: any) => previous,
  });

  const rows: any[] = data?.data?.data ?? [];
  const total: number = data?.data?.pagination?.total ?? rows.length;

  return {
    rows,
    total,
    page,
    setPage,
    isLoading,
    isFetching,
    searchInput,
    onSearchChange,
    includeInactive,
    setIncludeInactive,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** The chrome around every master data table: search box, toggle, table, paging. */
function MasterTable({
  list,
  placeholder,
  headers,
  emptyLabel,
  children,
}: {
  list: ReturnType<typeof useMasterList>;
  placeholder: string;
  headers: string[];
  emptyLabel: string;
  children: React.ReactNode;
}) {
  const { rows, total, page, setPage, pageCount, isLoading, isFetching } = list;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={list.searchInput}
            onChange={(e) => list.onSearchChange(e.target.value)}
            placeholder={placeholder}
            className="input pl-9 w-full"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 whitespace-nowrap">
          <input
            type="checkbox"
            checked={list.includeInactive}
            onChange={(e) => {
              list.setIncludeInactive(e.target.checked);
              setPage(1);
            }}
            className="rounded border-gray-300"
          />
          Show inactive
        </label>
        <span className="text-sm text-gray-500 whitespace-nowrap">
          {total.toLocaleString('en-IN')} total
        </span>
      </div>

      <div className={cn('card overflow-x-auto', isFetching && !isLoading && 'opacity-60')}>
        <table className="table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className={h === 'Actions' ? 'w-20' : undefined}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={headers.length} className="text-center py-8">
                  Loading...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="text-center py-8 text-gray-500">
                  {list.searchInput ? `No matches for "${list.searchInput}"` : emptyLabel}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Showing {from.toLocaleString('en-IN')}-{to.toLocaleString('en-IN')} of{' '}
            {total.toLocaleString('en-IN')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="btn btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-gray-600">
              Page {page} of {pageCount}
            </span>
            <button
              onClick={() => setPage(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
              className="btn btn-secondary btn-sm disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Shared Active/Inactive pill. */
function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-gray'}`}>
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

/** Shared edit button, rendered only when the user may manage master data. */
function EditCell({
  item,
  resource,
  onEdit,
  canManage,
}: {
  item: any;
  resource: string;
  onEdit?: (item: any) => void;
  canManage: boolean;
}) {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  // SETTINGS_MANAGE is required to deactivate/reactivate (more restrictive than edit)
  const canLifecycle = can(user?.role, 'SETTINGS_MANAGE');
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch preview when confirm dialog opens
  const previewQuery = useQuery({
    queryKey: ['lifecycle-preview', resource, item.id],
    queryFn: () => lifecycleApi.preview(resource, item.id),
    enabled: showConfirm && item.isActive,
  });

  const deactivate = useMutation({
    mutationFn: () => lifecycleApi.deactivate(resource, item.id),
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Deactivated successfully');
      queryClient.invalidateQueries({ queryKey: [resource === 'product-categories' ? 'productCategories' : resource] });
      queryClient.invalidateQueries({ queryKey: ['dropdowns'] });
      setShowConfirm(false);
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to deactivate'),
  });

  const reactivate = useMutation({
    mutationFn: () => lifecycleApi.reactivate(resource, item.id),
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Reactivated successfully');
      queryClient.invalidateQueries({ queryKey: [resource === 'product-categories' ? 'productCategories' : resource] });
      queryClient.invalidateQueries({ queryKey: ['dropdowns'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Failed to reactivate'),
  });

  if (!canManage) return <td />;

  const previewData = previewQuery.data?.data?.data;

  return (
    <td>
      <div className="flex items-center gap-2">
        {onEdit && (
          <button
            onClick={() => onEdit(item)}
            className="text-navy-600 hover:text-navy-800"
            title="Edit"
            aria-label="Edit"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {canLifecycle && (
          item.isActive ? (
            <button
              onClick={() => setShowConfirm(true)}
              className="text-gray-400 hover:text-red-600"
              title="Deactivate"
              aria-label="Deactivate"
            >
              <PowerOff className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => reactivate.mutate()}
              disabled={reactivate.isPending}
              className="text-gray-400 hover:text-green-600"
              title="Reactivate"
              aria-label="Reactivate"
            >
              <Power className="w-4 h-4" />
            </button>
          )
        )}
      </div>

      {/* Deactivation confirmation dialog */}
      {showConfirm && (
        <Modal isOpen onClose={() => setShowConfirm(false)} title="Deactivate Record" size="sm">
          <div className="p-6 space-y-4">
            {previewQuery.isLoading ? (
              <p className="text-gray-500">Checking dependencies...</p>
            ) : previewData?.blocked ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-red-700 font-medium">Cannot deactivate</p>
                <p className="text-red-600 text-sm mt-1">{previewData.blocked}</p>
              </div>
            ) : (
              <>
                <p className="text-gray-700">
                  This will hide the record from dropdowns in new documents.
                </p>
                {previewData?.dependents?.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 font-medium text-sm">
                      This record is referenced by:
                    </p>
                    <ul className="mt-2 text-sm text-amber-700 list-disc list-inside">
                      {previewData.dependents.map((d: any) => (
                        <li key={d.label}>{d.count} {d.label}</li>
                      ))}
                    </ul>
                    <p className="mt-2 text-sm text-amber-600">
                      It will remain on those existing records.
                    </p>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-end gap-3 pt-4 border-t">
              <button
                onClick={() => setShowConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => deactivate.mutate()}
                disabled={deactivate.isPending || !!previewData?.blocked}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deactivate.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </td>
  );
}

export default function MasterData() {
  const { user } = useAuthStore();
  // Everyone can read master data (finance needs the rates their totals depend
  // on), but only MASTER_MANAGE roles may change it, matching the API.
  const canManage = can(user?.role, 'MASTER_MANAGE');
  const [activeTab, setActiveTab] = useState<TabType>('countries');
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data"
        subtitle="Manage dropdown values and reference data"
        actions={
          canManage ? (
            <button onClick={() => { setEditItem(null); setShowModal(true); }} className="btn btn-primary">
              <Plus className="w-4 h-4 mr-2" />
              Add {tabs.find(t => t.id === activeTab)?.singular}
            </button>
          ) : undefined
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
      {activeTab === 'countries' && <CountriesTab onEdit={canManage ? (item) => { setEditItem(item); setShowModal(true); } : undefined} canManage={canManage} />}
      {activeTab === 'currencies' && <CurrenciesTab onEdit={canManage ? (item) => { setEditItem(item); setShowModal(true); } : undefined} canManage={canManage} />}
      {activeTab === 'incoterms' && <IncotermsTab onEdit={canManage ? (item) => { setEditItem(item); setShowModal(true); } : undefined} canManage={canManage} />}
      {activeTab === 'categories' && <CategoriesTab onEdit={canManage ? (item) => { setEditItem(item); setShowModal(true); } : undefined} canManage={canManage} />}
      {activeTab === 'ports' && <PortsTab onEdit={canManage ? (item) => { setEditItem(item); setShowModal(true); } : undefined} canManage={canManage} />}

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
function CountriesTab({ onEdit, canManage }: { onEdit?: (item: any) => void; canManage: boolean }) {
  const list = useMasterList('countries', masterApi.getCountries);

  return (
    <MasterTable
      list={list}
      placeholder="Search by country name, ISO code or region..."
      headers={['Code', 'Name', 'Region', 'Status', 'Actions']}
      emptyLabel="No countries found"
    >
      {list.rows.map((c: any) => (
        <tr key={c.id}>
          <td className="font-medium font-mono">{c.code}</td>
          <td>{c.name}</td>
          <td>{c.region || '-'}</td>
          <td><StatusBadge active={c.isActive} /></td>
          <EditCell item={c} resource="countries" onEdit={onEdit} canManage={canManage} />
        </tr>
      ))}
    </MasterTable>
  );
}
// Currencies Tab
function CurrenciesTab({ onEdit, canManage }: { onEdit?: (item: any) => void; canManage: boolean }) {
  const list = useMasterList('currencies', masterApi.getCurrencies);

  return (
    <MasterTable
      list={list}
      placeholder="Search by currency code or name..."
      headers={['Code', 'Name', 'Symbol', 'Status', 'Actions']}
      emptyLabel="No currencies found"
    >
      {list.rows.map((c: any) => (
        <tr key={c.id}>
          <td className="font-medium font-mono">
            {c.code}
            {/* Every stored amount is INR, so the base currency is worth marking. */}
            {c.code === 'INR' && <span className="ml-2 text-xs text-gray-500">base</span>}
          </td>
          <td>{c.name}</td>
          <td>{c.symbol}</td>
          <td><StatusBadge active={c.isActive} /></td>
          <EditCell item={c} resource="currencies" onEdit={onEdit} canManage={canManage} />
        </tr>
      ))}
    </MasterTable>
  );
}
// Incoterms Tab
function IncotermsTab({ onEdit, canManage }: { onEdit?: (item: any) => void; canManage: boolean }) {
  const list = useMasterList('incoterms', masterApi.getIncoterms);

  return (
    <MasterTable
      list={list}
      placeholder="Search by Incoterm code or name..."
      headers={['Code', 'Name', 'Description', 'Status', 'Actions']}
      emptyLabel="No incoterms found"
    >
      {list.rows.map((i: any) => (
        <tr key={i.id}>
          <td className="font-medium font-mono">{i.code}</td>
          <td className="whitespace-nowrap">{i.name}</td>
          <td className="text-sm text-gray-600">{i.description || '-'}</td>
          <td><StatusBadge active={i.isActive} /></td>
          <EditCell item={i} resource="incoterms" onEdit={onEdit} canManage={canManage} />
        </tr>
      ))}
    </MasterTable>
  );
}
// Categories Tab
function CategoriesTab({ onEdit, canManage }: { onEdit?: (item: any) => void; canManage: boolean }) {
  const list = useMasterList('productCategories', masterApi.getProductCategories);

  return (
    <MasterTable
      list={list}
      placeholder="Search by category name or description..."
      headers={['Name', 'Description', 'Status', 'Actions']}
      emptyLabel="No categories found"
    >
      {list.rows.map((c: any) => (
        <tr key={c.id}>
          <td className="font-medium">{c.name}</td>
          <td className="text-sm text-gray-600">{c.description || '-'}</td>
          <td><StatusBadge active={c.isActive} /></td>
          <EditCell item={c} resource="product-categories" onEdit={onEdit} canManage={canManage} />
        </tr>
      ))}
    </MasterTable>
  );
}
// Ports Tab
function PortsTab({ onEdit, canManage }: { onEdit?: (item: any) => void; canManage: boolean }) {
  const [type, setType] = useState<'' | 'SEA' | 'AIR' | 'LAND'>('');
  const list = useMasterList('ports', masterApi.getPorts, type ? { type } : {});

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {[
          { value: '', label: 'All' },
          { value: 'SEA', label: 'Sea' },
          { value: 'AIR', label: 'Air' },
          { value: 'LAND', label: 'Land' },
        ].map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              setType(opt.value as any);
              list.setPage(1);
            }}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium border transition-colors',
              type === opt.value
                ? 'bg-navy-900 text-white border-navy-900'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <MasterTable
        list={list}
        placeholder="Search by port name, UN/LOCODE or country..."
        headers={['Code', 'Name', 'Country', 'Type', 'Status', 'Actions']}
        emptyLabel="No ports found"
      >
        {list.rows.map((p: any) => (
          <tr key={p.id}>
            <td className="font-medium font-mono">{p.code}</td>
            <td>{p.name}</td>
            <td>{p.country?.name || '-'}</td>
            <td><span className="badge badge-navy">{p.type}</span></td>
            <td><StatusBadge active={p.isActive} /></td>
            <EditCell item={p} resource="ports" onEdit={onEdit} canManage={canManage} />
          </tr>
        ))}
      </MasterTable>
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
            <p className="text-xs text-gray-500">
              No exchange rate is stored. All amounts are held in INR; you choose a
              currency and rate when generating a quotation or invoice PDF.
            </p>
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

        {/* Every PUT accepts isActive, but there was no control for it, so a
            stale port or Incoterm could never be retired. Only meaningful on an
            existing row - new rows default to active. */}
        {item && (
          <div>
            <label className="label">Status</label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={formData.isActive !== false}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
              />
              Active
            </label>
            <p className="text-xs text-gray-500 mt-1">
              Inactive entries stay on existing records but stop appearing in dropdowns.
            </p>
          </div>
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
