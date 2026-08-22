/**
 * Deactivation of master data.
 *
 * Master data cannot be hard-deleted. Every foreign key pointing at products,
 * suppliers, buyers and the rest is ON DELETE RESTRICT, so a real delete throws a
 * database error the moment the record has been used - and a product used once is
 * exactly the product someone will try to tidy up.
 *
 * Deactivating instead keeps history intact: a product withdrawn today still
 * prints correctly on last year's invoice, while disappearing from the dropdowns
 * used to build new ones.
 *
 * Before deactivating, dependents are counted so the user is told what the record
 * is attached to rather than being left to guess.
 */
import { prisma } from '@seabridge/database';
import { AppError } from '../middleware/errorHandler';

export interface DependentCount {
  label: string;
  count: number;
}

/** What each master type is referenced by, and how to count it. */
const DEPENDENTS: Record<string, (id: string) => Promise<DependentCount[]>> = {
  product: async (id) => {
    const [quotationItems, orderItems, inquiryItems, supplierPrices] = await Promise.all([
      prisma.quotationItem.count({ where: { productId: id } }),
      prisma.orderItem.count({ where: { productId: id } }),
      prisma.inquiryItem.count({ where: { productId: id } }),
      prisma.supplierPrice.count({ where: { productId: id } }),
    ]);
    return [
      { label: 'quotation lines', count: quotationItems },
      { label: 'order lines', count: orderItems },
      { label: 'inquiry lines', count: inquiryItems },
      { label: 'supplier price lists', count: supplierPrices },
    ];
  },

  supplier: async (id) => {
    const [prices, procurements] = await Promise.all([
      prisma.supplierPrice.count({ where: { supplierId: id } }),
      prisma.procurement.count({ where: { supplierId: id } }),
    ]);
    return [
      { label: 'price list entries', count: prices },
      { label: 'procurements', count: procurements },
    ];
  },

  buyer: async (id) => {
    const [inquiries, quotations, orders, invoices] = await Promise.all([
      prisma.inquiry.count({ where: { buyerId: id } }),
      prisma.quotation.count({ where: { buyerId: id } }),
      prisma.exportOrder.count({ where: { buyerId: id } }),
      prisma.invoice.count({ where: { buyerId: id } }),
    ]);
    return [
      { label: 'inquiries', count: inquiries },
      { label: 'quotations', count: quotations },
      { label: 'orders', count: orders },
      { label: 'invoices', count: invoices },
    ];
  },

  cha: async (id) => {
    const [rates, shipments] = await Promise.all([
      prisma.cHARate.count({ where: { chaId: id } }),
      prisma.shipment.count({ where: { chaId: id } }),
    ]);
    return [
      { label: 'rate entries', count: rates },
      { label: 'shipments', count: shipments },
    ];
  },

  transporter: async (id) => {
    const [rates, shipments] = await Promise.all([
      prisma.transportRate.count({ where: { transporterId: id } }),
      prisma.shipment.count({ where: { transporterId: id } }),
    ]);
    return [
      { label: 'rate entries', count: rates },
      { label: 'shipments', count: shipments },
    ];
  },

  country: async (id) => {
    const [buyers, ports, suppliers] = await Promise.all([
      prisma.buyer.count({ where: { countryId: id } }),
      prisma.port.count({ where: { countryId: id } }),
      prisma.supplier.count({ where: { countryId: id } }),
    ]);
    return [
      { label: 'buyers', count: buyers },
      { label: 'ports', count: ports },
      { label: 'suppliers', count: suppliers },
    ];
  },

  port: async (id) => {
    const [loadingQuotes, dischargeQuotes, originShipments, destShipments] = await Promise.all([
      prisma.quotation.count({ where: { portOfLoadingId: id } }),
      prisma.quotation.count({ where: { portOfDischargeId: id } }),
      prisma.shipment.count({ where: { originPortId: id } }),
      prisma.shipment.count({ where: { destinationPortId: id } }),
    ]);
    return [
      { label: 'quotations as port of loading', count: loadingQuotes },
      { label: 'quotations as port of discharge', count: dischargeQuotes },
      { label: 'shipments as origin', count: originShipments },
      { label: 'shipments as destination', count: destShipments },
    ];
  },

  currency: async (id) => {
    const [quotations, invoices, buyers] = await Promise.all([
      prisma.quotation.count({ where: { currencyId: id } }),
      prisma.invoice.count({ where: { currencyId: id } }),
      prisma.buyer.count({ where: { currencyId: id } }),
    ]);
    return [
      { label: 'quotations', count: quotations },
      { label: 'invoices', count: invoices },
      { label: 'buyers', count: buyers },
    ];
  },

  incoterm: async (id) => {
    const [quotations, orders] = await Promise.all([
      prisma.quotation.count({ where: { incotermId: id } }),
      prisma.exportOrder.count({ where: { incotermId: id } }),
    ]);
    return [
      { label: 'quotations', count: quotations },
      { label: 'orders', count: orders },
    ];
  },

  productCategory: async (id) => {
    const products = await prisma.product.count({ where: { categoryId: id } });
    return [{ label: 'products', count: products }];
  },
};

