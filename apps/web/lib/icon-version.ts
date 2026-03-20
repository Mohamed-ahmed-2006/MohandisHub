import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function safeRead(filePath: string): Buffer | null {
  try {
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Returns a short fingerprint for the current logo files used by `apps/web/app/icon.tsx`.
 * This lets us bust browser caches when the image changes but the filename stays the same.
 */
export function getIconVersion(): string {
  const assetsDir = path.join(__dirname, '..', 'components', 'assets');
  const candidates = [
    path.join(assetsDir, 'mohandishub3 dark.png'),
    path.join(assetsDir, 'mohandishub3 light.png'),
  ];

  const hash = createHash('sha256');
  let any = false;

  for (const file of candidates) {
    const buf = safeRead(file);
    if (!buf) continue;
    any = true;
    hash.update(buf);
  }

  if (!any) return 'dev';

  return hash.digest('hex').slice(0, 10);
}

