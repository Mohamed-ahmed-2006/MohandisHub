/**
 * Workaround for Next.js 15.x on Windows: server webpack-runtime uses
 * require("./<id>.js") relative to `.next/server/`, while some chunks are only
 * emitted under `.next/server/chunks/`. Copy numeric chunk files up one level.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, '..');
const serverDir = path.join(webRoot, '.next', 'server');
const chunksDir = path.join(serverDir, 'chunks');

if (!fs.existsSync(chunksDir)) {
  process.exit(0);
}

for (const name of fs.readdirSync(chunksDir)) {
  if (!/^\d+\.js$/.test(name)) continue;
  const src = path.join(chunksDir, name);
  const dest = path.join(serverDir, name);
  if (!fs.existsSync(dest)) {
    fs.copyFileSync(src, dest);
  }
}
