// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Prospects', () => {
  test('route /v30/prospects charge avec le chrome v30', async ({ page }) => {
    await page.goto('/v30/prospects');

    await expect(page.locator('.v30-app-shell')).toBeVisible();
    // Conteneur prospects v30 (tableau OU split view)
    const wrapper = page.locator('[data-v30-prospects], .v30-prospects, main').first();
    await expect(wrapper).toBeVisible({ timeout: 10_000 });
  });

  test('switch segmented Kanban / Split / Table est présent', async ({ page }) => {
    await page.goto('/v30/prospects');

    // Tolérant : le segmented peut être implémenté avec .segmented, role=tablist, ou data-view
    const segmented = page.locator('.segmented, [role="tablist"], [data-v30-view-switch]').first();
    await expect(segmented).toBeVisible({ timeout: 10_000 });
  });

  test('la liste ou tableau des prospects se rend', async ({ page }) => {
    await page.goto('/v30/prospects');

    // On attend au moins 1 ligne ou 1 card ou l'empty state
    const rowOrCard = page.locator('.v30-prospects tr, .v30-prospects .card, .v30-prospects [data-prospect-id], .table tr, .empty').first();
    await expect(rowOrCard).toBeVisible({ timeout: 15_000 });
  });
});
