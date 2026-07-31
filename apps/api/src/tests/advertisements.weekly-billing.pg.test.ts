import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdvertisementBillingService } from '../modules/advertisements/advertisement-billing.service.js';
import { AdvertisementRenewalNotifier } from '../modules/advertisements/advertisement-renewal.notifier.js';
import { AdvertisementsRepository } from '../modules/advertisements/advertisements.repository.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';

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
// Weekly advertisement billing against a REAL PostgreSQL server.
// ---------------------------------------------------------------------------
// Everything that matters about this feature is a property of ROWS under
// concurrency: ten simultaneous approvals producing one period and one charge,
// an admin price change not rewriting a week already bought, an insufficient
// balance leaving an approval but no period. A hand-written model of PostgreSQL
// can only be as right as the person who wrote it, so these run against an
// actual server with actual FOR UPDATE blocking, actual READ COMMITTED
// visibility, actual unique indexes and actual CHECK constraints.
//
// Opt-in:  RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
// ---------------------------------------------------------------------------

let scratch: ScratchDatabase;
let pool: Pool;

vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

// A full lifecycle test here is a dozen sequential round trips to a remote
// PostgreSQL server, and the concurrency tests are ten transactions at once. The
// default 5s budget times those out before they can fail or pass on their
// merits, which would report latency as a defect.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 1_800_000 });

const service = (): AdvertisementsService => new AdvertisementsService();
const billing = (): AdvertisementBillingService => new AdvertisementBillingService();
const repository = (): AdvertisementsRepository => new AdvertisementsRepository();

/**
 * The reviewer. `reviewed_by` is a plain users FK — admin authority is enforced
 * by route middleware (`requireAdminPermission('manage_ads')`), which has its own
 * coverage; what matters here is that the reviewer is recorded.
 */
let adminId: string;

const submit = async (
  userId: string,
  overrides: { startsAt?: string; titleEn?: string } = {},
  idempotencyKey?: string,
) =>
  service().createAd(
    userId,
    {
      titleEn: overrides.titleEn ?? 'Structural surveys in Giza',
      imageUrl: 'https://cdn.example/ad.png',
      linkType: 'profile' as const,
      ...(overrides.startsAt ? { startsAt: overrides.startsAt } : {}),
    },
    idempotencyKey ?? null,
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

/**
 * Move a campaign's paid week wholly into the past.
 *
 * Both ends shift by the same amount because `chk_ad_period_exact_week` pins the
 * window to exactly 168 hours — which is itself the point: there is no way to
 * fake an elapsed week by shortening one.
 */
const timeTravelPastWeek = async (adId: string): Promise<void> => {
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

/** Approve, then let the week elapse and expire, leaving a renewable campaign. */
const approveThenExpire = async (adId: string): Promise<void> => {
  await service().approveAd(adId, adminId);
  await timeTravelPastWeek(adId);
  await service().expireDuePeriods();
};

beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('adsweekly');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  // Always drop, including after a failure.
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  vi.restoreAllMocks();
  // Approving a campaign now queues a boundary notification, dispatched fire
  // and forget. That transaction locks the event row and touches
  // `notifications`, while the cleanup below cascades from `advertisements`
  // INTO the event table — the opposite lock order, which deadlocked this
  // suite's `beforeEach`. Delivery is not what this file is about and has its
  // own coverage in advertisements.automatic-renewal.pg.test.ts, so it is
  // switched off here rather than raced against.
  vi.spyOn(AdvertisementRenewalNotifier.prototype, 'deliverSoon').mockImplementation(() => {});
  // A clean slate per test, inside the scratch database only. Periods go before
  // charges: `advertisement_campaign_periods.action_charge_id` is ON DELETE
  // RESTRICT, so a charge cannot be removed while a week still points at it.
  await pool.query(`DELETE FROM advertisement_campaign_periods`);
  await pool.query(`DELETE FROM advertisements`);
  await pool.query(`DELETE FROM mhc_action_charges`);
  await pool.query(`DELETE FROM transactions`);
  await setActionPrice(pool, 'advertisement', 25, true);
  const admin = await seedProvider(pool, { role: 'business', mhc: 0 });
  adminId = admin.userId;
});

