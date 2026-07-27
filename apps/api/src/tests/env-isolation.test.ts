import { afterEach, describe, expect, it, vi } from 'vitest';

const originalProcessEnv = { ...process.env };

function useBaseEnv(
  deployment: 'development' | 'test' | 'staging',
  overrides: Record<string, string> = {},
): void {
  process.env = {
    DEPLOYMENT_ENV: deployment,
    NODE_ENV: deployment === 'test' ? 'test' : 'development',
    JWT_SECRET: 'test-access-secret-with-at-least-32-characters',
    JWT_REFRESH_SECRET: 'test-refresh-secret-with-at-least-32-characters',
    ...overrides,
  };
}

async function importFreshEnv(configMock: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock('dotenv', () => ({ config: configMock }));
  return import('../config/env.js');
}

describe('environment file isolation', () => {
  afterEach(() => {
    process.env = { ...originalProcessEnv };
    vi.resetModules();
    vi.doUnmock('dotenv');
  });

  it('does not load any dotenv file for unit tests', async () => {
    useBaseEnv('test');
    const configMock = vi.fn(() => ({ parsed: {} }));

    const mod = await importFreshEnv(configMock);

    expect(mod.env.DEPLOYMENT_ENV).toBe('test');
    expect(configMock).not.toHaveBeenCalled();
  });

  it('loads only the deliberately named development file', async () => {
    useBaseEnv('development');
    const configMock = vi.fn(() => ({ parsed: {} }));

    await importFreshEnv(configMock);

    expect(configMock).toHaveBeenCalledOnce();
    const firstCall = configMock.mock.calls[0] as unknown[] | undefined;
    const configuredPath = (firstCall?.[0] as { path?: unknown } | undefined)?.path;
    expect(configuredPath).toBeTypeOf('string');
    expect(String(configuredPath)).toMatch(/apps[\\/]api[\\/]\.env\.development\.local$/);
  });

  it('loads only the deliberately named E2E file for the local E2E launcher', async () => {
    useBaseEnv('test', { MOHANDISHUB_E2E: '1' });
    const configMock = vi.fn(() => ({ parsed: {} }));

    await importFreshEnv(configMock);

    expect(configMock).toHaveBeenCalledOnce();
    const firstCall = configMock.mock.calls[0] as unknown[] | undefined;
    const configuredPath = (firstCall?.[0] as { path?: unknown } | undefined)?.path;
    expect(configuredPath).toBeTypeOf('string');
    expect(String(configuredPath)).toMatch(/apps[\\/]api[\\/]\.env\.e2e\.local$/);
  });

  it('rejects production public hosts from non-production processes', async () => {
    useBaseEnv('test', { API_PUBLIC_URL: 'https://api.mohandishub.app' });

    await expect(importFreshEnv(vi.fn())).rejects.toThrow(
      'Non-production process refused a MohandisHub production public host',
    );
  });

  it('requires an explicit matching project ref for remote test Supabase', async () => {
    useBaseEnv('test', {
      ALLOW_TEST_REMOTE_SERVICES: 'true',
      SUPABASE_URL: 'https://stagingref12345678.supabase.co',
    });

    await expect(importFreshEnv(vi.fn())).rejects.toThrow(
      'Remote Supabase use requires NON_PRODUCTION_SUPABASE_PROJECT_REF',
    );

    useBaseEnv('test', {
      ALLOW_TEST_REMOTE_SERVICES: 'true',
      SUPABASE_URL: 'https://stagingref12345678.supabase.co',
      NON_PRODUCTION_SUPABASE_PROJECT_REF: 'differentref12345678',
    });
    await expect(importFreshEnv(vi.fn())).rejects.toThrow(
      'Configured Supabase target does not match',
    );
  });

  it('fails staging startup when sandbox integrations are missing', async () => {
    useBaseEnv('staging');

    await expect(importFreshEnv(vi.fn())).rejects.toThrow('Staging provider configuration failed');
  });

  it('accepts only the official NOWPayments sandbox endpoint in staging', async () => {
    const stagingRef = 'stagingref12345678';
    const stagingEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://postgres:password@db.${stagingRef}.supabase.co:5432/postgres?sslmode=require`,
      API_PUBLIC_URL: 'https://api.staging.example.test',
      WEB_PUBLIC_URL: 'https://staging.example.test',
      CORS_ORIGIN: 'https://staging.example.test',
      SUPABASE_URL: `https://${stagingRef}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: 'staging-service-role-key',
      NON_PRODUCTION_SUPABASE_PROJECT_REF: stagingRef,
      OTP_EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: 'staging-resend-key',
      VERIFICATION_PROVIDER: 'didit',
      DIDIT_API_KEY: 'staging-didit-key',
      DIDIT_WEBHOOK_SECRET: 'staging-didit-webhook',
      DIDIT_WORKFLOW_ID: '11111111-1111-4111-8111-111111111111',
      NOWPAYMENTS_API_KEY: 'staging-nowpayments-key',
      NOWPAYMENTS_IPN_SECRET: 'staging-nowpayments-ipn',
      NOWPAYMENTS_CRYPTO_DEPOSITS_ENABLED: 'true',
      ADVERTISEMENTS_ENABLED: 'true',
    };
    useBaseEnv('staging', stagingEnv);

    const mod = await importFreshEnv(vi.fn());
    expect(mod.env.NOWPAYMENTS_API_BASE_URL).toBe('https://api-sandbox.nowpayments.io/v1');

    useBaseEnv('staging', {
      ...stagingEnv,
      NOWPAYMENTS_API_BASE_URL: 'https://api.nowpayments.io/v1',
    });
    await expect(importFreshEnv(vi.fn())).rejects.toThrow('Staging provider configuration failed');
  });
});
