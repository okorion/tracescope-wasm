import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45_000, expect: { timeout: 10_000 }, retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4179/tracescope-wasm/',
    viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{name: 'chromium', use: {...devices['Desktop Chrome'], viewport: {width: 1440, height: 1000}}}],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run preview', url: 'http://127.0.0.1:4179/tracescope-wasm/', reuseExistingServer: !process.env.CI,
  },
});
