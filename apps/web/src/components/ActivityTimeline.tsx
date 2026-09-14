/**
 * Activity Timeline Component
 * 
 * Shows chronological activity history for an entity.
 * Used in BuyerDetail, OrderDetail, and InvoiceDetail pages.
 */
import { useQuery } from '@tanstack/react-query';
import { timelineApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import {
  Clock,
  User,
  FileText,
  Edit,
  Plus,
  Trash,
  CheckCircle,
  AlertTriangle,
  Package,
  Ship,
  IndianRupee,
  Loader2,
} from 'lucide-react';

interface TimelineEvent {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  user?: {
    id: string;
    name: string;
  };
  metadata?: Record<string, any>;
}

interface ActivityTimelineProps {
  entityType: 'buyer' | 'order' | 'invoice';
  entityId: string;
}

const ACTION_ICONS: Record<string, typeof Clock> = {
  CREATE: Plus,
  UPDATE: Edit,
  DELETE: Trash,
  STATUS_CHANGE: CheckCircle,
  PAYMENT: IndianRupee,
  SHIPMENT: Ship,
  PROCUREMENT: Package,
  PROCUREMENT_CREATED: Package,
  SHIPMENT_CREATED: Ship,
  INVOICE_CREATED: FileText,
  INQUIRY_CREATED: FileText,
  QUOTATION_CREATED: FileText,
  ORDER_CREATED: Package,
  DEFAULT: Clock,
};

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-600',
  UPDATE: 'bg-blue-100 text-blue-600',
  DELETE: 'bg-red-100 text-red-600',
  STATUS_CHANGE: 'bg-purple-100 text-purple-600',
  PAYMENT: 'bg-emerald-100 text-emerald-600',
  SHIPMENT: 'bg-orange-100 text-orange-600',
  PROCUREMENT: 'bg-cyan-100 text-cyan-600',
  PROCUREMENT_CREATED: 'bg-cyan-100 text-cyan-600',
  SHIPMENT_CREATED: 'bg-orange-100 text-orange-600',
  INVOICE_CREATED: 'bg-indigo-100 text-indigo-600',
  INQUIRY_CREATED: 'bg-amber-100 text-amber-600',
  QUOTATION_CREATED: 'bg-teal-100 text-teal-600',
  ORDER_CREATED: 'bg-violet-100 text-violet-600',
  DEFAULT: 'bg-gray-100 text-gray-600',
};

export function ActivityTimeline({ entityType, entityId }: ActivityTimelineProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['timeline', entityType, entityId],
    queryFn: async () => {
      switch (entityType) {
        case 'buyer':
          return timelineApi.buyer(entityId);
        case 'order':
          return timelineApi.order(entityId);
        case 'invoice':
          return timelineApi.invoice(entityId);
        default:
          throw new Error('Invalid entity type');
      }
    },
    enabled: !!entityId,
  });

  const events: TimelineEvent[] = data?.data?.data?.events || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading activity...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-gray-500">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">Could not load activity history</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <Clock className="w-8 h-8 mx-auto mb-2 text-gray-300" />
        <p className="text-sm">No activity recorded yet</p>
      </div>
    );
  }

  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {events.map((event, index) => {
          const Icon = ACTION_ICONS[event.action] || ACTION_ICONS.DEFAULT;
          const colorClass = ACTION_COLORS[event.action] || ACTION_COLORS.DEFAULT;
          const isLast = index === events.length - 1;

          return (
            <li key={event.id}>
              <div className="relative pb-8">
                {/* Connecting line */}
                {!isLast && (
                  <span
                    className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                    aria-hidden="true"
                  />
                )}

                <div className="relative flex items-start space-x-3">
                  {/* Icon */}
                  <div className={`relative px-1 flex h-8 w-8 items-center justify-center rounded-full ${colorClass}`}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900">
                      {event.description}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                      <span>{formatDate(event.timestamp, 'DD MMM YYYY, HH:mm')}</span>
                      {event.user && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {event.user.name}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
