import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdvertisementsRepository } from '../modules/advertisements/advertisements.repository.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';
import {
  adLinkTypeSchema,
  adStatusSchema,
  createAdSchema,
  updateAdSchema,
} from '../modules/advertisements/advertisements.validation.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

// ---------------------------------------------------------------------------
// Advertisement moderation and the contract around it.
// ---------------------------------------------------------------------------
// This file replaces the charge-at-creation suite. Ad creation used to compute a
// price and charge MHC inside the create transaction; it now creates one
// `pending_review` row and nothing financial at all, so the properties worth
// asserting here are different ones:
//
//   * submission touches no wallet and no charge primitive — asserted by spying
//     on the primitive itself, so it holds regardless of what the price is;
//   * a client cannot supply a price, a duration, or a status;
//   * automatic renewal cannot be enabled.
//
// Row-level and concurrency behaviour lives in advertisements.weekly-billing.pg.test.ts,
// against a real PostgreSQL server. Nothing here models a database.
// ---------------------------------------------------------------------------

const poolConnectMock = vi.fn();
const poolQueryMock = vi.fn();

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: poolConnectMock }),
  hasDatabaseConfig: () => true,
}));
vi.mock('../config/env.js', () => ({ env: {} }));

const PROVIDER = '11111111-1111-4111-8111-111111111111';
const ADMIN = '99999999-9999-4999-8999-999999999999';
const AD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const baseInput = {
  titleEn: 'Structural surveys in Giza',
  imageUrl: 'https://cdn.example/ad.png',
  linkType: 'profile' as const,
};

/** A connection whose statements are recorded rather than executed. */
type FakeQueryResult = { rows: Record<string, unknown>[]; rowCount: number };
type FakeQuery = (sql: string) => Promise<FakeQueryResult>;

type FakeClient = {
  // Typed as Promise-returning so a replacement implementation is one too, and
  // an accidentally synchronous stub is a compile error rather than a hang.
  query: ReturnType<typeof vi.fn<FakeQuery>>;
  release: ReturnType<typeof vi.fn>;
  statements: string[];
};

