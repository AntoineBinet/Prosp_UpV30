// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('Mobile UX', () => {
  test('bottom nav is visible', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const bottomNav = page.locator('.mobile-bottom-nav');
    await expect(bottomNav).toBeVisible();
  });

  test('bottom nav has active indicator on current page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500); // let v8-features.js run

    const activeLink = page.locator('.mobile-bottom-nav a.active');
    await expect(activeLink).toBeVisible();
  });

  test('sidebar is off-screen by default on mobile', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    const sidebar = page.locator('.sidebar');
    // On mobile the sidebar uses transform: translateX(-100%)
    const rect = await sidebar.boundingBox();
    // Sidebar should be off-screen (right edge <= 0) or not have sidebar-open class
    const hasOpenClass = await sidebar.evaluate(el => el.classList.contains('sidebar-open'));
    expect(hasOpenClass).toBe(false);
  });

  test('hamburger menu toggles sidebar', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');

    const hamburger = page.locator('.hamburger, .menu-toggle, [class*="hamburger"], button[aria-label*="menu"]');
    if (await hamburger.count() > 0 && await hamburger.first().isVisible()) {
      await hamburger.first().click();
      await page.waitForTimeout(400); // animation

      const sidebar = page.locator('.sidebar');
      const hasOpenClass = await sidebar.evaluate(el => el.classList.contains('sidebar-open'));
      expect(hasOpenClass).toBe(true);
    }
  });
});
