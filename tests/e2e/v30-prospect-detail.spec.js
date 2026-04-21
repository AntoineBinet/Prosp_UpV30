// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Prospect detail', () => {
  test('ouvre une fiche et hydrate le header', async ({ page, request }) => {
    // On récupère un id via l'API (cookie auth auto via storageState)
    const res = await request.get('/api/data');
    test.skip(!res.ok(), 'API /api/data indisponible');
    const data = await res.json();
    const prospects = data?.prospects || [];
    test.skip(prospects.length === 0, 'Aucun prospect en base, test non applicable');

    const pid = prospects[0].id;
    await page.goto('/v30/prospect/' + pid);

    await expect(page.locator('[data-v30-fp]')).toBeVisible();

    // Header : nom hydraté (skeleton remplacé)
    const name = page.locator('[data-field="name"]');
    await expect(name).toBeVisible({ timeout: 10_000 });
    await expect(name.locator('.skel')).toHaveCount(0, { timeout: 10_000 });
  });

  test('les onglets Aperçu / Timeline / Push / IA existent', async ({ page, request }) => {
    const res = await request.get('/api/data');
    test.skip(!res.ok(), 'API /api/data indisponible');
    const data = await res.json();
    const prospects = data?.prospects || [];
    test.skip(prospects.length === 0, 'Aucun prospect en base');

    await page.goto('/v30/prospect/' + prospects[0].id);

    const tabs = page.locator('[data-v30-fp-tabs] button');
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText(/Aperçu/i);
  });
});
