#!/usr/bin/env node
import { spawn } from 'node:child_process';

const apiUrl = new URL(process.env.E2E_API_BASE_URL ?? 'http://localhost:4000');
const webUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000');
if (!['localhost', '127.0.0.1', '::1'].includes(apiUrl.hostname)) {
  throw new Error('The local E2E API launcher only accepts a loopback E2E_API_BASE_URL.');
}
if (!['localhost', '127.0.0.1', '::1'].includes(webUrl.hostname)) {
  throw new Error('The local E2E API launcher only accepts a loopback PLAYWRIGHT_BASE_URL.');
}

const apiPort = apiUrl.port || '4000';
const child = spawn('npm run dev:api', {
  cwd: process.cwd(),
  env: {
    ...process.env,
    DEPLOYMENT_ENV: 'test',
    MOHANDISHUB_E2E: '1',
    NODE_ENV: 'test',
    PORT: apiPort,
    DATABASE_URL: '',
    API_PUBLIC_URL: `http://127.0.0.1:${apiPort}`,
    WEB_PUBLIC_URL: webUrl.origin,
    CORS_ORIGIN: webUrl.origin,
    JWT_SECRET: 'local-e2e-access-secret-never-use-outside-tests',
    JWT_REFRESH_SECRET: 'local-e2e-refresh-secret-never-use-outside-tests',
    ALLOW_TEST_REMOTE_SERVICES: 'false',
    ADVERTISEMENTS_ENABLED: 'false',
    NOWPAYMENTS_CRYPTO_DEPOSITS_ENABLED: 'false',
    NOWPAYMENTS_FIAT_ENABLED: 'false',
    NOWPAYMENTS_WITHDRAWALS_ENABLED: 'false',
    NOWPAYMENTS_MASS_PAYOUTS_ENABLED: 'false',
    PAYMOB_DEPOSITS_ENABLED: 'false',
    PAYMOB_WITHDRAWALS_ENABLED: 'false',
    INSTAPAY_DEPOSITS_ENABLED: 'false',
    INSTAPAY_WITHDRAWALS_ENABLED: 'false',
  },
  shell: true,
  stdio: 'inherit',
});

const stop = (signal) => {
  if (!child.killed) child.kill(signal);
};

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
