// Users - team accounts and role assignment
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField } from '@/components/ui/FormFields';
import { formatDateTime, getInitials } from '@/lib/utils';
import { Plus, Users as UsersIcon, ShieldAlert, Edit, Trash2 } from 'lucide-react';

/** What each role can reach, so the choice is an informed one. */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  FOUNDER: 'Everything, including settings, users and the full dashboard',
  ADMIN: 'Everything except founder-only dashboards',
  SALES: 'Buyers, inquiries, quotations and their own dashboard',
  OPERATIONS: 'Orders, shipments, documents and packing',
  FINANCE: 'Invoices, payments, expenses and finance reporting',
};

const ROLE_STYLES: Record<string, string> = {
  FOUNDER: 'bg-navy-100 text-navy-800',
  ADMIN: 'bg-purple-100 text-purple-800',
  SALES: 'bg-blue-100 text-blue-800',
  OPERATIONS: 'bg-amber-100 text-amber-800',
  FINANCE: 'bg-green-100 text-green-800',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-800',
};

/**
 * Until now accounts could only be created by seeding the database. This screen
 * is restricted to founders and admins, and deliberately prevents a few things
 * that would lock everyone out: you cannot change your own role, and you cannot
 * deactivate or delete your own account.
 */
export default function Users() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list({ limit: 200 }).then((r) => r.data),
    retry: false,
  });

  const users = data?.data ?? [];

  const remove = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      toast.success('User removed');
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'Could not remove user'),
  });

  // A non-privileged role reaching this page gets a clear explanation rather
  // than an empty table.
  if ((error as any)?.response?.status === 403) {
    return (
      <div className="card">
        <div className="card-body flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-gray-700">
            <strong>Not available for your role.</strong> Only founders and admins can manage user
            accounts.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">
            Team accounts and what each role can reach.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="btn btn-primary"
        >
          <Plus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : users.length === 0 ? (
            <div className="p-12 text-center">
              <UsersIcon className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No users found.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u: any) => {
                  const isSelf = u.id === currentUser?.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="w-8 h-8 rounded-full bg-navy-100 text-navy-800 text-xs font-semibold flex items-center justify-center">
                            {getInitials(u.firstName, u.lastName)}
                          </span>
                          <span className="font-medium">
                            {u.firstName} {u.lastName}
                            {isSelf && <span className="text-xs text-gray-400 ml-1">(you)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="text-sm text-gray-600">{u.email}</td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            ROLE_STYLES[u.role] ?? 'bg-gray-100'
                          }`}
                          title={ROLE_DESCRIPTIONS[u.role]}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            STATUS_STYLES[u.status] ?? 'bg-gray-100'
                          }`}
                        >
                          {u.status}
                        </span>
                      </td>
                      <td className="text-sm text-gray-500">
                        {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'never'}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          onClick={() => {
                            setEditing(u);
                            setShowForm(true);
                          }}
                          className="btn btn-ghost btn-sm"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {/* Removing your own account would lock you out mid-session */}
                        {!isSelf && (
                          <button
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove ${u.firstName} ${u.lastName}? Their tasks and audit history remain.`
                                )
                              ) {
                                remove.mutate(u.id);
                              }
                            }}
                            className="btn btn-ghost btn-sm text-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold">What each role can reach</h2>
        </div>
        <div className="card-body space-y-2">
          {Object.entries(ROLE_DESCRIPTIONS).map(([role, description]) => (
            <div key={role} className="flex items-start gap-3 text-sm">
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                  ROLE_STYLES[role]
                }`}
              >
                {role}
              </span>
              <span className="text-gray-600">{description}</span>
            </div>
          ))}
        </div>
      </div>

      {showForm && (
        <UserFormModal
          user={editing}
          isSelf={editing?.id === currentUser?.id}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function UserFormModal({
  user,
  isSelf,
  onClose,
  onSaved,
}: {
  user: any | null;
  isSelf: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!user;

  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    password: '',
    role: user?.role ?? 'SALES',
    status: user?.status ?? 'ACTIVE',
    phone: user?.phone ?? '',
  });

  const save = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? usersApi.update(user.id, payload) : usersApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'User updated' : 'User created');
      onSaved();
    },
    onError: (error: any) => {
      const errors = error.response?.data?.errors;
      toast.error(errors?.[0]?.message || error.response?.data?.message || 'Could not save');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('Enter a first and last name');
      return;
    }
    if (!form.email.trim()) {
      toast.error('Enter an email address');
      return;
    }
    // A weak password on an account that can see every buyer and price is not
    // worth saving.
    if (!isEdit && form.password.length < 8) {
      toast.error('Set a password of at least 8 characters');
      return;
    }

    const payload: any = {
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      role: form.role,
      phone: form.phone || undefined,
    };
    if (!isEdit) payload.password = form.password;
    if (isEdit) payload.status = form.status;
    // Changing your own role or status could remove your own access mid-session
    if (isSelf) {
      delete payload.role;
      delete payload.status;
    }

    save.mutate(payload);
  };

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit User' : 'Add User'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        {isSelf && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 text-blue-800 text-sm">
            <ShieldAlert className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              This is your own account, so role and status are locked. Another founder or admin can
              change them.
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <FormField
            label="First Name"
            required
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <FormField
            label="Last Name"
            required
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <div className="col-span-2">
            <FormField
              label="Email"
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              hint="Used to sign in"
            />
          </div>
          {!isEdit && (
            <div className="col-span-2">
              <FormField
                label="Password"
                required
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                hint="At least 8 characters. Ask the user to change it after first sign-in."
              />
            </div>
          )}
          <SelectField
            label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            disabled={isSelf}
            options={Object.keys(ROLE_DESCRIPTIONS).map((r) => ({ value: r, label: r }))}
            hint={ROLE_DESCRIPTIONS[form.role]}
          />
          {isEdit && (
            <SelectField
              label="Status"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              disabled={isSelf}
              options={['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((s) => ({ value: s, label: s }))}
              hint="Inactive and suspended users cannot sign in"
            />
          )}
          <FormField
            label="Phone"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
