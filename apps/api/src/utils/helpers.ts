import { prisma } from '@seabridge/database';

// Generate sequential codes like BYR-00001, INQ-00001, etc.
export async function generateCode(entityType: string, prefix: string): Promise<string> {
  const sequence = await prisma.numberSequence.upsert({
    where: { entityType },
    create: {
      entityType,
      prefix,
      currentNo: 1,
      padLength: 5,
    },
    update: {
      currentNo: { increment: 1 },
    },
  });

  const paddedNo = String(sequence.currentNo).padStart(sequence.padLength, '0');
  return `${sequence.prefix}-${paddedNo}`;
}

// Calculate margin percentage
export function calculateMarginPercent(cost: number, price: number): number {
  if (price === 0) return 0;
  return Number((((price - cost) / price) * 100).toFixed(2));
}
