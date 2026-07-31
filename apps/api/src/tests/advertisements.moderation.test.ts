import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdvertisementBillingService } from '../modules/advertisements/advertisement-billing.service.js';
import { AdvertisementRenewalNotifier } from '../modules/advertisements/advertisement-renewal.notifier.js';
import { AdvertisementRenewalRepository } from '../modules/advertisements/advertisement-renewal.repository.js';
import {
  AUTO_RENEW_CONSENT_VERSION,
  AdvertisementRenewalService,
} from '../modules/advertisements/advertisement-renewal.service.js';
import { AdvertisementsRepository } from '../modules/advertisements/advertisements.repository.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';
import {
  adLinkTypeSchema,
  adStatusSchema,
  autoRenewalSchema,
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
  next_renewal_at: null,
  // Weekly billing and automatic-renewal columns, at their database defaults.
  // A real row always carries them, so the fixture does too — a test that
  // passes only because a column was absent proves nothing.
  renewal_mode: 'manual',
  auto_renew_enabled: false,
  auto_renew_enabled_at: null,
  auto_renew_enabled_by: null,
  auto_renew_consent_version: null,
  auto_renew_paused_reason: null,
  auto_renew_paused_at: null,
  last_renewal_outcome: null,
  last_renewal_attempt_at: null,
  renewal_count: 0,
  manual_renewal_required: false,
  ...overrides,
});

/**
 * The repository is stubbed at its boundary. What is NOT stubbed is the charging
 * primitive: it is spied on so "submission never charges" is a statement about
 * the call graph rather than about a mock's return value.
 */
