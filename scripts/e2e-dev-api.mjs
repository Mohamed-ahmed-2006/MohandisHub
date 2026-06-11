#!/usr/bin/env node
import { spawn } from 'node:child_process';

const apiPort = new URL(process.env.E2E_API_BASE_URL ?? 'http://localhost:4000').port || '4000';
const child = spawn('npm run dev:api', {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'development', PORT: apiPort },
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
