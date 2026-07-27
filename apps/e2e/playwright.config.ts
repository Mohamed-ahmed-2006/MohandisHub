import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadLocalEnv = () => {
  const envPath = resolve(__dirname, '.env.local');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
};

loadLocalEnv();

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? process.env.BASE_URL ?? 'http://localhost:3000';
const apiBaseURL =
  process.env.E2E_API_BASE_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000';
process.env.E2E_API_BASE_URL ??= apiBaseURL;

const isLocalWeb = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseURL);
const isLocalApi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(apiBaseURL);
const productionHosts = new Set(['mohandishub.app', 'www.mohandishub.app', 'api.mohandishub.app']);

for (const target of [baseURL, apiBaseURL]) {
  const host = new URL(target).hostname.toLowerCase();
  if (productionHosts.has(host)) {
    throw new Error(`E2E refused production host: ${host}`);
  }
}

if ((!isLocalWeb || !isLocalApi) && process.env.E2E_DEPLOYMENT_ENV !== 'staging') {
  throw new Error('Remote E2E requires E2E_DEPLOYMENT_ENV=staging');
}
if (
  (!isLocalWeb || !isLocalApi) &&
  process.env.E2E_NON_PRODUCTION_CONFIRMATION !== 'MOHANDISHUB_STAGING_ONLY'
) {
  throw new Error('Remote E2E requires E2E_NON_PRODUCTION_CONFIRMATION=MOHANDISHUB_STAGING_ONLY');
}

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html']],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: isLocalWeb
    ? [
        {
          command: 'node scripts/e2e-local-stub-api.mjs',
          cwd: '../..',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: `${apiBaseURL.replace(/\/$/, '')}/health`,
        },
        {
          command: 'node scripts/e2e-dev-web.mjs',
          cwd: '../..',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          url: `${baseURL.replace(/\/$/, '')}/en`,
        },
      ]
    : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
});
