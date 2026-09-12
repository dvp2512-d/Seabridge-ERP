/**
 * Verify business logic calculations without a database.
 *
 * Tests the pure functions that handle currency conversion, date periods, and
 * margin calculations. These are the figures that appear on documents and reports,
 * so a mistake here shows up everywhere.
 *
 * Run: npm run verify:logic
 */

// ─── Imports ────────────────────────────────────────────────────────────────

import { calculateInclusiveUnitPrices } from '../apps/api/src/services/inclusivePricing';
import {
  startOfFinancialYear,
  startOfMonth,
  financialYearLabel,
} from '../apps/api/src/utils/period';
import { calculateMarginPercent } from '../apps/api/src/utils/helpers';
import { toDocumentCurrency } from '../apps/api/src/services/exchangeRateService';

// ─── Test Utilities ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${(error as Error).message}`);
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toBeCloseTo(expected: number, decimals = 2) {
      const factor = Math.pow(10, decimals);
      const actualRounded = Math.round(actual * factor) / factor;
      const expectedRounded = Math.round(expected * factor) / factor;
      if (actualRounded !== expectedRounded) {
        throw new Error(`Expected ~${expected}, got ${actual}`);
      }
    },
    toBeTruthy() {
      if (!actual) {
        throw new Error(`Expected truthy value, got ${actual}`);
      }
    },
    toBeFalsy() {
      if (actual) {
        throw new Error(`Expected falsy value, got ${actual}`);
      }
    },
  };
}

// ─── Currency Conversion Tests ──────────────────────────────────────────────

console.log('\nCurrency Conversion (toDocumentCurrency):');

test('converts INR to USD at given rate', () => {
  // 84,500 INR at rate of 84.50 INR/USD = 1,000 USD
  const result = toDocumentCurrency(84500, 84.5);
  expect(result).toBe(1000);
});

test('converts INR to EUR at given rate', () => {
  // 92,300 INR at rate of 92.30 INR/EUR = 1,000 EUR
  const result = toDocumentCurrency(92300, 92.3);
  expect(result).toBe(1000);
});

test('handles rate of 1 (INR to INR)', () => {
  const result = toDocumentCurrency(50000, 1);
  expect(result).toBe(50000);
});

test('returns 0 for invalid rate (zero)', () => {
  const result = toDocumentCurrency(50000, 0);
  expect(result).toBe(0);
});

test('returns 0 for invalid rate (negative)', () => {
  const result = toDocumentCurrency(50000, -84.5);
  expect(result).toBe(0);
});

test('handles fractional results correctly', () => {
  // 100,000 INR at 83.45 = 1198.32... USD
  const result = toDocumentCurrency(100000, 83.45);
  expect(result).toBeCloseTo(1198.32, 2);
});

// ─── Inclusive Pricing Tests ────────────────────────────────────────────────

console.log('\nInclusive Pricing (calculateInclusiveUnitPrices):');

test('spreads costs evenly across units', () => {
  const items = [
    { quantity: 100, unitPrice: 200 },
    { quantity: 200, unitPrice: 150 },
  ];
  const additionalCosts = 3000; // 3000 / 300 units = 10 per unit

  const result = calculateInclusiveUnitPrices(items, additionalCosts);

  // Item 1: 200 + 10 = 210, 100 x 210 = 21,000
  // Item 2: 150 + 10 = 160, 200 x 160 = 32,000
  // Total: 53,000
  expect(result.perUnitCost).toBe(10);
  expect(result.lines[0].unitPrice).toBe(210);
  expect(result.lines[1].unitPrice).toBe(160);
  expect(result.total).toBe(53000);
  expect(result.reconciled).toBeTruthy();
});

test('handles zero additional costs', () => {
  const items = [
    { quantity: 50, unitPrice: 100 },
  ];

  const result = calculateInclusiveUnitPrices(items, 0);

  expect(result.perUnitCost).toBe(0);
  expect(result.lines[0].unitPrice).toBe(100);
  expect(result.total).toBe(5000);
  expect(result.reconciled).toBeTruthy();
});

