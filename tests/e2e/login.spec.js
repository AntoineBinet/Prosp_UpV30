// @ts-check
const { test, expect } = require('@playwright/test');

// These tests do NOT use the stored auth state — they test the login page itself.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login page', () => {
  test('shows login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
    await expect(page.locator('.btn-login')).toBeVisible();
  });

  test('bad credentials show error', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'wrong_user');
    await page.fill('#password', 'wrong_pass');
    await page.click('.btn-login');

    const err = page.locator('#errorMsg');
    await expect(err).toBeVisible({ timeout: 5000 });
    await expect(err).toContainText('Identifiants');
  });

  test('successful login redirects to /', async ({ page }) => {
    const user = process.env.PROSPUP_USER || 'admin';
    const pass = process.env.PROSPUP_PASS || 'admin';

    await page.goto('/login');
    await page.fill('#username', user);
    await page.fill('#password', pass);
    await page.click('.btn-login');

    await page.waitForURL('/', { timeout: 10_000 });
    await expect(page).toHaveURL('/');
  });

  test('unauthenticated access redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
