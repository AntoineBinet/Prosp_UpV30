// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:8000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Auth setup — runs first, stores session state
    { name: 'setup', testMatch: /auth\.setup\.js/ },

    // Desktop Chrome — skip mobile-only tests
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        storageState: './tests/e2e/.auth/user.json',
      },
      testIgnore: /mobile\.spec\.js/,
      dependencies: ['setup'],
    },

    // Mobile Pixel 5 — skip desktop-only navigation tests
    {
      name: 'mobile-pixel5',
      use: {
        ...devices['Pixel 5'],
        storageState: './tests/e2e/.auth/user.json',
      },
      testIgnore: /navigation\.spec\.js/,
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'python app.py',
    url: 'http://127.0.0.1:8000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
    env: { PYTHONIOENCODING: 'utf-8' },
  },
});
