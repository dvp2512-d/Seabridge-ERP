// Settings Page - Complete System Configuration
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { authApi, automationApi, getApiErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { cn } from '@/lib/utils';
import {
  User,
  Building2,
  Webhook,
  FileText,
  Zap,
  Key,
  Shield,
  Plus,
  Edit,
  Trash2,
  Play,
  Copy,
  Eye,
  EyeOff,
  Mail,
  AlertTriangle,
} from 'lucide-react';

type SettingsTab = 'profile' | 'company' | 'templates' | 'webhooks' | 'automations' | 'api';

export default function Settings() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  const tabs = [
    { key: 'profile', label: 'Profile', icon: User },
    { key: 'company', label: 'Company', icon: Building2 },
    { key: 'templates', label: 'Templates', icon: FileText },
    { key: 'webhooks', label: 'Webhooks', icon: Webhook },
    { key: 'automations', label: 'Automations', icon: Zap },
    { key: 'api', label: 'API Keys', icon: Key },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-500">Manage your account, company settings, and integrations</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-56 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as SettingsTab)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition',
                  activeTab === tab.key
                    ? 'bg-navy-100 text-navy-900'
                    : 'text-gray-600 hover:bg-gray-100'
                )}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'profile' && <ProfileSettings user={user} />}
          {activeTab === 'company' && <CompanySettings />}
          {activeTab === 'templates' && <TemplatesSettings />}
          {activeTab === 'webhooks' && <WebhooksSettings />}
          {activeTab === 'automations' && <AutomationsSettings />}
          {activeTab === 'api' && <ApiKeysSettings />}
        </div>
      </div>
    </div>
  );
}

// Profile Settings
function ProfileSettings({ user }: { user: any }) {
  const [formData, setFormData] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
  });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const updateUser = useAuthStore((state) => state.updateUser);

  const mutation = useMutation({
    mutationFn: () => authApi.updateProfile(formData),
    onSuccess: (response) => {
      // Update the stored session so the sidebar and initials refresh at once.
      const updated = response.data?.data;
      if (updated) {
        updateUser({ firstName: updated.firstName, lastName: updated.lastName });
      }
      toast.success('Profile updated');
    },
    onError: (error) => toast.error(getApiErrorMessage(error, 'Failed to update profile')),
  });

  const handleSave = () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      toast.error('First and last name are required');
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold">Profile Information</h2>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-4">
            <FormField
              label="First Name"
              required
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
            <FormField
              label="Last Name"
              required
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
            <div className="col-span-2">
              <FormField
                label="Phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <FormField
                label="Email"
                type="email"
                value={user?.email || ''}
                disabled
                hint="Contact admin to change email"
              />
            </div>
            <div className="col-span-2">
              <label className="label">Role</label>
              <div className="badge badge-navy">{user?.role}</div>
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <button onClick={() => setShowPasswordModal(true)} className="btn btn-secondary">
              Change Password
            </button>
            <button
              onClick={handleSave}
              className="btn btn-primary"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {showPasswordModal && (
        <PasswordChangeModal onClose={() => setShowPasswordModal(false)} />
      )}
    </div>
  );
}

// Password Change Modal
function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(formData.currentPassword, formData.newPassword),
    onSuccess: () => {
      toast.success('Password changed successfully');
      onClose();
    },
    onError: () => toast.error('Failed to change password'),
  });

  const handleSubmit = () => {
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    mutation.mutate();
  };

  return (
    <Modal isOpen onClose={onClose} title="Change Password" size="sm">
      <div className="p-6 space-y-4">
        <FormField
          label="Current Password"
          type="password"
          value={formData.currentPassword}
          onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
        />
        <FormField
          label="New Password"
          type="password"
          value={formData.newPassword}
          onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
        />
        <FormField
          label="Confirm New Password"
          type="password"
          value={formData.confirmPassword}
          onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
        />
        <div className="flex justify-end gap-3 pt-4">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSubmit} className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Company Settings
