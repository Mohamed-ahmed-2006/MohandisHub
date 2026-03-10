#!/usr/bin/env node
/**
 * Runs Next.js dev server with auto-recovery.
 * On crash (e.g. corrupted .next), clears .next and restarts.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'apps', 'web');
const nextDir = path.join(webDir, '.next');

function clearNextCache() {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true });
    console.log('[dev-web] Cleared corrupted .next cache, restarting...');
  }
}

function run() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'dev'], {
      cwd: webDir,
      stdio: 'inherit',
      shell: isWin,
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const code = await run();
    if (code === 0) {
      process.exit(0);
    }
    clearNextCache();
  }
}

main().catch((err) => {
  console.error('[dev-web] Fatal:', err);
  process.exit(1);
});