describe.skipIf(!pgIntegrationEnabled())('submission is free and unreviewed', () => {
  it('creates a pending_review campaign and charges nothing', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });

    const ad = await submit(userId);

    expect(ad.status).toBe('pending_review');
    expect(ad.billing_status).toBe('pending_review');
    expect(ad.billing_model).toBe('weekly');
    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await periodCount(ad.id)).toBe(0);
  });

  it('does not so much as create an MHC wallet', async () => {
    // Seeded WITHOUT a credit wallet: the charging primitive would create one
    // on first use, so its continued absence proves nothing financial ran.
    const suffix = Math.random().toString(36).slice(2, 10);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, display_name, primary_role)
       VALUES ($1, 'x', 'No Wallet', 'expert') RETURNING id`,
      [`nowallet-${suffix}@test.local`],
    );
    const userId = rows[0]!.id;

    await submit(userId);

    expect(
      await countRows(pool, `SELECT count(*)::text c FROM wallets WHERE user_id = $1`, [userId]),
    ).toBe(0);
  });

  it('is not publicly visible', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    await submit(userId);

    const served = await service().resolveActiveAds({});
    expect(served).toHaveLength(0);
  });

  it('deduplicates a retried submission', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const key = 'cccccccc-0000-4000-8000-000000000001';

    const first = await submit(userId, {}, key);
    const second = await submit(userId, {}, key);

    expect(second.id).toBe(first.id);
    expect(
      await countRows(pool, `SELECT count(*)::text c FROM advertisements WHERE advertiser_id = $1`, [
        userId,
      ]),
    ).toBe(1);
  });
});

describe.skipIf(!pgIntegrationEnabled())('rejection', () => {
  it('records the reviewer and reason, and creates no period or charge', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const rejected = await service().rejectAd(ad.id, adminId, 'Banner text is misleading');

    expect(rejected.status).toBe('rejected');
    expect(rejected.billing_status).toBe('rejected');
    expect(rejected.reviewed_by).toBe(adminId);
    expect(rejected.reviewed_at).not.toBeNull();
    expect(rejected.rejection_reason).toBe('Banner text is misleading');
    expect(await periodCount(ad.id)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
  });

  it('is idempotent', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    await service().rejectAd(ad.id, adminId, 'first');
    const again = await service().rejectAd(ad.id, adminId, 'second');

    // The original decision stands rather than being overwritten by a repeat.
    expect(again.rejection_reason).toBe('first');
    expect(await chargeCount(userId)).toBe(0);
  });

  it('refuses to reject an already-approved campaign', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    await expect(service().rejectAd(ad.id, adminId, 'too late')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_PENDING_REVIEW',
    });
  });
});

describe.skipIf(!pgIntegrationEnabled())('immediate approval', () => {
  it('creates exactly one seven-day period and charges the weekly price once', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const result = await service().approveAd(ad.id, adminId);

    expect(result.created).toBe(true);
    expect(result.mhcCharged).toBe(25);
    expect(await balanceOf(pool, userId)).toBe(75);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);

    const rows = await periods(ad.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      period_number: 1,
      status: 'active',
      renewal_source: 'initial',
      price: '25.00',
    });
    // Exactly seven times 24 hours, measured by the server.
    expect(rows[0]!.seconds).toBe('604800');
    expect(rows[0]!.action_charge_id).not.toBeNull();

    const campaign = await adRow(ad.id);
    expect(campaign.status).toBe('active');
    expect(campaign.billing_status).toBe('active');
    expect(campaign.reviewed_by).toBe(adminId);
  });

  it('charges the period, not the campaign', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    const { rows } = await pool.query<{ reference_type: string; reference_id: string }>(
      `SELECT reference_type, reference_id FROM mhc_action_charges WHERE user_id = $1`,
      [userId],
    );
    const period = (await periods(ad.id))[0]!;
    expect(rows[0]!.reference_type).toBe('advertisement_period');
    // The charge references the WEEK, which is what makes it idempotent per week.
    expect(rows[0]!.reference_id).not.toBe(ad.id);
    expect(await periodCount(ad.id)).toBe(1);
    expect(period.action_charge_id).toBeTruthy();
  });

  it('serves the campaign only while its paid week is running', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    const served = await service().resolveActiveAds({});
    expect(served.map((row) => row.id)).toContain(ad.id);
    // Existing analytics behaviour still works.
    expect(Number((await adRow(ad.id)).impressions)).toBe(1);
  });

  it('creates one period and one charge for ten concurrent approvals', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => service().approveAd(ad.id, adminId)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).not.toHaveLength(0);
    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(475);
  });
});

describe.skipIf(!pgIntegrationEnabled())('future-dated approval', () => {
  const future = () => new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

  it('records the approval but charges nothing before the start', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId, { startsAt: future() });

    const result = await service().approveAd(ad.id, adminId);

    expect(result.created).toBe(false);
    expect(result.period).toBeNull();
    const campaign = await adRow(ad.id);
    expect(campaign.status).toBe('scheduled');
    expect(campaign.billing_status).toBe('awaiting_start');
    expect(campaign.reviewed_at).not.toBeNull();
    expect(await periodCount(ad.id)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await service().resolveActiveAds({})).toHaveLength(0);
  });

  it('refuses to activate before the scheduled start', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId, { startsAt: future() });
    await service().approveAd(ad.id, adminId);

    await expect(service().activateDueAdvertisement(ad.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_START_NOT_DUE',
    });
    expect(await chargeCount(userId)).toBe(0);
  });

  it('creates one period and one charge when the start becomes due', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId, { startsAt: future() });
    await service().approveAd(ad.id, adminId);
    // The start arrives.
    await pool.query(`UPDATE advertisements SET starts_at = now() - interval '1 minute' WHERE id = $1`, [
      ad.id,
    ]);

    expect(await service().listDueScheduledAdIds()).toContain(ad.id);
    const result = await service().activateDueAdvertisement(ad.id);

    expect(result.created).toBe(true);
    expect(result.mhcCharged).toBe(25);
    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect((await periods(ad.id))[0]!.seconds).toBe('604800');
    expect((await adRow(ad.id)).billing_status).toBe('active');
  });

  it('creates one period and one charge for ten concurrent due-start calls', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId, { startsAt: future() });
    await service().approveAd(ad.id, adminId);
    await pool.query(`UPDATE advertisements SET starts_at = now() - interval '1 minute' WHERE id = $1`, [
      ad.id,
    ]);

    await Promise.allSettled(
      Array.from({ length: 10 }, () => service().activateDueAdvertisement(ad.id)),
    );

    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(475);
  });

  it('is safely retryable after a lost response', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    // The caller never saw the first response and tries again.
    const retry = await service().activateDueAdvertisement(ad.id);
    expect(retry.created).toBe(false);
    expect(retry.mhcCharged).toBe(0);
    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });
});

describe.skipIf(!pgIntegrationEnabled())('insufficient credits', () => {
  it('leaves no charge and no active period, and no debt', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    const ad = await submit(userId);

    await expect(service().approveAd(ad.id, adminId)).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
      details: { required: 25, available: 10 },
    });

    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await periodCount(ad.id)).toBe(0);
    // No debt and no negative balance.
    expect(await balanceOf(pool, userId)).toBe(10);
    expect(await service().resolveActiveAds({})).toHaveLength(0);
  });

  it('keeps the approval, and stays distinguishable from a rejection', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    const ad = await submit(userId);
    await expect(service().approveAd(ad.id, adminId)).rejects.toBeTruthy();

    const campaign = await adRow(ad.id);
    // Approved: reviewer recorded, no rejection reason, not pending_review.
    expect(campaign.reviewed_by).toBe(adminId);
    expect(campaign.reviewed_at).not.toBeNull();
    expect(campaign.rejection_reason).toBeNull();
    expect(campaign.status).toBe('scheduled');
    expect(campaign.billing_status).toBe('awaiting_credits');
    expect(campaign.status).not.toBe('rejected');
    expect(campaign.status).not.toBe('pending_review');
  });

  it('lets the advertiser activate it once they have credits', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    const ad = await submit(userId);
    await expect(service().approveAd(ad.id, adminId)).rejects.toBeTruthy();

    await pool.query(
      `UPDATE wallets SET balance = 40 WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );
    const result = await service().activateDueAdvertisement(ad.id, {
      requireAdvertiserId: userId,
    });

    expect(result.created).toBe(true);
    expect(await balanceOf(pool, userId)).toBe(15);
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('refuses another advertiser trying to activate a campaign that is not theirs', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const stranger = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().rejectAd(ad.id, adminId, 'no');

    await expect(
      service().activateDueAdvertisement(ad.id, { requireAdvertiserId: stranger.userId }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

describe.skipIf(!pgIntegrationEnabled())('zero-price weeks', () => {
  it('activates a week with no financial row at all', async () => {
    await setActionPrice(pool, 'advertisement', 0, true);
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const result = await service().approveAd(ad.id, adminId);

    expect(result.created).toBe(true);
    expect(result.mhcCharged).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);

    const rows = await periods(ad.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe('0.00');
    // chk_ad_period_charge_shape: a free week has no charge link.
    expect(rows[0]!.action_charge_id).toBeNull();
    expect(rows[0]!.seconds).toBe('604800');
  });

  it('still prevents a duplicate free week', async () => {
    await setActionPrice(pool, 'advertisement', 0, true);
    const { userId } = await seedProvider(pool, { mhc: 0 });
    const ad = await submit(userId);

    await Promise.allSettled(
      Array.from({ length: 10 }, () => service().approveAd(ad.id, adminId)),
    );

    expect(await periodCount(ad.id)).toBe(1);
  });
});

describe.skipIf(!pgIntegrationEnabled())('manual renewal', () => {
  it('buys one new seven-day period', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    const result = await service().renewAd(ad.id, userId, 'aaaaaaaa-0000-4000-8000-000000000001');

    expect(result.created).toBe(true);
    expect(result.mhcCharged).toBe(25);
    expect(await balanceOf(pool, userId)).toBe(50);
    expect(await chargeCount(userId)).toBe(2);

    const rows = await periods(ad.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      period_number: 2,
      status: 'active',
      renewal_source: 'manual',
    });
    expect(rows[1]!.seconds).toBe('604800');
    expect(rows[0]!.status).toBe('expired');

    const campaign = await adRow(ad.id);
    expect(campaign.status).toBe('active');
    expect(campaign.billing_status).toBe('active');
    expect(Number(campaign.renewal_count)).toBe(1);
    expect(campaign.manual_renewal_required).toBe(false);
  });

  it('refuses while the paid week is still running', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_PERIOD_STILL_ACTIVE',
    });
    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('refuses a campaign that was never approved', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_RENEWAL_NOT_ELIGIBLE',
    });
    expect(await chargeCount(userId)).toBe(0);
  });

  it('refuses a stranger', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const stranger = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    await expect(service().renewAd(ad.id, stranger.userId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('creates one period and one charge for ten concurrent renewals', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        service().renewAd(ad.id, userId, `bbbbbbbb-0000-4000-8000-00000000000${i}`),
      ),
    );

    // One initial week plus exactly one renewal.
    expect(await periodCount(ad.id)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
    expect(await balanceOf(pool, userId)).toBe(450);
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM advertisement_campaign_periods
          WHERE advertisement_id = $1 AND status = 'active'`,
        [ad.id],
      ),
    ).toBe(1);
  });

  it('returns the winning period for a repeated idempotency key', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    const key = 'dddddddd-0000-4000-8000-000000000001';

    const first = await service().renewAd(ad.id, userId, key);
    const second = await service().renewAd(ad.id, userId, key);

    expect(second.period!.id).toBe(first.period!.id);
    expect(second.created).toBe(false);
    expect(second.mhcCharged).toBe(0);
    expect(await periodCount(ad.id)).toBe(2);
    expect(await chargeCount(userId)).toBe(2);
  });

  it('cannot create two active weeks even with ten different keys at once', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service().renewAd(ad.id, userId, crypto.randomUUID()),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(await periodCount(ad.id)).toBe(2);
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM advertisement_campaign_periods
          WHERE advertisement_id = $1 AND status = 'active'`,
        [ad.id],
      ),
    ).toBe(1);
  });

  it('honours a configured maximum number of weeks', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    await pool.query(`UPDATE advertisements SET maximum_weeks = 1 WHERE id = $1`, [ad.id]);

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_RENEWAL_LIMIT_REACHED',
    });
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('honours a configured renewal end date', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    // A new week would run past the boundary.
    await pool.query(
      `UPDATE advertisements SET renewal_end_date = now() + interval '2 days' WHERE id = $1`,
      [ad.id],
    );

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_RENEWAL_WINDOW_CLOSED',
    });
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('creates nothing when the advertiser cannot pay for the new week', async () => {
    const { userId } = await seedProvider(pool, { mhc: 25 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    expect(await balanceOf(pool, userId)).toBe(0);

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
    });

    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(0);
    // Still renewable once they top up — the state did not degrade.
    expect((await adRow(ad.id)).billing_status).toBe('renewal_required');
  });
});