function CompanySettings() {
  return (
    <div className="space-y-6">
      {/* These forms have no backend yet. Rather than offer a Save button that
          silently discards what the user typed, the fields are read-only and
          the real source of each value is stated. */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
        <div className="text-sm text-yellow-800">
          <strong>Not editable yet.</strong> These values are currently set in
          configuration, not in the app. Company name and branding come from the
          environment file; currency, incoterms and other defaults are managed in{' '}
          <strong>Master Data</strong>. Editing here is on the roadmap.
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold">Company Information</h2>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FormField label="Company Name" value="SeaBridge Exports" readOnly disabled hint="Set by COMPANY_NAME in .env" />
            </div>
            <FormField label="Tax ID / GST" value="" readOnly disabled placeholder="Not configured" />
            <FormField label="Registration No" value="" readOnly disabled placeholder="Not configured" />
            <div className="col-span-2">
              <TextareaField label="Address" rows={2} value="" readOnly disabled placeholder="Not configured" />
            </div>
            <FormField label="Phone" value="" readOnly disabled placeholder="Not configured" />
            <FormField label="Email" value="" readOnly disabled placeholder="Not configured" />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold">Defaults</h2>
        </div>
        <div className="card-body">
          <p className="text-sm text-gray-600">
            Currencies, incoterms, countries, ports and product categories are all
            managed under <strong>Master Data</strong>. Payment terms and quotation
            validity are set per quotation when you create it.
          </p>
        </div>
      </div>
    </div>
  );
}

// Templates Settings
function TemplatesSettings() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['templates', typeFilter],
    queryFn: () => automationApi.listTemplates(typeFilter || undefined),
  });

  const { data: variablesData } = useQuery({
    queryKey: ['template-variables'],
    queryFn: () => automationApi.getTemplateVariables(),
  });

  const templates = data?.data?.data || [];
  const variables = variablesData?.data?.data || {};

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template deleted');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Document Templates</h2>
          <p className="text-sm text-gray-500">Manage email, quotation, and invoice templates</p>
        </div>
        <button onClick={() => { setSelectedTemplate(null); setShowModal(true); }} className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" /> New Template
        </button>
      </div>

      <div className="flex gap-2">
        {['', 'EMAIL', 'QUOTATION', 'INVOICE'].map((type) => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium',
              typeFilter === type ? 'bg-navy-100 text-navy-900' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            {type || 'All'}
          </button>
        ))}
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : templates.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No templates found</p>
          </div>
        ) : (
          <div className="divide-y">
            {templates.map((template: any) => (
              <div key={template.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center',
                    template.type === 'EMAIL' ? 'bg-blue-100' :
                    template.type === 'QUOTATION' ? 'bg-green-100' : 'bg-purple-100'
                  )}>
                    {template.type === 'EMAIL' ? <Mail className="w-5 h-5 text-blue-600" /> :
                     template.type === 'QUOTATION' ? <FileText className="w-5 h-5 text-green-600" /> :
                     <FileText className="w-5 h-5 text-purple-600" />}
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {template.name}
                      {template.isDefault && <span className="badge badge-success text-xs">Default</span>}
                    </div>
                    <div className="text-sm text-gray-500">{template.type}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSelectedTemplate(template); setShowModal(true); }}
                    className="p-2 text-gray-400 hover:text-gray-600"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(template.id)}
                    className="p-2 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <TemplateModal
          template={selectedTemplate}
          variables={variables}
          onClose={() => { setShowModal(false); setSelectedTemplate(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['templates'] });
            setShowModal(false);
            setSelectedTemplate(null);
          }}
        />
      )}
    </div>
  );
}

