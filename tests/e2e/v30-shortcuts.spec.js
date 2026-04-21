// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Raccourcis clavier', () => {
  test('G puis P navigue vers /v30/prospects', async ({ page }) => {
    await page.goto('/v30/dashboard');

    // Déclenche le goto (G seul arme, P navigue)
    await page.keyboard.press('g');
    await page.keyboard.press('p');

    await page.waitForURL(/\/v30\/prospects/, { timeout: 5000 });
    expect(page.url()).toContain('/v30/prospects');
  });

  test('G puis D navigue vers /v30/dashboard', async ({ page }) => {
    await page.goto('/v30/prospects');

    await page.keyboard.press('g');
    await page.keyboard.press('d');

    await page.waitForURL(/\/v30\/dashboard/, { timeout: 5000 });
    expect(page.url()).toContain('/v30/dashboard');
  });

  test('? ouvre la modale d\'aide', async ({ page }) => {
    await page.goto('/v30/dashboard');

    // Shift+? ou juste ?
    await page.keyboard.press('Shift+/'); // = ?

    const help = page.locator('[data-v30-help]');
    await expect(help).toBeVisible({ timeout: 3000 });
  });

  test('[ toggle focus mode / sidebar', async ({ page }) => {
    await page.goto('/v30/dashboard');

    const shell = page.locator('.v30-app-shell');
    const initialFocus = await shell.evaluate(el => el.classList.contains('is-focus'));

    await page.keyboard.press('[');

    const afterFocus = await shell.evaluate(el => el.classList.contains('is-focus'));
    expect(afterFocus).not.toBe(initialFocus);
  });
});
