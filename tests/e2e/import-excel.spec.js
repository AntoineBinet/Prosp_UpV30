// @ts-check
const path = require('path');
const { test, expect } = require('@playwright/test');

const FIXTURE_EXCEL = path.join(__dirname, '../fixtures/fichier_prosp_test_user.xlsx');

test.describe('Import Excel', () => {
  test('import Excel file: mapping, preview, import', async ({ page }) => {
    await page.goto('/');

    await page.waitForSelector('#tableView, .main-layout', { timeout: 15_000 });

    const openImportBtn = page.locator('button:has-text("Importer ma liste"), a:has-text("Importer ma liste")').first();
    await openImportBtn.click();

    const modal = page.locator('#modalImportList');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.locator('#importListStepChoice')).toBeVisible();

    const excelTab = modal.locator('button[data-tab="excel"]');
    await excelTab.click();

    const fileInput = page.locator('#importListFileExcel');
    await fileInput.setInputFiles(FIXTURE_EXCEL);

    await expect(modal.locator('#importListStepMapping')).toBeVisible({ timeout: 10_000 });
    const grid = modal.locator('#importListMappingGrid');
    await expect(grid).toBeVisible();
    const selects = grid.locator('.import-list-map-select');
    await expect(selects.first()).toBeVisible({ timeout: 3000 });

    const apercuBtn = modal.locator('button:has-text("Aperçu")');
    await apercuBtn.click();

    await expect(modal.locator('#importListStepPreview')).toBeVisible({ timeout: 5000 });
    const countEl = modal.locator('#importListPreviewCount');
    await expect(countEl).toContainText(/\d+/, { timeout: 3000 });
    const countText = await countEl.textContent();
    const count = parseInt(countText || '0', 10);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(21);

    const importerBtn = modal.locator('button:has-text("Importer")');
    await importerBtn.click();

    await expect(page.locator('.toast-container .toast, [class*="toast"]')).toContainText(/importé|succès|✅/, { timeout: 15_000 });

    const tableView = page.locator('#tableView');
    await expect(tableView).toBeVisible({ timeout: 5000 });
    const rows = tableView.locator('tbody tr, tr[data-id]');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
  });
});
