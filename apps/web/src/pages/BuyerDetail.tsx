// BuyerDetail - Complete 360° View
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { buyersApi, masterApi } from '@/lib/api';
import { formatCurrency, formatDate, formatDateTime, getStatusColor, cn } from '@/lib/utils';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import {
  ArrowLeft, Mail, Phone, Globe, Building2, Edit2, Plus,
  User, MessageSquare, FileText, ShoppingCart, DollarSign,
  Calendar, MapPin, CreditCard, TrendingUp
} from 'lucide-react';

type TabType = 'overview' | 'contacts' | 'communications' | 'inquiries' | 'orders' | 'invoices';

export default function BuyerDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showCommModal, setShowCommModal] = useState(false);
  const [editContact, setEditContact] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['buyer', id],
    queryFn: () => buyersApi.get(id!),
    enabled: !!id,
  });

  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const buyer = data?.data?.data;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-navy-900" />
      </div>
    );
  }

  if (!buyer) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Buyer not found</h2>
        <Link to="/buyers" className="text-navy-600 hover:underline mt-2 inline-block">
          Back to Buyers
        </Link>
      </div>
    );
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'contacts', label: 'Contacts', icon: User, count: buyer.contacts?.length },
    { id: 'communications', label: 'Communications', icon: MessageSquare, count: buyer.communications?.length },
    { id: 'inquiries', label: 'Inquiries', icon: FileText, count: buyer.inquiries?.length },
    { id: 'orders', label: 'Orders', icon: ShoppingCart, count: buyer.orders?.length },
    { id: 'invoices', label: 'Invoices', icon: DollarSign, count: buyer.invoices?.length },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/buyers" className="mt-1 text-gray-400 hover:text-gray-600">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{buyer.companyName}</h1>
            <span className={`badge ${getStatusColor(buyer.status)}`}>{buyer.status}</span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-gray-500">
            <span>{buyer.code}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              {buyer.country?.name}
            </span>
            {buyer.industry && (
              <>
                <span>•</span>
                <span>{buyer.industry}</span>
              </>
            )}
          </div>
        </div>
        <button onClick={() => setShowEditModal(true)} className="btn btn-secondary">
          <Edit2 className="w-4 h-4 mr-2" />
          Edit
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          icon={TrendingUp}
          label="Total Revenue"
          value={formatCurrency(buyer.totalRevenue || 0)}
          color="text-green-600"
        />
        <StatCard
          icon={ShoppingCart}
          label="Total Orders"
          value={buyer.totalOrders || 0}
          color="text-blue-600"
        />
        <StatCard
          icon={Calendar}
          label="Last Order"
          value={buyer.lastOrderDate ? formatDate(buyer.lastOrderDate) : 'Never'}
          color="text-purple-600"
        />
        <StatCard
          icon={CreditCard}
          label="Credit Limit"
          value={buyer.creditLimit ? formatCurrency(buyer.creditLimit) : 'Not set'}
          color="text-orange-600"
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 -mb-px overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={cn(
                'flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                activeTab === tab.id
                  ? 'border-navy-900 text-navy-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab buyer={buyer} />}
      {activeTab === 'contacts' && (
        <ContactsTab
          contacts={buyer.contacts || []}
          onAdd={() => { setEditContact(null); setShowContactModal(true); }}
          onEdit={(c) => { setEditContact(c); setShowContactModal(true); }}
        />
      )}
      {activeTab === 'communications' && (
        <CommunicationsTab
          communications={buyer.communications || []}
          onAdd={() => setShowCommModal(true)}
        />
      )}
      {activeTab === 'inquiries' && <InquiriesTab inquiries={buyer.inquiries || []} />}
      {activeTab === 'orders' && <OrdersTab orders={buyer.orders || []} />}
      {activeTab === 'invoices' && <InvoicesTab invoices={buyer.invoices || []} />}

      {/* Modals */}
      {showEditModal && (
        <EditBuyerModal
          buyer={buyer}
          dropdowns={dropdowns?.data?.data}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            setShowEditModal(false);
            queryClient.invalidateQueries({ queryKey: ['buyer', id] });
          }}
        />
      )}

      {showContactModal && (
        <ContactModal
          buyerId={id!}
          contact={editContact}
          onClose={() => { setShowContactModal(false); setEditContact(null); }}
          onSuccess={() => {
            setShowContactModal(false);
            setEditContact(null);
            queryClient.invalidateQueries({ queryKey: ['buyer', id] });
          }}
        />
      )}

      {showCommModal && (
        <CommunicationModal
          buyerId={id!}
          onClose={() => setShowCommModal(false)}
          onSuccess={() => {
            setShowCommModal(false);
            queryClient.invalidateQueries({ queryKey: ['buyer', id] });
          }}
        />
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string | number; color: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg bg-gray-100 ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-lg font-bold text-gray-900">{value}</div>
          <div className="text-xs text-gray-500">{label}</div>
        </div>
      </div>
    </div>
  );
}



