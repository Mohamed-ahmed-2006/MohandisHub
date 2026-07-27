import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..', '..');
const readFromRoot = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

describe('Phase 7 publish readiness hardening', () => {
  it('adds API security headers with Helmet', () => {
    const app = readFromRoot('apps/api/src/app.ts');
    const pkg = readFromRoot('apps/api/package.json');

    expect(pkg).toContain('"helmet"');
    expect(app).toContain("import helmet from 'helmet'");
    expect(app).toContain('app.use(');
    expect(app).toContain('helmet({');
    expect(app).toContain("crossOriginResourcePolicy: { policy: 'cross-origin' }");
  });

  it('tightens Next image remote patterns to configured hosts', () => {
    const nextConfig = readFromRoot('apps/web/next.config.ts');

    expect(nextConfig).toContain('remoteImagePatterns');
    expect(nextConfig).toContain('NEXT_PUBLIC_API_URL');
    expect(nextConfig).toContain('SUPABASE_URL');
    expect(nextConfig).not.toContain("hostname: '**'");
  });

  it('reports worker readiness, heartbeat, and failures to logs/Sentry', () => {
    const worker = readFromRoot('apps/api/src/worker.ts');
    const reservationWorker = readFromRoot(
      'apps/api/src/modules/reservations/reservations.lifecycle-worker.ts',
    );
    const retentionWorker = readFromRoot('apps/api/src/modules/retention/retention.worker.ts');

    expect(worker).toContain('initSentry()');
    expect(worker).toContain("logger.info('Worker ready'");
    expect(worker).toContain("logger.info('Worker heartbeat'");
    expect(worker).toContain("process.on('unhandledRejection'");
    expect(reservationWorker).toContain('captureException(error)');
    expect(retentionWorker).toContain('captureException(error)');
  });

  it('configures isolated local E2E targets without starting the database-backed API', () => {
    const config = readFromRoot('apps/e2e/playwright.config.ts');
    const webLauncher = readFromRoot('scripts/e2e-dev-web.mjs');
    const apiStub = readFromRoot('scripts/e2e-local-stub-api.mjs');

    expect(config).toContain('const apiBaseURL');
    expect(config).toContain('process.env.E2E_API_BASE_URL');
    expect(config).toContain('node scripts/e2e-local-stub-api.mjs');
    expect(config).toContain('node scripts/e2e-dev-web.mjs');
    expect(config).toContain('/health');
    expect(config).not.toContain('node scripts/e2e-dev-api.mjs');
    expect(webLauncher).toContain("DEPLOYMENT_ENV: 'test'");
    expect(webLauncher).toContain('NEXT_PUBLIC_API_URL: apiUrl.origin');
    expect(apiStub).toContain('only accepts a loopback');
  });

  it('enforces the current API coverage baseline', () => {
    const config = readFromRoot('apps/api/vitest.config.ts');

    expect(config).toContain('lines: 16');
    expect(config).toContain('functions: 9');
    expect(config).toContain('branches: 7');
    expect(config).toContain('statements: 15');
  });
});
