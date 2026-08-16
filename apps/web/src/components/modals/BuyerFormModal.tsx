import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { buyersApi, masterApi } from '@/lib/api';

const buyerSchema = z.object({
  companyName: z.string().min(1, 'Company name is required'),
  tradeName: z.string().optional(),
  countryId: z.string().min(1, 'Country is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  status: z.string().optional(),
  source: z.string().optional(),
  currencyId: z.string().optional(),
  paymentTerms: z.string().optional(),
  creditLimit: z.number().optional(),
  creditDays: z.number().optional(),
  taxId: z.string().optional(),
  notes: z.string().optional(),
});

type BuyerForm = z.infer<typeof buyerSchema>;

interface Props {
  buyer?: any;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BuyerFormModal({ buyer, onClose, onSuccess }: Props) {
  const { data: dropdowns } = useQuery({
    queryKey: ['dropdowns'],
    queryFn: () => masterApi.getDropdowns(),
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BuyerForm>({
    resolver: zodResolver(buyerSchema),
    defaultValues: buyer || {},
  });

  const mutation = useMutation({
    mutationFn: (data: BuyerForm) =>
      buyer ? buyersApi.update(buyer.id, data) : buyersApi.create(data),
    onSuccess: () => {
      toast.success(buyer ? 'Buyer updated' : 'Buyer created');
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to save buyer');
    },
  });

  const onSubmit = (data: BuyerForm) => {
    mutation.mutate(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-gray-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {buyer ? 'Edit Buyer' : 'Add New Buyer'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-6">
          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Company Name *</label>
              <input type="text" className="input" {...register('companyName')} />
              {errors.companyName && (
                <p className="mt-1 text-sm text-red-600">{errors.companyName.message}</p>
              )}
            </div>

            <div>
              <label className="label">Trade Name</label>
              <input type="text" className="input" {...register('tradeName')} />
            </div>

            <div>
              <label className="label">Country *</label>
              <select className="select" {...register('countryId')}>
                <option value="">Select Country</option>
                {dropdowns?.data?.data?.countries?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.countryId && (
                <p className="mt-1 text-sm text-red-600">{errors.countryId.message}</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className="label">Address</label>
              <input type="text" className="input" {...register('address')} />
            </div>

            <div>
              <label className="label">City</label>
              <input type="text" className="input" {...register('city')} />
            </div>

            <div>
              <label className="label">State</label>
              <input type="text" className="input" {...register('state')} />
            </div>

            <div>
              <label className="label">Website</label>
              <input type="text" className="input" {...register('website')} />
            </div>

            <div>
              <label className="label">Industry</label>
              <input type="text" className="input" {...register('industry')} />
            </div>

            <div>
              <label className="label">Status</label>
              <select className="select" {...register('status')}>
                {dropdowns?.data?.data?.buyerStatuses?.map((s: string) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Source</label>
              <input type="text" className="input" placeholder="EXHIBITION, REFERRAL, etc." {...register('source')} />
            </div>

            <div>
              <label className="label">Currency</label>
              <select className="select" {...register('currencyId')}>
                <option value="">Select Currency</option>
                {dropdowns?.data?.data?.currencies?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.code} ({c.symbol})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Payment Terms</label>
              <input type="text" className="input" placeholder="e.g., Net 30" {...register('paymentTerms')} />
            </div>

            <div>
              <label className="label">Tax ID</label>
              <input type="text" className="input" {...register('taxId')} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input" rows={3} {...register('notes')} />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving...' : buyer ? 'Update Buyer' : 'Create Buyer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
