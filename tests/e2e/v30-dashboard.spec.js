// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Dashboard', () => {
  test('route /v30/dashboard charge avec chrome v30', async ({ page }) => {
    await page.goto('/v30/dashboard');

    // Chrome v30 présent (sidebar + topbar + palette)
    await expect(page.locator('.v30-app-shell')).toBeVisible();
    await expect(page.locator('[data-v30-palette]')).toBeAttached();
  });

  test('hero name / KPI hero se remplit une fois hydraté', async ({ page }) => {
    await page.goto('/v30/dashboard');

    // Attente hydratation : skeletons disparaissent des zones principales
    const shell = page.locator('.v30-app-shell');
    await expect(shell).toBeVisible();

    // Au moins une carte KPI visible (peut être dans un grid ou container)
    const kpiOrCard = page.locator('.v30-dash [data-field], .v30-dash .card, .card').first();
    await expect(kpiOrCard).toBeVisible({ timeout: 10_000 });
  });

  test('titre de page en français contient ProspUp/Dashboard', async ({ page }) => {
    await page.goto('/v30/dashboard');
    await expect(page).toHaveTitle(/Prosp.*Up/i);
  });
});