// Overview Tab
function OverviewTab({ buyer }: { buyer: any }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Company Details */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold">Company Details</h3>
        </div>
        <div className="card-body space-y-4">
          {buyer.tradeName && (
            <div>
              <div className="text-sm text-gray-500">Trade Name</div>
              <div>{buyer.tradeName}</div>
            </div>
          )}
          <div>
            <div className="text-sm text-gray-500">Address</div>
            <div>{buyer.address || '-'}</div>
            {(buyer.city || buyer.state || buyer.postalCode) && (
              <div className="text-gray-600">
                {[buyer.city, buyer.state, buyer.postalCode].filter(Boolean).join(', ')}
              </div>
            )}
          </div>
          {buyer.website && (
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-gray-400" />
              <a href={buyer.website} target="_blank" rel="noopener noreferrer" className="text-navy-600 hover:underline">
                {buyer.website}
              </a>
            </div>
          )}
          {buyer.taxId && (
            <div>
              <div className="text-sm text-gray-500">Tax ID</div>
              <div>{buyer.taxId}</div>
            </div>
          )}
        </div>
      </div>

      {/* Business Terms */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold">Business Terms</h3>
        </div>
        <div className="card-body space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-500">Currency</div>
              <div>{buyer.currency?.code || 'USD'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Payment Terms</div>
              <div>{buyer.paymentTerms || '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Credit Limit</div>
              <div>{buyer.creditLimit ? formatCurrency(buyer.creditLimit) : '-'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Credit Days</div>
              <div>{buyer.creditDays ? `${buyer.creditDays} days` : '-'}</div>
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Source</div>
            <div>{buyer.source || '-'}</div>
          </div>
          {buyer.notes && (
            <div>
              <div className="text-sm text-gray-500">Notes</div>
              <div className="text-gray-700 whitespace-pre-wrap">{buyer.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Primary Contact */}
      {buyer.contacts?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold">Primary Contact</h3>
          </div>
          <div className="card-body">
            {(() => {
              const primary = buyer.contacts.find((c: any) => c.isPrimary) || buyer.contacts[0];
              return (
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center font-semibold">
                    {primary.firstName?.[0]}{primary.lastName?.[0]}
                  </div>
                  <div>
                    <div className="font-medium">{primary.firstName} {primary.lastName}</div>
                    {primary.designation && <div className="text-sm text-gray-500">{primary.designation}</div>}
                    {primary.email && (
                      <a href={`mailto:${primary.email}`} className="flex items-center gap-1 text-sm text-navy-600 mt-1">
                        <Mail className="w-4 h-4" /> {primary.email}
                      </a>
                    )}
                    {primary.phone && (
                      <div className="flex items-center gap-1 text-sm text-gray-600 mt-1">
                        <Phone className="w-4 h-4" /> {primary.phone}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold">Recent Activity</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {[
            ...(buyer.inquiries?.slice(0, 3).map((i: any) => ({ type: 'inquiry', ...i })) || []),
            ...(buyer.orders?.slice(0, 3).map((o: any) => ({ type: 'order', ...o })) || []),
          ]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 5)
            .map((item: any) => (
              <Link
                key={item.id}
                to={item.type === 'inquiry' ? `/inquiries/${item.id}` : `/orders/${item.id}`}
                className="block px-6 py-3 hover:bg-gray-50"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">
                      {item.type === 'inquiry' ? item.inquiryNumber : item.orderNumber}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {item.type === 'inquiry' ? 'Inquiry' : 'Order'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{formatDate(item.createdAt)}</span>
                </div>
              </Link>
            ))}
          {(!buyer.inquiries?.length && !buyer.orders?.length) && (
            <div className="px-6 py-8 text-center text-gray-500">No recent activity</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Contacts Tab
function ContactsTab({ contacts, onAdd, onEdit }: { contacts: any[]; onAdd: () => void; onEdit: (c: any) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onAdd} className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Add Contact
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {contacts.map((contact) => (
          <div key={contact.id} className="card p-4">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-navy-100 text-navy-600 flex items-center justify-center font-medium">
                  {contact.firstName?.[0]}{contact.lastName?.[0]}
                </div>
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {contact.firstName} {contact.lastName}
                    {contact.isPrimary && (
                      <span className="badge badge-gold text-xs">Primary</span>
                    )}
                  </div>
                  {contact.designation && (
                    <div className="text-sm text-gray-500">{contact.designation}</div>
                  )}
                </div>
              </div>
              <button onClick={() => onEdit(contact)} className="text-gray-400 hover:text-gray-600">
                <Edit2 className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 space-y-1 text-sm">
              {contact.email && (
                <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-navy-600 hover:underline">
                  <Mail className="w-4 h-4" /> {contact.email}
                </a>
              )}
              {contact.phone && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4" /> {contact.phone}
                </div>
              )}
              {contact.mobile && (
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4" /> {contact.mobile} (Mobile)
                </div>
              )}
            </div>
          </div>
        ))}
        {contacts.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500">
            No contacts yet. Add your first contact.
          </div>
        )}
      </div>
    </div>
  );
}



// Communications Tab
function CommunicationsTab({ communications, onAdd }: { communications: any[]; onAdd: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={onAdd} className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Log Communication
        </button>
      </div>
      <div className="card">
        <div className="divide-y divide-gray-100">
          {communications.map((comm) => (
            <div key={comm.id} className="px-6 py-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${
                    comm.direction === 'OUTBOUND' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                  }`}>
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-medium">{comm.subject || comm.type}</div>
                    <div className="text-sm text-gray-500 flex items-center gap-2">
                      <span className="badge badge-gray text-xs">{comm.type}</span>
                      <span>{comm.direction}</span>
                      <span>•</span>
                      <span>{comm.user?.firstName} {comm.user?.lastName}</span>
                    </div>
                    {comm.content && (
                      <p className="mt-2 text-gray-700 whitespace-pre-wrap">{comm.content}</p>
                    )}
                  </div>
                </div>
                <div className="text-sm text-gray-400">{formatDateTime(comm.createdAt)}</div>
              </div>
            </div>
          ))}
          {communications.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500">
              No communications logged yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Inquiries Tab
function InquiriesTab({ inquiries }: { inquiries: any[] }) {
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Inquiry #</th>
            <th>Stage</th>
            <th>Expected Value</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {inquiries.map((inquiry) => (
            <tr key={inquiry.id}>
              <td>
                <Link to={`/inquiries/${inquiry.id}`} className="text-navy-600 hover:underline font-medium">
                  {inquiry.inquiryNumber}
                </Link>
              </td>
              <td>
                <span className={`badge ${getStatusColor(inquiry.stage)}`}>
                  {inquiry.stage?.replace(/_/g, ' ')}
                </span>
              </td>
              <td>{inquiry.expectedValue ? formatCurrency(inquiry.expectedValue) : '-'}</td>
              <td>{formatDate(inquiry.createdAt)}</td>
            </tr>
          ))}
          {inquiries.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center py-8 text-gray-500">No inquiries</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Orders Tab
function OrdersTab({ orders }: { orders: any[] }) {
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Order #</th>
            <th>Status</th>
            <th>Total Value</th>
            <th>Order Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <Link to={`/orders/${order.id}`} className="text-navy-600 hover:underline font-medium">
                  {order.orderNumber}
                </Link>
              </td>
              <td>
                <span className={`badge ${getStatusColor(order.status)}`}>
                  {order.status?.replace(/_/g, ' ')}
                </span>
              </td>
              <td>{formatCurrency(order.totalValue || 0)}</td>
              <td>{formatDate(order.createdAt)}</td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center py-8 text-gray-500">No orders</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Invoices Tab
function InvoicesTab({ invoices }: { invoices: any[] }) {
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Status</th>
            <th>Total</th>
            <th>Balance</th>
            <th>Due Date</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                <Link to={`/invoices/${invoice.id}`} className="text-navy-600 hover:underline font-medium">
                  {invoice.invoiceNumber}
                </Link>
              </td>
              <td>
                <span className={`badge ${getStatusColor(invoice.status)}`}>
                  {invoice.status?.replace(/_/g, ' ')}
                </span>
              </td>
              <td>{formatCurrency(invoice.totalAmount || 0)}</td>
              <td className={Number(invoice.balanceAmount) > 0 ? 'text-red-600 font-medium' : ''}>
                {formatCurrency(invoice.balanceAmount || 0)}
              </td>
              <td>{formatDate(invoice.dueDate)}</td>
            </tr>
          ))}
          {invoices.length === 0 && (
            <tr>
              <td colSpan={5} className="text-center py-8 text-gray-500">No invoices</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}



// Edit Buyer Modal
function EditBuyerModal({ buyer, dropdowns, onClose, onSuccess }: { buyer: any; dropdowns: any; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    companyName: buyer.companyName || '',
    tradeName: buyer.tradeName || '',
    countryId: buyer.countryId || '',
    address: buyer.address || '',
    city: buyer.city || '',
    state: buyer.state || '',
    postalCode: buyer.postalCode || '',
    website: buyer.website || '',
    industry: buyer.industry || '',
    status: buyer.status || 'LEAD',
    source: buyer.source || '',
    currencyId: buyer.currencyId || '',
    paymentTerms: buyer.paymentTerms || '',
    creditLimit: buyer.creditLimit || '',
    creditDays: buyer.creditDays || '',
    taxId: buyer.taxId || '',
    notes: buyer.notes || '',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => buyersApi.update(buyer.id, data),
    onSuccess: () => {
      toast.success('Buyer updated successfully');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update buyer');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      creditLimit: formData.creditLimit ? Number(formData.creditLimit) : undefined,
      creditDays: formData.creditDays ? Number(formData.creditDays) : undefined,
    };
    mutation.mutate(data);
  };

  return (
    <Modal isOpen onClose={onClose} title="Edit Buyer" size="lg">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Company Name" required value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} />
          <FormField label="Trade Name" value={formData.tradeName} onChange={(e) => setFormData({ ...formData, tradeName: e.target.value })} />
          <SelectField label="Country" required value={formData.countryId} onChange={(e) => setFormData({ ...formData, countryId: e.target.value })} options={(dropdowns?.countries || []).map((c: any) => ({ value: c.id, label: c.name }))} placeholder="Select Country" />
          <SelectField label="Status" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value })} options={(dropdowns?.buyerStatuses || []).map((s: string) => ({ value: s, label: s }))} />
          <FormField label="Address" className="col-span-2" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
          <FormField label="City" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} />
          <FormField label="State" value={formData.state} onChange={(e) => setFormData({ ...formData, state: e.target.value })} />
          <FormField label="Website" value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} />
          <FormField label="Industry" value={formData.industry} onChange={(e) => setFormData({ ...formData, industry: e.target.value })} />
          <FormField label="Source" value={formData.source} onChange={(e) => setFormData({ ...formData, source: e.target.value })} placeholder="EXHIBITION, REFERRAL, etc." />
          <SelectField label="Currency" value={formData.currencyId} onChange={(e) => setFormData({ ...formData, currencyId: e.target.value })} options={(dropdowns?.currencies || []).map((c: any) => ({ value: c.id, label: `${c.code} (${c.symbol})` }))} placeholder="Select Currency" />
          <FormField label="Payment Terms" value={formData.paymentTerms} onChange={(e) => setFormData({ ...formData, paymentTerms: e.target.value })} placeholder="e.g., Net 30" />
          <FormField label="Credit Limit" type="number" value={formData.creditLimit} onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })} />
          <FormField label="Credit Days" type="number" value={formData.creditDays} onChange={(e) => setFormData({ ...formData, creditDays: e.target.value })} />
          <FormField label="Tax ID" value={formData.taxId} onChange={(e) => setFormData({ ...formData, taxId: e.target.value })} />
          <TextareaField label="Notes" className="col-span-2" value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} rows={3} />
        </div>
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

// Contact Modal
function ContactModal({ buyerId, contact, onClose, onSuccess }: { buyerId: string; contact: any; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    firstName: contact?.firstName || '',
    lastName: contact?.lastName || '',
    designation: contact?.designation || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    mobile: contact?.mobile || '',
    isPrimary: contact?.isPrimary || false,
  });

  const mutation = useMutation({
    mutationFn: (data: any) =>
      contact?.id
        ? buyersApi.updateContact(buyerId, contact.id, data)
        : buyersApi.addContact(buyerId, data),
    onSuccess: () => {
      toast.success(contact ? 'Contact updated' : 'Contact added');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save contact');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title={contact ? 'Edit Contact' : 'Add Contact'} size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="First Name" required value={formData.firstName} onChange={(e) => setFormData({ ...formData, firstName: e.target.value })} />
          <FormField label="Last Name" value={formData.lastName} onChange={(e) => setFormData({ ...formData, lastName: e.target.value })} />
          <FormField label="Designation" className="col-span-2" value={formData.designation} onChange={(e) => setFormData({ ...formData, designation: e.target.value })} />
          <FormField label="Email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
          <FormField label="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
          <FormField label="Mobile" value={formData.mobile} onChange={(e) => setFormData({ ...formData, mobile: e.target.value })} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isPrimary" checked={formData.isPrimary} onChange={(e) => setFormData({ ...formData, isPrimary: e.target.checked })} className="rounded border-gray-300" />
            <label htmlFor="isPrimary" className="text-sm">Primary Contact</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : contact ? 'Update' : 'Add Contact'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Communication Modal
function CommunicationModal({ buyerId, onClose, onSuccess }: { buyerId: string; onClose: () => void; onSuccess: () => void }) {
  const [formData, setFormData] = useState({
    type: 'EMAIL',
    subject: '',
    content: '',
    direction: 'OUTBOUND',
  });

  const mutation = useMutation({
    mutationFn: (data: any) => buyersApi.addCommunication(buyerId, data),
    onSuccess: () => {
      toast.success('Communication logged');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to log communication');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate(formData);
  };

  return (
    <Modal isOpen onClose={onClose} title="Log Communication" size="md">
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <SelectField label="Type" value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} options={[
            { value: 'EMAIL', label: 'Email' },
            { value: 'CALL', label: 'Phone Call' },
            { value: 'MEETING', label: 'Meeting' },
            { value: 'WHATSAPP', label: 'WhatsApp' },
            { value: 'VISIT', label: 'Site Visit' },
          ]} />
          <SelectField label="Direction" value={formData.direction} onChange={(e) => setFormData({ ...formData, direction: e.target.value })} options={[
            { value: 'OUTBOUND', label: 'Outbound (We contacted)' },
            { value: 'INBOUND', label: 'Inbound (They contacted)' },
          ]} />
        </div>
        <FormField label="Subject" value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} />
        <TextareaField label="Notes / Content" value={formData.content} onChange={(e) => setFormData({ ...formData, content: e.target.value })} rows={4} />
        <div className="flex justify-end gap-3 pt-4 border-t">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Log Communication'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
