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
const nextBin = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');

function clearNextCache() {
  if (fs.existsSync(nextDir)) {
    fs.rmSync(nextDir, { recursive: true });
    console.log('[dev-web] Cleared corrupted .next cache, restarting...');
  }
}

function run() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [nextBin, 'dev', '-p', '3000'], {
      cwd: webDir,
      stdio: 'inherit',
      shell: false,
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
