// Comprehensive Inquiry Detail Pageimport { useState } from 'react';import { useParams, Link } from 'react-router-dom';import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';import toast from 'react-hot-toast';import { inquiriesApi, productsApi } from '@/lib/api';import Modal from '@/components/ui/Modal';import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';import { formatCurrency, formatDate, getStatusColor, getPriorityColor, cn } from '@/lib/utils';import {
  ArrowLeft,
  Edit2,
  Plus,
  Calendar,
  Building2,
  Phone,
  Mail,
  FileText,
  TrendingUp,
  CheckCircle,
  XCircle,
  ChevronRight,
  MessageSquare,
  Target,
} from 'lucide-react';

const STAGES = [
  { id: 'NEW', label: 'New', icon: Plus },
  { id: 'REQUIREMENT_GATHERED', label: 'Requirements', icon: FileText },
  { id: 'PRICING_IN_PROGRESS', label: 'Pricing', icon: TrendingUp },
  { id: 'QUOTATION_SENT', label: 'Quoted', icon: Mail },
  { id: 'NEGOTIATION', label: 'Negotiation', icon: MessageSquare },
  { id: 'WON', label: 'Won', icon: CheckCircle },
  { id: 'LOST', label: 'Lost', icon: XCircle },
];

export default function InquiryDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [showStageModal, setShowStageModal] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['inquiry', id],
    queryFn: () => inquiriesApi.get(id!),
    enabled: !!id,
  });

  const inquiry = data?.data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
      </div>
    );
  }

  if (!inquiry) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Inquiry not found</h2>
        <Link to="/inquiries" className="text-navy-600 hover:underline mt-2 inline-block">
          Back to Inquiries
        </Link>
      </div>
    );
  }

  const currentStageIndex = STAGES.findIndex(s => s.id === inquiry.stage);
  const isOpen = !['WON', 'LOST'].includes(inquiry.stage);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/inquiries" className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{inquiry.inquiryNumber}</h1>
            <span className={`badge ${getStatusColor(inquiry.stage)}`}>
              {inquiry.stage?.replace(/_/g, ' ')}
            </span>
            <span className={`badge ${getPriorityColor(inquiry.priority)}`}>
              {inquiry.priority}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-gray-500">
            <Link to={`/buyers/${inquiry.buyer?.id}`} className="flex items-center gap-1 hover:text-navy-600">
              <Building2 className="w-4 h-4" />
              {inquiry.buyer?.companyName}
            </Link>
            <span>•</span>
            <span>Created {formatDate(inquiry.createdAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowEditModal(true)} className="btn btn-secondary">
            <Edit2 className="w-4 h-4 mr-2" />
            Edit
          </button>
          {isOpen && (
            <button onClick={() => setShowStageModal(true)} className="btn btn-primary">
              Update Stage
            </button>
          )}
        </div>
      </div>

      {/* Stage Progress */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          {STAGES.slice(0, 6).map((stage, index) => {
            const isCompleted = currentStageIndex > index;
            const isCurrent = inquiry.stage === stage.id;
            const StageIcon = stage.icon;
            
            return (
              <div key={stage.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center transition-colors',
                    isCompleted ? 'bg-green-500 text-white' :
                    isCurrent ? 'bg-navy-900 text-white' :
                    'bg-gray-200 text-gray-400'
                  )}>
                    <StageIcon className="w-5 h-5" />
                  </div>
                  <span className={cn(
                    'mt-2 text-xs font-medium',
                    isCurrent ? 'text-navy-900' : 'text-gray-500'
                  )}>
                    {stage.label}
                  </span>
                </div>
                {index < 5 && (
                  <div className={cn(
                    'w-16 h-1 mx-2',
                    isCompleted ? 'bg-green-500' : 'bg-gray-200'
                  )} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-sm">Expected Value</span>
              </div>
              <div className="text-xl font-bold text-gray-900">
                {inquiry.expectedValue ? formatCurrency(inquiry.expectedValue) : '-'}
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Calendar className="w-4 h-4" />
                <span className="text-sm">Expected Close</span>
              </div>
              <div className="text-xl font-bold text-gray-900">
                {inquiry.expectedDate ? formatDate(inquiry.expectedDate) : '-'}
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Target className="w-4 h-4" />
                <span className="text-sm">Products</span>
              </div>
              <div className="text-xl font-bold text-gray-900">
                {inquiry.items?.length || 0}
              </div>
            </div>
          </div>

          {/* Products Requested */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">Products Requested</h2>
              {isOpen && (
                <button onClick={() => setShowItemModal(true)} className="btn btn-secondary py-1 text-sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Add Product
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Target Price</th>
                    <th>Specifications</th>
                  </tr>
                </thead>
                <tbody>
                  {inquiry.items?.map((item: any) => (
                    <tr key={item.id}>
                      <td>
                        <div className="font-medium">{item.product?.name}</div>
                        <div className="text-xs text-gray-500">{item.product?.code}</div>
                      </td>
                      <td>{item.quantity} {item.unit}</td>
                      <td>{item.targetPrice ? formatCurrency(item.targetPrice) : '-'}</td>
                      <td className="max-w-xs truncate">{item.specifications || '-'}</td>
                    </tr>
                  ))}
                  {(!inquiry.items || inquiry.items.length === 0) && (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-500">
                        No products added yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Quotations */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">Quotations</h2>
              {isOpen && inquiry.items?.length > 0 && (
                <Link to={`/quotations/new?inquiryId=${inquiry.id}`} className="btn btn-gold py-1 text-sm">
                  <Plus className="w-4 h-4 mr-1" />
                  Create Quotation
                </Link>
              )}
            </div>
            <div className="divide-y divide-gray-100">
              {inquiry.quotations?.map((quotation: any) => (
                <Link
                  key={quotation.id}
                  to={`/quotations/${quotation.id}`}
                  className="block px-6 py-4 hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-navy-600">{quotation.quotationNumber}</div>
                      <div className="text-sm text-gray-500">
                        {formatDate(quotation.createdAt)} • Valid until {formatDate(quotation.validUntil)}
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`badge ${getStatusColor(quotation.status)}`}>
                        {quotation.status}
                      </span>
                      <div className="text-lg font-semibold text-gray-900 mt-1">
                        {formatCurrency(quotation.grandTotal)}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
              {(!inquiry.quotations || inquiry.quotations.length === 0) && (
                <div className="px-6 py-8 text-center text-gray-500">
                  No quotations created yet
                </div>
              )}
            </div>
          </div>

          {/* Requirements & Notes */}
          {(inquiry.requirements || inquiry.notes) && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Requirements & Notes</h2>
              </div>
              <div className="card-body space-y-4">
                {inquiry.requirements && (
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Requirements</div>
                    <p className="whitespace-pre-wrap">{inquiry.requirements}</p>
                  </div>
                )}
                {inquiry.notes && (
                  <div>
                    <div className="text-sm text-gray-500 mb-1">Notes</div>
                    <p className="whitespace-pre-wrap">{inquiry.notes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Quick Actions */}
          {isOpen && (
            <div className="card">
              <div className="card-header">
                <h2 className="font-semibold">Quick Actions</h2>
              </div>
              <div className="card-body space-y-2">
                <button onClick={() => setShowFollowUpModal(true)} className="btn btn-secondary w-full justify-start">
                  <Calendar className="w-4 h-4 mr-2" />
                  Schedule Follow-up
                </button>
                <Link to={`/quotations/new?inquiryId=${inquiry.id}`} className="btn btn-secondary w-full justify-start">
                  <FileText className="w-4 h-4 mr-2" />
                  Create Quotation
                </Link>
                <button onClick={() => setShowStageModal(true)} className="btn btn-secondary w-full justify-start">
                  <ChevronRight className="w-4 h-4 mr-2" />
                  Move to Next Stage
                </button>
              </div>
            </div>
          )}

          {/* Sales Owner */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Sales Owner</h2>
            </div>
            <div className="card-body">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center font-semibold">
                  {inquiry.salesOwner?.firstName?.[0]}{inquiry.salesOwner?.lastName?.[0]}
                </div>
                <div>
                  <div className="font-medium">{inquiry.salesOwner?.firstName} {inquiry.salesOwner?.lastName}</div>
                  <div className="text-sm text-gray-500">{inquiry.salesOwner?.email}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Next Follow-up */}
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <h2 className="font-semibold">Next Follow-up</h2>
              {isOpen && (
                <button onClick={() => setShowFollowUpModal(true)} className="text-navy-600 text-sm">
                  + Add
                </button>
              )}
            </div>
            <div className="card-body">
              {inquiry.nextFollowUp ? (
                <div className={cn(
                  'flex items-center gap-3 p-3 rounded-lg',
                  new Date(inquiry.nextFollowUp) < new Date() ? 'bg-red-50' : 'bg-green-50'
                )}>
                  <Calendar className={cn(
                    'w-5 h-5',
                    new Date(inquiry.nextFollowUp) < new Date() ? 'text-red-500' : 'text-green-500'
                  )} />
                  <div>
                    <div className="font-medium">{formatDate(inquiry.nextFollowUp)}</div>
                    {inquiry.nextAction && (
                      <div className="text-sm text-gray-600">{inquiry.nextAction}</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-gray-500">
                  No follow-up scheduled
                </div>
              )}
            </div>
          </div>

          {/* Buyer Contact */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Buyer Contact</h2>
            </div>
            <div className="card-body">
              <Link to={`/buyers/${inquiry.buyer?.id}`} className="block hover:bg-gray-50 -m-4 p-4 rounded-lg">
                <div className="font-medium text-navy-600">{inquiry.buyer?.companyName}</div>
                <div className="text-sm text-gray-500">{inquiry.buyer?.country?.name}</div>
              </Link>
              {inquiry.buyer?.contacts?.[0] && (
                <div className="mt-3 pt-3 border-t space-y-2">
                  <div className="font-medium">
                    {inquiry.buyer.contacts[0].firstName} {inquiry.buyer.contacts[0].lastName}
                  </div>
                  {inquiry.buyer.contacts[0].email && (
                    <a href={`mailto:${inquiry.buyer.contacts[0].email}`} className="flex items-center gap-2 text-sm text-navy-600">
                      <Mail className="w-4 h-4" />
                      {inquiry.buyer.contacts[0].email}
                    </a>
                  )}
                  {inquiry.buyer.contacts[0].phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Phone className="w-4 h-4" />
                      {inquiry.buyer.contacts[0].phone}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Follow-up History */}
          <div className="card">
            <div className="card-header">
              <h2 className="font-semibold">Follow-up History</h2>
            </div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {inquiry.followUps?.map((followUp: any) => (
                <div key={followUp.id} className="px-6 py-3">
                  <div className="flex items-center justify-between">
                    <span className="badge badge-gray text-xs">{followUp.type}</span>
                    <span className="text-xs text-gray-400">{formatDate(followUp.scheduledAt)}</span>
                  </div>
                  {followUp.notes && (
                    <p className="text-sm text-gray-600 mt-1">{followUp.notes}</p>
                  )}
                  {followUp.outcome && (
                    <p className="text-sm text-green-600 mt-1">Outcome: {followUp.outcome}</p>
                  )}
                </div>
              ))}
              {(!inquiry.followUps || inquiry.followUps.length === 0) && (
                <div className="px-6 py-8 text-center text-gray-500 text-sm">
                  No follow-ups recorded
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showStageModal && (
        <UpdateStageModal
          inquiry={inquiry}
          onClose={() => setShowStageModal(false)}
          onSuccess={() => {
            setShowStageModal(false);
            queryClient.invalidateQueries({ queryKey: ['inquiry', id] });
          }}
        />
      )}

      {showFollowUpModal && (
        <AddFollowUpModal
          inquiryId={id!}
          onClose={() => setShowFollowUpModal(false)}
          onSuccess={() => {
            setShowFollowUpModal(false);
            queryClient.invalidateQueries({ queryKey: ['inquiry', id] });
          }}
        />
      )}

      {showItemModal && (
        <AddItemModal
          inquiryId={id!}
          onClose={() => setShowItemModal(false)}
          onSuccess={() => {
            setShowItemModal(false);
            queryClient.invalidateQueries({ queryKey: ['inquiry', id] });
          }}
        />
      )}

      {showEditModal && (
        <EditInquiryModal
          inquiry={inquiry}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            queryClient.invalidateQueries({ queryKey: ['inquiry', id] });
          }}
        />
      )}
    </div>
  );
}



// Update Stage Modal
function UpdateStageModal({ inquiry, onClose, onSuccess }: { inquiry: any; onClose: () => void; onSuccess: () => void }) {
  const [stage, setStage] = useState(inquiry.stage);
  const [lostReason, setLostReason] = useState('');

  const mutation = useMutation({
    mutationFn: (data: any) => inquiriesApi.update(inquiry.id, data),
    onSuccess: () => {
      toast.success('Stage updated');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  const handleSubmit = () => {
    const data: any = { stage };
    if (stage === 'LOST') data.lostReason = lostReason;
    mutation.mutate(data);
  };

  return (
    <Modal isOpen onClose={onClose} title="Update Inquiry Stage" size="md">
      <div className="p-6 space-y-4">
        <SelectField
          label="New Stage"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
          options={STAGES.map(s => ({ value: s.id, label: s.label }))}
        />
        
        {stage === 'LOST' && (
          <TextareaField
            label="Lost Reason"
            required
            value={lostReason}
            onChange={(e) => setLostReason(e.target.value)}
            rows={3}
            placeholder="Why was this inquiry lost?"
          />
        )}

        {stage === 'WON' && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 text-green-800">
              <CheckCircle className="w-5 h-5" />
              <span className="font-medium">Great! This inquiry will be marked as Won.</span>
            </div>
            <p className="text-sm text-green-600 mt-1">
              Create an order from the accepted quotation to proceed.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Updating...' : 'Update Stage'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Add Follow-up Modal
function AddFollowUpModal({ inquiryId, onClose, onSuccess }: { inquiryId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    scheduledAt: '',
    type: 'CALL',
    notes: '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => inquiriesApi.addFollowUp(inquiryId, data),
    onSuccess: () => {
      toast.success('Follow-up scheduled');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Schedule Follow-up" size="md">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Date & Time"
            required
            type="datetime-local"
            value={formData.scheduledAt}
            onChange={(e) => setFormData({ ...formData, scheduledAt: e.target.value })}
          />
          <SelectField
            label="Type"
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            options={[
              { value: 'CALL', label: 'Phone Call' },
              { value: 'EMAIL', label: 'Email' },
              { value: 'MEETING', label: 'Meeting' },
              { value: 'VISIT', label: 'Site Visit' },
            ]}
          />
        </div>
        <TextareaField
          label="Notes / Action Items"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={3}
          placeholder="What needs to be discussed or done?"
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Scheduling...' : 'Schedule'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Add Item Modal
function AddItemModal({ inquiryId, onClose, onSuccess }: { inquiryId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    productId: '',
    quantity: '',
    unit: 'KG',
    targetPrice: '',
    specifications: '',
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-all'],
    queryFn: async () => (await productsApi.list({ limit: 500 })).data?.data ?? [],
  });

  const mutation = useMutation({
    mutationFn: (data: any) => inquiriesApi.addItem(inquiryId, {
      ...data,
      quantity: parseFloat(data.quantity),
      targetPrice: data.targetPrice ? parseFloat(data.targetPrice) : undefined,
    }),
    onSuccess: () => {
      toast.success('Product added');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Add Product to Inquiry" size="md">
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
        <FormField
          label="Target Price (Optional)"
          type="number"
          value={formData.targetPrice}
          onChange={(e) => setFormData({ ...formData, targetPrice: e.target.value })}
          placeholder="Buyer's target price per unit"
        />
        <TextareaField
          label="Specifications"
          value={formData.specifications}
          onChange={(e) => setFormData({ ...formData, specifications: e.target.value })}
          rows={2}
          placeholder="Quality requirements, specs..."
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Adding...' : 'Add Product'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Edit Inquiry Modal
function EditInquiryModal({ inquiry, onClose, onSuccess }: { inquiry: any; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    priority: inquiry.priority || 'MEDIUM',
    expectedValue: inquiry.expectedValue || '',
    expectedDate: inquiry.expectedDate ? inquiry.expectedDate.split('T')[0] : '',
    requirements: inquiry.requirements || '',
    notes: inquiry.notes || '',
    nextFollowUp: inquiry.nextFollowUp ? inquiry.nextFollowUp.split('T')[0] : '',
    nextAction: inquiry.nextAction || '',
  });
  const mutation = useMutation({
    mutationFn: (data: any) => inquiriesApi.update(inquiry.id, {
      ...data,
      expectedValue: data.expectedValue ? parseFloat(data.expectedValue) : undefined,
      expectedDate: data.expectedDate || undefined,
      nextFollowUp: data.nextFollowUp || undefined,
    }),
    onSuccess: () => {
      toast.success('Inquiry updated');
      onSuccess();
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Failed'),
  });

  return (
    <Modal isOpen onClose={onClose} title="Edit Inquiry" size="lg">
      <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(formData); }} className="p-6 space-y-4">
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
            label="Expected Value"
            type="number"
            value={formData.expectedValue}
            onChange={(e) => setFormData({ ...formData, expectedValue: e.target.value })}
          />
          <FormField
            label="Expected Close Date"
            type="date"
            value={formData.expectedDate}
            onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
          />
          <FormField
            label="Next Follow-up"
            type="date"
            value={formData.nextFollowUp}
            onChange={(e) => setFormData({ ...formData, nextFollowUp: e.target.value })}
          />
        </div>
        <FormField
          label="Next Action"
          value={formData.nextAction}
          onChange={(e) => setFormData({ ...formData, nextAction: e.target.value })}
          placeholder="What's the next step?"
        />
        <TextareaField
          label="Requirements"
          value={formData.requirements}
          onChange={(e) => setFormData({ ...formData, requirements: e.target.value })}
          rows={3}
        />
        <TextareaField
          label="Notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
        />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
