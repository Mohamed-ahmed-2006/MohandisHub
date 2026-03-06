#!/usr/bin/env node
/**
 * Kills any process listening on the given port.
 * Cross-platform: Windows (netstat + taskkill) and Unix (lsof + kill).
 * Usage: node scripts/kill-port.js [port]
 * Default port: 4000 (or PORT env var)
 */

const port = parseInt(process.env.PORT || process.argv[2] || '4000', 10);
const isWindows = process.platform === 'win32';

function execSync(cmd) {
  const { execSync: exec } = require('child_process');
  try {
    return exec(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
}

function getPidsWindows() {
  const out = execSync(`netstat -ano | findstr :${port}`);
  if (!out) return [];
  const pids = new Set();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/\s+(\d+)\s*$/);
    if (m) pids.add(m[1]);
  }
  return [...pids];
}

function getPidsUnix() {
  const out = execSync(`lsof -ti :${port}`);
  if (!out) return [];
  return out.trim().split(/\s+/).filter(Boolean);
}

function killPid(pid) {
  if (isWindows) {
    execSync(`taskkill /PID ${pid} /F`);
  } else {
    execSync(`kill -9 ${pid}`);
  }
}

const pids = isWindows ? getPidsWindows() : getPidsUnix();

if (pids.length === 0) {
  process.exit(0);
}

for (const pid of pids) {
  try {
    killPid(pid);
    console.log(`Killed process ${pid} on port ${port}`);
  } catch (e) {
    // Ignore - process may have exited
  }
}

process.exit(0);
