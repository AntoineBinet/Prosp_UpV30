// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Focus (relances) page', () => {
  test('loads relance list', async ({ page }) => {
    await page.goto('/focus');

    const todoList = page.locator('#todoList');
    await expect(todoList).toBeVisible();

    // Skeletons should disappear
    await expect(todoList.locator('.skeleton')).toHaveCount(0, { timeout: 10_000 });
  });

  test('has page title', async ({ page }) => {
    await page.goto('/focus');
    await expect(page).toHaveTitle(/ProspUp/i);
  });
});
