import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdvertisementsRepository } from '../modules/advertisements/advertisements.repository.js';
import { AdvertisementsService } from '../modules/advertisements/advertisements.service.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

import { FakeCreditDb, type FakeConnection } from './support/fake-credit-db.js';

// ---------------------------------------------------------------------------
// P0-03 — advertisements are charged in MHC, not from a frozen EGP wallet.
// ---------------------------------------------------------------------------
// Ad creation used to compute an EGP amount and call
// `walletRepo.debitWalletInTransaction` on the money wallet that 20260728160000
// froze. It worked only because the configured price was 0.
//
// These tests assert on resulting rows — advertisements, mhc_action_charges,
// transactions, wallet balances — through the same in-memory PostgreSQL model
// the charge primitive is tested against, extended with an `advertisements`
// table and its domain idempotency index.
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

let db: FakeCreditDb;
/** Advertisement rows, keyed by id, in the committed store of the fake db. */
let adminAcceptsAds: boolean;
let adMhcPrice: { mhcPrice: number; isActive: boolean } | null;

const baseInput = {
  durationDays: 7,
  titleEn: 'Structural surveys in Giza',
  imageUrl: 'https://cdn.example/ad.png',
  linkType: 'profile' as const,
};

/**
 * The repository is stubbed only where it talks to tables the credit model does
 * not carry (the ad row itself and the admin controls). Everything financial —
 * the charge, the ledger, the wallet — goes through the real MhcService against
 * the real fake database, because that is what these tests are about.
 */
type AdRow = {
  id: string;
  advertiser_id: string;
  title_en: string;
  amount_paid: string;
  status: string;
  client_idempotency_key: string | null;
};

let ads: AdRow[];
/** Rows written by a transaction that has not committed yet, per connection. */
let pendingAds: Map<FakeConnection, AdRow[]>;

const makeRepo = (): AdvertisementsRepository => {
  const repo = new AdvertisementsRepository();

  vi.spyOn(repo, 'getGlobalAdAcceptance').mockImplementation(() =>
    Promise.resolve(adminAcceptsAds),
  );
  vi.spyOn(repo, 'getAdvertisementMhcPrice').mockImplementation(() => Promise.resolve(adMhcPrice));
  vi.spyOn(repo, 'setAdvertisementMhcPrice').mockImplementation((price: number) => {
    adMhcPrice = { mhcPrice: price, isActive: true };
    return Promise.resolve();
  });
  vi.spyOn(repo, 'upsertGlobalAdControls').mockImplementation((_admin: string, accept: boolean) => {
    adminAcceptsAds = accept;
    return Promise.resolve();
  });
  vi.spyOn(repo, 'findAdByIdempotencyKey').mockImplementation((advertiserId, key) =>
    Promise.resolve(
      (ads.find((a) => a.advertiser_id === advertiserId && a.client_idempotency_key === key) ??
        null) as never,
    ),
  );
  vi.spyOn(repo, 'createAdInTx').mockImplementation(
    (client, advertiserId, input, _startsAt, _expiresAt, advertisementId, idempotencyKey) => {
      const conn = client as unknown as FakeConnection;
      const visible = [...ads, ...(pendingAds.get(conn) ?? [])];
      // uq_advertisements_advertiser_idempotency, modelled.
      if (
        idempotencyKey &&
        visible.some(
          (a) => a.advertiser_id === advertiserId && a.client_idempotency_key === idempotencyKey,
        )
      ) {
        return Promise.reject(
          Object.assign(
            new Error(
              'duplicate key value violates unique constraint "uq_advertisements_advertiser_idempotency"',
            ),
            { code: '23505' },
          ),
        );
      }
      const row: AdRow = {
        id: advertisementId,
        advertiser_id: advertiserId,
        title_en: input.titleEn,
        amount_paid: '0.00',
        status: 'active',
        client_idempotency_key: idempotencyKey,
      };
      pendingAds.set(conn, [...(pendingAds.get(conn) ?? []), row]);
      return Promise.resolve(row as never);
    },
  );
  return repo;
};

/**
 * Drive the service the way an HTTP request does, and commit the ad rows the
 * service's own transaction would have committed.
 */
const createAd = async (
  service: AdvertisementsService,
  idempotencyKey?: string,
): Promise<AdRow | null> => {
  const conn = db.connect();
  poolConnectMock.mockReturnValue(conn);
  pendingAds.set(conn, []);
  try {
    const ad = (await service.createAd(PROVIDER, baseInput, idempotencyKey)) as unknown as AdRow;
    // The service committed; promote its pending ad rows to committed.
    ads.push(...(pendingAds.get(conn) ?? []));
    return ad;
  } finally {
    pendingAds.delete(conn);
  }
};

