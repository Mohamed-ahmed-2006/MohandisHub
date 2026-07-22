import { afterEach, describe, expect, it, vi } from 'vitest';

const originalProcessEnv = { ...process.env };

const isolatedEnvKeys = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'CORS_ORIGIN',
  'CORS_EXTRA_ORIGINS',
  'API_PUBLIC_URL',
  'WEB_PUBLIC_URL',
  'DB_POOL_MAX',
  'DB_IDLE_TIMEOUT_MS',
  'TRUST_PROXY',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN_DAYS',
  'AUTH_CROSS_SITE_REFRESH_COOKIE',
  'ALLOW_FACTORY_RESET',
  'VERIFICATION_PROVIDER',
  'IDENFY_API_KEY',
  'IDENFY_API_SECRET',
  'DIDIT_API_KEY',
  'DIDIT_WEBHOOK_SECRET',
  'DIDIT_WORKFLOW_ID',
  'DIDIT_BASE_URL',
  'OTP_EMAIL_PROVIDER',
  'OTP_SMS_PROVIDER',
  'BREVO_API_KEY',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'EMAIL_FROM',
  'EMAIL_LOGO_URL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'SMS_HTTP_ENDPOINT',
  'SMS_HTTP_API_KEY',
  'SMS_HTTP_FROM',
  'META_WHATSAPP_TOKEN',
  'META_WHATSAPP_PHONE_NUMBER_ID',
  'META_WHATSAPP_OTP_TEMPLATE',
  'META_WHATSAPP_LANGUAGE',
  'WEB_PUSH_ENABLED',
  'WEB_PUSH_VAPID_PUBLIC_KEY',
  'WEB_PUSH_VAPID_PRIVATE_KEY',
  'WEB_PUSH_SUBJECT',
  'CRYPTOMUS_MERCHANT_ID',
  'CRYPTOMUS_API_KEY',
  'CRYPTOMUS_WEBHOOK_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PUBLISHABLE_KEY',
  'NOWPAYMENTS_API_KEY',
  'NOWPAYMENTS_IPN_SECRET',
  'NOWPAYMENTS_AUTH_EMAIL',
  'NOWPAYMENTS_AUTH_PASSWORD',
  'NOWPAYMENTS_FIAT_ENABLED',
  'NOWPAYMENTS_CUSTODY_ENABLED',
  'NOWPAYMENTS_MASS_PAYOUTS_ENABLED',
  'NOWPAYMENTS_WITHDRAWALS_ENABLED',
  'NOWPAYMENTS_MANUAL_PAYOUT_VERIFY',
  'NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT',
  'NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY',
  'NOWPAYMENTS_ALLOWED_PAY_CURRENCIES',
  'NOWPAYMENTS_LIVE_REQUIRED',
  'PAYMOB_SECRET_KEY',
  'PAYMOB_PUBLIC_KEY',
  'PAYMOB_HMAC_SECRET',
  'PAYMOB_INTEGRATION_IDS',
  'PAYMOB_API_BASE_URL',
  'PAYMOB_DEPOSITS_ENABLED',
  'PAYMOB_WITHDRAWALS_ENABLED',
  'PAYMOB_PAYOUT_CLIENT_ID',
  'PAYMOB_PAYOUT_CLIENT_SECRET',
  'PAYMOB_PAYOUT_BASE_URL',
  'AGORA_APP_ID',
  'AGORA_APP_CERTIFICATE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SENTRY_DSN',
  'RETENTION_SWEEP_INTERVAL_MS',
  'RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS',
  'RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS',
  'RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS',
  'RETENTION_VERIFICATION_REQUESTS_DAYS',
  'RETENTION_CHAT_MESSAGES_DAYS',
  'RETENTION_UPLOADS_DAYS',
  'RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED',
  'RETENTION_BID_MESSAGE_ATTACHMENT_DAYS',
  'RETENTION_VERIFIED_PRIVATE_UPLOADS_DAYS',
  'PUBLIC_UPLOAD_MAX_BYTES_CEILING',
];

const requiredProductionEnv: Record<string, string> = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
  DATABASE_URL:
    'postgresql://postgres:password@db.example.supabase.co:5432/postgres?sslmode=require',
  CORS_ORIGIN: 'https://mohandishub.app',
  API_PUBLIC_URL: 'https://api.mohandishub.app',
  WEB_PUBLIC_URL: 'https://mohandishub.app',
  SENTRY_DSN: 'https://public@example.ingest.sentry.io/1',
  OTP_EMAIL_PROVIDER: 'resend',
  RESEND_API_KEY: 'resend-key',
  EMAIL_FROM: 'MohandisHub <otp@mail.mohandishub.app>',
  VERIFICATION_PROVIDER: 'didit',
  DIDIT_API_KEY: 'didit-key',
  DIDIT_WEBHOOK_SECRET: 'didit-secret',
  DIDIT_WORKFLOW_ID: '11111111-1111-4111-8111-111111111111',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

