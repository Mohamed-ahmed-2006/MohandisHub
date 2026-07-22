import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('upload resource-abuse controls', () => {
  it('rate-limits accounts and bounds concurrent in-memory uploads before multer', () => {
    const routes = readSource('../modules/upload/upload.routes.ts');
    const limits = readSource('../middleware/rate-limit.ts');

    expect(limits).toContain('export const uploadRateLimiter');
    expect(limits).toContain("req.user?.id ?? 'unauthenticated'");
    expect(routes).toContain('const MAX_CONCURRENT_UPLOADS = 2');
    expect(routes).toContain('const DEFAULT_MAX_SIZE = 15 * 1024 * 1024');

    const publicRoute = routes.indexOf("  '/',");
    const privateRoute = routes.indexOf("  '/private',");
    for (const routeStart of [publicRoute, privateRoute]) {
      const limiter = routes.indexOf('uploadRateLimiter', routeStart);
      const guard = routes.indexOf('uploadConcurrencyGuard', routeStart);
      const multer = routes.indexOf("upload.single('file')", routeStart);
      expect(routeStart).toBeGreaterThanOrEqual(0);
      expect(limiter).toBeGreaterThan(routeStart);
      expect(guard).toBeGreaterThan(limiter);
      expect(multer).toBeGreaterThan(guard);
    }
  });
});