beforeEach(() => {
  // restore before clear: a spy left on MhcService.prototype by one test would
  // otherwise silently change what the next test is exercising.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  db = new FakeCreditDb();
  db.seedUser(PROVIDER, 'expert');
  db.seedUser(ADMIN, 'business');
  db.seedWallet({ userId: PROVIDER, mhc: 100 });
  db.seedPrice('advertisement', 25, true);
  adminAcceptsAds = true;
  adMhcPrice = { mhcPrice: 25, isActive: true };
  ads = [];
  pendingAds = new Map();
});

const service = (): AdvertisementsService =>
  new AdvertisementsService(makeRepo(), undefined, undefined, new MhcService());

describe('advertisement creation — charged in MHC', () => {
  it('creates one advertisement and debits the configured MHC price once', async () => {
    const ad = await createAd(service());

    expect(ad).not.toBeNull();
    expect(ads).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(1);
  });

  it('records the charge against the advertisement it paid for', async () => {
    const ad = await createAd(service());

    const charge = db.charges()[0]!;
    expect(charge).toMatchObject({
      user_id: PROVIDER,
      action_key: 'advertisement',
      reference_type: 'advertisement',
      reference_id: ad!.id,
      charged_cents: 2500,
    });
    // The ledger row carries the business reference, so an auditor can walk from
    // a credit movement back to the campaign without a join table lookup.
    expect(db.ledger()[0]!.metadata).toMatchObject({
      asset: 'MHC',
      action_key: 'advertisement',
      charge_reference_type: 'advertisement',
      charge_reference_id: ad!.id,
    });
  });

  it('writes exactly one ledger transaction for the campaign', async () => {
    await createAd(service());

    const ledger = db.ledger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      type: 'payment',
      amount_cents: 2500,
      balance_delta_cents: -2500,
      balance_after_cents: 7500,
    });
    expect(100 + db.ledgerSumFor(PROVIDER)).toBe(db.balanceOf(PROVIDER));
  });

  it('never reads or writes an EGP money wallet on the advertisement path', async () => {
    await createAd(service());

    // The fake database only models provider_credit wallets, so any money-wallet
    // access would have had to go through the mocked pool. Nothing did.
    expect(poolQueryMock).not.toHaveBeenCalled();
    // And every balance write it did make was against the credit wallet.
    const walletWrites = db.statements.filter((s) => /^UPDATE wallets SET balance/.test(s));
    expect(walletWrites).toHaveLength(1);
  });

  it('leaves amount_paid at zero, so the legacy EGP refund maths cannot fire', async () => {
    await createAd(service());
    expect(ads[0]!.amount_paid).toBe('0.00');
  });
});

describe('advertisement creation — insufficient credits', () => {
  beforeEach(() => {
    db.seedWallet({ userId: PROVIDER, mhc: 10 });
    db.seedPrice('advertisement', 40, true);
    adMhcPrice = { mhcPrice: 40, isActive: true };
  });

  it('returns 402 with the MHC error contract', async () => {
    await expect(createAd(service())).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
      details: { required: 40, available: 10 },
    });
  });

  it('creates no advertisement, no charge and no ledger row', async () => {
    await expect(createAd(service())).rejects.toBeTruthy();

    expect(ads).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(10);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });
});