describe.skipIf(!pgIntegrationEnabled())('price changes affect future weeks only', () => {
  it('prices the new week at the new price and leaves the old snapshot alone', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    // The admin raises the weekly price through the same row charging reads.
    await service().updateAdminAdControls(adminId, { acceptAds: true, mhcPrice: 60 });
    await service().renewAd(ad.id, userId);

    const rows = await periods(ad.id);
    expect(rows[0]!.price).toBe('25.00');
    expect(rows[1]!.price).toBe('60.00');
    expect(await balanceOf(pool, userId)).toBe(500 - 25 - 60);
  });

  it('never rewrites a snapshot already recorded', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    const before = (await periods(ad.id))[0]!.price;

    await service().updateAdminAdControls(adminId, { acceptAds: true, mhcPrice: 99 });

    expect((await periods(ad.id))[0]!.price).toBe(before);
    expect((await periods(ad.id))[0]!.price).toBe('25.00');
  });
});

describe.skipIf(!pgIntegrationEnabled())('caller transaction boundary', () => {
  it('refuses to open a second first week', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    const repo = repository();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = (await repo.findAdForUpdate(client, ad.id))!;
      await expect(
        billing().openFirstPeriodInTx(client, locked, { startsAt: new Date() }),
      ).rejects.toMatchObject({ statusCode: 409, code: 'AD_PERIOD_ALREADY_EXISTS' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('leaves no period, charge, ledger row or campaign change when the caller aborts', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const repo = repository();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = (await repo.findAdForUpdate(client, ad.id))!;
      const result = await billing().openFirstPeriodInTx(client, locked, {
        startsAt: new Date(),
      });
      // Inside the transaction everything exists...
      expect(result.created).toBe(true);
      expect(result.mhcCharged).toBe(25);
      const inside = await client.query<{ c: string }>(
        `SELECT count(*)::text c FROM advertisement_campaign_periods WHERE advertisement_id = $1`,
        [ad.id],
      );
      expect(inside.rows[0]!.c).toBe('1');

      // ...and the caller then abandons its own work.
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await periodCount(ad.id)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
    expect((await adRow(ad.id)).status).toBe('pending_review');
  });
});

describe.skipIf(!pgIntegrationEnabled())('expiration', () => {
  it('pauses a manual campaign and demands a renewal', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    const swept = await service().expireDuePeriods();

    expect(swept.periods).toBe(1);
    expect(swept.campaigns).toBe(1);
    const campaign = await adRow(ad.id);
    expect(campaign.status).toBe('expired');
    expect(campaign.billing_status).toBe('renewal_required');
    expect(campaign.manual_renewal_required).toBe(true);
    expect(campaign.current_period_ends_at).toBeNull();
    expect((await periods(ad.id))[0]!.status).toBe('expired');
    // Stops serving.
    expect(await service().resolveActiveAds({})).toHaveLength(0);
  });

  it('charges nothing and refunds nothing', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    await service().expireDuePeriods();

    expect(await balanceOf(pool, userId)).toBe(75);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    // No refund was recorded against the charge.
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM mhc_action_charges WHERE user_id = $1 AND refunded_at IS NOT NULL`,
        [userId],
      ),
    ).toBe(0);
  });

  it('is idempotent and preserves the period history', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    await service().expireDuePeriods();
    const second = await service().expireDuePeriods();

    expect(second.periods).toBe(0);
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('does not expire a week that is still running', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    const swept = await service().expireDuePeriods();

    expect(swept.periods).toBe(0);
    expect((await adRow(ad.id)).billing_status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Serving fails closed on an elapsed week, without help from expiration.
// ---------------------------------------------------------------------------
// Expiration is lazy in this wave, so the read path cannot assume the transition
// has run. Every test here drives `listActiveAdsForAdCenter` DIRECTLY — the
// repository query, not the service — so the lazy sweep inside `resolveActiveAds`
// cannot be what produces the result.

describe.skipIf(!pgIntegrationEnabled())('serving fails closed after a week elapses', () => {
  const servedIds = async (): Promise<string[]> =>
    (await repository().listActiveAdsForAdCenter(100)).map((row) => row.id);

  it('hides an elapsed week before any expiration has run', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    expect(await servedIds()).toContain(ad.id);

    // The week elapses. Nothing expires it: no sweep, no scheduler.
    await timeTravelPastWeek(ad.id);

    // Every status column still says the campaign is live and paid.
    const stale = await adRow(ad.id);
    expect(stale.status).toBe('active');
    expect(stale.billing_status).toBe('active');
    expect((await periods(ad.id))[0]!.status).toBe('active');

    expect(await servedIds()).not.toContain(ad.id);
  });

  it('hides it when the expiration write is lost entirely', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    // Simulate the sweep beginning and its transaction never committing: the
    // period is read, then the write is rolled back.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE advertisement_campaign_periods SET status = 'expired'
          WHERE advertisement_id = $1 AND status = 'active'`,
        [ad.id],
      );
      await client.query(
        `UPDATE advertisements SET status = 'expired', billing_status = 'renewal_required'
          WHERE id = $1`,
        [ad.id],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    // The rollback restored the "still active" state — and it is still hidden.
    expect((await adRow(ad.id)).billing_status).toBe('active');
    expect(await servedIds()).not.toContain(ad.id);
  });

  it('hides it even when the mirrored campaign window is stale', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    // Only the PERIOD moves into the past. The campaign's mirror columns still
    // claim a current week, so the period table is what has to refuse this.
    await pool.query(
      `UPDATE advertisement_campaign_periods
       SET starts_at = starts_at - interval '8 days', ends_at = ends_at - interval '8 days'
       WHERE advertisement_id = $1 AND status = 'active'`,
      [ad.id],
    );

    const row = await adRow(ad.id);
    expect(row.current_period_ends_at).not.toBeNull();
    expect(new Date(row.current_period_ends_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(await servedIds()).not.toContain(ad.id);
  });

  it('hides a campaign whose period row was never created', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    // The period disappears while every campaign column still says "active".
    await pool.query(`DELETE FROM advertisement_campaign_periods WHERE advertisement_id = $1`, [
      ad.id,
    ]);

    expect((await adRow(ad.id)).status).toBe('active');
    expect(await servedIds()).not.toContain(ad.id);
  });

  it('does not let an admin schedule override extend a paid week', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    // The override that used to win: it sat inside a COALESCE over expires_at,
    // so it REPLACED the paid-period boundary and served an unpaid campaign.
    await service().applyAdminSchedule(ad.id, {
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    });

    expect(await servedIds()).not.toContain(ad.id);
  });

  it('lets an admin schedule override still pull a live campaign early', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    expect(await servedIds()).toContain(ad.id);

    // Restriction still works — the override may shorten, just not extend.
    await service().applyAdminSchedule(ad.id, {
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    expect(await servedIds()).not.toContain(ad.id);
  });

  it('never exposes it while serving and expiration run concurrently', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);
    await timeTravelPastWeek(ad.id);

    // Ten interleaved reads and sweeps. The read must be safe at every point in
    // the sweep's transaction — before it, during it, and after it.
    //
    // Ten, not more: each sweep holds a dedicated connection for its
    // transaction, and the pooler caps this project at 15 sessions. A higher
    // number measures the pooler rather than the query.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? servedIds() : service().expireDuePeriods().then(() => servedIds()),
      ),
    );

    for (const ids of results) expect(ids).not.toContain(ad.id);

    // A second pass after everything has settled, so the post-sweep state is
    // asserted on its own rather than only under contention.
    expect(await servedIds()).not.toContain(ad.id);
    // And the sweep did land exactly once.
    expect((await adRow(ad.id)).billing_status).toBe('renewal_required');
    expect(await periodCount(ad.id)).toBe(1);
  });

  it('serves it again only once a new week is bought', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    expect(await servedIds()).not.toContain(ad.id);

    await service().renewAd(ad.id, userId);

    expect(await servedIds()).toContain(ad.id);
  });

  it('preserves legacy listing behaviour, including admin overrides', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO advertisements (
         advertiser_id, title_en, image_url, link_type, status,
         amount_paid, starts_at, expires_at, duration_days, destination_provider_id
       ) VALUES ($1, 'Legacy EGP campaign', 'https://cdn.example/legacy.png', 'profile', 'active',
         150, now() - interval '1 day', now() + interval '6 days', 7, $1)
       RETURNING id`,
      [userId],
    );
    const legacyId = rows[0]!.id;

    // A legacy campaign has no period and must still serve on its own window.
    expect(await periodCount(legacyId)).toBe(0);
    expect(await servedIds()).toContain(legacyId);

    // Its window elapses: hidden.
    await pool.query(
      `UPDATE advertisements SET expires_at = now() - interval '1 hour' WHERE id = $1`,
      [legacyId],
    );
    expect(await servedIds()).not.toContain(legacyId);

    // And the historical admin override still extends a LEGACY campaign, which
    // is the behaviour those campaigns shipped with and were paid for.
    await pool.query(
      `UPDATE advertisements SET admin_forced_expires_at = now() + interval '30 days' WHERE id = $1`,
      [legacyId],
    );
    expect(await servedIds()).toContain(legacyId);
  });
});

describe.skipIf(!pgIntegrationEnabled())('cancellation', () => {
  it('hides an active campaign immediately and refunds nothing', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    const result = await service().cancelAd(ad.id, userId);

    expect(result).toMatchObject({ cancelled: true, refundAmount: 0 });
    const campaign = await adRow(ad.id);
    expect(campaign.status).toBe('cancelled');
    expect(campaign.billing_status).toBe('cancelled');
    expect(await service().resolveActiveAds({})).toHaveLength(0);
    // The paid week is kept as history, marked cancelled, and NOT refunded.
    expect(await balanceOf(pool, userId)).toBe(75);
    expect(await periodCount(ad.id)).toBe(1);
    expect((await periods(ad.id))[0]!.status).toBe('cancelled');
    expect(
      await countRows(
        pool,
        `SELECT count(*)::text c FROM mhc_action_charges WHERE user_id = $1 AND refunded_at IS NOT NULL`,
        [userId],
      ),
    ).toBe(0);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('prevents any further renewal', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    await service().cancelAd(ad.id, userId);

    await expect(service().renewAd(ad.id, userId)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_RENEWABLE',
    });
    await expect(service().activateDueAdvertisement(ad.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_ACTIVATABLE',
    });
    expect(await periodCount(ad.id)).toBe(1);
    expect(await chargeCount(userId)).toBe(1);
  });

  it('cancels an unreviewed campaign with no charge and no refund', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const result = await service().cancelAd(ad.id, userId);

    expect(result).toMatchObject({ cancelled: true, refundAmount: 0 });
    expect((await adRow(ad.id)).status).toBe('cancelled');
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
  });

  it('cancels an approved future campaign with no charge and no refund', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId, {
      startsAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await service().approveAd(ad.id, adminId);

    const result = await service().cancelAd(ad.id, userId);

    expect(result.refundAmount).toBe(0);
    expect((await adRow(ad.id)).status).toBe('cancelled');
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
  });

  it('cancels a campaign waiting on a manual renewal', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    const result = await service().cancelAd(ad.id, userId);

    expect(result.refundAmount).toBe(0);
    expect((await adRow(ad.id)).billing_status).toBe('cancelled');
  });

  it('is idempotent and refuses a stranger', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const stranger = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().cancelAd(ad.id, userId);

    await expect(service().cancelAd(ad.id, stranger.userId)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    const again = await service().cancelAd(ad.id, userId);
    expect(again.cancelled).toBe(true);
  });
});

describe.skipIf(!pgIntegrationEnabled())('no EGP money path', () => {
  it('never creates or touches a money wallet across the whole lifecycle', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    await service().renewAd(ad.id, userId);
    await service().cancelAd(ad.id, userId);

    expect(await moneyWalletCount(userId)).toBe(0);
    // Every ledger row written for this advertiser is a credit movement.
    const { rows } = await pool.query<{ asset: string | null; c: string }>(
      `SELECT w.asset_code AS asset, count(*)::text AS c
       FROM transactions t JOIN wallets w ON w.id = t.wallet_id
       WHERE t.user_id = $1 GROUP BY w.asset_code`,
      [userId],
    );
    for (const row of rows) expect(row.asset).toBe('MHC');
  });
});

describe.skipIf(!pgIntegrationEnabled())('grandfathered legacy campaigns', () => {
  /** A pre-weekly campaign, exactly as an existing production row would look. */
  const seedLegacyAd = async (userId: string): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO advertisements (
         advertiser_id, title_en, image_url, link_type, status,
         amount_paid, starts_at, expires_at, duration_days,
         destination_provider_id
       ) VALUES ($1, 'Legacy EGP campaign', 'https://cdn.example/legacy.png', 'profile', 'active',
         150, now() - interval '1 day', now() + interval '6 days', 7, $1)
       RETURNING id`,
      [userId],
    );
    return rows[0]!.id;
  };

  it('stays on the legacy billing model', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const legacyId = await seedLegacyAd(userId);

    const row = await adRow(legacyId);
    expect(row.billing_model).toBe('legacy');
    expect(row.billing_status).toBe('legacy');
    expect(row.auto_renew_enabled).toBe(false);
    expect(Number(row.renewal_count)).toBe(0);
  });

  it('is never charged retroactively by any weekly path', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const legacyId = await seedLegacyAd(userId);

    await service().expireDuePeriods();
    await service().resolveActiveAds({});
    await expect(service().approveAd(legacyId, adminId)).rejects.toMatchObject({
      code: 'AD_NOT_WEEKLY',
    });
    await expect(service().renewAd(legacyId, userId)).rejects.toMatchObject({
      code: 'AD_NOT_WEEKLY',
    });
    await expect(service().activateDueAdvertisement(legacyId)).rejects.toMatchObject({
      code: 'AD_NOT_WEEKLY',
    });

    expect(await periodCount(legacyId)).toBe(0);
    expect(await chargeCount(userId)).toBe(0);
    expect(await balanceOf(pool, userId)).toBe(100);
  });

  it('keeps serving and keeps its own expiry sweep', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const legacyId = await seedLegacyAd(userId);

    expect((await service().resolveActiveAds({})).map((r) => r.id)).toContain(legacyId);

    // Its own window elapses; the legacy sweep still closes it.
    await pool.query(`UPDATE advertisements SET expires_at = now() - interval '1 hour' WHERE id = $1`, [
      legacyId,
    ]);
    await service().resolveActiveAds({});
    expect((await adRow(legacyId)).status).toBe('expired');
  });
});

