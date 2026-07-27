import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('launch surface hardening', () => {
  it('exposes business teams only after replacing the old production stub', () => {
    const apiRoutes = readSource('../routes/index.ts');
    const roadmap = readSource('../../../../docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md');

    expect(apiRoutes).toContain('businessTeamsRouter');
    expect(apiRoutes).toContain("apiRouter.use('/business-teams'");
    expect(roadmap).toMatch(/Team accounts for businesses\*\*\s+\|\s+Active/);
    expect(roadmap).toContain('Owner-managed business teams are active with roles and invites');
  });

  it('does not expose the removed legacy immediate-payment bookings API', () => {
    const apiRoutes = readSource('../routes/index.ts');
    const sharedIndex = readSource('../../../../packages/shared/src/index.ts');

    expect(apiRoutes).not.toContain('bookingsRouter');
    expect(apiRoutes).not.toContain("apiRouter.use('/bookings'");
    expect(sharedIndex).not.toContain('./bookings.js');
  });

  it('keeps the production worker blueprint compatible with production env guards', () => {
    const renderBlueprint = readSource('../../../../render.yaml');
    const apiSection =
      renderBlueprint.split('name: mohandishub-api')[1]?.split('name: mohandishub-worker')[0] ?? '';
    const workerSection = renderBlueprint.split('name: mohandishub-worker')[1] ?? '';

    expect(apiSection).not.toContain('plan: free');
    expect(apiSection).toContain('plan: starter');
    expect(apiSection).toContain('key: TRUST_PROXY');
    expect(apiSection).toContain('value: 1');
    expect(apiSection).toContain('key: CORS_ORIGIN');
    expect(apiSection).toContain('value: https://mohandishub.app');
    expect(apiSection).toContain('key: API_PUBLIC_URL');
    expect(apiSection).toContain('value: https://api.mohandishub.app');
    expect(apiSection).toContain('key: WEB_PUBLIC_URL');
    expect(apiSection).toContain('value: https://mohandishub.app');
    expect(apiSection).toContain('key: SENTRY_DSN');
    expect(apiSection).toContain('key: BACKUP_PROVIDER');
    expect(apiSection).toContain('value: supabase');
    expect(apiSection).toContain('key: BACKUP_SUPABASE_PROJECT_REF');
    expect(apiSection).toContain('key: BACKUP_SUPABASE_ACCESS_TOKEN');
    expect(apiSection).not.toContain('key: JWT_SECRET\n        generateValue: true');
    expect(apiSection).not.toContain('key: JWT_REFRESH_SECRET\n        generateValue: true');
    expect(apiSection).toContain('key: JWT_SECRET');
    expect(apiSection).toContain('sync: false');
    expect(workerSection).not.toContain('plan: free');
    expect(workerSection).toContain('plan: starter');
    expect(workerSection).toContain('key: NODE_ENV');
    expect(workerSection).toContain('value: production');
    expect(workerSection).toContain('key: TRUST_PROXY');
    expect(workerSection).toContain('value: 1');
    expect(workerSection).toContain('key: SENTRY_DSN');
    expect(workerSection).toContain('key: OTP_EMAIL_PROVIDER');
    expect(workerSection).toContain('value: resend');
    expect(workerSection).toContain('key: RESEND_API_KEY');
    expect(workerSection).toContain('key: VERIFICATION_PROVIDER');
    expect(workerSection).toContain('key: CORS_ORIGIN');
    expect(workerSection).toContain('key: API_PUBLIC_URL');
    expect(workerSection).toContain('key: WEB_PUBLIC_URL');
    expect(workerSection).toContain('value: https://mohandishub.app');
    expect(workerSection).toContain('value: https://api.mohandishub.app');
    expect(workerSection).toContain('key: SUPABASE_URL');
    expect(workerSection).toContain('key: SUPABASE_SERVICE_ROLE_KEY');
    expect(workerSection).toContain('key: NOWPAYMENTS_API_KEY');
    expect(workerSection).toContain('key: NOWPAYMENTS_IPN_SECRET');
    expect(workerSection).toContain('key: NOWPAYMENTS_LIVE_REQUIRED');
    expect(workerSection).toContain('key: RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS');
  });

  it('fails production startup when NOWPayments launch prerequisites are missing', () => {
    const envSource = readSource('../config/env.ts');
    const renderBlueprint = readSource('../../../../render.yaml');
    const apiSection =
      renderBlueprint.split('name: mohandishub-api')[1]?.split('name: mohandishub-worker')[0] ?? '';

    expect(envSource).toContain('NOWPAYMENTS_LIVE_REQUIRED');
    expect(envSource).toContain('NOWPAYMENTS_API_KEY = [');
    expect(envSource).toContain('NOWPAYMENTS_IPN_SECRET = [');
    expect(envSource).toContain('API_PUBLIC_URL = [');
    expect(envSource).toContain('WEB_PUBLIC_URL = [');
    expect(envSource).toContain('NOWPAYMENTS_MASS_PAYOUTS_ENABLED=true');
    expect(envSource).toContain('NOWPAYMENTS_AUTH_EMAIL = [');
    expect(apiSection).toContain('key: NOWPAYMENTS_API_KEY');
    expect(apiSection).toContain('key: NOWPAYMENTS_IPN_SECRET');
    expect(apiSection).toContain('key: NOWPAYMENTS_LIVE_REQUIRED');
    expect(apiSection).toContain('key: NOWPAYMENTS_WITHDRAWALS_ENABLED');
    expect(apiSection).toContain('key: NOWPAYMENTS_MASS_PAYOUTS_ENABLED');
    expect(apiSection).toContain('key: NOWPAYMENTS_AUTH_EMAIL');
    expect(apiSection).toContain('key: NOWPAYMENTS_AUTH_PASSWORD');
  });

  it('keeps Paymob disabled by default and blocked from production activation', () => {
    const envExample = readSource('../../.env.example');
    const envSource = readSource('../config/env.ts');
    const renderBlueprint = readSource('../../../../render.yaml');
    const apiSection =
      renderBlueprint.split('name: mohandishub-api')[1]?.split('name: mohandishub-worker')[0] ?? '';
    const appSettings = readSource('../../../../packages/shared/src/app-settings.ts');

    expect(envExample).toContain('PAYMOB_DEPOSITS_ENABLED=false');
    expect(envExample).toContain('PAYMOB_WITHDRAWALS_ENABLED=false');
    expect(appSettings).toMatch(/key: 'deposit_paymob',[\s\S]*?defaultEnabled: false/);
    expect(appSettings).toMatch(/key: 'withdrawal_paymob',[\s\S]*?defaultEnabled: false/);
    expect(envExample).toContain('Do not use staging URLs in production.');
    expect(envExample).not.toContain(
      'PAYMOB_PAYOUT_BASE_URL=https://stagingpayouts.paymobsolutions.com',
    );
    expect(envSource).toContain(
      'Paymob production withdrawals must not use a staging payout endpoint.',
    );
    expect(envSource).toContain('Paymob deposits and withdrawals are not approved for production.');
    expect(apiSection).toContain('key: PAYMOB_SECRET_KEY');
    expect(apiSection).toContain('key: PAYMOB_HMAC_SECRET');
    expect(apiSection).toContain('key: PAYMOB_PAYOUT_CLIENT_ID');
    expect(apiSection).toContain('key: PAYMOB_PAYOUT_BASE_URL');
    expect(apiSection).toContain('key: PAYMOB_DEPOSITS_ENABLED');
    expect(apiSection).toContain('value: false');
  });

  it('keeps Stripe absent while returning a deterministic legacy error', () => {
    const apiPackage = JSON.parse(readSource('../../package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const webPackage = JSON.parse(readSource('../../../../apps/web/package.json')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const walletController = readSource('../modules/wallet/wallet.controller.ts');
    const walletRoutes = readSource('../modules/wallet/wallet.routes.ts');
    const webWalletClient = readSource('../../../../apps/web/lib/wallet/client.ts');
    const envSource = readSource('../config/env.ts');

    expect({ ...apiPackage.dependencies, ...apiPackage.devDependencies }).not.toHaveProperty(
      'stripe',
    );
    expect({ ...webPackage.dependencies, ...webPackage.devDependencies }).not.toHaveProperty(
      '@stripe/stripe-js',
    );
    expect({ ...webPackage.dependencies, ...webPackage.devDependencies }).not.toHaveProperty(
      '@stripe/react-stripe-js',
    );
    expect(walletRoutes).toContain("walletRouter.post('/deposit/stripe'");
    expect(walletRoutes).toContain("walletRouter.post('/deposit/confirm-stripe'");
    expect(walletController.match(/code: 'STRIPE_DISABLED'/g)).toHaveLength(2);
    expect(walletController).not.toContain('stripe.');
    expect(webWalletClient).not.toContain('createStripeCheckout');
    expect(envSource).not.toContain('STRIPE_SECRET_KEY');
    expect(envSource).not.toContain('STRIPE_WEBHOOK_SECRET');
  });

  it('filters every unfinished payment rail through server capabilities', () => {
    const settingsService = readSource('../modules/settings/settings.service.ts');

    expect(settingsService).toContain('deposit_card: false');
    expect(settingsService).toContain('env.NOWPAYMENTS_CRYPTO_DEPOSITS_ENABLED');
    expect(settingsService).toContain('env.PAYMOB_DEPOSITS_ENABLED');
    expect(settingsService).toContain('env.PAYMOB_WITHDRAWALS_ENABLED');
    expect(settingsService).toContain('env.INSTAPAY_DEPOSITS_ENABLED');
    expect(settingsService).toContain('env.INSTAPAY_WITHDRAWALS_ENABLED');
  });

  it('makes repository migration helpers staging-only with an exact confirmation', () => {
    const migrationScript = readSource('../../../../scripts/push-migrations.mjs');

    expect(migrationScript).toContain('MIGRATION_DEPLOYMENT_ENV');
    expect(migrationScript).toContain('MIGRATE_DEDICATED_STAGING');
    expect(migrationScript).toContain('NON_PRODUCTION_SUPABASE_PROJECT_REF');
    expect(migrationScript).toContain(
      'Migration target does not match the dedicated non-production',
    );
    expect(migrationScript).not.toContain("resolve(root, 'apps/api/.env')");
  });

  it('does not allow credentialed localhost CORS by default in production', () => {
    const corsSource = readSource('../config/cors.ts');

    expect(corsSource).toContain("if (env.NODE_ENV !== 'production')");
    expect(corsSource).toContain('CORS_EXTRA_ORIGINS');
    expect(corsSource).toContain('http://localhost:3000');
  });

  it('uses the same origin allowlist for HTTP and sockets', () => {
    const appSource = readSource('../app.ts');
    const serverSource = readSource('../server.ts');

    expect(appSource).toContain('getAllowedCorsOrigins');
    expect(appSource).toContain('isCorsOriginAllowed');
    expect(serverSource).toContain('getAllowedCorsOrigins');
    expect(serverSource).toContain('isCorsOriginAllowed');
    expect(serverSource).not.toContain('origin: env.CORS_ORIGIN');
  });
});
