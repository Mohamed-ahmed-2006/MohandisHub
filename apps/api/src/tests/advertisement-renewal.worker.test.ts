import { afterEach, describe, expect, it, vi } from 'vitest';

import { startAdvertisementBillingWorker } from '../modules/advertisements/advertisement-billing.worker.js';
import { buildRenewalNotification } from '../modules/advertisements/advertisement-renewal.notifier.js';
import type { AdRenewalEventType } from '../modules/advertisements/advertisements.types.js';

// ---------------------------------------------------------------------------
// The parts of automatic renewal that need no database at all.
// ---------------------------------------------------------------------------
// Three things are asserted here because they are pure, and asserting them
// against a real PostgreSQL server would only make them slower to run and
// harder to read:
//
//   * the sweep cadence is a CONFIGURED number with real bounds, so a typo in
//     an environment variable cannot turn the worker into a hot loop;
//   * the worker starts nothing in a test process, so importing it can never
//     begin charging anybody;
//   * what a provider is actually TOLD, and what travels in the payload — the
//     one place a balance or a ledger id could leak onto a push notification.
//
// Row-level behaviour, concurrency and exactly-once guarantees live in
// advertisements.automatic-renewal.pg.test.ts, against an actual server.
// ---------------------------------------------------------------------------

const originalProcessEnv = { ...process.env };

async function importFreshEnv() {
  vi.resetModules();
  vi.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
  return import('../config/env.js');
}

describe('the sweep cadence is configured, and bounded', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...originalProcessEnv };
    vi.resetModules();
    vi.doUnmock('dotenv');
  });

  it('defaults to one minute against a 168-hour period', async () => {
    delete process.env.AD_BILLING_SWEEP_INTERVAL_MS;
    delete process.env.AD_BILLING_SWEEP_BATCH_SIZE;
    delete process.env.AD_RENEWAL_REMINDER_HOURS;
    const mod = await importFreshEnv();

    expect(mod.env.AD_BILLING_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(mod.env.AD_BILLING_SWEEP_BATCH_SIZE).toBe(25);
    expect(mod.env.AD_RENEWAL_REMINDER_HOURS).toBe(24);
  });

  it('accepts a deliberate override', async () => {
    vi.stubEnv('AD_BILLING_SWEEP_INTERVAL_MS', '300000');
    vi.stubEnv('AD_BILLING_SWEEP_BATCH_SIZE', '5');
    vi.stubEnv('AD_RENEWAL_REMINDER_HOURS', '48');
    const mod = await importFreshEnv();

    expect(mod.env.AD_BILLING_SWEEP_INTERVAL_MS).toBe(300_000);
    expect(mod.env.AD_BILLING_SWEEP_BATCH_SIZE).toBe(5);
    expect(mod.env.AD_RENEWAL_REMINDER_HOURS).toBe(48);
  });

  it('refuses to boot on an interval that would make a hot loop', async () => {
    // The floor exists because this worker opens a transaction per campaign.
    // One millisecond is a typo, not a configuration — and the process fails
    // to start rather than silently substituting a number nobody chose.
    vi.stubEnv('AD_BILLING_SWEEP_INTERVAL_MS', '1');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(importFreshEnv()).rejects.toThrow('Environment validation failed');
  });

  it('refuses to boot on an unbounded batch size', async () => {
    vi.stubEnv('AD_BILLING_SWEEP_BATCH_SIZE', '100000');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(importFreshEnv()).rejects.toThrow('Environment validation failed');
  });

  it('refuses a reminder window of zero, or one longer than the period', async () => {
    vi.stubEnv('AD_RENEWAL_REMINDER_HOURS', '0');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(importFreshEnv()).rejects.toThrow('Environment validation failed');

    vi.unstubAllEnvs();
    vi.stubEnv('AD_RENEWAL_REMINDER_HOURS', '400');
    await expect(importFreshEnv()).rejects.toThrow('Environment validation failed');
  });
});

describe('the worker starts nothing in a test process', () => {
  it('returns a handle whose stop resolves, and never sweeps', async () => {
    const sweep = vi.fn();
    const worker = startAdvertisementBillingWorker({
      service: { runLifecycleSweep: sweep } as never,
      intervalMs: 5_000,
    });

    await expect(worker.stop()).resolves.toBeUndefined();
    expect(sweep).not.toHaveBeenCalled();
  });
});