test('handles empty items array', () => {
  const result = calculateInclusiveUnitPrices([], 1000);

  expect(result.total).toBe(0);
  expect(result.lines.length).toBe(0);
});

test('increases precision when needed to reconcile', () => {
  // 40 cost over 3 units = 13.333... per unit
  // At 2 decimals: 13.33 x 3 = 39.99 (off by 0.01)
  // At 3 decimals: 13.333 x 3 = 39.999 ≈ 40.00
  const items = [
    { quantity: 1, unitPrice: 100 },
    { quantity: 1, unitPrice: 100 },
    { quantity: 1, unitPrice: 100 },
  ];

  const result = calculateInclusiveUnitPrices(items, 40);

  // Should reconcile with higher precision
  expect(result.reconciled).toBeTruthy();
  expect(Math.abs(result.remainder)).toBeCloseTo(0, 2);
});

test('calculates correct total with mixed quantities', () => {
  const items = [
    { quantity: 1000, unitPrice: 210.5 },  // Psyllium husk
    { quantity: 500, unitPrice: 178.25 },   // Psyllium powder
  ];
  const additionalCosts = 80500; // Freight + CHA

  const result = calculateInclusiveUnitPrices(items, additionalCosts);

  // Total goods: 1000*210.5 + 500*178.25 = 210,500 + 89,125 = 299,625
  // Target total: 299,625 + 80,500 = 380,125
  expect(result.total).toBeCloseTo(380125, 0);
});

// ─── Financial Year Tests ───────────────────────────────────────────────────

console.log('\nFinancial Year Calculations (period.ts):');

test('correctly identifies FY start for date in April-December', () => {
  // 15 August 2026 is in FY 2026-27, which started 1 April 2026
  const date = new Date('2026-08-15');
  const start = startOfFinancialYear(date);

  expect(start.getUTCFullYear()).toBe(2026);
  expect(start.getUTCMonth()).toBe(3); // April = month 3
  expect(start.getUTCDate()).toBe(1);
});

test('correctly identifies FY start for date in January-March', () => {
  // 20 February 2026 is in FY 2025-26, which started 1 April 2025
  const date = new Date('2026-02-20');
  const start = startOfFinancialYear(date);

  expect(start.getUTCFullYear()).toBe(2025);
  expect(start.getUTCMonth()).toBe(3); // April
  expect(start.getUTCDate()).toBe(1);
});

test('generates correct FY label for mid-year date', () => {
  const date = new Date('2026-09-12');
  const label = financialYearLabel(date);

  expect(label).toBe('FY 2026-27');
});

test('generates correct FY label for Q4 date', () => {
  const date = new Date('2027-02-15');
  const label = financialYearLabel(date);

  expect(label).toBe('FY 2026-27');
});

test('startOfMonth returns first day of month', () => {
  const date = new Date('2026-09-12');
  const start = startOfMonth(date);

  expect(start.getUTCFullYear()).toBe(2026);
  expect(start.getUTCMonth()).toBe(8); // September
  expect(start.getUTCDate()).toBe(1);
});

// ─── Margin Calculation Tests ───────────────────────────────────────────────

console.log('\nMargin Calculations (helpers.ts):');

test('calculates margin percentage correctly', () => {
  // Cost 75, Price 100 = 25% margin
  const margin = calculateMarginPercent(75, 100);
  expect(margin).toBe(25);
});

test('handles zero price (prevents division by zero)', () => {
  const margin = calculateMarginPercent(100, 0);
  expect(margin).toBe(0);
});

test('calculates high margin correctly', () => {
  // Cost 20, Price 100 = 80% margin
  const margin = calculateMarginPercent(20, 100);
  expect(margin).toBe(80);
});

test('calculates low margin correctly', () => {
  // Cost 95, Price 100 = 5% margin
  const margin = calculateMarginPercent(95, 100);
  expect(margin).toBe(5);
});

test('handles negative margin (selling below cost)', () => {
  // Cost 120, Price 100 = -20% margin
  const margin = calculateMarginPercent(120, 100);
  expect(margin).toBe(-20);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✓ All logic verifications passed\n');
}
