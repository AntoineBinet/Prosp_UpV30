// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Dashboard', () => {
  test('loads KPI cards', async ({ page }) => {
    await page.goto('/dashboard');

    // KPI row should be present
    const kpiRow = page.locator('#dashKpiRow');
    await expect(kpiRow).toBeVisible();

    // Skeletons should disappear once data loads (replaced by real cards)
    await expect(kpiRow.locator('.skeleton')).toHaveCount(0, { timeout: 10_000 });

    // At least one KPI card should exist
    const cards = kpiRow.locator('.card, .dash-kpi-card, [class*="kpi"]');
    await expect(cards.first()).toBeVisible({ timeout: 10_000 });
  });

  test('has page title', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveTitle(/ProspUp/i);
  });

  test('sidebar is visible on desktop', async ({ page }) => {
    await page.goto('/dashboard');
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();
  });
});
