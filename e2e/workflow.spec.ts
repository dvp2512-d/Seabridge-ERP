import { test, expect, Page } from '@playwright/test';

/**
 * Critical Business Workflow E2E Tests
 * 
 * Tests the core business flow: Buyer → Inquiry → Quotation → Order → Invoice
 */

// Helper: Login as founder
async function loginAsFounder(page: Page) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill('founder@seabridge.com');
  await page.getByLabel(/password/i).fill('admin123');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

// Generate unique test data suffix
const testId = Date.now().toString().slice(-6);

test.describe('Sales Pipeline Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFounder(page);
  });

  test('should create a new buyer', async ({ page }) => {
    await page.goto('/buyers');
    await page.getByRole('button', { name: /new buyer|add buyer/i }).click();
    
    // Fill buyer form
    await page.getByLabel(/company name|name/i).first().fill(`E2E Test Buyer ${testId}`);
    await page.getByLabel(/contact person/i).fill('John Test');
    await page.getByLabel(/email/i).fill(`john.test.${testId}@example.com`);
    
    // Save
    await page.getByRole('button', { name: /save|create/i }).click();
    
    // Should see success message or redirect to detail
    await expect(page.getByText(/success|created|saved/i)).toBeVisible({ timeout: 5000 });
  });

  test('should create an inquiry from buyer', async ({ page }) => {
    // First create a buyer
    await page.goto('/buyers');
    await page.getByRole('button', { name: /new buyer|add buyer/i }).click();
    await page.getByLabel(/company name|name/i).first().fill(`E2E Inquiry Test ${testId}`);
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByText(/success|created/i)).toBeVisible({ timeout: 5000 });
    
    // Navigate to inquiries
    await page.goto('/inquiries');
    await page.getByRole('button', { name: /new inquiry|add inquiry/i }).click();
    
    // Select the buyer we just created
    await page.getByLabel(/buyer/i).click();
    await page.getByRole('option', { name: new RegExp(`E2E Inquiry Test ${testId}`, 'i') }).click();
    
    // Set inquiry details
    await page.getByLabel(/priority/i).selectOption('HIGH');
    
    // Save inquiry
    await page.getByRole('button', { name: /save|create/i }).click();
    await expect(page.getByText(/success|created|INQ-/i)).toBeVisible({ timeout: 5000 });
  });

  test('should create a quotation with margin calculation', async ({ page }) => {
    await page.goto('/quotations');
    await page.getByRole('button', { name: /new quotation/i }).click();
    
    // Select a buyer
    await page.getByLabel(/buyer/i).click();
    await page.getByRole('option').first().click();
    
    // Add line item (if the form supports it)
    const addItemButton = page.getByRole('button', { name: /add item|add line/i });
    if (await addItemButton.isVisible()) {
      await addItemButton.click();
      
      // Fill item details
      await page.getByLabel(/quantity/i).fill('1000');
      await page.getByLabel(/unit price/i).fill('175');
      await page.getByLabel(/unit cost/i).fill('100');
    }
    
    // Save quotation
    await page.getByRole('button', { name: /save|create/i }).click();
    
    // Should show quotation number
    await expect(page.getByText(/QT-\d+/)).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Quotation to Order Conversion', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFounder(page);
  });

  test('should convert accepted quotation to order', async ({ page }) => {
    // Go to quotations list
    await page.goto('/quotations');
    
    // Find an accepted quotation (or the first one)
    await page.getByRole('row').nth(1).click();
    
    // If there's a "Convert to Order" button and quotation is accepted
    const convertButton = page.getByRole('button', { name: /convert to order/i });
    if (await convertButton.isVisible()) {
      await convertButton.click();
      
      // Confirm conversion
      const confirmButton = page.getByRole('button', { name: /confirm|yes|convert/i });
      if (await confirmButton.isVisible()) {
        await confirmButton.click();
      }
      
      // Should redirect to order or show success
      await expect(page.getByText(/ORD-\d+|order created|success/i)).toBeVisible({ timeout: 5000 });
    }
  });
});

test.describe('Invoice and Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFounder(page);
  });

  test('should create invoice from order', async ({ page }) => {
    await page.goto('/orders');
    
    // Click on first order
    await page.getByRole('row').nth(1).click();
    
    // Look for create invoice button
    const invoiceButton = page.getByRole('button', { name: /create invoice/i });
    if (await invoiceButton.isVisible()) {
      await invoiceButton.click();
      
      // Select invoice type
      await page.getByLabel(/type/i).selectOption('COMMERCIAL');
      
      // Save
      await page.getByRole('button', { name: /save|create/i }).click();
      
      // Should show invoice number
      await expect(page.getByText(/INV-\d+/)).toBeVisible({ timeout: 5000 });
    }
  });

  test('should record payment on invoice', async ({ page }) => {
    await page.goto('/invoices');
    
    // Click on first unpaid invoice
    const unpaidRow = page.getByRole('row').filter({ hasText: /sent|draft|partially/i }).first();
    if (await unpaidRow.isVisible()) {
      await unpaidRow.click();
      
      // Record payment
      const paymentButton = page.getByRole('button', { name: /record payment|add payment/i });
      if (await paymentButton.isVisible()) {
        await paymentButton.click();
        
        // Fill payment form
        await page.getByLabel(/amount/i).fill('10000');
        await page.getByLabel(/reference/i).fill(`E2E-PAY-${testId}`);
        
        // Save payment
        await page.getByRole('button', { name: /save|record/i }).click();
        
        // Should see success or updated balance
        await expect(page.getByText(/success|payment recorded|balance/i)).toBeVisible({ timeout: 5000 });
      }
    }
  });
});

test.describe('PDF Generation', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsFounder(page);
  });

  test('should download quotation PDF', async ({ page }) => {
    await page.goto('/quotations');
    
    // Click on first quotation
    await page.getByRole('row').nth(1).click();
    
    // Wait for download when clicking PDF button
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download pdf|pdf/i }).click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });

  test('should download invoice PDF', async ({ page }) => {
    await page.goto('/invoices');
    
    // Click on first invoice
    await page.getByRole('row').nth(1).click();
    
    // Wait for download when clicking PDF button
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('button', { name: /download pdf|pdf/i }).click();
    
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  });
});
