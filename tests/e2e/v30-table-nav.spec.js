// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('v30 — Navigation clavier sur tables', () => {
  test('J/K active ligne suivante / précédente', async ({ page }) => {
    await page.goto('/v30/prospects');
    await expect(page.locator('[data-v30-table-nav]')).toBeVisible();

    // Injecter des lignes factices pour tester (DB peut être vide)
    await page.evaluate(() => {
      const tbody = document.querySelector('[data-v30-table-nav]');
      if (!tbody) return;
      tbody.innerHTML = '<tr data-id="1"><td><input type="checkbox" data-v30-row-select></td>' +
        '<td><a data-v30-open="1">A</a></td></tr>' +
        '<tr data-id="2"><td><input type="checkbox" data-v30-row-select></td>' +
        '<td><a data-v30-open="2">B</a></td></tr>' +
        '<tr data-id="3"><td><input type="checkbox" data-v30-row-select></td>' +
        '<td><a data-v30-open="3">C</a></td></tr>';
    });

    await page.keyboard.press('j');
    await expect(page.locator('tr.is-active')).toHaveAttribute('data-id', '1');

    await page.keyboard.press('j');
    await expect(page.locator('tr.is-active')).toHaveAttribute('data-id', '2');

    await page.keyboard.press('k');
    await expect(page.locator('tr.is-active')).toHaveAttribute('data-id', '1');
  });

  test('X toggle la checkbox de la ligne active', async ({ page }) => {
    await page.goto('/v30/prospects');
    await page.evaluate(() => {
      const tbody = document.querySelector('[data-v30-table-nav]');
      if (!tbody) return;
      tbody.innerHTML = '<tr data-id="42"><td>' +
        '<input type="checkbox" data-v30-row-select></td><td>X</td></tr>';
    });

    await page.keyboard.press('j'); // active la ligne
    await page.keyboard.press('x'); // toggle

    const checked = await page.evaluate(() =>
      document.querySelector('tr.is-active input[type="checkbox"]').checked);
    expect(checked).toBe(true);
  });
});