describe.skipIf(!pgIntegrationEnabled())('database-enforced period invariants', () => {
  let adId: string;
  let userId: string;

  beforeEach(async () => {
    if (!pgIntegrationEnabled()) return;
    const provider = await seedProvider(pool, { mhc: 500 });
    userId = provider.userId;
    const ad = await submit(userId);
    adId = ad.id;
    await service().approveAd(adId, adminId);
  });

  const insertPeriod = (overrides: string): Promise<unknown> =>
    pool.query(
      `INSERT INTO advertisement_campaign_periods
         (advertisement_id, period_number, starts_at, ends_at, mhc_price_snapshot, status, renewal_source)
       VALUES ${overrides}`,
    );

  it('rejects a period that is not exactly 168 hours', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 99, now() + interval '30 days', now() + interval '36 days', 0, 'scheduled', 'manual')`,
      ),
    ).rejects.toThrow(/chk_ad_period_exact_week/);
  });

  it('rejects a second active period for one advertisement', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 98, now() + interval '30 days', now() + interval '30 days' + interval '168 hours', 0, 'active', 'manual')`,
      ),
    ).rejects.toThrow(/uq_ad_period_active/);
  });

  it('rejects a duplicate period number', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 1, now() + interval '60 days', now() + interval '60 days' + interval '168 hours', 0, 'scheduled', 'manual')`,
      ),
    ).rejects.toThrow(/uq_ad_period_number/);
  });

  it('rejects an overlapping period', async () => {
    // Overlaps the running week by a day.
    await expect(
      insertPeriod(
        `('${adId}', 97, now() + interval '1 day', now() + interval '1 day' + interval '168 hours', 0, 'scheduled', 'manual')`,
      ),
    ).rejects.toThrow(/ad_period_no_overlap/);
  });

  it('accepts a period that starts exactly when the previous one ends', async () => {
    const current = (await periods(adId))[0]!;
    // '[)' bounds make consecutive weeks adjacent, not overlapping.
    await pool.query(
      `INSERT INTO advertisement_campaign_periods
         (advertisement_id, period_number, starts_at, ends_at, mhc_price_snapshot, status, renewal_source)
       VALUES ($1, 2, $2::timestamptz, $2::timestamptz + interval '168 hours', 0, 'scheduled', 'manual')`,
      [adId, current.ends_at],
    );
    expect(await periodCount(adId)).toBe(2);
  });

  it('rejects a negative price snapshot', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 96, now() + interval '90 days', now() + interval '90 days' + interval '168 hours', -1, 'scheduled', 'manual')`,
      ),
    ).rejects.toThrow(/mhc_price_snapshot/);
  });

  it('rejects an invalid period status and renewal source', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 95, now() + interval '120 days', now() + interval '120 days' + interval '168 hours', 0, 'nonsense', 'manual')`,
      ),
    ).rejects.toThrow(/chk_ad_period_status/);
    await expect(
      insertPeriod(
        `('${adId}', 94, now() + interval '150 days', now() + interval '150 days' + interval '168 hours', 0, 'scheduled', 'nonsense')`,
      ),
    ).rejects.toThrow(/chk_ad_period_renewal_source/);
  });

  it('rejects a priced week that points at no charge', async () => {
    await expect(
      insertPeriod(
        `('${adId}', 93, now() + interval '180 days', now() + interval '180 days' + interval '168 hours', 25, 'scheduled', 'manual')`,
      ),
    ).rejects.toThrow(/chk_ad_period_charge_shape/);
  });

  it('rejects a second week pointing at the same charge', async () => {
    const chargeId = (await periods(adId))[0]!.action_charge_id;
    await expect(
      pool.query(
        `INSERT INTO advertisement_campaign_periods
           (advertisement_id, period_number, starts_at, ends_at, mhc_price_snapshot, action_charge_id, status, renewal_source)
         VALUES ($1, 92, now() + interval '210 days', now() + interval '210 days' + interval '168 hours', 25, $2, 'scheduled', 'manual')`,
        [adId, chargeId],
      ),
    ).rejects.toThrow(/uq_ad_period_action_charge/);
  });

  // The consent columns are supplied in both statements below so that
  // `chk_advertisements_auto_renew_consent` (Wave 2F-B) is satisfied and only
  // the constraint each test is actually about can fail. PostgreSQL does not
  // promise an evaluation order between CHECKs.
  it('rejects automatic renewal without a bound', async () => {
    await expect(
      pool.query(
        `UPDATE advertisements
         SET renewal_mode = 'automatic', auto_renew_enabled = true,
             auto_renew_enabled_at = now(), auto_renew_enabled_by = advertiser_id
         WHERE id = $1`,
        [adId],
      ),
    ).rejects.toThrow(/chk_advertisements_auto_renew_bounded/);
  });

  it('rejects automatic renewal left in manual mode', async () => {
    await expect(
      pool.query(
        `UPDATE advertisements
         SET auto_renew_enabled = true, maximum_weeks = 4,
             auto_renew_enabled_at = now(), auto_renew_enabled_by = advertiser_id
         WHERE id = $1`,
        [adId],
      ),
    ).rejects.toThrow(/chk_advertisements_auto_renew_mode/);
  });

  it('rejects a non-positive maximum week count and an invalid billing state', async () => {
    await expect(
      pool.query(`UPDATE advertisements SET maximum_weeks = 0 WHERE id = $1`, [adId]),
    ).rejects.toThrow(/chk_advertisements_maximum_weeks/);
    await expect(
      pool.query(`UPDATE advertisements SET billing_status = 'nonsense' WHERE id = $1`, [adId]),
    ).rejects.toThrow(/chk_advertisements_billing_status/);
    await expect(
      pool.query(`UPDATE advertisements SET billing_model = 'nonsense' WHERE id = $1`, [adId]),
    ).rejects.toThrow(/chk_advertisements_billing_model/);
  });

  it('rejects a renewal end date that precedes the campaign', async () => {
    await expect(
      pool.query(
        `UPDATE advertisements SET renewal_end_date = created_at - interval '1 day' WHERE id = $1`,
        [adId],
      ),
    ).rejects.toThrow(/chk_advertisements_renewal_end_date/);
  });
});

// ---------------------------------------------------------------------------
// A campaign nobody opted in stays manual.
// ---------------------------------------------------------------------------
// This block replaces "automatic renewal is not available", which pinned the
// `AUTO_RENEWAL_NOT_AVAILABLE` placeholder Wave 2F-A shipped. That refusal is
// now false — Wave 2F-B implements automatic renewal — so those assertions are
// replaced rather than relaxed. What is asserted here is the half that must
// remain true regardless: a campaign whose advertiser has consented to nothing
// renews only when they ask.
//
// The automatic path itself is covered by advertisements.automatic-renewal.pg.test.ts.
// ---------------------------------------------------------------------------
describe.skipIf(!pgIntegrationEnabled())('a campaign nobody opted in stays manual', () => {
  it('starts manual, unconsented and unbounded', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    const row = await adRow(ad.id);
    expect(row.auto_renew_enabled).toBe(false);
    expect(row.renewal_mode).toBe('manual');
    expect(row.maximum_weeks).toBeNull();
    expect(row.renewal_end_date).toBeNull();
    expect(row.auto_renew_enabled_at).toBeNull();
    expect(row.auto_renew_enabled_by).toBeNull();
  });

  it('accepts switching it off on a campaign that was never on', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    await expect(
      service().setAutoRenewal(ad.id, userId, { enabled: false }),
    ).resolves.toMatchObject({ autoRenewEnabled: false, renewalMode: 'manual' });
    expect((await adRow(ad.id)).auto_renew_enabled).toBe(false);
  });

  it('never writes an automatic period', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);
    await service().renewAd(ad.id, userId);

    const sources = (await periods(ad.id)).map((p) => p.renewal_source);
    expect(sources).toEqual(['initial', 'manual']);
    expect(sources).not.toContain('automatic');
  });
});

describe.skipIf(!pgIntegrationEnabled())('billing state API', () => {
  it('reports the weekly price, the current week and every snapshot', async () => {
    const { userId } = await seedProvider(pool, { mhc: 500 });
    const ad = await submit(userId);
    await approveThenExpire(ad.id);

    const state = await service().getBillingState(ad.id, { id: userId, isAdmin: false });

    expect(state).toMatchObject({
      billingModel: 'weekly',
      billingStatus: 'renewal_required',
      moderationStatus: 'expired',
      weeklyMhcPrice: 25,
      manualRenewalRequired: true,
      canRenew: true,
      // Wave 2F-B: a weekly campaign that has not been cancelled or rejected
      // MAY be switched to automatic renewal. It has not been, and the
      // advertiser has consented to nothing.
      autoRenewalAvailable: true,
      autoRenewEnabled: false,
      renewalMode: 'manual',
      canRetryAutomaticRenewal: false,
    });
    expect(state.autoRenewEnabledAt).toBeNull();
    expect(state.autoRenewPausedReason).toBeNull();
    expect(state.periods).toHaveLength(1);
    expect(state.periods[0]).toMatchObject({
      periodNumber: 1,
      mhcPriceSnapshot: 25,
      status: 'expired',
      renewalSource: 'initial',
      hasCharge: true,
    });
  });

  it('refuses a stranger and allows an admin', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const stranger = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    await expect(
      service().getBillingState(ad.id, { id: stranger.userId, isAdmin: false }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    await expect(
      service().getBillingState(ad.id, { id: stranger.userId, isAdmin: true }),
    ).resolves.toMatchObject({ billingStatus: 'pending_review' });
  });
});

describe.skipIf(!pgIntegrationEnabled())('moderation cannot be bypassed', () => {
  it('does not let an advertiser edit an approved campaign', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);
    await service().approveAd(ad.id, adminId);

    await expect(
      service().updateAd(ad.id, userId, { titleEn: 'Something entirely different' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AD_NOT_EDITABLE' });
  });

  it('does not let an admin force a weekly campaign live without a paid week', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const ad = await submit(userId);

    await expect(service().applyAdminStatus(ad.id, 'active')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_ACTIVATION_REQUIRES_PERIOD',
    });
    expect(await periodCount(ad.id)).toBe(0);
    expect(await service().resolveActiveAds({})).toHaveLength(0);
  });

  it('refuses a service destination the advertiser does not own', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });

    await expect(
      service().createAd(userId, {
        titleEn: 'Pointing at someone else',
        imageUrl: 'https://cdn.example/ad.png',
        linkType: 'service',
        linkTarget: '11111111-1111-4111-8111-111111111111',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'AD_SERVICE_NOT_FOUND' });
  });
});

// ---------------------------------------------------------------------------
// Migration forward/rollback proof
// ---------------------------------------------------------------------------
// Built on a SEPARATE scratch copy, because it destroys the objects the suite
// above depends on. The rollback text is the one documented in the migration
// header; if the two drift, this fails.

const ROLLBACK_SQL = `
-- Newest dependant first, exactly as the 20260730120000 header now instructs:
-- 20260731090000 hangs advertisement_renewal_events.period_id off the period
-- table, so the DROP below cannot run while that table exists.
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

