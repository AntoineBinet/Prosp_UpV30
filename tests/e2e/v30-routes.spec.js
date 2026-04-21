// @ts-check
// Smoke test : toutes les routes /v30/* retournent 200 pour un admin authentifié.
const { test, expect } = require('@playwright/test');

const ROUTES = [
  '/v30/dashboard',
  '/v30/focus',
  '/v30/calendrier',
  '/v30/prospects',
  '/v30/entreprises',
  '/v30/sourcing',
  '/v30/push',
  '/v30/stats',
  '/v30/rapport',
  '/v30/parametres',
  '/v30/users',
  '/v30/snapshots',
  '/v30/activity',
  '/v30/metiers',
  '/v30/collab',
  '/v30/duplicates',
  '/v30/help',
  '/v30/dc'
];

test.describe('v30 — routes smoke test', () => {
  for (const route of ROUTES) {
    test(`GET ${route} répond 200 et contient .v30-app-shell`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      await expect(page.locator('.v30-app-shell')).toBeVisible();
    });
  }
});