/**
 * Count what references a record, dropping the zero rows so the caller can
 * present only what actually matters.
 */
export async function countDependents(type: string, id: string): Promise<DependentCount[]> {
  const counter = DEPENDENTS[type];
  if (!counter) return [];
  const counts = await counter(id);
  return counts.filter((c) => c.count > 0);
}

/** "4 quotation lines and 2 order lines" */
export function describeDependents(counts: DependentCount[]): string {
  const parts = counts.map((c) => `${c.count} ${c.label}`);
  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Guards that must hold before a record can be deactivated, beyond simple
 * reference counting.
 */
export async function assertCanDeactivate(type: string, id: string): Promise<void> {
  // Every converted total is expressed in the base currency (INR), so switching it off
  // would break the dashboard and every summary at once.
  if (type === 'currency') {
    const currency = await prisma.currency.findUnique({ where: { id } });
    if (currency?.code === 'INR') {
      throw new AppError(
        `${currency.code} is the base currency. Every converted total depends on it, so it cannot be deactivated.`,
        400
      );
    }
  }
}

/** Prisma delegates keyed by the type names used above. */
type Delegate = { findUnique: Function; update: Function };

function delegateFor(type: string): Delegate {
  const map: Record<string, Delegate> = {
    product: prisma.product as any,
    supplier: prisma.supplier as any,
    buyer: prisma.buyer as any,
    cha: prisma.cHA as any,
    transporter: prisma.transporter as any,
    country: prisma.country as any,
    port: prisma.port as any,
    currency: prisma.currency as any,
    incoterm: prisma.incoterm as any,
    productCategory: prisma.productCategory as any,
  };
  const delegate = map[type];
  if (!delegate) throw new AppError(`Unknown record type "${type}"`, 500);
  return delegate;
}

/**
 * Deactivate one master record.
 *
 * Returns what the record was attached to, so the UI can report "hidden from new
 * documents, still on 4 quotations" rather than a bare success message.
 */
export async function deactivateRecord(
  type: string,
  id: string,
  label: string
): Promise<{ id: string; dependents: DependentCount[]; message: string }> {
  const delegate = delegateFor(type);

  const existing = await delegate.findUnique({ where: { id } });
  if (!existing) throw new AppError(`${label} not found`, 404);

  if (existing.isActive === false) {
    throw new AppError(`This ${label.toLowerCase()} is already inactive`, 400);
  }

  await assertCanDeactivate(type, id);

  const dependents = await countDependents(type, id);

  await delegate.update({ where: { id }, data: { isActive: false } });

  return {
    id,
    dependents,
    message:
      dependents.length > 0
        ? `Deactivated. It stays on ${describeDependents(dependents)} and is hidden from new records.`
        : 'Deactivated and hidden from new records.',
  };
}

/** Switch a deactivated record back on. */
export async function reactivateRecord(
  type: string,
  id: string,
  label: string
): Promise<{ id: string; message: string }> {
  const delegate = delegateFor(type);

  const existing = await delegate.findUnique({ where: { id } });
  if (!existing) throw new AppError(`${label} not found`, 404);

  if (existing.isActive === true) {
    throw new AppError(`This ${label.toLowerCase()} is already active`, 400);
  }

  await delegate.update({ where: { id }, data: { isActive: true } });

  return { id, message: 'Reactivated and available again.' };
}

/**
 * Preview what deactivating would affect, without changing anything.
 *
 * Lets the confirmation dialog state the consequences before the user commits,
 * rather than reporting them afterwards.
 */
export async function previewDeactivation(
  type: string,
  id: string
): Promise<{ dependents: DependentCount[]; summary: string; blocked: string | null }> {
  let blocked: string | null = null;
  try {
    await assertCanDeactivate(type, id);
  } catch (error) {
    blocked = (error as AppError).message;
  }

  const dependents = await countDependents(type, id);
  return { dependents, summary: describeDependents(dependents), blocked };
}
