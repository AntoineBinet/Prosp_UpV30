// @ts-check
const { test, expect } = require('@playwright/test');

test.describe('PWA', () => {
  test('service worker is registered', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      return regs.length > 0;
    });
    expect(swRegistered).toBe(true);
  });

  test('manifest is valid with shortcuts', async ({ page }) => {
    await page.goto('/dashboard');

    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="manifest"]');
      if (!link) return null;
      const res = await fetch(link.getAttribute('href'));
      return res.json();
    });

    expect(manifest).toBeTruthy();
    expect(manifest.name).toContain('ProspUp');
    expect(manifest.start_url).toBe('/dashboard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.shortcuts).toBeDefined();
    expect(manifest.shortcuts.length).toBeGreaterThanOrEqual(3);
  });

  test('sw caches shell assets', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check that the SW has cached shell assets
    const cacheNames = await page.evaluate(async () => {
      if (!('caches' in window)) return [];
      return caches.keys();
    });

    const hasShellCache = cacheNames.some(n => n.includes('prospup'));
    expect(hasShellCache).toBe(true);
  });
});
