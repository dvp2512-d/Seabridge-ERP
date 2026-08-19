// Enhanced Inquiries Page with Pipeline View
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { inquiriesApi, buyersApi, masterApi, productsApi } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatCurrency, formatDate, getStatusColor, getPriorityColor, cn } from '@/lib/utils';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import RowActions from '@/components/ui/RowActions';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useLifecycleActions } from '@/hooks/useLifecycleActions';
import { refreshAggregates } from '@/lib/queryKeys';
import {
  Plus,
  Search,
  LayoutGrid,
  List,
  Calendar,
  TrendingUp,
  Clock,
  ChevronRight,
} from 'lucide-react';

type ViewMode = 'table' | 'pipeline' | 'kanban';

const STAGES = [
  { id: 'NEW', label: 'New', color: 'bg-blue-500' },
  { id: 'REQUIREMENT_GATHERED', label: 'Requirements', color: 'bg-indigo-500' },
  { id: 'PRICING_IN_PROGRESS', label: 'Pricing', color: 'bg-yellow-500' },
  { id: 'QUOTATION_SENT', label: 'Quoted', color: 'bg-orange-500' },
  { id: 'NEGOTIATION', label: 'Negotiation', color: 'bg-purple-500' },
  { id: 'WON', label: 'Won', color: 'bg-green-500' },
  { id: 'LOST', label: 'Lost', color: 'bg-red-500' },
];

export default function Inquiries() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  // Deactivate / cancel flow, shared with every other list so the

  // wording and confirmations stay consistent.

  const lifecycle = useLifecycleActions(['inquiries']);
  const [stageFilter, setStageFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [showModal, setShowModal] = useState(false);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['inquiries', search, stageFilter, priorityFilter, page],
    queryFn: () => inquiriesApi.list({
      search: search || undefined,
      stage: stageFilter || undefined,
      page,
      limit: 50,
    }),
  });

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const inquiries = data?.data?.data || [];
  const pagination = data?.data?.pagination;

  const handleSearch = useDebouncedCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, 300);

  // Calculate pipeline stats
  const pipelineStats = STAGES.slice(0, 5).map(stage => ({
    ...stage,
    count: inquiries.filter((i: any) => i.stage === stage.id).length,
    value: inquiries
      .filter((i: any) => i.stage === stage.id)
      .reduce((sum: number, i: any) => sum + (parseFloat(i.expectedValue) || 0), 0),
  }));

  const totalPipelineValue = pipelineStats.reduce((sum, s) => sum + s.value, 0);

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
        title="Sales Pipeline"
        subtitle={`${pagination?.total || inquiries.length} inquiries • ${formatCurrency(totalPipelineValue)} pipeline value`}
        actions={
          <button onClick={() => setShowModal(true)} className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Inquiry
          </button>
        }
      />

      {/* Pipeline Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {pipelineStats.map((stage) => (
          <button
            key={stage.id}
            onClick={() => setStageFilter(stageFilter === stage.id ? '' : stage.id)}
            className={cn(
              'card p-4 text-left transition-all',
              stageFilter === stage.id && 'ring-2 ring-navy-500'
            )}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-3 h-3 rounded-full ${stage.color}`} />
              <span className="text-sm font-medium text-gray-600">{stage.label}</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{stage.count}</div>
            <div className="text-sm text-gray-500">{formatCurrency(stage.value)}</div>
          </button>
        ))}
      </div>

      {/* Filters & View Toggle */}
      <div className="card">
        <div className="p-4">
          <div className="flex flex-col lg:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search by inquiry number or buyer..."
                className="input pl-10"
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <select
                className="select"
                value={stageFilter}
                onChange={(e) => { setStageFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Stages</option>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select
                className="select"
                value={priorityFilter}
                onChange={(e) => { setPriorityFilter(e.target.value); setPage(1); }}
              >
                <option value="">All Priorities</option>
                <option value="URGENT">Urgent</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden">
                <button
                  onClick={() => setViewMode('table')}
                  className={cn('p-2', viewMode === 'table' ? 'bg-navy-900 text-white' : 'bg-white text-gray-600')}
                >
                  <List className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('kanban')}
                  className={cn('p-2', viewMode === 'kanban' ? 'bg-navy-900 text-white' : 'bg-white text-gray-600')}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
        </div>
      ) : viewMode === 'table' ? (
        <InquiryTable
          inquiries={inquiries}
          onView={(id) => navigate(`/inquiries/${id}`)}
          onCancel={(id, label) => lifecycle.request({ kind: 'delete', resource: 'inquiries' }, id, label)}
        />
      ) : (
        <InquiryKanban inquiries={inquiries} onView={(id) => navigate(`/inquiries/${id}`)} />
      )}

      {/* Pagination for table view */}
      {viewMode === 'table' && pagination && pagination.total > pagination.limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            Page {pagination.page} of {Math.ceil(pagination.total / pagination.limit)}
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

      {/* New Inquiry Modal */}
      {showModal && (
        <NewInquiryModal
          dropdowns={dropdowns?.data?.data}
          onClose={() => setShowModal(false)}
          onSuccess={(inquiry) => {
            setShowModal(false);
            queryClient.invalidateQueries({ queryKey: ['inquiries'] });
      // The dashboard pipeline figure reads inquiries, so refresh it too
      refreshAggregates(queryClient);
            if (inquiry?.id) navigate(`/inquiries/${inquiry.id}`);
          }}
        />
      )}
    </div>
  );
}

