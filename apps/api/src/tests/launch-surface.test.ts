import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('launch surface hardening', () => {
  it('does not expose the business team stub as a production API feature', () => {
    const apiRoutes = readSource('../routes/index.ts');
    const roadmap = readSource('../../../../docs/FEATURE_ROADMAP_STATUS_AND_TESTING.md');

    expect(apiRoutes).not.toContain("businessTeamsRouter");
    expect(apiRoutes).not.toContain("apiRouter.use('/business/team'");
    expect(roadmap).toContain('Team accounts for businesses** | Deferred');
    expect(roadmap).toContain('Do not advertise team seats as an active launch feature');
  });

  it('does not expose the removed legacy immediate-payment bookings API', () => {
    const apiRoutes = readSource('../routes/index.ts');
    const sharedIndex = readSource('../../../../packages/shared/src/index.ts');

    expect(apiRoutes).not.toContain("bookingsRouter");
    expect(apiRoutes).not.toContain("apiRouter.use('/bookings'");
    expect(sharedIndex).not.toContain("./bookings.js");
  });

  it('keeps the production worker blueprint compatible with production env guards', () => {
    const renderBlueprint = readSource('../../../../render.yaml');
    const workerSection = renderBlueprint.split('name: mohandishub-worker')[1] ?? '';

    expect(workerSection).toContain('key: NODE_ENV');
    expect(workerSection).toContain('value: production');
    expect(workerSection).toContain('key: OTP_EMAIL_PROVIDER');
    expect(workerSection).toContain('value: brevo');
    expect(workerSection).toContain('key: VERIFICATION_PROVIDER');
    expect(workerSection).toContain('key: CORS_ORIGIN');
    expect(workerSection).toContain('key: API_PUBLIC_URL');
    expect(workerSection).toContain('key: WEB_PUBLIC_URL');
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
    const apiSection = renderBlueprint.split('name: mohandishub-api')[1]?.split('name: mohandishub-worker')[0] ?? '';

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
