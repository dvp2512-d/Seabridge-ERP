// Tasks - follow-ups attached to the export workflow
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { tasksApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Modal from '@/components/ui/Modal';
import { FormField, SelectField, TextareaField } from '@/components/ui/FormFields';
import { formatDate, isPastDue } from '@/lib/utils';
import { Plus, CheckSquare, AlertTriangle, Trash2, Edit, User as UserIcon } from 'lucide-react';

const PRIORITY_STYLES: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-700',
  MEDIUM: 'bg-blue-100 text-blue-800',
  HIGH: 'bg-amber-100 text-amber-800',
  URGENT: 'bg-red-100 text-red-800',
};

/**
 * Everyone can see and create tasks, but the list a user gets back is scoped by
 * their role on the server: founders and admins see the whole team, everyone else
 * sees what they created or were assigned. The banner makes that scoping visible
 * rather than leaving someone to wonder why a colleague's task is missing.
 */
export default function Tasks() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', status, priority, assigneeId, overdueOnly],
    queryFn: () =>
      tasksApi
        .list({
          status: status || undefined,
          priority: priority || undefined,
          assigneeId: assigneeId || undefined,
          overdue: overdueOnly ? 'true' : undefined,
        })
        .then((r) => r.data),
  });

  // Only privileged roles can list users, so this quietly yields nothing for
  // others and the assignee filter simply does not appear.
  const { data: usersData } = useQuery({
    queryKey: ['users-for-tasks'],
    queryFn: () => usersApi.list({ limit: 100 }).then((r) => r.data.data),
    retry: false,
  });
  const users = usersData ?? [];

  const tasks = data?.data ?? [];
  const summary = data?.summary;

  const update = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => tasksApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Could not update'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => {
      toast.success('Task deleted');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error: any) => toast.error(error.response?.data?.message || 'Could not delete'),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Tasks</h1>
          <p className="text-sm text-gray-500 mt-1">
            {summary?.scopedToSelf
              ? 'Showing tasks assigned to you or created by you.'
              : 'Showing tasks across the whole team.'}
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
          New Task
        </button>
      </div>

      {(summary?.overdueCount ?? 0) > 0 && !overdueOnly && (
        <button
          onClick={() => setOverdueOnly(true)}
          className="w-full flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200 text-left hover:bg-red-100"
        >
          <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
          <span className="text-sm text-red-800">
            <strong>
              {summary.overdueCount} {summary.overdueCount === 1 ? 'task is' : 'tasks are'} past due.
            </strong>{' '}
            Click to filter.
          </span>
        </button>
      )}

      <div className="card">
        <div className="card-body flex flex-wrap gap-3 items-end">
          <SelectField
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => ({
              value: s,
              label: s.replace('_', ' '),
            }))}
          />
          <SelectField
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            placeholder="All priorities"
            options={['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p }))}
          />
          {users.length > 0 && (
            <SelectField
              label="Assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              placeholder="Anyone"
              options={users.map((u: any) => ({
                value: u.id,
                label: `${u.firstName} ${u.lastName}`,
              }))}
            />
          )}
          {overdueOnly && (
            <button onClick={() => setOverdueOnly(false)} className="btn btn-secondary">
              Clear overdue filter
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : tasks.length === 0 ? (
            <div className="p-12 text-center">
              <CheckSquare className="w-10 h-10 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No tasks match these filters.</p>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Assignee</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t: any) => {
                  const overdue =
                    isPastDue(t.dueDate) && !['COMPLETED', 'CANCELLED'].includes(t.status);
                  return (
                    <tr key={t.id} className={overdue ? 'bg-red-50' : ''}>
                      <td>
                        <div className="font-medium">{t.title}</div>
                        {t.description && (
                          <div className="text-xs text-gray-500 max-w-[320px] truncate">
                            {t.description}
                          </div>
                        )}
                        {t.relatedType && (
                          <div className="text-xs text-gray-400 mt-0.5">
                            {t.relatedType.toLowerCase()}
                          </div>
                        )}
                      </td>
                      <td className="text-sm">
                        <span className="inline-flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-gray-400" />
                          {t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : '-'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            PRIORITY_STYLES[t.priority] ?? ''
                          }`}
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td className="text-sm">
                        {t.dueDate ? (
                          <span className={overdue ? 'text-red-700 font-medium' : ''}>
                            {formatDate(t.dueDate)}
                          </span>
                        ) : (
                          <span className="text-gray-400">no date</span>
                        )}
                      </td>
                      <td>
                        {/* Status is the field changed most often, so it is editable inline */}
                        <select
                          className="select text-xs py-1"
                          value={t.status}
                          onChange={(e) =>
                            update.mutate({ id: t.id, payload: { status: e.target.value } })
                          }
                          aria-label={`Status of ${t.title}`}
                        >
                          {['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => (
                            <option key={s} value={s}>
                              {s.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="text-right whitespace-nowrap">
                        <button
                          onClick={() => {
                            setEditing(t);
                            setShowForm(true);
                          }}
                          className="btn btn-ghost btn-sm"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        {/* The server also enforces this; hiding it avoids offering
                            an action that would be refused. */}
                        {(t.createdById === user?.id ||
                          user?.role === 'FOUNDER' ||
                          user?.role === 'ADMIN') && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${t.title}"?`)) remove.mutate(t.id);
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

      {showForm && (
        <TaskFormModal
          task={editing}
          users={users}
          currentUserId={user?.id}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
            setShowForm(false);
          }}
        />
      )}
    </div>
  );
}

