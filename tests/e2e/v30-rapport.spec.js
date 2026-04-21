// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Rapport WYSIWYG (tab de /v30/stats)', () => {
  test('ouvre le tab Rapport et voit le doc éditeur', async ({ page }) => {
    await page.goto('/v30/stats');
    await expect(page.locator('[data-v30-stats]')).toBeVisible();

    await page.click('[data-v30-stats-tabs] button[data-tab="rapport"]');

    const doc = page.locator('[data-v30-rep-doc]');
    await expect(doc).toBeVisible({ timeout: 5000 });

    // Zones contenteditable
    const ces = page.locator('[contenteditable="true"][data-v30-rep-ce]');
    await expect(ces).toHaveCount(4);

    // Sections
    const secs = page.locator('.v30-rep-sec');
    await expect(secs).toHaveCount(6);
  });

  test('autosave localStorage des notes', async ({ page }) => {
    await page.goto('/v30/stats');
    await page.click('[data-v30-stats-tabs] button[data-tab="rapport"]');

    const notes = page.locator('[data-v30-rep-ce="notes"]');
    await expect(notes).toBeVisible({ timeout: 5000 });
    await notes.click();
    await notes.fill(''); // clear
    await notes.type('Test autosave ' + Date.now());

    // Attendre le debounce
    await page.waitForTimeout(500);

    // Vérifier que localStorage contient la clé
    const saved = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('prospup_rapport_'));
      return keys.length > 0;
    });
    expect(saved).toBe(true);
  });

  test('endpoint /api/rapport/export-pdf retourne un PDF', async ({ request }) => {
    const res = await request.post('/api/rapport/export-pdf', {
      data: {
        week: '2026-W17',
        markdown: '# Test\n\n## Section\n- bullet'
      }
    });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
  });
});