describe('what the advertiser is told', () => {
  const event = (
    eventType: AdRenewalEventType,
    detail: Record<string, unknown> = {},
    boundary = 3,
  ) => ({
    advertisement_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    event_type: eventType,
    boundary_period_number: boundary,
    detail,
  });

  it('has copy and a deep-linkable payload for every boundary event', () => {
    const types: AdRenewalEventType[] = [
      'initial_activated',
      'renewal_succeeded',
      'renewal_failed_insufficient_credits',
      'renewal_failed_pricing_unavailable',
      'manual_renewal_required',
      'auto_renew_stopped_max_weeks',
      'auto_renew_stopped_end_date',
      'renewal_reminder',
      'auto_renew_enabled',
      'auto_renew_disabled',
    ];

    for (const type of types) {
      const built = buildRenewalNotification(event(type), 'Structural surveys in Giza');
      expect(built.type.startsWith('advertisement_')).toBe(true);
      expect(built.title.length).toBeGreaterThan(0);
      expect(built.message.length).toBeGreaterThan(0);
      expect(built.payload.advertisementId).toBe('aaaaaaaa-0000-4000-8000-000000000001');
      expect(built.payload.adTitle).toBe('Structural surveys in Giza');
      expect(built.payload.periodNumber).toBe(3);
    }
  });

  it('says nothing was charged wherever nothing was charged', () => {
    for (const type of [
      'renewal_failed_insufficient_credits',
      'renewal_failed_pricing_unavailable',
      'auto_renew_stopped_max_weeks',
      'auto_renew_stopped_end_date',
    ] as AdRenewalEventType[]) {
      expect(buildRenewalNotification(event(type), 'Ad').message).toMatch(/Nothing was charged/);
    }
  });

  it('never promises a refund, and never contradicts the 168-hour period', () => {
    for (const type of [
      'initial_activated',
      'renewal_succeeded',
      'manual_renewal_required',
      'auto_renew_disabled',
    ] as AdRenewalEventType[]) {
      const built = buildRenewalNotification(event(type), 'Ad');
      expect(built.message).not.toMatch(/refund/i);
      expect(built.message).not.toMatch(/per day|daily/i);
    }
    expect(buildRenewalNotification(event('renewal_succeeded'), 'Ad').message).toContain(
      '168 hours',
    );
  });

  it('carries no balance, wallet id, charge id or ledger reference', () => {
    const built = buildRenewalNotification(
      event('renewal_failed_insufficient_credits', {
        requiredMhc: 25,
        // Anything a future writer puts on the JSONB column that is not on the
        // allow-list must not reach the payload.
        balance: 3,
        walletId: 'wallet-1',
        chargeId: 'charge-1',
        transactionId: 'txn-1',
      }),
      'Ad',
    );

    expect(built.payload.requiredMhc).toBe(25);
    expect(built.payload).not.toHaveProperty('balance');
    expect(built.payload).not.toHaveProperty('walletId');
    expect(built.payload).not.toHaveProperty('chargeId');
    expect(built.payload).not.toHaveProperty('transactionId');
    expect(JSON.stringify(built)).not.toMatch(/EGP|£/);
  });

  it('passes only the figures a screen already shows', () => {
    const built = buildRenewalNotification(
      event('renewal_succeeded', {
        mhcCharged: 25,
        periodEndsAt: '2026-08-07T00:00:00.000Z',
      }),
      'Ad',
    );

    expect(built.payload.mhcCharged).toBe(25);
    expect(built.payload.periodEndsAt).toBe('2026-08-07T00:00:00.000Z');
  });

  it('lands every advertisement event on the campaign it is about', async () => {
    const { NOTIFICATION_NAVIGATION_MAP } = await import('@mohandishub/shared');

    for (const type of [
      'advertisement_activated',
      'advertisement_renewed',
      // Including the empty-balance one. The credits screen knows nothing about
      // the campaign, so a provider sent there had no way back and no way to
      // retry; the campaign panel carries Add credits, the campaign and Retry
      // renewal together.
      'advertisement_renewal_failed_credits',
      'advertisement_renewal_failed_pricing',
      'advertisement_renewal_required',
      'advertisement_renewal_reminder',
      'advertisement_auto_renew_stopped_max_weeks',
      'advertisement_auto_renew_stopped_end_date',
      'advertisement_auto_renew_enabled',
      'advertisement_auto_renew_disabled',
    ] as const) {
      expect(NOTIFICATION_NAVIGATION_MAP[type]).toBe('/app/advertisements');
    }
  });
});
