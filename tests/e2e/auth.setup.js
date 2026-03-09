// @ts-check
const { test: setup } = require('@playwright/test');

const USER = process.env.PROSPUP_USER || 'admin';
const PASS = process.env.PROSPUP_PASS || 'admin';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');

  await page.fill('#username', USER);
  await page.fill('#password', PASS);
  await page.click('.btn-login');

  // Wait for redirect to home page (successful login)
  await page.waitForURL('/', { timeout: 10_000 });

  // Persist session cookies for other tests
  await page.context().storageState({ path: './tests/e2e/.auth/user.json' });
});