DROP TABLE IF EXISTS public.advertisement_campaign_periods;

ALTER TABLE public.advertisements
  DROP CONSTRAINT IF EXISTS chk_advertisements_billing_model,
  DROP CONSTRAINT IF EXISTS chk_advertisements_billing_status,
  DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_mode,
  DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_count,
  DROP CONSTRAINT IF EXISTS chk_advertisements_maximum_weeks,
  DROP CONSTRAINT IF EXISTS chk_advertisements_renewal_end_date,
  DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_bounded,
  DROP CONSTRAINT IF EXISTS chk_advertisements_auto_renew_mode,
  DROP CONSTRAINT IF EXISTS chk_advertisements_current_period_shape;

DROP INDEX IF EXISTS public.idx_advertisements_billing_due;
DROP INDEX IF EXISTS public.idx_advertisements_billing_status;

ALTER TABLE public.advertisements
  DROP COLUMN IF EXISTS billing_model,
  DROP COLUMN IF EXISTS billing_status,
  DROP COLUMN IF EXISTS renewal_mode,
  DROP COLUMN IF EXISTS auto_renew_enabled,
  DROP COLUMN IF EXISTS maximum_weeks,
  DROP COLUMN IF EXISTS renewal_end_date,
  DROP COLUMN IF EXISTS current_period_starts_at,
  DROP COLUMN IF EXISTS current_period_ends_at,
  DROP COLUMN IF EXISTS next_renewal_at,
  DROP COLUMN IF EXISTS renewal_count,
  DROP COLUMN IF EXISTS manual_renewal_required;
