import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * 
 * Tests the login flow, session persistence, and logout.
 */

test.describe('Authentication', () => {
  test('should show login page when not authenticated', async ({ page }) => {
    await page.goto('/');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /login|sign in/i })).toBeVisible();
  });

  test('should reject invalid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('wrong@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    
    // Should show error message
    await expect(page.getByText(/invalid|incorrect|failed/i)).toBeVisible({ timeout: 5000 });
  });

  test('should login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    
    await page.getByLabel(/email/i).fill('founder@seabridge.com');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    
    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    await expect(page.getByText(/dashboard/i)).toBeVisible({ timeout: 10000 });
  });

  test('should persist session across page refresh', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('founder@seabridge.com');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    
    // Refresh page
    await page.reload();
    
    // Should still be logged in
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    await expect(page.getByText(/dashboard/i)).toBeVisible();
  });

  test('should logout and redirect to login', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('founder@seabridge.com');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    
    // Click logout (may be in a dropdown or sidebar)
    const logoutButton = page.getByRole('button', { name: /logout|sign out/i });
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
    } else {
      // Try finding it in user menu
      await page.getByRole('button', { name: /user|account|profile/i }).click();
      await page.getByRole('menuitem', { name: /logout|sign out/i }).click();
    }
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});

/**
 * Role-Based Access E2E Tests
 */
test.describe('Role-Based Access', () => {
  test('SALES user should see only allowed menu items', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('hiren@seabridge.com');
    await page.getByLabel(/password/i).fill('admin123');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    
    await expect(page).toHaveURL(/\/(dashboard)?$/);
    
    // Should see: Dashboard, Buyers, Inquiries, Quotations
    await expect(page.getByRole('link', { name: /buyers/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /inquiries/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /quotations/i })).toBeVisible();
    
    // Should NOT see: Invoices (FINANCE only), Audit Log (ADMIN only)
    await expect(page.getByRole('link', { name: /invoices/i })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /audit/i })).not.toBeVisible();
  });
});
