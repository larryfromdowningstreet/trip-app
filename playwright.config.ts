import { defineConfig, devices } from '@playwright/test';

// Browser tests of the built app (CSP and the offline service worker exist only in the build).
//   npx playwright install webkit     once
//   npm run e2e                       iPhone Safari (WebKit)
//   npm run e2e -- --project=iphone-chromium   the same tests on Chromium with an iPhone screen, where WebKit is unavailable
const iPhone = devices['iPhone 15'];

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts', // not *.spec.ts, so Vitest leaves these alone
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173/', locale: 'zh-TW', timezoneId: 'Asia/Taipei', trace: 'off' },
  projects: [
    { name: 'iphone-webkit', use: { ...iPhone } },
    { name: 'iphone-chromium', use: { ...iPhone, browserName: 'chromium', defaultBrowserType: 'chromium' } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
