import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdvertisementRenewalNotifier } from '../modules/advertisements/advertisement-renewal.notifier.js';
import { AdvertisementRenewalRepository } from '../modules/advertisements/advertisement-renewal.repository.js';
import { AdvertisementRenewalService } from '../modules/advertisements/advertisement-renewal.service.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';
import { NotificationsRepository } from '../modules/notifications/notifications.repository.js';
import { HttpError } from '../utils/http-error.js';

import {
  balanceOf,
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  seedProvider,
  setActionPrice,
  type ScratchDatabase,
} from './support/pg-scratch.js';

// ---------------------------------------------------------------------------
// Automatic weekly advertisement renewal against a REAL PostgreSQL server.
// ---------------------------------------------------------------------------
// Automatic renewal is a standing instruction to debit a provider's credits
// every week with nobody watching. Everything that makes that safe is a
// property of ROWS UNDER CONCURRENCY — ten workers producing one period, a
// cancellation that lands a millisecond before the scheduler's lock, a failed
// boundary that must not become an hourly debit loop — and a hand-written model
// of PostgreSQL can only be as right as the person who wrote it.
//
// So these run against an actual server: actual FOR UPDATE SKIP LOCKED, actual
// READ COMMITTED visibility, actual partial unique indexes, actual gist
// exclusion constraints, actual CHECK constraints.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

// Ten concurrent transactions against a remote server do not fit in 5 seconds,
// and reporting latency as a defect helps nobody.
vi.setConfig({ testTimeout: 300_000, hookTimeout: 1_800_000 });

const service = (): AdvertisementsService => new AdvertisementsService();
const renewal = (): AdvertisementRenewalService => new AdvertisementRenewalService();
const notifier = (): AdvertisementRenewalNotifier => new AdvertisementRenewalNotifier();
const renewalRepo = (): AdvertisementRenewalRepository => new AdvertisementRenewalRepository();

let adminId: string;

const submit = async (userId: string, overrides: { startsAt?: string } = {}) =>
  service().createAd(
    userId,
    {
      titleEn: 'Structural surveys in Giza',
      imageUrl: 'https://cdn.example/ad.png',
      linkType: 'profile' as const,
      ...(overrides.startsAt ? { startsAt: overrides.startsAt } : {}),
    },
    null,
  );

const adRow = async (adId: string) => {
  const { rows } = await pool.query(`SELECT * FROM advertisements WHERE id = $1`, [adId]);
  return rows[0] as Record<string, unknown>;
};

const periods = async (adId: string) => {
  const { rows } = await pool.query(
    `SELECT period_number, status, renewal_source, mhc_price_snapshot::text AS price,
            action_charge_id, starts_at, ends_at,
            EXTRACT(EPOCH FROM (ends_at - starts_at))::bigint AS seconds
     FROM advertisement_campaign_periods
     WHERE advertisement_id = $1
     ORDER BY period_number`,
    [adId],
  );
  return rows as {
    period_number: number;
    status: string;
    renewal_source: string;
    price: string;
    action_charge_id: string | null;
    starts_at: string;
    ends_at: string;
    seconds: string;
  }[];
};

const periodCount = (adId: string): Promise<number> =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM advertisement_campaign_periods WHERE advertisement_id = $1`,
    [adId],
  );

const chargeCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM mhc_action_charges WHERE user_id = $1`, [userId]);

const ledgerCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM transactions WHERE user_id = $1`, [userId]);

const moneyWalletCount = (userId: string): Promise<number> =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM wallets WHERE user_id = $1 AND account_type = 'money'`,
    [userId],
  );

const events = async (adId: string) => {
  const { rows } = await pool.query(
    `SELECT event_type, boundary_period_number, notified_at, detail
     FROM advertisement_renewal_events
     WHERE advertisement_id = $1
     ORDER BY boundary_period_number, event_type`,
    [adId],
  );
  return rows as {
    event_type: string;
    boundary_period_number: number;
    notified_at: string | null;
    detail: Record<string, unknown>;
  }[];
};

const eventCount = (adId: string, eventType: string): Promise<number> =>
  countRows(
    pool,
    `SELECT count(*)::text c FROM advertisement_renewal_events
      WHERE advertisement_id = $1 AND event_type = $2`,
    [adId, eventType],
  );