`;

describe.skipIf(!pgIntegrationEnabled())('migration forward and rollback', () => {
  it('builds the weekly billing objects from nothing', async () => {
    const copy = await createScratchDatabase('adsforward');
    try {
      const { rows } = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.advertisement_campaign_periods')::text AS t`,
      );
      expect(rows[0]!.t).toBe('advertisement_campaign_periods');

      // The weekly price is present, active and still zero.
      const { rows: price } = await copy.pool.query<{ p: string; a: boolean }>(
        `SELECT mhc_price::text p, is_active a FROM mhc_action_prices WHERE action_key = 'advertisement'`,
      );
      expect(price[0]).toMatchObject({ p: '0.00', a: true });

      // Grandfathering is a column DEFAULT, so it holds without a backfill.
      const { rows: def } = await copy.pool.query<{ d: string | null }>(
        `SELECT column_default d FROM information_schema.columns
          WHERE table_name = 'advertisements' AND column_name = 'billing_model'`,
      );
      expect(def[0]!.d).toContain('legacy');

      // The exclusion constraint really is an exclusion constraint.
      const { rows: excl } = await copy.pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) def FROM pg_constraint WHERE conname = 'ad_period_no_overlap'`,
      );
      expect(excl[0]!.def).toContain('EXCLUDE USING gist');
      expect(excl[0]!.def).toContain('tstzrange');
    } finally {
      await copy.drop();
    }
  }, 900_000);

  it('runs the documented rollback twice and returns to the expected schema', async () => {
    const copy = await createScratchDatabase('adsrollback');
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
      expect(before.has('table:advertisement_campaign_periods')).toBe(true);
      expect(before.has('column:advertisements.billing_model')).toBe(true);

      // Idempotent: the documented sequence runs twice with the same result.
      await copy.exec(ROLLBACK_SQL);
      await copy.exec(ROLLBACK_SQL);

      const after = await fingerprint();
      expect(after.has('table:advertisement_campaign_periods')).toBe(false);
      expect(after.has('column:advertisements.billing_model')).toBe(false);
      expect(after.has('column:advertisements.manual_renewal_required')).toBe(false);

      // Nothing appeared, and everything that disappeared belongs to this
      // migration. Asserted as an exact set, so an unnoticed casualty fails here.
      const added = [...after].filter((k) => !before.has(k));
      expect(added).toEqual([]);

      const removed = [...before].filter((k) => !after.has(k)).sort();
      const foreign = removed.filter(
        (k) =>
          !k.includes('advertisement_campaign_periods') &&
          !k.includes('ad_period') &&
          // Wave 2F-B objects, reversed first because they depend on the period
          // table. Listed here rather than excluded from the rollback, so the
          // combined reversal is still asserted to be exact.
          !k.includes('advertisement_renewal_events') &&
          !k.includes('ad_renewal_event') &&
          !/advertisements\.(auto_renew_enabled_at|auto_renew_enabled_by|auto_renew_consent_version|auto_renew_paused_reason|auto_renew_paused_at|last_renewal_outcome|last_renewal_attempt_at)/.test(
            k,
          ) &&
          !/chk_advertisements_(auto_renew_consent|auto_renew_paused_reason|auto_renew_paused_shape|last_renewal_outcome)/.test(
            k,
          ) &&
          !/idx_advertisements_auto_renew_due/.test(k) &&
          // Dropping `auto_renew_enabled_by` takes its foreign key with it.
          !/advertisements_auto_renew_enabled_by_fkey/.test(k) &&
          !/advertisements\.(billing_model|billing_status|renewal_mode|auto_renew_enabled|maximum_weeks|renewal_end_date|current_period_starts_at|current_period_ends_at|next_renewal_at|renewal_count|manual_renewal_required)/.test(
            k,
          ) &&
          !/chk_advertisements_(billing_model|billing_status|renewal_mode|renewal_count|maximum_weeks|renewal_end_date|auto_renew_bounded|auto_renew_mode|current_period_shape)/.test(
            k,
          ) &&
          !/idx_advertisements_billing_(due|status)/.test(k),
      );
      expect(foreign).toEqual([]);

      // The review columns predate this migration and must survive its reversal.
      expect(after.has('column:advertisements.reviewed_by')).toBe(true);
      expect(after.has('column:advertisements.reviewed_at')).toBe(true);
      expect(after.has('column:advertisements.rejection_reason')).toBe(true);

      // Financial history and the tables around it are untouched.
      const { rows: survivors } = await copy.pool.query<{ t: string | null; name: string }>(
        `SELECT name, to_regclass('public.' || name)::text AS t
           FROM unnest(ARRAY[
             'transactions','mhc_action_charges','mhc_job_activations','wallets',
             'advertisements','plan_subscriptions','provider_payment_disclosures'
           ]) AS name`,
      );
      for (const row of survivors) expect(row.t).toBe(row.name);

      // The legacy EGP columns are still there — the rollback drops none of them.
      const { rows: legacy } = await copy.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'advertisements'
            AND column_name IN ('amount_paid','daily_price_piastres','quoted_amount_piastres',
                                'wallet_hold_id','cancellation_refund_piastres')`,
      );
      expect(legacy[0]!.n).toBe('5');
    } finally {
      await copy.drop();
    }
  }, 900_000);
});