// Table View Component
function InquiryTable({
  inquiries,
  onView,
  onCancel,
}: {
  inquiries: any[];
  onView: (id: string) => void;
  /** Mark lost. Handled by the parent so the confirmation dialog is shared. */
  onCancel: (id: string, label: string) => void;
}) {
  if (inquiries.length === 0) {
    return (
      <div className="card p-12 text-center">
        <TrendingUp className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-1">No inquiries found</h3>
        <p className="text-gray-500">Create your first inquiry to get started</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <table className="table">
        <thead>
          <tr>
            <th>Inquiry #</th>
            <th>Buyer</th>
            <th>Stage</th>
            <th>Priority</th>
            <th>Expected Value</th>
            <th>Sales Owner</th>
            <th>Next Follow-up</th>
            <th>Created</th>
            <th className="w-16"></th>
          </tr>
        </thead>
        <tbody>
          {inquiries.map((inquiry: any) => (
            <tr key={inquiry.id} className="cursor-pointer" onClick={() => onView(inquiry.id)}>
              <td className="font-medium font-mono">{inquiry.inquiryNumber}</td>
              <td>
                <div className="font-medium text-gray-900">{inquiry.buyer?.companyName}</div>
                <div className="text-xs text-gray-500">{inquiry.buyer?.code}</div>
              </td>
              <td>
                <span className={`badge ${getStatusColor(inquiry.stage)}`}>
                  {inquiry.stage?.replace(/_/g, ' ')}
                </span>
              </td>
              <td>
                <span className={`badge ${getPriorityColor(inquiry.priority)}`}>
                  {inquiry.priority}
                </span>
              </td>
              <td className="font-medium">
                {inquiry.expectedValue ? formatCurrency(inquiry.expectedValue) : '-'}
              </td>
              <td>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center text-xs font-medium">
                    {inquiry.salesOwner?.firstName?.[0]}{inquiry.salesOwner?.lastName?.[0]}
                  </div>
                  <span className="text-sm">{inquiry.salesOwner?.firstName}</span>
                </div>
              </td>
              <td>
                {inquiry.nextFollowUp ? (
                  <div className={cn(
                    'flex items-center gap-1 text-sm',
                    new Date(inquiry.nextFollowUp) < new Date() ? 'text-red-600' : 'text-gray-600'
                  )}>
                    <Calendar className="w-4 h-4" />
                    {formatDate(inquiry.nextFollowUp)}
                  </div>
                ) : (
                  <span className="text-gray-400">-</span>
                )}
              </td>
              <td className="text-gray-500">{formatDate(inquiry.createdAt)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <RowActions
                        destructivePermission="RECORD_DELETE"
                  viewHref={`/inquiries/${inquiry.id}`}
                  destructiveKind="delete"
                  // Marked lost rather than deleted, which is the language the
                  // pipeline already uses and keeps the record in the history.
                  onDestructive={() => onCancel(inquiry.id, inquiry.inquiryNumber)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Kanban View Component
function InquiryKanban({ inquiries, onView }: { inquiries: any[]; onView: (id: string) => void }) {
  const activeStages = STAGES.filter(s => !['WON', 'LOST'].includes(s.id));

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {activeStages.map((stage) => {
        const stageInquiries = inquiries.filter((i: any) => i.stage === stage.id);
        return (
          <div key={stage.id} className="flex-shrink-0 w-72">
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${stage.color}`} />
                  <span className="font-medium text-gray-700">{stage.label}</span>
                </div>
                <span className="text-sm text-gray-500 bg-white px-2 py-0.5 rounded">
                  {stageInquiries.length}
                </span>
              </div>
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {stageInquiries.map((inquiry: any) => (
                  <div
                    key={inquiry.id}
                    onClick={() => onView(inquiry.id)}
                    className="bg-white rounded-lg p-3 shadow-sm border border-gray-200 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-mono text-sm font-medium text-navy-600">
                        {inquiry.inquiryNumber}
                      </span>
                      <span className={`badge text-xs ${getPriorityColor(inquiry.priority)}`}>
                        {inquiry.priority}
                      </span>
                    </div>
                    <div className="font-medium text-gray-900 text-sm mb-1">
                      {inquiry.buyer?.companyName}
                    </div>
                    {inquiry.expectedValue && (
                      <div className="text-sm text-green-600 font-medium">
                        {formatCurrency(inquiry.expectedValue)}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center gap-1">
                        <div className="w-5 h-5 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center text-xs">
                          {inquiry.salesOwner?.firstName?.[0]}
                        </div>
                        <span className="text-xs text-gray-500">{inquiry.salesOwner?.firstName}</span>
                      </div>
                      {inquiry.nextFollowUp && (
                        <div className={cn(
                          'flex items-center gap-1 text-xs',
                          new Date(inquiry.nextFollowUp) < new Date() ? 'text-red-500' : 'text-gray-400'
                        )}>
                          <Clock className="w-3 h-3" />
                          {formatDate(inquiry.nextFollowUp, 'DD MMM')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {stageInquiries.length === 0 && (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    No inquiries
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}



// New Inquiry Modal
function NewInquiryModal({ dropdowns, onClose, onSuccess }: { dropdowns: any; onClose: () => void; onSuccess: (inquiry?: any) => void }) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    buyerId: '',
    priority: 'MEDIUM',
    source: '',
    expectedValue: '',
    expectedDate: '',
    requirements: '',
    notes: '',
    items: [] as { productId: string; quantity: string; unit: string; targetPrice: string; specifications: string }[],
  });
  const [newItem, setNewItem] = useState({ productId: '', quantity: '', unit: 'KG', targetPrice: '', specifications: '' });

  const { data: buyersData } = useQuery({
    queryKey: ['buyers-dropdown'],
    queryFn: () => buyersApi.list({ limit: 100 }),
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await productsApi.list({ limit: 500 })).data?.data ?? [],
  });

  const buyers = buyersData?.data?.data || [];

  const mutation = useMutation({
    mutationFn: (data: any) => inquiriesApi.create({
      ...data,
      expectedValue: data.expectedValue ? parseFloat(data.expectedValue) : undefined,
      expectedDate: data.expectedDate || undefined,
      items: data.items.map((item: any) => ({
        ...item,
        quantity: parseFloat(item.quantity),
        targetPrice: item.targetPrice ? parseFloat(item.targetPrice) : undefined,
      })),
    }),
    onSuccess: (response) => {
      toast.success('Inquiry created successfully');
      onSuccess(response.data?.data);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create inquiry');
    },
  });

  const addItem = () => {
    if (newItem.productId && newItem.quantity) {
      setFormData({
        ...formData,
        items: [...formData.items, { ...newItem }],
      });
      setNewItem({ productId: '', quantity: '', unit: 'KG', targetPrice: '', specifications: '' });
    }
  };

  const removeItem = (index: number) => {
    setFormData({
      ...formData,
      items: formData.items.filter((_, i) => i !== index),
    });
  };

  const handleSubmit = () => {
    if (!formData.buyerId) {
      toast.error('Please select a buyer');
      return;
    }
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title="Create New Inquiry" size="lg">
      <div className="p-6">
        {/* Step Indicator */}
        <div className="flex items-center justify-center mb-6">
          <div className={cn('flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium', step >= 1 ? 'bg-navy-900 text-white' : 'bg-gray-200 text-gray-600')}>1</div>
          <div className={cn('w-16 h-1 mx-2', step >= 2 ? 'bg-navy-900' : 'bg-gray-200')} />
          <div className={cn('flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium', step >= 2 ? 'bg-navy-900 text-white' : 'bg-gray-200 text-gray-600')}>2</div>
          <div className={cn('w-16 h-1 mx-2', step >= 3 ? 'bg-navy-900' : 'bg-gray-200')} />
          <div className={cn('flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium', step >= 3 ? 'bg-navy-900 text-white' : 'bg-gray-200 text-gray-600')}>3</div>
        </div>

        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 mb-4">Basic Information</h3>
            <SelectField
              label="Buyer"
              required
              value={formData.buyerId}
              onChange={(e) => setFormData({ ...formData, buyerId: e.target.value })}
              options={buyers.map((b: any) => ({ value: b.id, label: `${b.code} - ${b.companyName}` }))}
              placeholder="Select Buyer"
            />
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Priority"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                options={[
                  { value: 'LOW', label: 'Low' },
                  { value: 'MEDIUM', label: 'Medium' },
                  { value: 'HIGH', label: 'High' },
                  { value: 'URGENT', label: 'Urgent' },
                ]}
              />
              <FormField
                label="Source"
                value={formData.source}
                onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                placeholder="EMAIL, PHONE, EXHIBITION..."
              />
              <FormField
                label="Expected Value"
                type="number"
                value={formData.expectedValue}
                onChange={(e) => setFormData({ ...formData, expectedValue: e.target.value })}
                placeholder="Estimated order value"
              />
              <FormField
                label="Expected Close Date"
                type="date"
                value={formData.expectedDate}
                onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
              />
            </div>
            <TextareaField
              label="Requirements Summary"
              value={formData.requirements}
              onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
              rows={3}
              placeholder="Brief summary of buyer's requirements..."
            />
          </div>
        )}

        {/* Step 2: Products */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 mb-4">Products Requested</h3>
            
            {/* Add Item Form */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label="Product"
                  value={newItem.productId}
                  onChange={(e) => setNewItem({ ...newItem, productId: e.target.value })}
                  options={products.map((p: any) => ({ value: p.id, label: `${p.code} - ${p.name}` }))}
                  placeholder="Select Product"
                />
                <div className="grid grid-cols-2 gap-2">
                  <FormField
                    label="Quantity"
                    type="number"
                    value={newItem.quantity}
                    onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
                  />
                  <SelectField
                    label="Unit"
                    value={newItem.unit}
                    onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                    options={dropdowns?.units?.map((u: string) => ({ value: u, label: u })) || []}
                  />
                </div>
                <FormField
                  label="Target Price"
                  type="number"
                  value={newItem.targetPrice}
                  onChange={(e) => setNewItem({ ...newItem, targetPrice: e.target.value })}
                  placeholder="Buyer's target (optional)"
                />
                <FormField
                  label="Specifications"
                  value={newItem.specifications}
                  onChange={(e) => setNewItem({ ...newItem, specifications: e.target.value })}
                  placeholder="Quality specs..."
                />
              </div>
              <button type="button" onClick={addItem} className="btn btn-secondary w-full">
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </button>
            </div>

            {/* Items List */}
            {formData.items.length > 0 && (
              <div className="space-y-2">
                {formData.items.map((item, index) => {
                  const product = products.find((p: any) => p.id === item.productId);
                  return (
                    <div key={index} className="flex items-center justify-between bg-white border border-gray-200 rounded-lg p-3">
                      <div>
                        <div className="font-medium">{product?.name || 'Unknown Product'}</div>
                        <div className="text-sm text-gray-500">
                          {item.quantity} {item.unit}
                          {item.targetPrice && ` • Target: ${formatCurrency(parseFloat(item.targetPrice))}`}
                        </div>
                      </div>
                      <button onClick={() => removeItem(index)} className="text-red-500 hover:text-red-700">
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {formData.items.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                Add at least one product to the inquiry
              </div>
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 mb-4">Review & Create</h3>
            
            <div className="bg-gray-50 rounded-lg p-4 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Buyer:</span>
                  <span className="ml-2 font-medium">{buyers.find((b: any) => b.id === formData.buyerId)?.companyName}</span>
                </div>
                <div>
                  <span className="text-gray-500">Priority:</span>
                  <span className={`ml-2 badge ${getPriorityColor(formData.priority)}`}>{formData.priority}</span>
                </div>
                <div>
                  <span className="text-gray-500">Source:</span>
                  <span className="ml-2 font-medium">{formData.source || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Expected Value:</span>
                  <span className="ml-2 font-medium">{formData.expectedValue ? formatCurrency(parseFloat(formData.expectedValue)) : '-'}</span>
                </div>
              </div>
              {formData.requirements && (
                <div className="pt-3 border-t">
                  <span className="text-gray-500 text-sm">Requirements:</span>
                  <p className="mt-1 text-sm">{formData.requirements}</p>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-medium text-gray-700 mb-2">Products ({formData.items.length})</h4>
              <div className="space-y-2">
                {formData.items.map((item, index) => {
                  const product = products.find((p: any) => p.id === item.productId);
                  return (
                    <div key={index} className="flex items-center justify-between bg-white border border-gray-200 rounded p-2 text-sm">
                      <span>{product?.name}</span>
                      <span className="text-gray-500">{item.quantity} {item.unit}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between mt-6 pt-4 border-t">
          <button
            type="button"
            onClick={() => step > 1 ? setStep(step - 1) : onClose()}
            className="btn btn-secondary"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>
          {step < 3 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="btn btn-primary"
              disabled={step === 1 && !formData.buyerId}
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Creating...' : 'Create Inquiry'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