// Template Modal
function TemplateModal({
  template,
  variables,
  onClose,
  onSuccess,
}: {
  template: any;
  variables: any;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    type: template?.type || 'EMAIL',
    subject: template?.subject || '',
    content: template?.content || '',
    isDefault: template?.isDefault || false,
  });

  const mutation = useMutation({
    mutationFn: (data: any) => template
      ? automationApi.updateTemplate(template.id, data)
      : automationApi.createTemplate(data),
    onSuccess: () => {
      toast.success(template ? 'Template updated' : 'Template created');
      onSuccess();
    },
    onError: () => toast.error('Failed to save template'),
  });

  return (
    <Modal isOpen onClose={onClose} title={template ? 'Edit Template' : 'New Template'} size="lg">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="Template Name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <SelectField
            label="Type"
            required
            value={formData.type}
            onChange={(e) => setFormData({ ...formData, type: e.target.value })}
            options={[
              { value: 'EMAIL', label: 'Email' },
              { value: 'QUOTATION', label: 'Quotation' },
              { value: 'INVOICE', label: 'Invoice' },
              { value: 'DOCUMENT', label: 'Document' },
            ]}
            disabled={!!template}
          />
        </div>

        {formData.type === 'EMAIL' && (
          <FormField
            label="Subject"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            placeholder="Email subject line"
          />
        )}

        <TextareaField
          label="Content"
          required
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          rows={10}
          placeholder="Template content with {{variables}}"
        />

        {/* Available Variables */}
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="font-medium text-sm mb-2">Available Variables</h4>
          <div className="flex flex-wrap gap-1">
            {Object.entries(variables).map(([category, vars]: [string, any]) => (
              <div key={category} className="mr-4 mb-2">
                <div className="text-xs text-gray-500 mb-1">{category}</div>
                <div className="flex flex-wrap gap-1">
                  {vars.slice(0, 3).map((v: string) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFormData({ ...formData, content: formData.content + v })}
                      className="text-xs px-2 py-0.5 bg-white border rounded hover:bg-gray-50"
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isDefault}
            onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Set as default template for this type</span>
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate(formData)} className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save Template'}
          </button>
        </div>
      </div>
    </Modal>
  );
}



// Webhooks Settings
function WebhooksSettings() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [selectedWebhook, setSelectedWebhook] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => automationApi.listWebhooks(),
  });

  const { data: eventsData } = useQuery({
    queryKey: ['webhook-events'],
    queryFn: () => automationApi.getWebhookEvents(),
  });

  const webhooks = data?.data?.data || [];
  const eventCategories = eventsData?.data?.data || [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationApi.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast.success('Webhook deleted');
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => automationApi.testWebhook(id),
    onSuccess: (response) => {
      if (response.data?.data?.delivered) {
        toast.success('Webhook test successful');
      } else {
        toast.error(`Test failed: ${response.data?.data?.error || 'Unknown error'}`);
      }
    },
    onError: () => toast.error('Failed to test webhook'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-gray-500">Send real-time notifications to external systems</p>
        </div>
        <button onClick={() => { setSelectedWebhook(null); setShowModal(true); }} className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" /> New Webhook
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : webhooks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Webhook className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No webhooks configured</p>
            <p className="text-sm mt-1">Create a webhook to send events to external systems</p>
          </div>
        ) : (
          <div className="divide-y">
            {webhooks.map((webhook: any) => (
              <div key={webhook.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      'w-3 h-3 rounded-full',
                      webhook.isActive ? 'bg-green-500' : 'bg-gray-400'
                    )} />
                    <div>
                      <div className="font-medium">{webhook.name}</div>
                      <div className="text-sm text-gray-500 font-mono">{webhook.url}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => testMutation.mutate(webhook.id)}
                      className="btn btn-secondary py-1 text-xs"
                      disabled={testMutation.isPending}
                    >
                      <Play className="w-3 h-3 mr-1" /> Test
                    </button>
                    <button
                      onClick={() => { setSelectedWebhook(webhook); setShowModal(true); }}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(webhook.id)}
                      className="p-2 text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {webhook.events?.slice(0, 5).map((event: string) => (
                    <span key={event} className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                      {event}
                    </span>
                  ))}
                  {webhook.events?.length > 5 && (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">
                      +{webhook.events.length - 5} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <WebhookModal
          webhook={selectedWebhook}
          eventCategories={eventCategories}
          onClose={() => { setShowModal(false); setSelectedWebhook(null); }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            setShowModal(false);
            setSelectedWebhook(null);
          }}
        />
      )}
    </div>
  );
}

