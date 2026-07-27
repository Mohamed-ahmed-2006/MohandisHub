#!/usr/bin/env node
import { spawn } from 'node:child_process';

const apiUrl = new URL(process.env.E2E_API_BASE_URL ?? 'http://localhost:4000');
if (!['localhost', '127.0.0.1'].includes(apiUrl.hostname)) {
  throw new Error('The local E2E web launcher only accepts a loopback E2E_API_BASE_URL.');
}

const child = spawn(process.execPath, ['scripts/dev-web-with-recovery.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    API_INTERNAL_URL: apiUrl.origin,
    DEPLOYMENT_ENV: 'test',
    NEXT_PUBLIC_API_URL: apiUrl.origin,
  },
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code) => process.exit(code ?? 1));
