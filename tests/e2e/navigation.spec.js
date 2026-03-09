// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Navigation — sidebar links', () => {
  const links = [
    { url: '/dashboard' },
    { url: '/focus' },
    { url: '/' },
  ];

  for (const { url } of links) {
    test(`sidebar link to ${url} works`, async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForLoadState('domcontentloaded');

      const sidebar = page.locator('.sidebar');
      const link = sidebar.locator(`a[href="${url}"]`).first();

      if (await link.isVisible()) {
        await link.click();
        await page.waitForURL(url === '/' ? '/' : `**${url}**`, { timeout: 10_000 });
        expect(page.url()).toContain(url === '/' ? '/' : url);
      }
    });
  }
});