const makeService = (
  repoOverrides: Record<string, unknown> = {},
  renewalRepoOverrides: Record<string, unknown> = {},
): AdvertisementsService => {
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
  vi.spyOn(repo, 'countPeriods').mockResolvedValue(0);
  // Assigned directly rather than through vi.spyOn: spying with a key typed as
  // the union of every repository method produces a union TypeScript refuses to
  // represent. The instance is fresh per call, so nothing leaks between tests.
  const instance = repo as unknown as Record<string, unknown>;
  for (const [name, value] of Object.entries(repoOverrides)) {
    instance[name] = value;
  }

  // The renewal half is stubbed at the same boundary. `writeAutoRenewalConfigInTx`
  // echoes what it was asked to store, so a test can assert what the service
  // DECIDED to write without modelling PostgreSQL.
  const renewalRepo = new AdvertisementRenewalRepository();
  vi.spyOn(renewalRepo, 'now').mockImplementation(() => Promise.resolve(new Date()));
  vi.spyOn(renewalRepo, 'periodFitsBeforeBoundary').mockResolvedValue(true);
  vi.spyOn(renewalRepo, 'listEvents').mockResolvedValue([]);
  vi.spyOn(renewalRepo, 'findEventInTx').mockResolvedValue(null);
  vi.spyOn(renewalRepo, 'insertEventInTx').mockImplementation((_c, input) =>
    Promise.resolve({
      id: 'eeeeeeee-0000-4000-8000-000000000001',
      advertisement_id: input.advertisementId,
      advertiser_id: input.advertiserId,
      boundary_period_number: input.boundaryPeriodNumber,
      event_type: input.eventType,
      period_id: input.periodId ?? null,
      detail: input.detail ?? {},
      created_at: new Date().toISOString(),
      delivery_status: 'pending',
      claim_expires_at: null,
      claimed_at: null,
      attempt_count: 0,
      last_delivery_error: null,
      delivered_at: null,
      in_app_notification_id: null,
    }),
  );
  vi.spyOn(renewalRepo, 'writeAutoRenewalConfigInTx').mockImplementation((_c, params) =>
    Promise.resolve(
      pendingRow({
        auto_renew_enabled: params.enabled,
        renewal_mode: params.enabled ? 'automatic' : 'manual',
        maximum_weeks: params.maximumWeeks,
        renewal_end_date: params.renewalEndDate,
        auto_renew_enabled_at: params.enabled ? new Date().toISOString() : null,
        auto_renew_enabled_by: params.consentBy,
        auto_renew_consent_version: params.consentVersion,
        auto_renew_paused_reason: null,
        auto_renew_paused_at: null,
      }) as never,
    ),
  );
  for (const [name, value] of Object.entries(renewalRepoOverrides)) {
    (renewalRepo as unknown as Record<string, unknown>)[name] = value;
  }

  const mhc = new MhcService();
  vi.spyOn(mhc, 'getBalanceFor').mockResolvedValue(0);
  const notifier = new AdvertisementRenewalNotifier(renewalRepo);
  // Delivery is out of band by design; asserting it here would be asserting the
  // outbox, which has its own coverage.
  vi.spyOn(notifier, 'deliverSoon').mockImplementation(() => {});
  const billing = new AdvertisementBillingService(repo, mhc, renewalRepo, notifier);
  const renewal = new AdvertisementRenewalService(repo, renewalRepo, billing, notifier, mhc);
  return new AdvertisementsService(repo, undefined, undefined, mhc, billing, renewalRepo, renewal);
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

// ---------------------------------------------------------------------------
// Automatic renewal configuration (Wave 2F-B).
// ---------------------------------------------------------------------------
// This block replaces the "automatic renewal is refused" suite, which pinned
// the deliberate placeholder Wave 2F-A shipped (`AUTO_RENEWAL_NOT_AVAILABLE`).
// That refusal is now false, so the assertions that encoded it are replaced
// rather than relaxed. What is asserted instead is stricter than what they
// asserted: consent, a bound, a bound that can still be reached, and — above
// all — that none of it goes anywhere near the charging primitive.
//
// Row-level and concurrency behaviour lives in
// advertisements.automatic-renewal.pg.test.ts, against a real server.
// ---------------------------------------------------------------------------
describe('automatic renewal configuration', () => {
  it('refuses to enable without explicit consent', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, PROVIDER, { enabled: true, maximumWeeks: 4 }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'AD_AUTO_RENEWAL_CONSENT_REQUIRED',
    });
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('refuses to enable without a maximum week count or an end date', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, PROVIDER, { enabled: true, consentAccepted: true }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'AD_AUTO_RENEWAL_BOUND_REQUIRED',
    });
  });

  it('refuses a maximum week count the campaign has already used up', async () => {
    const service = makeService({ getMaxPeriodNumberInTx: () => Promise.resolve(4) });

    await expect(
      service.setAutoRenewal(AD_ID, PROVIDER, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 4,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_AUTO_RENEWAL_MAX_WEEKS_TOO_LOW',
    });
  });

  it('refuses an end date a full week would not fit before', async () => {
    const service = makeService({}, { periodFitsBeforeBoundary: () => Promise.resolve(false) });

    await expect(
      service.setAutoRenewal(AD_ID, PROVIDER, {
        enabled: true,
        consentAccepted: true,
        renewalEndDate: '2026-08-02T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'AD_AUTO_RENEWAL_END_DATE_TOO_SOON',
    });
  });

  it('stores consent, both bounds and the terms version when enabling', async () => {
    const service = makeService();

    const state = await service.setAutoRenewal(AD_ID, PROVIDER, {
      enabled: true,
      consentAccepted: true,
      maximumWeeks: 6,
      renewalEndDate: '2026-12-01T00:00:00.000Z',
    });

    expect(state).toMatchObject({
      autoRenewEnabled: true,
      renewalMode: 'automatic',
      maximumWeeks: 6,
      autoRenewConsentVersion: AUTO_RENEW_CONSENT_VERSION,
    });
    expect(state.autoRenewEnabledAt).not.toBeNull();
    // Both bounds are kept. Whichever is reached first stops the campaign; the
    // service does not pick one and discard the other.
    expect(state.renewalEndDate).not.toBeNull();
    // Configuring is free. This is the assertion that matters most here.
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('accepts disabling it, and charges nothing', async () => {
    const state = await makeService().setAutoRenewal(AD_ID, PROVIDER, { enabled: false });

    expect(state).toMatchObject({ autoRenewEnabled: false, renewalMode: 'manual' });
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('refuses a legacy campaign', async () => {
    const service = makeService({
      findAdForUpdate: () =>
        Promise.resolve(pendingRow({ billing_model: 'legacy', billing_status: 'legacy' })),
    });

    await expect(
      service.setAutoRenewal(AD_ID, PROVIDER, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 4,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AD_NOT_WEEKLY' });
  });

  it('refuses a cancelled campaign', async () => {
    const service = makeService({
      findAdForUpdate: () =>
        Promise.resolve(pendingRow({ status: 'cancelled', billing_status: 'cancelled' })),
    });

    await expect(
      service.setAutoRenewal(AD_ID, PROVIDER, {
        enabled: true,
        consentAccepted: true,
        maximumWeeks: 4,
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AD_AUTO_RENEWAL_NOT_CONFIGURABLE' });
  });

  it('refuses a rejected campaign', async () => {
    const service = makeService({
      findAdForUpdate: () =>
        Promise.resolve(pendingRow({ status: 'rejected', billing_status: 'rejected' })),
    });

    await expect(
      service.setAutoRenewal(AD_ID, PROVIDER, { enabled: false }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'AD_AUTO_RENEWAL_NOT_CONFIGURABLE' });
  });

  it('refuses a stranger', async () => {
    await expect(
      makeService().setAutoRenewal(AD_ID, 'ffffffff-0000-4000-8000-00000000000f', {
        enabled: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('is idempotent: an identical request writes nothing a second time', async () => {
    const writeSpy = vi.fn();
    const service = makeService(
      {
        findAdForUpdate: () =>
          Promise.resolve(
            pendingRow({
              auto_renew_enabled: true,
              renewal_mode: 'automatic',
              maximum_weeks: 6,
              auto_renew_enabled_at: new Date().toISOString(),
              auto_renew_enabled_by: PROVIDER,
              auto_renew_paused_reason: null,
            }),
          ),
      },
      { writeAutoRenewalConfigInTx: writeSpy },
    );

    const state = await service.setAutoRenewal(AD_ID, PROVIDER, {
      enabled: true,
      consentAccepted: true,
      maximumWeeks: 6,
    });

    expect(writeSpy).not.toHaveBeenCalled();
    expect(state.autoRenewEnabled).toBe(true);
    expect(chargeSpy).not.toHaveBeenCalled();
  });

  it('validation strips any price, amount or period length a client sends', () => {
    const parsed = autoRenewalSchema.parse({
      enabled: true,
      consentAccepted: true,
      maximumWeeks: 3,
      mhcPrice: 999,
      amount: 999,
      periodHours: 1,
      periodNumber: 7,
    } as never);

    expect(parsed).not.toHaveProperty('mhcPrice');
    expect(parsed).not.toHaveProperty('amount');
    expect(parsed).not.toHaveProperty('periodHours');
    expect(parsed).not.toHaveProperty('periodNumber');
  });

  it('validation refuses to enable without consent', () => {
    expect(autoRenewalSchema.safeParse({ enabled: true, maximumWeeks: 2 }).success).toBe(false);
    expect(
      autoRenewalSchema.safeParse({ enabled: true, consentAccepted: true, maximumWeeks: 2 })
        .success,
    ).toBe(true);
    // Turning something off has never needed consent.
    expect(autoRenewalSchema.safeParse({ enabled: false }).success).toBe(true);
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
      // A weekly campaign that has not been cancelled or rejected MAY be
      // switched to automatic renewal; nothing has been bought yet.
      autoRenewalAvailable: true,
      autoRenewEnabled: false,
      renewalMode: 'manual',
      canRenew: false,
      canRetryAutomaticRenewal: false,
    });
    // An admin looking at somebody else's campaign is shown no balance at all.
    expect(state.creditBalance).toBeNull();
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
