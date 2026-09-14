/**
 * Expenses generated from the records that create them.
 *
 * A supplier purchase order, and the freight, CHA and transport costs on a
 * shipment, are all money the business owes. They were previously typed into the
 * Expenses module a second time by hand, which meant the payables figure depended
 * on someone remembering, and the same cost could be entered twice.
 *
 * Filling in the source record now produces the expense. Four kinds are generated:
 *
 *   PROCUREMENT       -> the supplier's purchase order total
 *   SHIPMENT_FREIGHT  -> Shipment.freightCost
 *   SHIPMENT_CHA      -> Shipment.chaCharges
 *   SHIPMENT_TRANSPORT-> Shipment.transportCharges
 *
 * IDEMPOTENCE
 *   Every generated expense is keyed on (sourceType, sourceId), which carries a
 *   unique index. Saving a shipment three times updates one expense rather than
 *   creating three, and that is guaranteed by the database rather than by this
 *   file being careful.
 *
 * WHY AMOUNTS STOP TRACKING THE SOURCE ONCE PAID
 *   While nothing has been paid, editing the source updates the expense - a
 *   corrected freight cost should correct the payable. Once a payment exists the
 *   amount is left alone, because it has been reported in the dashboard's cash
 *   figures and reconciled against a bank statement. Silently rewriting it would
 *   change history. The mismatch is surfaced instead, on the expense's notes, for
 *   someone to resolve deliberately.
 *
 * WHY A ZERO OR CLEARED COST DELETES THE EXPENSE
 *   Clearing a freight cost means it was entered in error. An unpaid generated
 *   expense is therefore removed rather than left at zero, which would otherwise
 *   accumulate as noise in the payables list. One that has been paid is kept - the
 *   money left the account whatever the source record now says.
 */
import { prisma } from '@seabridge/database';
import { generateCode } from '../utils/helpers';

/** The kinds of record an expense can be generated from. */
export const EXPENSE_SOURCE_TYPES = [
  'MANUAL',
  'PROCUREMENT',
  'SHIPMENT_FREIGHT',
  'SHIPMENT_CHA',
  'SHIPMENT_TRANSPORT',
  'SHIPMENT_PACKAGING',
  'SHIPMENT_INSURANCE',
  'SHIPMENT_INSPECTION',
  'SHIPMENT_COMMISSION',
  'SHIPMENT_OTHER',
  'PAYMENT_FOREX_LOSS',
] as const;

export type ExpenseSourceType = (typeof EXPENSE_SOURCE_TYPES)[number];

/** Expense category each source maps to, so the Expenses filters stay meaningful. */
const SOURCE_CATEGORY: Record<Exclude<ExpenseSourceType, 'MANUAL'>, string> = {
  PROCUREMENT: 'SUPPLIER_PAYMENT',
  SHIPMENT_FREIGHT: 'FREIGHT',
  SHIPMENT_CHA: 'CHA',
  SHIPMENT_TRANSPORT: 'TRANSPORT',
  SHIPMENT_PACKAGING: 'PACKAGING',
  SHIPMENT_INSURANCE: 'INSURANCE',
  SHIPMENT_INSPECTION: 'INSPECTION',
  SHIPMENT_COMMISSION: 'COMMISSION',
  SHIPMENT_OTHER: 'OTHER',
  PAYMENT_FOREX_LOSS: 'FOREX_LOSS',
};

function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

interface SyncInput {
  sourceType: Exclude<ExpenseSourceType, 'MANUAL'>;
  sourceId: string;
  /** INR. Null or zero removes an unpaid generated expense. */
  amount: number | null;
  description: string;
  vendorName: string | null;
  /** The source document's own reference - a PO or shipment number. */
  invoiceRef: string | null;
  expenseDate: Date;
}

export interface SyncResult {
  action: 'created' | 'updated' | 'deleted' | 'locked' | 'unchanged';
  expenseId?: string;
  /** Set when the source changed but the expense was locked by a payment. */
  conflict?: string;
}

/**
 * Create, update or remove the one expense belonging to a source record.
 *
 * Never throws for business reasons: this runs inside the request that saved a
 * shipment or a procurement, and failing to mirror a cost must not fail the save
 * that the operator actually asked for. Problems are returned for the caller to
 * report or log.
 */
