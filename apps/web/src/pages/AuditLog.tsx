// Audit Log Viewer - Track all changes made in the system
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { SelectField } from '@/components/ui/FormFields';
import Modal from '@/components/ui/Modal';
import {
  History,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
} from 'lucide-react';

const ACTION_ICONS: Record<string, any> = {
  CREATE: Plus,
  UPDATE: Pencil,
  DELETE: Trash2,
  PERMANENT_DELETE: Trash2,
  DEACTIVATE: RefreshCw,
  REACTIVATE: RefreshCw,
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'text-green-600 bg-green-50',
  UPDATE: 'text-blue-600 bg-blue-50',
  DELETE: 'text-red-600 bg-red-50',
  PERMANENT_DELETE: 'text-red-700 bg-red-100',
  DEACTIVATE: 'text-amber-600 bg-amber-50',
  REACTIVATE: 'text-emerald-600 bg-emerald-50',
};

export default function AuditLog() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    entityType: '',
    action: '',
    userId: '',
    search: '',
  });
  const [selectedEntry, setSelectedEntry] = useState<any>(null);

  // Fetch audit log entries
  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', page, filters],
    queryFn: () =>
      auditApi
        .list({
          page,
          limit: 25,
          ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        })
        .then((r: any) => r.data.data),
  });

  // Fetch filter options
  const { data: options } = useQuery({
    queryKey: ['audit-options'],
    queryFn: () => auditApi.options().then((r: any) => r.data.data),
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['audit-stats'],
    queryFn: () => auditApi.stats().then((r: any) => r.data.data),
  });

  const entries = data?.entries ?? [];
  const pagination = data?.pagination ?? { page: 1, totalPages: 1, total: 0 };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters({ entityType: '', action: '', userId: '', search: '' });
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <History className="w-7 h-7" />
            Audit Log
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Track all changes made in the system - who did what, when.
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <div className="text-sm text-gray-500">Today</div>
            <div className="text-2xl font-bold text-navy-900">{stats.todayCount}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-gray-500">This Week</div>
            <div className="text-2xl font-bold text-navy-900">{stats.weekCount}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-gray-500">Total Records</div>
            <div className="text-2xl font-bold text-navy-900">{stats.totalCount}</div>
          </div>
          <div className="card p-4">
            <div className="text-sm text-gray-500">Top Action</div>
            <div className="text-2xl font-bold text-navy-900">
              {stats.actionBreakdown?.[0]?.action || '-'}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="card-body">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="font-medium">Filters</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                className="input pl-9"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
              />
            </div>
            <SelectField
              label=""
              value={filters.entityType}
              onChange={(e) => handleFilterChange('entityType', e.target.value)}
              options={[
                { value: '', label: 'All Entity Types' },
                ...(options?.entityTypes?.map((t: string) => ({ value: t, label: t })) ?? []),
              ]}
            />
            <SelectField
              label=""
              value={filters.action}
              onChange={(e) => handleFilterChange('action', e.target.value)}
              options={[
                { value: '', label: 'All Actions' },
                ...(options?.actions?.map((a: string) => ({ value: a, label: a })) ?? []),
              ]}
            />
            <SelectField
              label=""
              value={filters.userId}
              onChange={(e) => handleFilterChange('userId', e.target.value)}
              options={[
                { value: '', label: 'All Users' },
                ...(options?.users?.map((u: any) => ({ value: u.id, label: u.name })) ?? []),
              ]}
            />
            <button onClick={clearFilters} className="btn btn-secondary">
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="font-semibold">
            Activity Log ({pagination.total} entries)
          </h2>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
              No audit entries found
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Description</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry: any) => {
                  const ActionIcon = ACTION_ICONS[entry.action] || FileText;
                  const actionColor = ACTION_COLORS[entry.action] || 'text-gray-600 bg-gray-50';
                  
                  return (
                    <tr key={entry.id}>
                      <td className="text-sm whitespace-nowrap">
                        {formatDate(entry.createdAt)}
                        <div className="text-xs text-gray-400">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </div>
                      </td>
                      <td>
                        <span className="font-medium">{entry.user?.name || 'System'}</span>
                        {entry.user?.email && (
                          <div className="text-xs text-gray-500">{entry.user.email}</div>
                        )}
                      </td>
                      <td>
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${actionColor}`}>
                          <ActionIcon className="w-3 h-3" />
                          {entry.action}
                        </span>
                      </td>
                      <td>
                        <span className="font-medium">{entry.entityType}</span>
                        <div className="text-xs text-gray-500 font-mono">{entry.entityId}</div>
                      </td>
                      <td className="text-sm max-w-xs truncate" title={entry.description}>
                        {entry.description || '-'}
                      </td>
                      <td>
                        <button
                          onClick={() => setSelectedEntry(entry)}
                          className="btn btn-ghost btn-sm"
                          title="View Details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="card-footer flex items-center justify-between">
            <div className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary btn-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary btn-sm"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Entry Detail Modal */}
      {selectedEntry && (
        <Modal
          isOpen
          onClose={() => setSelectedEntry(null)}
          title="Audit Entry Details"
          size="lg"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-500">Timestamp</label>
                <div className="font-medium">
                  {new Date(selectedEntry.createdAt).toLocaleString()}
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-500">User</label>
                <div className="font-medium">
                  {selectedEntry.user?.name || 'System'}
                  {selectedEntry.user?.email && (
                    <span className="text-gray-500 ml-2">({selectedEntry.user.email})</span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Action</label>
                <div className="font-medium">{selectedEntry.action}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">Entity</label>
                <div className="font-medium">
                  {selectedEntry.entityType}
                  <span className="text-gray-500 ml-2 font-mono text-sm">
                    ({selectedEntry.entityId})
                  </span>
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-sm text-gray-500">Description</label>
                <div className="font-medium">{selectedEntry.description || '-'}</div>
              </div>
              <div>
                <label className="text-sm text-gray-500">IP Address</label>
                <div className="font-mono text-sm">{selectedEntry.ipAddress || '-'}</div>
              </div>
            </div>

            {selectedEntry.changes && Object.keys(selectedEntry.changes).length > 0 && (
              <div>
                <label className="text-sm text-gray-500 block mb-2">Changes</label>
                <pre className="bg-gray-50 p-4 rounded-lg text-xs overflow-x-auto max-h-64">
                  {JSON.stringify(selectedEntry.changes, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex justify-end pt-4">
              <button onClick={() => setSelectedEntry(null)} className="btn btn-secondary">
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
