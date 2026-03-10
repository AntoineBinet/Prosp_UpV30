// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Page Aide', () => {
  test('charge la page aide avec hero et sommaire', async ({ page }) => {
    await page.goto('/help');
    await expect(page).toHaveTitle(/Prosp'Up.*Aide/i);
    await expect(page.locator('.help-hero')).toBeVisible();
    await expect(page.locator('.help-hero-title')).toContainText('Bienvenue');
    await expect(page.locator('.help-toc-block')).toBeVisible();
    await expect(page.locator('.help-toc-group-label').first()).toBeVisible();
  });

  test('liens Essayer / tutoriels ont les bonnes cibles', async ({ page }) => {
    await page.goto('/help');
    const tryButtons = page.locator('a.help-try-btn');
    await expect(tryButtons.first()).toBeVisible();
    const hrefs = await tryButtons.evaluateAll((nodes) => nodes.map((a) => a.getAttribute('href')));
    expect(hrefs).toContain('/dashboard');
    expect(hrefs.some((h) => h === '/' || h === '/?openQuickAdd=1')).toBe(true);
    expect(hrefs).toContain('/focus');
    expect(hrefs).toContain('/entreprises');
    expect(hrefs).toContain('/calendrier');
    expect(hrefs).toContain('/sourcing');
    expect(hrefs).toContain('/push');
  });

  test('navigation vers Dashboard depuis aide', async ({ page }) => {
    await page.goto('/help');
    await page.locator('a.help-try-btn').filter({ hasText: 'Dashboard' }).first().click();
    await page.waitForURL(/\/dashboard/);
    expect(page.url()).toContain('dashboard');
  });

  test('navigation vers Prospects depuis aide', async ({ page }) => {
    await page.goto('/help');
    await page.locator('a.help-try-btn').filter({ hasText: 'Prospects' }).first().click();
    await page.waitForURL(/\/(\?|$)/);
    expect(page.url()).toMatch(/^http:\/\/[^/]+\/(\?|$)/);
  });

  test('lien Ajout IA ouvre la page prospects avec paramètre', async ({ page }) => {
    await page.goto('/help');
    const ajoutLink = page.locator('a.help-try-btn').filter({ hasText: 'Ajout IA' });
    await expect(ajoutLink).toHaveCount(1);
    await expect(ajoutLink).toHaveAttribute('href', '/?openQuickAdd=1');
  });
});