const notificationCount = (userId: string, type: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM notifications WHERE user_id = $1 AND type = $2`, [
    userId,
    type,
  ]);

/**
 * Move a campaign's paid week wholly into the past.
 *
 * Both ends shift by the same amount, because `chk_ad_period_exact_week` pins
 * the window to exactly 168 hours — there is no way to fake an elapsed week by
 * shortening one, which is itself part of what is being tested.
 *
 * Already-closed weeks are pushed TWICE as far first. Without that, travelling
 * a second time would land the running week exactly where the previous one
 * already sits, and `ad_period_no_overlap` would reject the test's own setup.
 * Sixteen days is more than a period, so no intermediate row order inside
 * either statement can collide either.
 */
const timeTravelPastWeek = async (adId: string): Promise<void> => {
  await pool.query(
    `UPDATE advertisement_campaign_periods
     SET starts_at = starts_at - interval '16 days', ends_at = ends_at - interval '16 days'
     WHERE advertisement_id = $1 AND status <> 'active'`,
    [adId],
  );
  await pool.query(
    `UPDATE advertisement_campaign_periods
     SET starts_at = starts_at - interval '8 days', ends_at = ends_at - interval '8 days'
     WHERE advertisement_id = $1 AND status = 'active'`,
    [adId],
  );
  await pool.query(
    `UPDATE advertisements
     SET current_period_starts_at = current_period_starts_at - interval '8 days',
         current_period_ends_at = current_period_ends_at - interval '8 days',
         starts_at = starts_at - interval '8 days',
         expires_at = expires_at - interval '8 days',
         next_renewal_at = next_renewal_at - interval '8 days'
     WHERE id = $1`,
    [adId],
  );
};

/** A weekly campaign, approved, running its first paid week. */
const liveCampaign = async (params: { mhc: number }): Promise<{ userId: string; adId: string }> => {
  const { userId } = await seedProvider(pool, { mhc: params.mhc });
  const ad = await submit(userId);
  await service().approveAd(ad.id, adminId);
  return { userId, adId: ad.id };
};

/** Consent to automatic renewal, exactly as the provider endpoint would. */
const enableAutoRenewal = async (
  adId: string,
  userId: string,
  bounds: { maximumWeeks?: number | null; renewalEndDate?: string | null } = { maximumWeeks: 10 },
) =>
  service().setAutoRenewal(adId, userId, {
    enabled: true,
    consentAccepted: true,
    ...bounds,
  });

/** A campaign consented to automatic renewal whose week has just elapsed. */
const dueForAutoRenewal = async (params: {
  mhc: number;
  bounds?: { maximumWeeks?: number | null; renewalEndDate?: string | null };
}): Promise<{ userId: string; adId: string }> => {
  const { userId, adId } = await liveCampaign({ mhc: params.mhc });
  await enableAutoRenewal(adId, userId, params.bounds ?? { maximumWeeks: 10 });
  await timeTravelPastWeek(adId);
  return { userId, adId };
};

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('adsauto');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  // Always drop, including after a failure. No scratch database is left behind.
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  vi.restoreAllMocks();
  // Delivery is fire-and-forget from the write paths. Suppressed by default so
  // a floating promise cannot race the next test's cleanup; the suites that
  // care about notifications drive `deliverPending` explicitly, which exercises
  // exactly the same delivery code.
  vi.spyOn(AdvertisementRenewalNotifier.prototype, 'deliverSoon').mockImplementation(() => {});

  // Events before periods before charges: each is ON DELETE RESTRICT or SET
  // NULL from the next, so the order is the dependency order.
  await pool.query(`DELETE FROM advertisement_renewal_events`);
  await pool.query(`DELETE FROM advertisement_campaign_periods`);
  await pool.query(`DELETE FROM advertisements`);
  await pool.query(`DELETE FROM notifications`);
  await pool.query(`DELETE FROM mhc_action_charges`);
  await pool.query(`DELETE FROM transactions`);
  await setActionPrice(pool, 'advertisement', 25, true);
  const admin = await seedProvider(pool, { role: 'business', mhc: 0 });
  adminId = admin.userId;
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('configuration requires consent and a bound', () => {
  it('refuses to enable without explicit consent, and writes nothing', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await expect(
      service().setAutoRenewal(adId, userId, { enabled: true, maximumWeeks: 4 } as never),
    ).rejects.toMatchObject({ code: 'AD_AUTO_RENEWAL_CONSENT_REQUIRED' });

    const row = await adRow(adId);
    expect(row.auto_renew_enabled).toBe(false);
    expect(row.auto_renew_enabled_at).toBeNull();
  });

  it('refuses to enable with no bound at all', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await expect(
      service().setAutoRenewal(adId, userId, { enabled: true, consentAccepted: true }),
    ).rejects.toMatchObject({ code: 'AD_AUTO_RENEWAL_BOUND_REQUIRED' });
    expect((await adRow(adId)).auto_renew_enabled).toBe(false);
  });

  it('records who consented, when, and to which terms', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    const state = await enableAutoRenewal(adId, userId, { maximumWeeks: 4 });

    expect(state.autoRenewEnabled).toBe(true);
    const row = await adRow(adId);
    expect(row.auto_renew_enabled).toBe(true);
    expect(row.renewal_mode).toBe('automatic');
    expect(row.auto_renew_enabled_by).toBe(userId);
    expect(row.auto_renew_enabled_at).not.toBeNull();
    expect(row.auto_renew_consent_version).toBe(state.consentVersion);
  });

  it('cannot be enabled without a consent record, even by raw SQL', async () => {
    const { adId } = await liveCampaign({ mhc: 100 });

    // The consent is a CHECK, not a convention. This is the assertion that a
    // future code path cannot switch automatic renewal on and forget it.
    await expect(
      pool.query(
        `UPDATE advertisements
         SET auto_renew_enabled = true, renewal_mode = 'automatic', maximum_weeks = 4
         WHERE id = $1`,
        [adId],
      ),
    ).rejects.toThrow(/chk_advertisements_auto_renew_consent/);
  });

  it('cannot be enabled without a bound, even by raw SQL', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await expect(
      pool.query(
        `UPDATE advertisements
         SET auto_renew_enabled = true, renewal_mode = 'automatic',
             maximum_weeks = NULL, renewal_end_date = NULL,
             auto_renew_enabled_at = now(), auto_renew_enabled_by = $2
         WHERE id = $1`,
        [adId, userId],
      ),
    ).rejects.toThrow(/chk_advertisements_auto_renew_bounded/);
  });

  it('accepts both bounds and keeps both', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    const endDate = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

    const state = await enableAutoRenewal(adId, userId, { maximumWeeks: 5, renewalEndDate: endDate });

    expect(state.maximumWeeks).toBe(5);
    expect(state.renewalEndDate).not.toBeNull();
    const row = await adRow(adId);
    expect(row.maximum_weeks).toBe(5);
    expect(row.renewal_end_date).not.toBeNull();
  });

  it('refuses an end date a full 168-hour week could not fit before', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    // Three days out, with a week already running: nothing fits.
    const tooSoon = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();

    await expect(
      service().setAutoRenewal(adId, userId, {
        enabled: true,
        consentAccepted: true,
        renewalEndDate: tooSoon,
      }),
    ).rejects.toMatchObject({ code: 'AD_AUTO_RENEWAL_END_DATE_TOO_SOON' });
  });

  it('refuses a maximum week count the campaign has already used', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await expect(
      service().setAutoRenewal(adId, userId, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 1,
      }),
    ).rejects.toMatchObject({ code: 'AD_AUTO_RENEWAL_MAX_WEEKS_TOO_LOW' });
  });

  it('never charges for a configuration change', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    const before = await balanceOf(pool, userId);

    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });
    await enableAutoRenewal(adId, userId, { maximumWeeks: 8 });
    await service().setAutoRenewal(adId, userId, { enabled: false });

    expect(await balanceOf(pool, userId)).toBe(before);
    expect(await chargeCount(userId)).toBe(1); // the first week only
    expect(await periodCount(adId)).toBe(1);
  });

  it('never alters the running period', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    const before = (await periods(adId))[0]!;

    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });
    await service().setAutoRenewal(adId, userId, { enabled: false });

    const after = (await periods(adId))[0]!;
    expect(after).toEqual(before);
  });

  it('is idempotent: an identical repeat writes no second event', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });
    const first = await adRow(adId);
    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });
    const second = await adRow(adId);

    expect(second.updated_at).toEqual(first.updated_at);
    expect(await eventCount(adId, 'auto_renew_enabled')).toBe(1);
  });

  it('acknowledges a real off/on sequence twice', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });

    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });
    await service().setAutoRenewal(adId, userId, { enabled: false });
    await enableAutoRenewal(adId, userId, { maximumWeeks: 6 });

    // Two real decisions, both acknowledged. The configuration events are
    // deliberately outside the boundary dedup index for exactly this reason.
    expect(await eventCount(adId, 'auto_renew_enabled')).toBe(2);
    expect(await eventCount(adId, 'auto_renew_disabled')).toBe(1);
  });

  it('refuses a legacy campaign', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    await pool.query(`UPDATE advertisements SET billing_model = 'legacy' WHERE id = $1`, [adId]);

    await expect(
      service().setAutoRenewal(adId, userId, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 4,
      }),
    ).rejects.toMatchObject({ code: 'AD_NOT_WEEKLY' });
  });

  it('refuses a cancelled campaign, and a stranger', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 100 });
    const stranger = await seedProvider(pool, { mhc: 100 });

    await expect(
      service().setAutoRenewal(adId, stranger.userId, { enabled: false }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await service().cancelAd(adId, userId);
    await expect(
      service().setAutoRenewal(adId, userId, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 4,
      }),
    ).rejects.toMatchObject({ code: 'AD_AUTO_RENEWAL_NOT_CONFIGURABLE' });
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('the scheduler buys exactly one week', () => {
  it('renews into one complete 168-hour period', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 100 });

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result.outcome).toBe('renewed');
    const rows = await periods(adId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      period_number: 2,
      status: 'active',
      renewal_source: 'automatic',
      price: '25.00',
    });
    expect(rows[1]!.seconds).toBe('604800'); // 168 hours, to the second
    expect(rows[0]!.status).toBe('expired');
    expect(await balanceOf(pool, userId)).toBe(50);
    expect(await chargeCount(userId)).toBe(2);
    expect(await ledgerCount(userId)).toBe(2);
  });

  it('starts the new week at the charge instant, so a late worker loses nothing', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 100 });
    // Pretend the worker was down for three days after the boundary.
    await pool.query(
      `UPDATE advertisement_campaign_periods
       SET starts_at = starts_at - interval '3 days', ends_at = ends_at - interval '3 days'
       WHERE advertisement_id = $1`,
      [adId],
    );

    const before = new Date();
    await renewal().renewAutomatically(adId, { blocking: true });

    const week2 = (await periods(adId))[1]!;
    // Not backdated to the boundary: the advertiser gets a full week from now.
    expect(new Date(week2.starts_at).getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
    expect(week2.seconds).toBe('604800');
  });

  it('activates a due future start once, and only once', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const startsAt = new Date(Date.now() + 3600_000).toISOString();
    const ad = await submit(userId, { startsAt });
    await service().approveAd(ad.id, adminId);
    expect((await adRow(ad.id)).billing_status).toBe('awaiting_start');
    await pool.query(`UPDATE advertisements SET starts_at = now() - interval '1 minute' WHERE id = $1`, [
      ad.id,
    ]);

    await renewal().runLifecycleSweep({ batchSize: 10 });
    await renewal().runLifecycleSweep({ batchSize: 10 });

    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await eventCount(ad.id, 'initial_activated')).toBe(1);
  });

  it('gives two workers racing a due future start one period and one charge', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId, { startsAt: new Date(Date.now() + 3600_000).toISOString() });
    await service().approveAd(ad.id, adminId);
    await pool.query(`UPDATE advertisements SET starts_at = now() - interval '1 minute' WHERE id = $1`, [
      ad.id,
    ]);

    await Promise.allSettled([
      service().activateDueAdvertisement(ad.id),
      service().activateDueAdvertisement(ad.id),
    ]);

    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(75);
  });

  it('gives two concurrent schedulers one period, one charge and one debit', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 100 });

    await Promise.allSettled([
      renewal().renewAutomatically(adId),
      renewal().renewAutomatically(adId),
    ]);

    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await ledgerCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(50);
  });

  it('gives TEN concurrent schedulers one period and one charge', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => renewal().renewAutomatically(adId)),
    );

    const renewed = results.filter(
      (r) => r.status === 'fulfilled' && r.value.outcome === 'renewed',
    );
    expect(renewed).toHaveLength(1);
    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await ledgerCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(450);
    expect(await eventCount(adId, 'renewal_succeeded')).toBe(1);
  });

  it('refuses to open the FIRST week through the renewal path', async () => {
    // An approved campaign that never found the credits for week 1. Starting it
    // is a different operation, with its own approval and scheduled-start
    // checks — and week 1 must be `initial`, not `automatic`.
    const { userId } = await seedProvider(pool, { mhc: 0 });
    const ad = await submit(userId);
    await expect(service().approveAd(ad.id, adminId)).rejects.toMatchObject({
      code: 'MHC_INSUFFICIENT_CREDITS',
    });
    await pool.query(
      `UPDATE advertisements
       SET auto_renew_enabled = true, renewal_mode = 'automatic', maximum_weeks = 10,
           auto_renew_enabled_at = now(), auto_renew_enabled_by = advertiser_id
       WHERE id = $1`,
      [ad.id],
    );
    await pool.query(
      `UPDATE wallets SET balance = 500 WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );

    const result = await renewal().renewAutomatically(ad.id, {
      blocking: true,
      clearPause: true,
    });

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'never_started' });
    expect(await periodCount(ad.id)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(500);

    // The supported route does start it, and labels it correctly.
    await service().activateDueAdvertisement(ad.id, { requireAdvertiserId: userId });
    expect((await periods(ad.id))[0]).toMatchObject({
      period_number: 1,
      renewal_source: 'initial',
    });
    expect(Number((await adRow(ad.id)).renewal_count)).toBe(0);
  });

  it('is idempotent when the scheduler retries after a committed success', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 100 });

    await renewal().renewAutomatically(adId, { blocking: true });
    const second = await renewal().renewAutomatically(adId, { blocking: true });

    expect(second).toMatchObject({ outcome: 'skipped', reason: 'period_still_active' });
    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
  });

  it('is idempotent across repeated whole sweeps', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 200 });

    await renewal().runLifecycleSweep({ batchSize: 10 });
    await renewal().runLifecycleSweep({ batchSize: 10 });
    await renewal().runLifecycleSweep({ batchSize: 10 });

    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await eventCount(adId, 'renewal_succeeded')).toBe(1);
  });

  it('leaves no charge and no period when the transaction fails before commit', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 100 });
    const before = await balanceOf(pool, userId);
    // Fail AFTER the charge and the period insert, which is the only failure
    // window that could leave a debit behind if the boundary were not atomic.
    vi.spyOn(AdvertisementRenewalRepository.prototype, 'insertEventInTx').mockRejectedValue(
      new Error('simulated crash before commit'),
    );

    await expect(renewal().renewAutomatically(adId, { blocking: true })).rejects.toThrow(
      /simulated crash/,
    );

    vi.restoreAllMocks();
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(before);
    expect(await eventCount(adId, 'renewal_succeeded')).toBe(0);
  });

  it('buys a free week with no charge row and no ledger row', async () => {
    await setActionPrice(pool, 'advertisement', 0, true);
    const { userId, adId } = await dueForAutoRenewal({ mhc: 0 });

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result.outcome).toBe('renewed');
    const rows = await periods(adId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ price: '0.00', action_charge_id: null });
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(0);
  });

  it('uses the CURRENT admin price and never rewrites an older week', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await setActionPrice(pool, 'advertisement', 40, true);
    await renewal().renewAutomatically(adId, { blocking: true });

    const rows = await periods(adId);
    // Week 1 was bought at 25 and stays at 25 forever.
    expect(rows[0]!.price).toBe('25.00');
    // Week 2 pays what the admin charges today.
    expect(rows[1]!.price).toBe('40.00');
    expect(await balanceOf(pool, userId)).toBe(500 - 25 - 40);

    // And a later change still does not touch either snapshot.
    await setActionPrice(pool, 'advertisement', 90, true);
    const after = await periods(adId);
    expect(after[0]!.price).toBe('25.00');
    expect(after[1]!.price).toBe('40.00');
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('failure fails closed, once', () => {
  it('creates no financial row when credits run out', async () => {
    // Exactly one week's worth: week 1 empties the balance.
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    expect(await balanceOf(pool, userId)).toBe(0);

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'paused', reason: 'insufficient_credits' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(0);
  });

  it('never leaves a negative balance', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });

    const { rows } = await pool.query<{ balance: string }>(
      `SELECT balance::text FROM wallets WHERE user_id = $1`,
      [userId],
    );
    for (const row of rows) expect(parseFloat(row.balance)).toBeGreaterThanOrEqual(0);
  });

  it('stops serving the advertisement', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });

    const served = await service().resolveActiveAds({});
    expect(served.map((ad) => ad.id)).not.toContain(adId);
    const row = await adRow(adId);
    expect(row.billing_status).toBe('renewal_required');
    expect(row.auto_renew_paused_reason).toBe('insufficient_credits');
  });

  it('preserves the advertiser preference so a top-up can resume it', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });

    const row = await adRow(adId);
    // The advertiser still wants weekly renewal; they are out of credits.
    expect(row.auto_renew_enabled).toBe(true);
    expect(row.renewal_mode).toBe('automatic');
  });

  it('produces exactly one durable failure notification', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });

    await notifier().deliverPending();

    expect(await eventCount(adId, 'renewal_failed_insufficient_credits')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewal_failed_credits')).toBe(1);
    const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM notifications WHERE user_id = $1 AND type = 'advertisement_renewal_failed_credits'`,
      [userId],
    );
    expect(rows[0]!.payload.advertisementId).toBe(adId);
    // Nothing sensitive travels with it.
    expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/balance|walletId|chargeId/i);
  });

  it('does not debit or notify again for the same boundary', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });
    await notifier().deliverPending();

    // The scheduler will not even look at it: the pause takes it out of the
    // candidate index, and the candidate read is the only way in.
    expect(await renewalRepo().listDueAutomaticRenewalAdIds(50)).not.toContain(adId);

    // And a sweep, twice, changes nothing.
    await renewal().runLifecycleSweep({ batchSize: 10 });
    await renewal().runLifecycleSweep({ batchSize: 10 });

    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await eventCount(adId, 'renewal_failed_insufficient_credits')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewal_failed_credits')).toBe(1);
  });

  it('does not notify twice even when the advertiser retries and fails again', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });
    await notifier().deliverPending();

    // Explicit retry, still no credits.
    const retry = await service().retryAutomaticRenewal(adId, userId);
    await notifier().deliverPending();

    expect(retry).toMatchObject({ outcome: 'paused', reason: 'insufficient_credits' });
    expect(await eventCount(adId, 'renewal_failed_insufficient_credits')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewal_failed_credits')).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    // The pause survives the failed retry, so nothing is loose afterwards.
    expect((await adRow(adId)).auto_renew_paused_reason).toBe('insufficient_credits');
  });

  it('lets the advertiser recover by adding credits and retrying', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 25 });
    await renewal().renewAutomatically(adId, { blocking: true });

    await pool.query(
      `UPDATE wallets SET balance = 100 WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );
    const retry = await service().retryAutomaticRenewal(adId, userId);

    expect(retry.outcome).toBe('renewed');
    expect(await periodCount(adId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(75);
    const row = await adRow(adId);
    expect(row.auto_renew_paused_reason).toBeNull();
    expect(row.last_renewal_outcome).toBe('succeeded');
  });

  it('fails closed when the advertisement action is switched off', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await setActionPrice(pool, 'advertisement', 25, false);

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'paused', reason: 'pricing_unavailable' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(475);
    expect(await eventCount(adId, 'renewal_failed_pricing_unavailable')).toBe(1);
  });

  it('fails closed when the advertisement has no price row at all', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await setActionPrice(pool, 'advertisement', null);

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'paused', reason: 'pricing_unavailable' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    // Restored for the shared afterward state.
    await setActionPrice(pool, 'advertisement', 25, true);
  });

  it('does not retry unavailable pricing on a timer', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 500 });
    await setActionPrice(pool, 'advertisement', 25, false);
    await renewal().renewAutomatically(adId, { blocking: true });

    await renewal().runLifecycleSweep({ batchSize: 10 });
    await renewal().runLifecycleSweep({ batchSize: 10 });

    expect(await eventCount(adId, 'renewal_failed_pricing_unavailable')).toBe(1);
    expect(await periodCount(adId)).toBe(1);
    await setActionPrice(pool, 'advertisement', 25, true);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('bounds stop the campaign without charging', () => {
  it('stops at the maximum week count', async () => {
    // maximum_weeks counts the FIRST week too, so 2 allows exactly one renewal.
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500, bounds: { maximumWeeks: 2 } });

    const first = await renewal().renewAutomatically(adId, { blocking: true });
    expect(first.outcome).toBe('renewed');

    await timeTravelPastWeek(adId);
    const second = await renewal().renewAutomatically(adId, { blocking: true });

    expect(second).toMatchObject({ outcome: 'paused', reason: 'max_weeks_reached' });
    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(450);
    const row = await adRow(adId);
    expect(row.auto_renew_enabled).toBe(false);
    expect(row.renewal_mode).toBe('manual');
    expect(await eventCount(adId, 'auto_renew_stopped_max_weeks')).toBe(1);
  });

  it('stops at the renewal end date, with no shortened final week', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500, bounds: { maximumWeeks: 20 } });
    // An end date three days out: a full 168 hours cannot fit before it.
    await pool.query(
      `UPDATE advertisements SET renewal_end_date = now() + interval '3 days' WHERE id = $1`,
      [adId],
    );

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'paused', reason: 'end_date_reached' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await eventCount(adId, 'auto_renew_stopped_end_date')).toBe(1);
    expect((await adRow(adId)).auto_renew_enabled).toBe(false);
  });

  it('lets the earliest of two bounds win', async () => {
    const { adId } = await dueForAutoRenewal({
      mhc: 500,
      bounds: { maximumWeeks: 20, renewalEndDate: null },
    });
    // A generous week count, and an end date that has effectively arrived.
    await pool.query(
      `UPDATE advertisements SET renewal_end_date = now() + interval '2 days' WHERE id = $1`,
      [adId],
    );

    const result = await renewal().renewAutomatically(adId, { blocking: true });

    // The date wins, even though 19 weeks remain on the count.
    expect(result).toMatchObject({ outcome: 'paused', reason: 'end_date_reached' });
  });

  it('never creates a period shorter than 168 hours, whatever the bound', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 500, bounds: { maximumWeeks: 20 } });
    await pool.query(
      `UPDATE advertisements SET renewal_end_date = now() + interval '169 hours' WHERE id = $1`,
      [adId],
    );

    await renewal().renewAutomatically(adId, { blocking: true });

    // It fitted, so it was bought — and it is a whole week, not a trimmed one.
    for (const period of await periods(adId)) {
      expect(period.seconds).toBe('604800');
    }
  });

  it('cannot store a shortened week even by raw SQL', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 500 });

    await expect(
      pool.query(
        `INSERT INTO advertisement_campaign_periods
           (advertisement_id, period_number, starts_at, ends_at, mhc_price_snapshot, status, renewal_source)
         VALUES ($1, 99, now(), now() + interval '100 hours', 0, 'scheduled', 'automatic')`,
        [adId],
      ),
    ).rejects.toThrow(/chk_ad_period_exact_week/);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('races have defined financial behaviour', () => {
  it('does not charge when auto-renew was disabled before the scheduler claimed it', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await service().setAutoRenewal(adId, userId, { enabled: false });
    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'not_automatic' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('keeps a week bought before disabling, and charges nothing after', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await renewal().renewAutomatically(adId, { blocking: true });
    await service().setAutoRenewal(adId, userId, { enabled: false });

    // The paid week is untouched and unrefunded.
    const week2 = (await periods(adId))[1]!;
    expect(week2.status).toBe('active');
    expect(await balanceOf(pool, userId)).toBe(450);

    // And nothing renews after it.
    await timeTravelPastWeek(adId);
    const after = await renewal().renewAutomatically(adId, { blocking: true });
    expect(after).toMatchObject({ outcome: 'skipped', reason: 'not_automatic' });
    expect(await periodCount(adId)).toBe(2);
  });

  it('does not charge when the campaign was cancelled before the claim', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await service().cancelAd(adId, userId);
    const result = await renewal().renewAutomatically(adId, { blocking: true });

    expect(result).toMatchObject({ outcome: 'skipped', reason: 'cancelled_or_rejected' });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('refunds nothing when a cancellation lands after a renewal', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });
    const balanceAfterRenewal = await balanceOf(pool, userId);

    await service().cancelAd(adId, userId);

    expect(await balanceOf(pool, userId)).toBe(balanceAfterRenewal);
    // The charges are preserved as history; only the period is closed.
    expect(await chargeCount(userId)).toBe(2);
    expect((await periods(adId))[1]!.status).toBe('cancelled');
    // And it stops serving immediately.
    const served = await service().resolveActiveAds({});
    expect(served.map((ad) => ad.id)).not.toContain(adId);
  });

  it('gives a manual and an automatic renewal racing exactly one week', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    // The manual endpoint requires the week to have been closed already.
    await service().expireDuePeriods();

    const results = await Promise.allSettled([
      service().renewAd(adId, userId, null),
      renewal().renewAutomatically(adId),
    ]);

    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await ledgerCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(450);
    // The loser reports a stable state rather than inventing a second week.
    const rejected = results.filter((r) => r.status === 'rejected');
    for (const failure of rejected) {
      const reason: unknown = failure.reason;
      const code = reason instanceof HttpError ? reason.code : String(reason);
      expect(code).toMatch(/AD_PERIOD_STILL_ACTIVE|AD_RENEWAL_NOT_ELIGIBLE|AD_RENEWAL_CONFLICT/);
    }
  });

  it('gives two workers one success notification', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await Promise.allSettled([
      renewal().renewAutomatically(adId),
      renewal().renewAutomatically(adId),
    ]);
    await notifier().deliverPending();
    await notifier().deliverPending();

    expect(await eventCount(adId, 'renewal_succeeded')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewed')).toBe(1);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('notifications are durable, deduplicated and late-bound', () => {
  it('does not roll back a committed renewal when the notification fails', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    // The financial half already committed. Break delivery entirely.
    vi.spyOn(NotificationsRepository.prototype, 'createInTx').mockRejectedValue(
      new Error('notifications unavailable'),
    );
    await notifier().deliverPending();
    vi.restoreAllMocks();
    vi.spyOn(AdvertisementRenewalNotifier.prototype, 'deliverSoon').mockImplementation(() => {});

    // The week and the charge survive untouched...
    expect(await periodCount(adId)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(450);
    // ...and the event is still in the outbox, undelivered.
    const [successEvent] = (await events(adId)).filter(
      (e) => e.event_type === 'renewal_succeeded',
    );
    expect(successEvent!.notified_at).toBeNull();

    // A later sweep delivers it, exactly once.
    await notifier().deliverPending();
    expect(await notificationCount(userId, 'advertisement_renewed')).toBe(1);
  });

  it('delivers each event once however many times the outbox is swept', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    await Promise.all([
      notifier().deliverPending(),
      notifier().deliverPending(),
      notifier().deliverPending(),
    ]);
    await notifier().deliverPending();

    expect(await notificationCount(userId, 'advertisement_renewed')).toBe(1);
  });

  it('tells a MANUAL advertiser their week ended, once', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 500 });
    await timeTravelPastWeek(adId);

    await service().expireDuePeriods();
    await service().expireDuePeriods();
    await notifier().deliverPending();

    expect(await eventCount(adId, 'manual_renewal_required')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewal_required')).toBe(1);
  });

  it('does not tell an AUTOMATIC advertiser to renew manually', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await renewal().runLifecycleSweep({ batchSize: 10 });
    await notifier().deliverPending();

    expect(await eventCount(adId, 'manual_renewal_required')).toBe(0);
    expect(await notificationCount(userId, 'advertisement_renewal_required')).toBe(0);
    expect(await notificationCount(userId, 'advertisement_renewed')).toBe(1);
  });

  it('reminds once per boundary, and not again', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });
    // Slide the running week so it ends inside the reminder window. The closed
    // week goes further back first: sliding week 2 into [-160h, +8h] would
    // otherwise land it on top of week 1, and `ad_period_no_overlap` — rightly —
    // refuses that.
    await pool.query(
      `UPDATE advertisement_campaign_periods
       SET starts_at = starts_at - interval '30 days', ends_at = ends_at - interval '30 days'
       WHERE advertisement_id = $1 AND status <> 'active'`,
      [adId],
    );
    await pool.query(
      `UPDATE advertisement_campaign_periods
       SET starts_at = now() - interval '160 hours', ends_at = now() + interval '8 hours'
       WHERE advertisement_id = $1 AND status = 'active'`,
      [adId],
    );
    await pool.query(
      `UPDATE advertisements
       SET current_period_starts_at = now() - interval '160 hours',
           current_period_ends_at = now() + interval '8 hours'
       WHERE id = $1`,
      [adId],
    );

    await renewal().runLifecycleSweep({ batchSize: 10, reminderWindowHours: 24 });
    await renewal().runLifecycleSweep({ batchSize: 10, reminderWindowHours: 24 });
    await notifier().deliverPending();

    expect(await eventCount(adId, 'renewal_reminder')).toBe(1);
    expect(await notificationCount(userId, 'advertisement_renewal_reminder')).toBe(1);
  });

  it('cannot record the same boundary outcome twice, even by raw SQL', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    await expect(
      pool.query(
        `INSERT INTO advertisement_renewal_events
           (advertisement_id, advertiser_id, boundary_period_number, event_type)
         VALUES ($1, $2, 2, 'renewal_succeeded')`,
        [adId, userId],
      ),
    ).rejects.toThrow(/uq_ad_renewal_event_boundary/);
  });

  it('addresses every notification to the campaign owner and nobody else', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    const other = await seedProvider(pool, { mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    await notifier().deliverPending();

    expect(await notificationCount(userId, 'advertisement_renewed')).toBe(1);
    expect(await notificationCount(other.userId, 'advertisement_renewed')).toBe(0);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('the sweep is bounded, isolated and interruptible', () => {
  it('does not let one failing campaign stop the others', async () => {
    const broke = await dueForAutoRenewal({ mhc: 25 }); // no credits left
    const okA = await dueForAutoRenewal({ mhc: 500 });
    const okB = await dueForAutoRenewal({ mhc: 500 });

    const summary = await renewal().runLifecycleSweep({ batchSize: 25 });

    expect(summary.renewed).toBe(2);
    expect(summary.paused).toBe(1);
    expect(await periodCount(okA.adId)).toBe(2);
    expect(await periodCount(okB.adId)).toBe(2);
    expect(await periodCount(broke.adId)).toBe(1);
    // The failing campaign's transaction did not roll back its neighbours'.
    expect(await balanceOf(pool, okA.userId)).toBe(450);
    expect(await balanceOf(pool, broke.userId)).toBe(0);
  });

  it('honours the batch size, and drains the backlog over later ticks', async () => {
    const campaigns = [
      await dueForAutoRenewal({ mhc: 500 }),
      await dueForAutoRenewal({ mhc: 500 }),
      await dueForAutoRenewal({ mhc: 500 }),
    ];

    const first = await renewal().runLifecycleSweep({ batchSize: 1 });
    expect(first.renewed).toBe(1);

    await renewal().runLifecycleSweep({ batchSize: 1 });
    await renewal().runLifecycleSweep({ batchSize: 1 });

    for (const campaign of campaigns) {
      expect(await periodCount(campaign.adId)).toBe(2);
    }
  });

  it('stops between campaigns when asked to shut down, mid-transaction never', async () => {
    const a = await dueForAutoRenewal({ mhc: 500 });
    const b = await dueForAutoRenewal({ mhc: 500 });

    // Shutdown requested before the first campaign: nothing is touched at all.
    const summary = await renewal().runLifecycleSweep({ batchSize: 25, shouldStop: () => true });

    expect(summary).toMatchObject({ started: 0, renewed: 0, paused: 0, notified: 0 });
    expect(await periodCount(a.adId)).toBe(1);
    expect(await periodCount(b.adId)).toBe(1);
    // Nothing half-done: no orphan charge, no orphan period.
    expect(await chargeCount(a.userId)).toBe(1);
    expect(await chargeCount(b.userId)).toBe(1);
  });

  it('runs every stage of one tick: start, renew, expire, remind, notify', async () => {
    const auto = await dueForAutoRenewal({ mhc: 500 });
    const manual = await liveCampaign({ mhc: 500 });
    await timeTravelPastWeek(manual.adId);

    const summary = await renewal().runLifecycleSweep({ batchSize: 25 });

    expect(summary.renewed).toBe(1);
    expect(summary.expiredPeriods).toBeGreaterThanOrEqual(1);
    expect(summary.failures).toBe(0);
    // The outbox ran last, so this tick's events were delivered in this tick.
    expect(await notificationCount(auto.userId, 'advertisement_renewed')).toBe(1);
    expect(await notificationCount(manual.userId, 'advertisement_renewal_required')).toBe(1);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('legacy campaigns stay outside all of it', () => {
  it('cannot be enabled, claimed or renewed', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 500 });
    await enableAutoRenewal(adId, userId, { maximumWeeks: 10 });
    await timeTravelPastWeek(adId);
    // Converted afterwards, so the row carries automatic-renewal state AND a
    // legacy billing model — the worst case, not the easy one.
    await pool.query(`UPDATE advertisements SET billing_model = 'legacy' WHERE id = $1`, [adId]);

    expect(await renewalRepo().listDueAutomaticRenewalAdIds(50)).not.toContain(adId);
    const result = await renewal().renewAutomatically(adId, { blocking: true });
    expect(result).toMatchObject({ outcome: 'skipped', reason: 'not_weekly' });

    await renewal().runLifecycleSweep({ batchSize: 25 });
    expect(await periodCount(adId)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('nothing that already worked was broken', () => {
  it('still lets an advertiser renew manually', async () => {
    const { userId, adId } = await liveCampaign({ mhc: 500 });
    await timeTravelPastWeek(adId);
    await service().expireDuePeriods();

    const result = await service().renewAd(adId, userId, null);

    expect(result.created).toBe(true);
    const rows = await periods(adId);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ renewal_source: 'manual', status: 'active' });
    expect(rows[1]!.seconds).toBe('604800');
  });

  it('still moderates: approve activates, reject charges nothing', async () => {
    const approved = await seedProvider(pool, { mhc: 500 });
    const adA = await submit(approved.userId);
    await service().approveAd(adA.id, adminId);
    expect((await adRow(adA.id)).status).toBe('active');

    const rejected = await seedProvider(pool, { mhc: 500 });
    const adB = await submit(rejected.userId);
    await service().rejectAd(adB.id, adminId, 'Not suitable');
    expect((await adRow(adB.id)).status).toBe('rejected');
    expect(await chargeCount(rejected.userId)).toBe(0);
    expect(await periodCount(adB.id)).toBe(0);
  });

  it('still fails closed on public serving once the week is over', async () => {
    const { adId } = await dueForAutoRenewal({ mhc: 25 });

    // The mirror columns still claim a live window; only the PERIOD is stale.
    await pool.query(
      `UPDATE advertisements
       SET status = 'active', billing_status = 'active',
           current_period_starts_at = now() - interval '1 hour',
           current_period_ends_at = now() + interval '10 days'
       WHERE id = $1`,
      [adId],
    );

    const served = await service().resolveActiveAds({});
    expect(served.map((ad) => ad.id)).not.toContain(adId);
  });

  it('reads and writes no EGP wallet anywhere in the renewal path', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });

    await renewal().renewAutomatically(adId, { blocking: true });
    await renewal().runLifecycleSweep({ batchSize: 25 });

    expect(await moneyWalletCount(userId)).toBe(0);
    const { rows } = await pool.query<{ asset_code: string }>(
      `SELECT DISTINCT w.asset_code
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id
       WHERE t.user_id = $1`,
      [userId],
    );
    for (const row of rows) expect(row.asset_code).toBe('MHC');
  });
});

// ===========================================================================
describe.skipIf(!pgIntegrationEnabled())('period history is owned, bounded and honest', () => {
  it('returns only this campaign, paginated', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });
    const other = await liveCampaign({ mhc: 500 });

    const page = await service().listPeriodHistory(
      adId,
      { id: userId, isAdmin: false },
      { page: 1, limit: 1 },
    );

    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]!.periodNumber).toBe(2);
    expect(page.totalPages).toBe(2);

    const second = await service().listPeriodHistory(
      adId,
      { id: userId, isAdmin: false },
      { page: 2, limit: 1 },
    );
    expect(second.rows[0]!.periodNumber).toBe(1);
    // Nothing from the other campaign leaked in.
    expect(await periodCount(other.adId)).toBe(1);
  });

  it('refuses a stranger and allows an admin', async () => {
    const { adId } = await liveCampaign({ mhc: 500 });
    const stranger = await seedProvider(pool, { mhc: 500 });

    await expect(
      service().listPeriodHistory(adId, { id: stranger.userId, isAdmin: false }, { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const asAdmin = await service().listPeriodHistory(
      adId,
      { id: adminId, isAdmin: true },
      { page: 1, limit: 20 },
    );
    expect(asAdmin.total).toBe(1);
  });

  it('exposes the price snapshot and not the ledger behind it', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    const page = await service().listPeriodHistory(
      adId,
      { id: userId, isAdmin: false },
      { page: 1, limit: 20 },
    );

    expect(page.rows[0]).toMatchObject({
      periodNumber: 2,
      renewalSource: 'automatic',
      mhcPriceSnapshot: 25,
      hasCharge: true,
    });
    expect(page.rows[0]).not.toHaveProperty('actionChargeId');
    expect(JSON.stringify(page)).not.toMatch(/action_charge_id|transaction_id/);
  });

  it('reports renewal state and history to the campaign owner', async () => {
    const { userId, adId } = await dueForAutoRenewal({ mhc: 500 });
    await renewal().renewAutomatically(adId, { blocking: true });

    const state = await service().getBillingState(adId, { id: userId, isAdmin: false });

    expect(state).toMatchObject({
      autoRenewEnabled: true,
      renewalMode: 'automatic',
      lastRenewalOutcome: 'succeeded',
      periodsUsed: 2,
      canRetryAutomaticRenewal: false,
    });
    expect(state.creditBalance).toBe(450);
    expect(state.renewalHistory.some((e) => e.eventType === 'renewal_succeeded')).toBe(true);
  });
});

// ===========================================================================
// Built on SEPARATE scratch copies, because it destroys the objects the suites
// above depend on. The rollback text is the one documented in the migration
// header; if the two drift, this fails.

const ROLLBACK_SQL = `
DROP TABLE IF EXISTS public.advertisement_renewal_events;

ALTER TABLE public.advertisements
  DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_consent,
  DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_paused_reason,
  DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_paused_shape,
  DROP CONSTRAINT IF EXISTS chk_advertisements_last_renewal_outcome;

DROP INDEX IF EXISTS public.idx_advertisements_auto_renew_due;

ALTER TABLE public.advertisements
  DROP COLUMN IF EXISTS auto_renew_enabled_at,
  DROP COLUMN IF EXISTS auto_renew_enabled_by,
  DROP COLUMN IF EXISTS auto_renew_consent_version,
  DROP COLUMN IF EXISTS auto_renew_paused_reason,
  DROP COLUMN IF EXISTS auto_renew_paused_at,
  DROP COLUMN IF EXISTS last_renewal_outcome,
  DROP COLUMN IF EXISTS last_renewal_attempt_at;
`;

describe.skipIf(!pgIntegrationEnabled())('migration forward and rollback', () => {
  it('builds the automatic-renewal objects from nothing, with the price still 0', async () => {
    const copy = await createScratchDatabase('autofwd');
    try {
      const { rows } = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.advertisement_renewal_events')::text AS t`,
      );
      expect(rows[0]!.t).toBe('advertisement_renewal_events');

      // The whole point of the wave, and still not a paid product.
      const { rows: price } = await copy.pool.query<{ p: string; a: boolean }>(
        `SELECT mhc_price::text p, is_active a FROM mhc_action_prices WHERE action_key = 'advertisement'`,
      );
      expect(price[0]).toMatchObject({ p: '0.00', a: true });

      // Nothing became auto-renewing by deploying this file.
      const { rows: enabled } = await copy.pool.query<{ c: string }>(
        `SELECT count(*)::text c FROM advertisements WHERE auto_renew_enabled`,
      );
      expect(enabled[0]!.c).toBe('0');

      // The dedup index is partial, and covers exactly the boundary events.
      const { rows: index } = await copy.pool.query<{ def: string }>(
        `SELECT indexdef AS def FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'uq_ad_renewal_event_boundary'`,
      );
      expect(index[0]!.def).toContain('UNIQUE');
      expect(index[0]!.def).toContain('renewal_succeeded');
      expect(index[0]!.def).toContain('renewal_reminder');
      // ...and deliberately not the two configuration acknowledgements.
      expect(index[0]!.def).not.toContain('auto_renew_enabled');

      // Every 2F-A constraint that makes exactly-once true is still there.
      const { rows: kept } = await copy.pool.query<{ conname: string }>(
        `SELECT conname FROM pg_constraint
          WHERE conname IN ('chk_ad_period_exact_week','ad_period_no_overlap',
                            'chk_ad_period_charge_shape','chk_advertisements_auto_renew_bounded')`,
      );
      expect(kept.map((r) => r.conname).sort()).toEqual([
        'ad_period_no_overlap',
        'chk_ad_period_charge_shape',
        'chk_advertisements_auto_renew_bounded',
        'chk_ad_period_exact_week',
      ].sort());
    } finally {
      await copy.drop();
    }
  }, 900_000);

  it('runs the documented rollback twice and returns the schema exactly', async () => {
    const copy = await createScratchDatabase('autorollback');
    const fingerprint = async () => {
      const { rows } = await copy.pool.query<{ kind: string; sig: string }>(
        `SELECT 'table' AS kind, table_name AS sig
           FROM information_schema.tables WHERE table_schema = 'public'
         UNION ALL
         SELECT 'column', table_name || '.' || column_name
           FROM information_schema.columns WHERE table_schema = 'public'
         UNION ALL
         SELECT 'constraint', conrelid::regclass::text || '::' || conname
           FROM pg_constraint WHERE connamespace = 'public'::regnamespace
         UNION ALL
         SELECT 'index', tablename || '.' || indexname FROM pg_indexes WHERE schemaname = 'public'
         ORDER BY 1, 2`,
      );
      return new Set(rows.map((r) => `${r.kind}:${r.sig}`));
    };

    try {
      const before = await fingerprint();
      expect(before.has('table:advertisement_renewal_events')).toBe(true);
      expect(before.has('column:advertisements.auto_renew_enabled_at')).toBe(true);

      // Idempotent: the documented sequence runs twice with the same result.
      await copy.exec(ROLLBACK_SQL);
      await copy.exec(ROLLBACK_SQL);

      const after = await fingerprint();
      expect(after.has('table:advertisement_renewal_events')).toBe(false);
      expect(after.has('column:advertisements.auto_renew_paused_reason')).toBe(false);
      expect(after.has('index:advertisements.idx_advertisements_auto_renew_due')).toBe(false);

      // Nothing appeared, and everything that disappeared belongs to THIS
      // migration. Asserted as an exact set, so a casualty fails here.
      expect([...after].filter((k) => !before.has(k))).toEqual([]);

      const removed = [...before].filter((k) => !after.has(k)).sort();
      const foreign = removed.filter(
        (k) =>
          !k.includes('advertisement_renewal_events') &&
          !k.includes('ad_renewal_event') &&
          !/advertisements\.(auto_renew_enabled_at|auto_renew_enabled_by|auto_renew_consent_version|auto_renew_paused_reason|auto_renew_paused_at|last_renewal_outcome|last_renewal_attempt_at)/.test(
            k,
          ) &&
          !/chk_advertisements_(auto_renew_consent|auto_renew_paused_reason|auto_renew_paused_shape|last_renewal_outcome)/.test(
            k,
          ) &&
          // Dropping `auto_renew_enabled_by` takes its foreign key with it,
          // which is the correct and only way to remove it.
          !/advertisements_auto_renew_enabled_by_fkey/.test(k) &&
          !/idx_advertisements_auto_renew_due/.test(k),
      );
      expect(foreign).toEqual([]);

      // Wave 2F-A survives its successor's reversal intact.
      expect(after.has('table:advertisement_campaign_periods')).toBe(true);
      expect(after.has('column:advertisements.billing_model')).toBe(true);
      expect(after.has('column:advertisements.auto_renew_enabled')).toBe(true);
      expect(after.has('column:advertisements.maximum_weeks')).toBe(true);

      // Financial history and everything around it is untouched.
      const { rows: survivors } = await copy.pool.query<{ t: string | null; name: string }>(
        `SELECT name, to_regclass('public.' || name)::text AS t
           FROM unnest(ARRAY[
             'transactions','mhc_action_charges','mhc_job_activations','wallets',
             'advertisements','advertisement_campaign_periods','notifications',
             'plan_subscriptions','provider_payment_disclosures'
           ]) AS name`,
      );
      for (const row of survivors) expect(row.t).toBe(row.name);

      // And the price is exactly where it was on the way in.
      const { rows: price } = await copy.pool.query<{ p: string }>(
        `SELECT mhc_price::text p FROM mhc_action_prices WHERE action_key = 'advertisement'`,
      );
      expect(price[0]!.p).toBe('0.00');
    } finally {
      await copy.drop();
    }
  }, 900_000);

  it('refuses to drop the period table while the event log references it', async () => {
    const copy = await createScratchDatabase('autoorder');
    try {
      // The reason both earlier migration headers had to be extended. Asserting
      // the failure is what stops the obsolete ordering being restored.
      await expect(
        copy.exec('DROP TABLE IF EXISTS public.advertisement_campaign_periods;'),
      ).rejects.toThrow(
        /cannot drop table advertisement_campaign_periods because other objects depend on it/i,
      );

      const { rows } = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.advertisement_campaign_periods')::text AS t`,
      );
      expect(rows[0]!.t).toBe('advertisement_campaign_periods');
    } finally {
      await copy.drop();
    }
  }, 900_000);
});
