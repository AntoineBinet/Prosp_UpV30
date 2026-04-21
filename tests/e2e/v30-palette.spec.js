// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Command palette ⌘K', () => {
  test('⌘K ouvre la palette', async ({ page }) => {
    await page.goto('/v30/dashboard');

    const palette = page.locator('[data-v30-palette]');
    await expect(palette).toHaveAttribute('hidden', /.*/);

    await page.keyboard.press('Meta+k');
    await expect(palette).not.toHaveAttribute('hidden', /.*/, { timeout: 5000 });

    const input = page.locator('[data-v30-palette-input]');
    await expect(input).toBeFocused({ timeout: 3000 });
  });

  test('Ctrl+K ouvre aussi (alternative Windows)', async ({ page }) => {
    await page.goto('/v30/dashboard');

    const palette = page.locator('[data-v30-palette]');
    await page.keyboard.press('Control+k');
    // Palette ouverte (hidden retiré)
    await expect(palette).not.toHaveAttribute('hidden', /.*/, { timeout: 5000 });
  });

  test('taper dans la recherche affiche des résultats', async ({ page }) => {
    await page.goto('/v30/dashboard');
    await page.keyboard.press('Meta+k');

    const input = page.locator('[data-v30-palette-input]');
    await expect(input).toBeVisible();
    await input.fill('dash');

    // Le corps de la palette contient des items (pages et/ou actions)
    const body = page.locator('[data-v30-palette-body]');
    await expect(body).toBeVisible();
    await expect(body).not.toBeEmpty({ timeout: 3000 });
  });

  test('Escape ferme la palette', async ({ page }) => {
    await page.goto('/v30/dashboard');
    await page.keyboard.press('Meta+k');

    const palette = page.locator('[data-v30-palette]');
    await expect(palette).not.toHaveAttribute('hidden', /.*/, { timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(palette).toHaveAttribute('hidden', /.*/, { timeout: 3000 });
  });
});
