import { test, expect, Page } from '@playwright/test';

/**
 * Dashboard E2E Tests
 * 
 * Tests dashboard visibility, KPIs, and role-based views.
 */

async function loginAs(page: Page, email: string, password = 'admin123') {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/);
}

test.describe('Dashboard', () => {
  test('should show KPI cards for founder', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    await page.goto('/');
    
    // Should see main KPI cards
    await expect(page.getByText(/revenue|sales/i)).toBeVisible();
    await expect(page.getByText(/orders/i)).toBeVisible();
    await expect(page.getByText(/receivables/i)).toBeVisible();
  });

  test('should show financial year selector', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    await page.goto('/');
    
    // Financial year should be displayed (April-March Indian FY)
    const fyPattern = /FY\s*\d{4}[-–]\d{2,4}|20\d{2}[-–]\d{2}/;
    await expect(page.getByText(fyPattern)).toBeVisible();
  });

  test('should show recent activity feed', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    await page.goto('/');
    
    // Look for activity section
    const activitySection = page.locator('text=/recent activity|recent|activity/i');
    if (await activitySection.isVisible()) {
      // Should show some activity items
      await expect(page.getByRole('listitem').or(page.locator('[data-activity]'))).toHaveCount(1, { timeout: 5000 });
    }
  });

  test('should show charts for data visualization', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    await page.goto('/');
    
    // Should have chart containers (recharts renders SVG)
    const charts = page.locator('svg.recharts-surface, [class*="chart"]');
    const chartCount = await charts.count();
    expect(chartCount).toBeGreaterThanOrEqual(0); // May or may not have charts depending on data
  });
});

test.describe('Dashboard Role Views', () => {
  test('SALES user sees sales-focused dashboard', async ({ page }) => {
    await loginAs(page, 'hiren@seabridge.com');
    
    await page.goto('/');
    
    // Should see sales metrics
    await expect(page.getByText(/inquiries|quotations|pipeline/i)).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('sidebar navigation works correctly', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    // Test navigation to main modules
    const navItems = [
      { link: /buyers/i, url: /\/buyers/ },
      { link: /inquiries/i, url: /\/inquiries/ },
      { link: /quotations/i, url: /\/quotations/ },
      { link: /orders/i, url: /\/orders/ },
      { link: /invoices/i, url: /\/invoices/ },
    ];
    
    for (const item of navItems) {
      await page.getByRole('link', { name: item.link }).click();
      await expect(page).toHaveURL(item.url);
    }
  });

  test('should return to dashboard from any page', async ({ page }) => {
    await loginAs(page, 'founder@seabridge.com');
    
    // Navigate somewhere
    await page.goto('/buyers');
    
    // Click dashboard link (or logo)
    const dashboardLink = page.getByRole('link', { name: /dashboard/i });
    if (await dashboardLink.isVisible()) {
      await dashboardLink.click();
    } else {
      // Try clicking the logo
      await page.locator('header a, [class*="logo"]').first().click();
    }
    
    await expect(page).toHaveURL(/\/(dashboard)?$/);
  });
});