function TaskFormModal({
  task,
  users,
  currentUserId,
  onClose,
  onSaved,
}: {
  task: any | null;
  users: any[];
  currentUserId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!task;

  const [form, setForm] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    // Default to self so a task can be created without picking an assignee
    assigneeId: task?.assigneeId ?? currentUserId ?? '',
    priority: task?.priority ?? 'MEDIUM',
    dueDate: task?.dueDate ? new Date(task.dueDate).toISOString().slice(0, 10) : '',
    notes: task?.notes ?? '',
  });

  const save = useMutation({
    mutationFn: (payload: any) =>
      isEdit ? tasksApi.update(task.id, payload) : tasksApi.create(payload),
    onSuccess: () => {
      toast.success(isEdit ? 'Task updated' : 'Task created');
      onSaved();
    },
    onError: (error: any) => {
      const errors = error.response?.data?.errors;
      toast.error(errors?.[0]?.message || error.response?.data?.message || 'Could not save');
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      toast.error('Enter a title');
      return;
    }
    if (!form.assigneeId) {
      toast.error('Choose who this is assigned to');
      return;
    }
    save.mutate({
      title: form.title,
      description: form.description || undefined,
      assigneeId: form.assigneeId,
      priority: form.priority,
      dueDate: form.dueDate || null,
      notes: form.notes || undefined,
    });
  };

  // When the user cannot list others, offer only themselves rather than an
  // empty dropdown that blocks submission.
  const assigneeOptions =
    users.length > 0
      ? users.map((u: any) => ({ value: u.id, label: `${u.firstName} ${u.lastName} (${u.role})` }))
      : currentUserId
      ? [{ value: currentUserId, label: 'Myself' }]
      : [];

  return (
    <Modal isOpen onClose={onClose} title={isEdit ? 'Edit Task' : 'New Task'} size="lg">
      <form onSubmit={submit} className="space-y-4">
        <FormField
          label="Title"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Chase Jebel Ali booking confirmation"
        />
        <TextareaField
          label="Description"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div className="grid grid-cols-3 gap-4">
          <SelectField
            label="Assignee"
            required
            value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
            options={assigneeOptions}
          />
          <SelectField
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => ({ value: p, label: p }))}
          />
          <FormField
            label="Due Date"
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            hint="Optional"
          />
        </div>
        <TextareaField
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
        />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