const makeClient = (): FakeClient => {
  const statements: string[] = [];
  const client: FakeClient = {
    query: vi.fn<FakeQuery>((sql: string) => {
      statements.push(typeof sql === 'string' ? sql.trim() : String(sql));
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
    release: vi.fn(),
    statements,
  };
  return client;
};

let client: FakeClient;
let chargeSpy: ReturnType<typeof vi.spyOn>;

const pendingRow = (overrides: Record<string, unknown> = {}) => ({
  id: AD_ID,
  advertiser_id: PROVIDER,
  title_en: baseInput.titleEn,
  status: 'pending_review',
  billing_model: 'weekly',
  billing_status: 'pending_review',
  starts_at: null,
  reviewed_at: null,
  reviewed_by: null,
  rejection_reason: null,
  amount_paid: '0.00',
  client_idempotency_key: null,
  maximum_weeks: null,
  renewal_end_date: null,
  current_period_ends_at: null,
  ...overrides,
});

/**
 * The repository is stubbed at its boundary. What is NOT stubbed is the charging
 * primitive: it is spied on so "submission never charges" is a statement about
 * the call graph rather than about a mock's return value.
 */
const makeService = (repoOverrides: Record<string, unknown> = {}): AdvertisementsService => {
  const repo = new AdvertisementsRepository();
  vi.spyOn(repo, 'getGlobalAdAcceptance').mockResolvedValue(true);
  vi.spyOn(repo, 'getAdvertisementMhcPrice').mockResolvedValue({ mhcPrice: 25, isActive: true });
  vi.spyOn(repo, 'isAdvertisableProvider').mockResolvedValue(true);
  vi.spyOn(repo, 'findOwnedActiveServiceId').mockResolvedValue(null);
  vi.spyOn(repo, 'findAdByIdempotencyKey').mockResolvedValue(null);
  vi.spyOn(repo, 'createPendingAdInTx').mockResolvedValue(pendingRow() as never);
  vi.spyOn(repo, 'getAdById').mockResolvedValue(pendingRow() as never);
  vi.spyOn(repo, 'findAdForUpdate').mockResolvedValue(pendingRow() as never);
  vi.spyOn(repo, 'rejectAdInTx').mockImplementation((_c, id, adminId, reason) =>
    Promise.resolve(
      pendingRow({
        id,
        status: 'rejected',
        billing_status: 'rejected',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason,
      }) as never,
    ),
  );
  vi.spyOn(repo, 'recordApprovalInTx').mockImplementation((_c, id, adminId, billingStatus) =>
    Promise.resolve(
      pendingRow({
        id,
        status: 'scheduled',
        billing_status: billingStatus,
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
      }) as never,
    ),
  );
  vi.spyOn(repo, 'findActivePeriodInTx').mockResolvedValue(null);
  vi.spyOn(repo, 'getMaxPeriodNumberInTx').mockResolvedValue(0);
  vi.spyOn(repo, 'listPeriods').mockResolvedValue([]);
  // Assigned directly rather than through vi.spyOn: spying with a key typed as
  // the union of every repository method produces a union TypeScript refuses to
  // represent. The instance is fresh per call, so nothing leaks between tests.
  const instance = repo as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(repoOverrides)) {
    instance[name] = value;
  }
  return new AdvertisementsService(repo, undefined, undefined, new MhcService());
};

beforeEach(() => {
  // restore before clear: a spy left on a prototype by one test would otherwise
  // silently change what the next test is exercising.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  client = makeClient();
  poolConnectMock.mockReturnValue(client);
  chargeSpy = vi.spyOn(MhcService.prototype, 'chargeAction');
});

describe('submission never charges', () => {
  it('creates a pending_review campaign without calling the charge primitive', async () => {
    const ad = await makeService().createAd(PROVIDER, baseInput);

    expect(ad.status).toBe('pending_review');
    expect(ad.billing_status).toBe('pending_review');
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('charges nothing even when a non-zero weekly price is configured', async () => {
    // The price is 25 in this fixture. Nothing reads it on the submit path.
    await makeService().createAd(PROVIDER, baseInput);
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('opens exactly one transaction and commits it', async () => {
    await makeService().createAd(PROVIDER, baseInput);

    expect(client.statements.filter((s) => s === 'BEGIN')).toHaveLength(1);
    expect(client.statements.filter((s) => s === 'COMMIT')).toHaveLength(1);
    expect(client.statements.filter((s) => s === 'ROLLBACK')).toHaveLength(0);
  });

  it('refuses when the admin has stopped accepting campaigns', async () => {
    const service = makeService({ getGlobalAdAcceptance: () => Promise.resolve(false) });

    await expect(service.createAd(PROVIDER, baseInput)).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADS_DISABLED_BY_ADMIN',
    });
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('returns the existing campaign for a retried submission', async () => {
    const existing = pendingRow({ id: 'bbbbbbbb-0000-4000-8000-000000000002' });
    const service = makeService({ findAdByIdempotencyKey: () => Promise.resolve(existing) });

    const ad = await service.createAd(PROVIDER, baseInput, 'cccccccc-0000-4000-8000-000000000001');

    expect(ad.id).toBe(existing.id);
    // The fast path never even opens a transaction.
    expect(poolConnectMock).not.toHaveBeenCalled();
  });

  it('refuses a profile campaign for an account that cannot be advertised', async () => {
    const service = makeService({ isAdvertisableProvider: () => Promise.resolve(false) });

    await expect(service.createAd(PROVIDER, baseInput)).rejects.toMatchObject({
      statusCode: 403,
      code: 'AD_PROFILE_NOT_ADVERTISABLE',
    });
  });

  it('refuses a service campaign pointing at a service the advertiser does not own', async () => {
    const service = makeService({ findOwnedActiveServiceId: () => Promise.resolve(null) });

    await expect(
      service.createAd(PROVIDER, {
        ...baseInput,
        linkType: 'service',
        linkTarget: '22222222-2222-4222-8222-222222222222',
      }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'AD_SERVICE_NOT_FOUND' });
  });
});

describe('rejection', () => {
  it('records the reviewer and reason and never calls the charge primitive', async () => {
    const rejected = await makeService().rejectAd(AD_ID, ADMIN, 'Banner text is misleading');

    expect(rejected).toMatchObject({
      status: 'rejected',
      billing_status: 'rejected',
      reviewed_by: ADMIN,
      rejection_reason: 'Banner text is misleading',
    });
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('reports the existing rejection rather than re-rejecting', async () => {
    const already = pendingRow({ status: 'rejected', rejection_reason: 'first' });
    const service = makeService({ findAdForUpdate: () => Promise.resolve(already) });

    const result = await service.rejectAd(AD_ID, ADMIN, 'second');

    expect(result.rejection_reason).toBe('first');
  });

  it('refuses to reject an approved campaign', async () => {
    const approved = pendingRow({ status: 'scheduled', billing_status: 'awaiting_start' });
    const service = makeService({ findAdForUpdate: () => Promise.resolve(approved) });

    await expect(service.rejectAd(AD_ID, ADMIN, 'too late')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_PENDING_REVIEW',
    });
  });

  it('refuses to moderate a legacy campaign', async () => {
    const legacy = pendingRow({ billing_model: 'legacy', billing_status: 'legacy' });
    const service = makeService({ findAdForUpdate: () => Promise.resolve(legacy) });

    await expect(service.rejectAd(AD_ID, ADMIN, 'no')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_WEEKLY',
    });
    await expect(service.approveAd(AD_ID, ADMIN)).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_NOT_WEEKLY',
    });
  });
});

describe('approval', () => {
  it('records approval without charging for a future-dated campaign', async () => {
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const service = makeService({
      findAdForUpdate: () => Promise.resolve(pendingRow({ starts_at: future })),
    });
    // The approval path reads now() from the database.
    client.query.mockImplementation((sql: string) => {
      client.statements.push(String(sql).trim());
      if (String(sql).includes('now()::text')) {
        return Promise.resolve({ rows: [{ now: new Date().toISOString() }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await service.approveAd(AD_ID, ADMIN);

    expect(result.period).toBeNull();
    expect(result.created).toBe(false);
    expect(result.advertisement.billing_status).toBe('awaiting_start');
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('reports an already-approved campaign instead of charging again', async () => {
    const service = makeService({
      findAdForUpdate: () => Promise.resolve(pendingRow({ status: 'active', billing_status: 'active' })),
    });

    const result = await service.approveAd(AD_ID, ADMIN);

    expect(result.created).toBe(false);
    expect(result.mhcCharged).toBe(0);
    expect(chargeSpy).not.toHaveBeenCalled();
  });
});

describe('automatic renewal is refused', () => {
  it('rejects enabling it with a stable error code', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, PROVIDER, { enabled: true, maximumWeeks: 4 }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AUTO_RENEWAL_NOT_AVAILABLE' });
  });

  it('accepts disabling it', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, PROVIDER, { enabled: false }),
    ).resolves.toEqual({ autoRenewEnabled: false, autoRenewalAvailable: false });
  });

  it('refuses a stranger', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, 'ffffffff-0000-4000-8000-00000000000f', {
        enabled: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

describe('ownership', () => {
  it('refuses a stranger cancelling, renewing or reading billing state', async () => {
    const stranger = 'ffffffff-0000-4000-8000-00000000000f';
    const service = makeService();

    await expect(service.cancelAd(AD_ID, stranger)).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN',
    });
    await expect(
      service.getBillingState(AD_ID, { id: stranger, isAdmin: false }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('lets an admin read any campaign billing state', async () => {
    const state = await makeService().getBillingState(AD_ID, { id: ADMIN, isAdmin: true });

    expect(state).toMatchObject({
      billingModel: 'weekly',
      billingStatus: 'pending_review',
      weeklyMhcPrice: 25,
      autoRenewalAvailable: false,
      canRenew: false,
    });
  });

  it('refuses to edit a campaign once it has been reviewed', async () => {
    const service = makeService({
      getAdById: () =>
        Promise.resolve(pendingRow({ status: 'scheduled', billing_status: 'awaiting_start' })),
    });

    await expect(service.updateAd(AD_ID, PROVIDER, { titleEn: 'Swapped creative' })).rejects.toMatchObject(
      { statusCode: 409, code: 'AD_NOT_EDITABLE' },
    );
  });
});

describe('a client cannot supply a trusted price, duration or status', () => {
  it('has no price field of any kind on the create schema', () => {
    const parsed = createAdSchema.parse({
      ...baseInput,
      mhcPrice: 999,
      price: 999,
      amount: 999,
    } as never);

    expect(parsed).not.toHaveProperty('mhcPrice');
    expect(parsed).not.toHaveProperty('price');
    expect(parsed).not.toHaveProperty('amount');
  });

  it('no longer accepts a campaign duration', () => {
    const parsed = createAdSchema.parse({ ...baseInput, durationDays: 365 } as never);
    // A week is exactly seven days, server-side. There is nothing to choose.
    expect(parsed).not.toHaveProperty('durationDays');
  });

  it('does not let a provider set the moderation status on their own campaign', () => {
    const parsed = updateAdSchema.parse({ titleEn: 'Edited title', status: 'active' } as never);
    expect(parsed).not.toHaveProperty('status');
  });

  it('offers only destinations the database can actually store', () => {
    expect(adLinkTypeSchema.options).toEqual(['profile', 'service']);
    expect(adLinkTypeSchema.safeParse('need').success).toBe(false);
  });

  it('describes exactly the moderation statuses the database permits', () => {
    expect(adStatusSchema.options).toEqual([
      'pending_review',
      'scheduled',
      'active',
      'paused_by_admin',
      'rejected',
      'expired',
      'cancelled',
    ]);
    // The pre-moderation value is gone from both the schema and the database.
    expect(adStatusSchema.safeParse('pending_payment').success).toBe(false);
  });

  it('requires a service campaign to name a service id', () => {
    expect(
      createAdSchema.safeParse({ ...baseInput, linkType: 'service', linkTarget: 'not-a-uuid' })
        .success,
    ).toBe(false);
    expect(createAdSchema.safeParse({ ...baseInput, linkType: 'service' }).success).toBe(false);
  });
});

describe('admin weekly pricing', () => {
  it('writes the same row the charge primitive reads', async () => {
    let stored: number | null = null;
    const service = makeService({
      setAdvertisementMhcPrice: (price: number) => {
        stored = price;
        return Promise.resolve();
      },
      upsertGlobalAdControls: () => Promise.resolve(),
    });

    const updated = await service.updateAdminAdControls(ADMIN, { acceptAds: true, mhcPrice: 40 });

    expect(updated).toEqual({ acceptAds: true, mhcPrice: 40 });
    expect(stored).toBe(40);
  });

  it('rejects a negative weekly price', async () => {
    await expect(
      makeService().updateAdminAdControls(ADMIN, { acceptAds: true, mhcPrice: -1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'AD_INVALID_MHC_PRICE' });
  });

  it('reports a disabled action price as zero rather than guessing', async () => {
    const service = makeService({
      getAdvertisementMhcPrice: () => Promise.resolve({ mhcPrice: 25, isActive: false }),
    });
    expect(await service.getAdminAdControls()).toEqual({ acceptAds: true, mhcPrice: 0 });
  });

  it('refuses to force a weekly campaign live by writing a status', async () => {
    await expect(makeService().applyAdminStatus(AD_ID, 'active')).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_ACTIVATION_REQUIRES_PERIOD',
    });
  });
});
