import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  use: { baseURL: process.env.SITE_URL ?? 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  webServer: process.env.SITE_URL ? undefined : { command: 'npm run preview -- --host 127.0.0.1', port: 4173, reuseExistingServer: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }, { name: 'mobile', use: { ...devices['iPhone 14'] } }],
})