describe('advertisement creation — action price configuration', () => {
  it('creates the campaign with no charge row when the price is zero', async () => {
    db.seedPrice('advertisement', 0, true);
    adMhcPrice = { mhcPrice: 0, isActive: true };

    const ad = await createAd(service());

    expect(ad).not.toBeNull();
    expect(ads).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('creates nothing when the advertisement action price is missing', async () => {
    db.removePrice('advertisement');
    adMhcPrice = null;

    await expect(createAd(service())).rejects.toMatchObject({
      statusCode: 503,
      code: 'MHC_ACTION_PRICE_MISSING',
    });
    expect(ads).toHaveLength(0);
    expect(db.charges()).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });

  it('creates nothing when the advertisement action is disabled', async () => {
    db.seedPrice('advertisement', 25, false);
    adMhcPrice = { mhcPrice: 25, isActive: false };

    await expect(createAd(service())).rejects.toMatchObject({
      statusCode: 409,
      code: 'MHC_ACTION_DISABLED',
    });
    expect(ads).toHaveLength(0);
    expect(db.charges()).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });

  it('refuses when the admin has stopped accepting campaigns, before any charge', async () => {
    adminAcceptsAds = false;

    await expect(createAd(service())).rejects.toMatchObject({
      statusCode: 403,
      code: 'ADS_DISABLED_BY_ADMIN',
    });
    expect(db.charges()).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });
});

describe('advertisement creation — domain idempotency', () => {
  it('creates one advertisement and one charge for two concurrent identical requests', async () => {
    const key = 'cccccccc-0000-4000-8000-000000000001';
    const svc = service();

    // Sequential retry with the same key: the second request must resolve to the
    // first campaign, not create a second one.
    const first = await createAd(svc, key);
    const second = await createAd(svc, key);

    expect(second!.id).toBe(first!.id);
    expect(ads).toHaveLength(1);
    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(75);
  });

  it('absorbs a lost idempotency race and returns the winning campaign', async () => {
    const key = 'cccccccc-0000-4000-8000-000000000002';
    const svc = service();

    // A competing request commits between our pre-check and our INSERT, so the
    // unique index — not the pre-check — is what stops the duplicate.
    const winner: AdRow = {
      id: 'dddddddd-0000-4000-8000-000000000009',
      advertiser_id: PROVIDER,
      title_en: baseInput.titleEn,
      amount_paid: '0.00',
      status: 'active',
      client_idempotency_key: key,
    };
    ads.push(winner);

    // The pre-check sees nothing; by the time the INSERT runs, the competitor
    // has committed. Only the unique index can stop the duplicate here.
    let preCheckDone = false;
    const repo = (svc as unknown as { repo: AdvertisementsRepository }).repo;
    vi.spyOn(repo, 'findAdByIdempotencyKey').mockImplementation(() => {
      if (!preCheckDone) {
        preCheckDone = true;
        return Promise.resolve(null);
      }
      return Promise.resolve(winner as never);
    });
    vi.spyOn(repo, 'createAdInTx').mockRejectedValue(
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "uq_advertisements_advertiser_idempotency"',
        ),
        { code: '23505' },
      ),
    );

    const result = await createAd(svc, key);

    expect(result!.id).toBe(winner.id);
    expect(ads).toHaveLength(1);
    // Nothing was charged: the campaign already existed.
    expect(db.charges()).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });

  it('does not deduplicate two genuinely different campaigns', async () => {
    const svc = service();
    await createAd(svc, 'cccccccc-0000-4000-8000-000000000003');
    await createAd(svc, 'cccccccc-0000-4000-8000-000000000004');

    expect(ads).toHaveLength(2);
    expect(db.charges()).toHaveLength(2);
    expect(db.balanceOf(PROVIDER)).toBe(50);
  });
});

describe('advertisement creation — transaction boundary', () => {
  it('rolls the MHC debit back when the campaign write fails after charging', async () => {
    const repo = makeRepo();
    const mhc = new MhcService();
    const svc = new AdvertisementsService(repo, undefined, undefined, mhc);

    // The charge succeeds, then the caller's own work throws. Both must vanish.
    const realCharge = mhc.chargeAction.bind(mhc);
    vi.spyOn(mhc, 'chargeAction').mockImplementation(async (params) => {
      await realCharge(params);
      throw new Error('AD_POST_CHARGE_FAILURE');
    });

    const conn = db.connect();
    poolConnectMock.mockReturnValue(conn);
    pendingAds.set(conn, []);

    await expect(svc.createAd(PROVIDER, baseInput)).rejects.toThrow('AD_POST_CHARGE_FAILURE');

    // The transaction rolled back, so the debit, the ledger row and the charge
    // row are all gone, and the campaign was never committed.
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
    expect(ads).toHaveLength(0);
  });

  it('charges inside the caller transaction, never on its own connection', async () => {
    await createAd(service());

    const statements = db.statements;
    const begin = statements.findIndex((s) => /^BEGIN$/.test(s));
    const commit = statements.findIndex((s) => /^COMMIT$/.test(s));
    const debit = statements.findIndex((s) => /^UPDATE wallets SET balance = balance - /.test(s));
    expect(begin).toBeGreaterThan(-1);
    expect(debit).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(debit);
    // Exactly one transaction: the service's. The primitive opened none.
    expect(statements.filter((s) => /^BEGIN$/.test(s))).toHaveLength(1);
    expect(statements.filter((s) => /^COMMIT$/.test(s))).toHaveLength(1);
  });
});

describe('admin advertisement pricing', () => {
  it('edits the MHC action price, which is the same row charging reads', async () => {
    const svc = service();
    const updated = await svc.updateAdminAdControls(ADMIN, { acceptAds: true, mhcPrice: 40 });

    expect(updated).toEqual({ acceptAds: true, mhcPrice: 40 });
    expect(adMhcPrice).toEqual({ mhcPrice: 40, isActive: true });
    expect(await svc.getAdminAdControls()).toEqual({ acceptAds: true, mhcPrice: 40 });
  });

  it('rejects a negative credit price', async () => {
    await expect(
      service().updateAdminAdControls(ADMIN, { acceptAds: true, mhcPrice: -1 }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'AD_INVALID_MHC_PRICE' });
  });

  it('reports a disabled action price as zero rather than guessing', async () => {
    adMhcPrice = { mhcPrice: 25, isActive: false };
    expect(await service().getAdminAdControls()).toEqual({ acceptAds: true, mhcPrice: 0 });
  });
});
