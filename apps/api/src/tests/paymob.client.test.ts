import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Replica of the canonical Paymob HMAC field order (see paymob.client.ts).
const HMAC_FIELDS = [
  'amount_cents',
  'created_at',
  'currency',
  'error_occured',
  'has_parent_transaction',
  'id',
  'integration_id',
  'is_3d_secure',
  'is_auth',
  'is_capture',
  'is_refunded',
  'is_standalone_payment',
  'is_voided',
  'order.id',
  'owner',
  'pending',
  'source_data.pan',
  'source_data.sub_type',
  'source_data.type',
  'success',
] as const;

function readPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function toHmacValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  return '';
}

function computeExpectedHmac(transaction: Record<string, unknown>, secret: string): string {
  const concatenated = HMAC_FIELDS.map((field) => toHmacValue(readPath(transaction, field))).join('');
  return createHmac('sha512', secret).update(concatenated).digest('hex');
}

function setBaseEnv(): void {
  // env.ts requires these to parse; stub so the test is self-contained.
  vi.stubEnv('JWT_SECRET', 'x'.repeat(40));
  vi.stubEnv('JWT_REFRESH_SECRET', 'y'.repeat(40));
}

const sampleTransaction: Record<string, unknown> = {
  amount_cents: 15000,
  created_at: '2026-06-05T10:00:00.000000',
  currency: 'EGP',
  error_occured: false,
  has_parent_transaction: false,
  id: 123456,
  integration_id: 4242,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refunded: false,
  is_standalone_payment: true,
  is_voided: false,
  order: { id: 987654, merchant_order_id: 'pm_dep_abc_1' },
  owner: 55,
  pending: false,
  source_data: { pan: '2345', sub_type: 'MasterCard', type: 'card' },
  success: true,
};

describe('paymob.client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('treats deposits as not configured until env keys + flag are present', async () => {
    setBaseEnv();
    vi.stubEnv('PAYMOB_DEPOSITS_ENABLED', 'false');
    vi.resetModules();
    const mod = await import('../lib/paymob.client.js');

    expect(mod.isPaymobDepositConfigured()).toBe(false);
    await expect(
      mod.createPaymobIntention({
        amountEgp: 100,
        specialReference: 'pm_dep_test',
        billingData: { first_name: 'A', last_name: 'B', email: 'a@b.co', phone_number: 'NA' },
        notificationUrl: 'https://api.example.com/api/wallet/paymob/webhook',
        redirectionUrl: 'https://app.example.com/wallet',
      }),
    ).rejects.toBeInstanceOf(mod.PaymobNotConfiguredError);
  });

  it('treats payouts as not configured until env keys + flag are present', async () => {
    setBaseEnv();
    vi.stubEnv('PAYMOB_WITHDRAWALS_ENABLED', 'false');
    vi.resetModules();
    const mod = await import('../lib/paymob.client.js');

    expect(mod.isPaymobPayoutConfigured()).toBe(false);
    await expect(mod.authenticatePaymobPayout()).rejects.toBeInstanceOf(mod.PaymobNotConfiguredError);
  });

  it('verifies the transaction-callback HMAC over the canonical field order', async () => {
    setBaseEnv();
    vi.stubEnv('PAYMOB_HMAC_SECRET', 'super-secret');
    vi.resetModules();
    const mod = await import('../lib/paymob.client.js');

    const validHmac = computeExpectedHmac(sampleTransaction, 'super-secret');
    expect(mod.verifyPaymobHmac(sampleTransaction, validHmac)).toBe(true);
    expect(mod.verifyPaymobHmac(sampleTransaction, `${validHmac}00`)).toBe(false);
    expect(mod.verifyPaymobHmac(sampleTransaction, null)).toBe(false);
  });
});