async function syncOne(input: SyncInput): Promise<SyncResult> {
  const { sourceType, sourceId } = input;
  const amount = input.amount === null ? null : round2(input.amount);

  // Try to find existing expense by source. If the sourceType/sourceId columns don't
  // exist (pre-migration database), fall back to not finding anything - which will
  // cause a create attempt that will fail with a clear schema error.
  let existing: { id: string; amount: unknown; paidAmount: unknown; status: string } | null = null;
  try {
    existing = await prisma.expense.findUnique({
      where: { sourceType_sourceId: { sourceType, sourceId } },
      select: { id: true, amount: true, paidAmount: true, status: true },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // If the column doesn't exist, we're on an old schema. Let the caller handle it.
    if (msg.includes('P2022') || msg.includes('column') || msg.includes('does not exist')) {
      throw new Error(
        'Database schema is out of date. The expense sync feature requires columns from recent migrations. ' +
        'Please run: npm run db:deploy (or redeploy with deploy.cmd)'
      );
    }
    throw err;
  }

  // Nothing to record: remove a stale unpaid expense, keep a paid one.
  if (amount === null || amount <= 0) {
    if (!existing) return { action: 'unchanged' };
    if (Number(existing.paidAmount) > 0) {
      return {
        action: 'locked',
        expenseId: existing.id,
        conflict: 'the cost was cleared on the source record but the expense is part paid',
      };
    }
    await prisma.expense.delete({ where: { id: existing.id } });
    return { action: 'deleted', expenseId: existing.id };
  }

  if (!existing) {
    const expenseNumber = await generateCode('EXPENSE', 'EXP');
    const created = await prisma.expense.create({
      data: {
        expenseNumber,
        category: SOURCE_CATEGORY[sourceType],
        description: input.description,
        amount,
        expenseDate: input.expenseDate,
        vendorName: input.vendorName,
        invoiceRef: input.invoiceRef,
        // PENDING, not APPROVED: the cost is known, but approving it to be paid is
        // a separate decision that finance makes.
        status: 'PENDING',
        sourceType,
        sourceId,
        isGenerated: true,
        paidAmount: 0,
        balanceAmount: amount,
      },
      select: { id: true },
    });
    return { action: 'created', expenseId: created.id };
  }

  const paid = Number(existing.paidAmount);

  // Already paid against: the amount is history now. Report rather than rewrite.
  if (paid > 0 && Number(existing.amount) !== amount) {
    await prisma.expense.update({
      where: { id: existing.id },
      data: {
        notes:
          `Source record now shows ${amount.toFixed(2)}; this expense was raised at ` +
          `${Number(existing.amount).toFixed(2)} and has ${paid.toFixed(2)} paid against it. ` +
          'Resolve manually.',
      },
    });
    return {
      action: 'locked',
      expenseId: existing.id,
      conflict: `amount changed to ${amount.toFixed(2)} but ${paid.toFixed(2)} is already paid`,
    };
  }

  if (Number(existing.amount) === amount) {
    // Descriptive fields may still have moved - a shipment gaining a vessel name.
    await prisma.expense.update({
      where: { id: existing.id },
      data: {
        description: input.description,
        vendorName: input.vendorName,
        invoiceRef: input.invoiceRef,
      },
    });
    return { action: 'unchanged', expenseId: existing.id };
  }

  await prisma.expense.update({
    where: { id: existing.id },
    data: {
      amount,
      balanceAmount: round2(amount - paid),
      description: input.description,
      vendorName: input.vendorName,
      invoiceRef: input.invoiceRef,
      expenseDate: input.expenseDate,
    },
  });
  return { action: 'updated', expenseId: existing.id };
}

/**
 * Mirror a supplier purchase order into an expense.
 *
 * Raised as soon as the procurement exists, because ordering from a supplier is
 * what creates the obligation - waiting for delivery would leave a committed spend
 * invisible in the payables figure.
 *
 * Dated from the order date rather than today, so the expense falls in the period
 * the commitment was made.
 */
export async function syncProcurementExpense(procurementId: string): Promise<SyncResult> {
  const procurement = await prisma.procurement.findUnique({
    where: { id: procurementId },
    select: {
      id: true,
      poNumber: true,
      totalAmount: true,
      orderDate: true,
      createdAt: true,
      supplier: { select: { name: true } },
      order: { select: { orderNumber: true } },
    },
  });

  if (!procurement) return { action: 'unchanged' };

  const reference = procurement.poNumber || 'draft PO';
  const forOrder = procurement.order ? ` for order ${procurement.order.orderNumber}` : '';

  return syncOne({
    sourceType: 'PROCUREMENT',
    sourceId: procurement.id,
    amount: Number(procurement.totalAmount ?? 0),
    description: `Supplier payment - ${procurement.supplier?.name ?? 'supplier'} (${reference})${forOrder}`,
    vendorName: procurement.supplier?.name ?? null,
    invoiceRef: procurement.poNumber,
    expenseDate: procurement.orderDate ?? procurement.createdAt,
  });
}

/**
 * Mirror a shipment's costs into expenses.
 *
 * Separate expenses for each cost type, because they are owed to different
 * parties and paid separately. A combined figure could never be marked
 * paid correctly.
 */
export async function syncShipmentExpenses(shipmentId: string): Promise<SyncResult[]> {
  // Query only the core fields first; the additional cost fields may not exist
  // in databases that haven't run the 20260912190000 migration yet.
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true,
      shipmentNumber: true,
      freightCost: true,
      chaCharges: true,
      transportCharges: true,
      etd: true,
      createdAt: true,
      cha: { select: { name: true } },
      transporter: { select: { name: true } },
      order: { select: { orderNumber: true } },
    },
  });

  if (!shipment) return [];

  // Try to fetch additional cost fields if they exist. These were added in a later
  // migration, so older databases may not have them. We do a raw query to check.
  let additionalCosts: {
    packagingCharges: number | null;
    insuranceCharges: number | null;
    inspectionCharges: number | null;
    commissionCharges: number | null;
    otherCharges: number | null;
  } = {
    packagingCharges: null,
    insuranceCharges: null,
    inspectionCharges: null,
    commissionCharges: null,
    otherCharges: null,
  };

  try {
    const extra = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        packagingCharges: true,
        insuranceCharges: true,
        inspectionCharges: true,
        commissionCharges: true,
        otherCharges: true,
      },
    });
    if (extra) {
      additionalCosts = {
        packagingCharges: extra.packagingCharges === null ? null : Number(extra.packagingCharges),
        insuranceCharges: extra.insuranceCharges === null ? null : Number(extra.insuranceCharges),
        inspectionCharges: extra.inspectionCharges === null ? null : Number(extra.inspectionCharges),
        commissionCharges: extra.commissionCharges === null ? null : Number(extra.commissionCharges),
        otherCharges: extra.otherCharges === null ? null : Number(extra.otherCharges),
      };
    }
  } catch {
    // Columns don't exist yet - that's fine, we'll just skip these cost types
  }

  const forOrder = shipment.order ? ` for order ${shipment.order.orderNumber}` : '';
  // The shipment's departure is when these costs belong to; falls back to when the
  // record was created if no ETD has been set yet.
  const date = shipment.etd ?? shipment.createdAt;
  const ref = shipment.shipmentNumber;

  const results: SyncResult[] = [];

  // Freight cost
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_FREIGHT',
      sourceId: shipment.id,
      amount: shipment.freightCost === null ? null : Number(shipment.freightCost),
      description: `Ocean/air freight - shipment ${ref}${forOrder}`,
      vendorName: shipment.transporter?.name ?? null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // CHA charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_CHA',
      sourceId: shipment.id,
      amount: shipment.chaCharges === null ? null : Number(shipment.chaCharges),
      description: `CHA charges - ${shipment.cha?.name ?? 'clearing agent'} - shipment ${ref}${forOrder}`,
      vendorName: shipment.cha?.name ?? null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Transport charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_TRANSPORT',
      sourceId: shipment.id,
      amount: shipment.transportCharges === null ? null : Number(shipment.transportCharges),
      description: `Inland transport - ${shipment.transporter?.name ?? 'transporter'} - shipment ${ref}${forOrder}`,
      vendorName: shipment.transporter?.name ?? null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Packaging charges (may not exist in older databases)
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_PACKAGING',
      sourceId: shipment.id,
      amount: additionalCosts.packagingCharges,
      description: `Packaging charges - shipment ${ref}${forOrder}`,
      vendorName: null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Insurance charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_INSURANCE',
      sourceId: shipment.id,
      amount: additionalCosts.insuranceCharges,
      description: `Insurance charges - shipment ${ref}${forOrder}`,
      vendorName: null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Inspection charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_INSPECTION',
      sourceId: shipment.id,
      amount: additionalCosts.inspectionCharges,
      description: `Inspection charges - shipment ${ref}${forOrder}`,
      vendorName: null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Commission charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_COMMISSION',
      sourceId: shipment.id,
      amount: additionalCosts.commissionCharges,
      description: `Commission charges - shipment ${ref}${forOrder}`,
      vendorName: null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  // Other charges
  results.push(
    await syncOne({
      sourceType: 'SHIPMENT_OTHER',
      sourceId: shipment.id,
      amount: additionalCosts.otherCharges,
      description: `Other charges - shipment ${ref}${forOrder}`,
      vendorName: null,
      invoiceRef: ref,
      expenseDate: date,
    })
  );

  return results;
}