function stubProductionEnv(overrides: Record<string, string | undefined> = {}): void {
  vi.unstubAllEnvs();
  process.env = { ...originalProcessEnv };
  for (const key of isolatedEnvKeys) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries({ ...requiredProductionEnv, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      vi.stubEnv(key, value);
    }
  }
}

async function importFreshEnv() {
  vi.resetModules();
  vi.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
  return import('../config/env.js');
}

describe('production environment validation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalProcessEnv };
    vi.resetModules();
    vi.doUnmock('dotenv');
  });

  it('accepts the minimum production launch configuration', async () => {
    stubProductionEnv();

    const mod = await importFreshEnv();

    expect(mod.env.NODE_ENV).toBe('production');
    expect(mod.env.DATABASE_URL).toBe(requiredProductionEnv.DATABASE_URL);
    expect(mod.env.OTP_EMAIL_PROVIDER).toBe('resend');
  });

  it('fails fast when the production database URL is missing', async () => {
    stubProductionEnv({ DATABASE_URL: undefined });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('fails fast when the production database URL permits an unencrypted connection', async () => {
    stubProductionEnv({
      DATABASE_URL: 'postgresql://postgres:password@db.example.supabase.co:5432/postgres',
    });
    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');

    stubProductionEnv({
      DATABASE_URL:
        'postgresql://postgres:password@db.example.supabase.co:5432/postgres?sslmode=disable',
    });
    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('rejects loopback, insecure, or mismatched production CORS origins', async () => {
    stubProductionEnv({ CORS_ORIGIN: 'http://localhost:3000' });
    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');

    stubProductionEnv({ CORS_ORIGIN: 'http://mohandishub.app' });
    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');

    stubProductionEnv({ CORS_ORIGIN: 'https://admin.mohandishub.app' });
    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('rejects copied placeholder or reused JWT secrets in production', async () => {
    stubProductionEnv({
      JWT_SECRET: 'change-me-to-a-random-secret-at-least-32-chars',
      JWT_REFRESH_SECRET: 'change-me-to-another-random-secret-at-least-32',
    });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');

    stubProductionEnv({
      JWT_SECRET: 'prod-secret-access-token-unique-value-123456',
      JWT_REFRESH_SECRET: 'prod-secret-access-token-unique-value-123456',
    });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('requires Resend, Didit, Supabase storage, public URLs, and Sentry in production', async () => {
    stubProductionEnv({
      API_PUBLIC_URL: undefined,
      WEB_PUBLIC_URL: undefined,
      SENTRY_DSN: undefined,
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
      DIDIT_API_KEY: undefined,
      DIDIT_WEBHOOK_SECRET: undefined,
      DIDIT_WORKFLOW_ID: undefined,
      SUPABASE_URL: undefined,
      SUPABASE_SERVICE_ROLE_KEY: undefined,
    });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('keeps Paymob optional until feature flags are enabled', async () => {
    stubProductionEnv({
      PAYMOB_DEPOSITS_ENABLED: 'false',
      PAYMOB_WITHDRAWALS_ENABLED: 'false',
      PAYMOB_SECRET_KEY: undefined,
      PAYMOB_PUBLIC_KEY: undefined,
      PAYMOB_HMAC_SECRET: undefined,
      PAYMOB_INTEGRATION_IDS: undefined,
      PAYMOB_PAYOUT_CLIENT_ID: undefined,
      PAYMOB_PAYOUT_CLIENT_SECRET: undefined,
      PAYMOB_PAYOUT_BASE_URL: undefined,
    });

    const mod = await importFreshEnv();

    expect(mod.env.PAYMOB_DEPOSITS_ENABLED).toBe(false);
    expect(mod.env.PAYMOB_WITHDRAWALS_ENABLED).toBe(false);
  });

  it('rejects enabled Paymob withdrawals without production payout configuration', async () => {
    stubProductionEnv({
      PAYMOB_WITHDRAWALS_ENABLED: 'true',
      PAYMOB_PAYOUT_CLIENT_ID: 'client-id',
      PAYMOB_PAYOUT_CLIENT_SECRET: 'client-secret',
      PAYMOB_PAYOUT_BASE_URL: 'https://stagingpayouts.paymobsolutions.com',
    });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });

  it('allows Paymob deposits to be runtime-gated when production keys are not active yet', async () => {
    stubProductionEnv({
      PAYMOB_DEPOSITS_ENABLED: 'true',
      PAYMOB_SECRET_KEY: 'secret',
      PAYMOB_PUBLIC_KEY: undefined,
      PAYMOB_HMAC_SECRET: undefined,
      PAYMOB_INTEGRATION_IDS: undefined,
    });

    const mod = await importFreshEnv();

    expect(mod.env.PAYMOB_DEPOSITS_ENABLED).toBe(true);
    expect(mod.env.PAYMOB_PUBLIC_KEY).toBeUndefined();
    expect(mod.env.PAYMOB_HMAC_SECRET).toBeUndefined();
  });

  it('rejects unsafe global upload retention in production', async () => {
    stubProductionEnv({ RETENTION_UPLOADS_DAYS: '30' });

    await expect(importFreshEnv()).rejects.toThrow('Production provider configuration failed');
  });
});