// Webhook Modal
function WebhookModal({
  webhook,
  eventCategories,
  onClose,
  onSuccess,
}: {
  webhook: any;
  eventCategories: any[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: webhook?.name || '',
    url: webhook?.url || '',
    events: webhook?.events || [],
    isActive: webhook?.isActive ?? true,
  });
  const [showSecret, setShowSecret] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: any) => webhook
      ? automationApi.updateWebhook(webhook.id, data)
      : automationApi.createWebhook(data),
    onSuccess: () => {
      toast.success(webhook ? 'Webhook updated' : 'Webhook created');
      onSuccess();
    },
    onError: () => toast.error('Failed to save webhook'),
  });

  const toggleEvent = (event: string) => {
    setFormData({
      ...formData,
      events: formData.events.includes(event)
        ? formData.events.filter((e: string) => e !== event)
        : [...formData.events, event],
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={webhook ? 'Edit Webhook' : 'New Webhook'} size="lg">
      <div className="p-6 space-y-4">
        <FormField
          label="Webhook Name"
          required
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="e.g., Slack Notifications"
        />

        <FormField
          label="Endpoint URL"
          required
          value={formData.url}
          onChange={(e) => setFormData({ ...formData, url: e.target.value })}
          placeholder="https://example.com/webhook"
        />

        {webhook?.secret && (
          <div>
            <label className="label">Webhook Secret</label>
            <div className="flex items-center gap-2">
              <input
                type={showSecret ? 'text' : 'password'}
                value={webhook.secret}
                readOnly
                className="input flex-1 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(webhook.secret); toast.success('Copied!'); }}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">Use this secret to verify webhook signatures</p>
          </div>
        )}

        <div>
          <label className="label">Events to Subscribe</label>
          <div className="border rounded-lg p-4 space-y-4 max-h-64 overflow-y-auto">
            {eventCategories.map((category: any) => (
              <div key={category.category}>
                <div className="font-medium text-sm text-gray-700 mb-2">{category.category}</div>
                <div className="flex flex-wrap gap-2">
                  {category.events.map((event: string) => (
                    <label key={event} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.events.includes(event)}
                        onChange={() => toggleEvent(event)}
                        className="rounded"
                      />
                      <span className="text-sm">{event}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.isActive}
            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
            className="rounded"
          />
          <span className="text-sm">Active</span>
        </label>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={() => mutation.mutate(formData)} className="btn btn-primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save Webhook'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Automations Settings
function AutomationsSettings() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [selectedAutomation, setSelectedAutomation] = useState<any>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['automations'],
    queryFn: () => automationApi.listAutomations(),
  });

  const automations = data?.data?.data || [];

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      automationApi.updateAutomation(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automation updated');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => automationApi.deleteAutomation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast.success('Automation deleted');
    },
  });

  // Predefined automation templates
  const automationTemplates = [
    { name: 'Auto follow-up reminder', trigger: 'inquiry.created', description: 'Create task for follow-up after new inquiry' },
    { name: 'Quotation expiry alert', trigger: 'quotation.expiring', description: 'Notify when quotation is about to expire' },
    { name: 'Invoice overdue notification', trigger: 'invoice.overdue', description: 'Send reminder when invoice becomes overdue' },
    { name: 'Order confirmation email', trigger: 'order.created', description: 'Send confirmation email to buyer' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Automation Rules</h2>
          <p className="text-sm text-gray-500">Automate repetitive tasks and workflows</p>
        </div>
        <button onClick={() => { setSelectedAutomation(null); setShowModal(true); }} className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" /> New Automation
        </button>
      </div>

      {/* Quick Templates */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-3">Quick Setup Templates</h3>
        <div className="grid grid-cols-2 gap-2">
          {automationTemplates.map((template, idx) => (
            <button
              key={idx}
              onClick={() => setShowModal(true)}
              className="text-left p-3 bg-white rounded-lg border hover:border-blue-300 transition"
            >
              <div className="font-medium text-sm">{template.name}</div>
              <div className="text-xs text-gray-500">{template.description}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : automations.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No automations configured</p>
            <p className="text-sm mt-1">Use templates above or create custom rules</p>
          </div>
        ) : (
          <div className="divide-y">
            {automations.map((automation: any) => (
              <div key={automation.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleMutation.mutate({ id: automation.id, isActive: !automation.isActive })}
                    className={cn(
                      'w-10 h-6 rounded-full transition-colors',
                      automation.isActive ? 'bg-green-500' : 'bg-gray-300'
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 bg-white rounded-full shadow transition-transform',
                      automation.isActive ? 'translate-x-5' : 'translate-x-1'
                    )} />
                  </button>
                  <div>
                    <div className="font-medium">{automation.name}</div>
                    <div className="text-sm text-gray-500">
                      Trigger: <span className="font-mono">{automation.trigger}</span>
                      {automation.runCount > 0 && ` • Ran ${automation.runCount} times`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSelectedAutomation(automation); setShowModal(true); }}
                    className="p-2 text-gray-400 hover:text-gray-600"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(automation.id)}
                    className="p-2 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <Modal
          isOpen
          onClose={() => setShowModal(false)}
          title={selectedAutomation ? `Automation: ${selectedAutomation.name}` : 'New Automation Rule'}
          size="md"
        >
          <div className="p-6 text-center text-gray-500">
            <Zap className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="font-medium text-gray-700">Rule builder not available yet</p>
            <p className="text-sm mt-2">
              Triggers, conditions and actions are stored by the API, but the visual builder
              is still to come. Until then rules can be managed via the API.
            </p>
            <button onClick={() => setShowModal(false)} className="btn btn-primary mt-4">Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// API Keys Settings
function ApiKeysSettings() {
  const [showSecret, setShowSecret] = useState<string | null>(null);

  // Placeholder API keys
  const apiKeys = [
    { id: '1', name: 'Production API', key: 'sb_prod_xxxxx...xxxxx', created: '2024-01-15', lastUsed: '2024-02-20' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="text-sm text-gray-500">Manage API keys for external integrations</p>
        </div>
        <button className="btn btn-primary">
          <Plus className="w-4 h-4 mr-2" /> Generate New Key
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          <div>
            <h3 className="font-medium text-yellow-800">Security Notice</h3>
            <p className="text-sm text-yellow-700 mt-1">
              API keys provide full access to your account. Keep them secure and never share them publicly.
              Rotate keys periodically for better security.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        {apiKeys.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Key className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No API keys created</p>
          </div>
        ) : (
          <div className="divide-y">
            {apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{apiKey.name}</div>
                    <div className="text-sm font-mono text-gray-500 mt-1">
                      {showSecret === apiKey.id ? 'sb_prod_12345...abcdef' : apiKey.key}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Created: {apiKey.created} • Last used: {apiKey.lastUsed}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowSecret(showSecret === apiKey.id ? null : apiKey.id)}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      {showSecret === apiKey.id ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button className="p-2 text-gray-400 hover:text-gray-600">
                      <Copy className="w-4 h-4" />
                    </button>
                    <button className="p-2 text-gray-400 hover:text-red-600">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* API Documentation Link */}
      <div className="card">
        <div className="card-body">
          <h3 className="font-medium mb-2">API Documentation</h3>
          <p className="text-sm text-gray-500 mb-3">
            Learn how to integrate with SeaBridge ERP using our REST API.
          </p>
          <div className="flex gap-2">
            <button className="btn btn-secondary text-sm">View API Docs</button>
            <button className="btn btn-secondary text-sm">Download Postman Collection</button>
          </div>
        </div>
      </div>
    </div>
  );
}