/**
 * Recalculate an expense's paid amount, balance and status from its payments.
 *
 * Status is derived rather than set, so it cannot disagree with the payments: fully
 * paid is PAID, part paid is APPROVED with a balance, nothing paid returns to
 * PENDING unless it was explicitly approved or rejected.
 *
 * Runs inside the caller's transaction when one is supplied, so recording a
 * payment and updating the totals cannot half-succeed.
 */
export async function recalculateExpensePayment(
  expenseId: string,
  tx: { expense: any; expensePayment: any } = prisma
): Promise<void> {
  const [expense, aggregate] = await Promise.all([
    tx.expense.findUnique({
      where: { id: expenseId },
      select: { amount: true, status: true },
    }),
    tx.expensePayment.aggregate({
      where: { expenseId },
      _sum: { amount: true },
    }),
  ]);

  if (!expense) return;

  const amount = Number(expense.amount);
  const paid = round2(Number(aggregate._sum.amount ?? 0));
  const balance = round2(amount - paid);

  let status = expense.status;
  if (paid <= 0) {
    // Back to unpaid. A rejected expense stays rejected; an approved one stays
    // approved, since approval is a decision that reversing a payment does not undo.
    if (status === 'PAID') status = 'APPROVED';
  } else if (balance <= 0) {
    status = 'PAID';
  } else {
    // Part paid. Paying anything at all implies it was approved.
    status = 'APPROVED';
  }

  await tx.expense.update({
    where: { id: expenseId },
    data: { paidAmount: paid, balanceAmount: balance, status },
  });
}
