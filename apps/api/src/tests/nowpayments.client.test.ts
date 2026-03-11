import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  normalizeNowPaymentsApiKey,
  verifyNowPaymentsIpnSignature,
} from '../lib/nowpayments.client.js';

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortObjectDeep(record[key]);
    }
    return sorted;
  }
  return value;
}

describe('nowpayments.client', () => {
  it('normalizes api key prefix', () => {
    expect(normalizeNowPaymentsApiKey('api:abc123')).toBe('abc123');
    expect(normalizeNowPaymentsApiKey('plain-key')).toBe('plain-key');
  });

  it('verifies sorted-json HMAC signatures', () => {
    const payload = {
      payment_status: 'finished',
      order_id: 'order_123',
      amount: 100,
      nested: { b: 2, a: 1 },
    };
    const rawBody = JSON.stringify(payload);
    const canonical = JSON.stringify(sortObjectDeep(payload));
    const signature = createHmac('sha512', 'secret').update(canonical).digest('hex');

    expect(verifyNowPaymentsIpnSignature(rawBody, signature, 'secret')).toBe(true);
    expect(verifyNowPaymentsIpnSignature(rawBody, `${signature}bad`, 'secret')).toBe(false);
  });
});
