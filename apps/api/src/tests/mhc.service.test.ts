import { createHmac } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MhcService } from '../modules/mhc/mhc.service.js';
import { HttpError } from '../utils/http-error.js';

// The IPN handler reads the secret from env at call time; set it before the
// service module is imported so signature verification is exercised for real
// rather than short-circuited by a missing-config guard.
vi.mock('../config/env.js', () => ({
  env: {
    NOWPAYMENTS_IPN_SECRET: 'test-ipn-secret',
    NOWPAYMENTS_API_KEY: 'test-api-key',
    API_PUBLIC_URL: 'https://api.example.test',
  },
}));

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({
  query: clientQueryMock,
  release: releaseMock,
}));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({
    query: poolQueryMock,
    connect: connectMock,
  }),
}));

/**
 * Route a mocked query by matching a fragment of the SQL text.
 *
 * `rowCount` is reported because the activation transaction uses guarded UPDATEs
 * and aborts when one matches no row. A handler may override it to simulate
 * losing that race; otherwise an UPDATE reports one affected row.
 */
function routeQuery(
  handlers: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>,
): (sql: string) => { rows: unknown[]; rowCount: number } {
  return (sql: string) => {
    for (const handler of handlers) {
      if (handler.match.test(sql)) {
        return { rows: handler.rows, rowCount: handler.rowCount ?? handler.rows.length };
      }
    }
    return { rows: [], rowCount: /^\s*UPDATE\b/i.test(sql.trim()) ? 1 : 0 };
  };
}

const CREDIT_WALLET = {
  id: 'wallet-mhc-1',
  user_id: 'provider-1',
  balance: '100',
  is_frozen: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const PACKAGE = {
  id: 'pkg-1',
  code: 'starter',
  name: 'Starter',
  name_ar: null,
  mhc_amount: '100',
  external_price_amount: '250',
  external_price_currency: 'EGP',
  is_active: true,
  sort_order: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MhcService — role restrictions', () => {
  it('rejects customers from holding credits', async () => {
    const service = new MhcService();
    await expect(
      service.getMyCredits({ userId: 'cust-1', role: 'customer' }),
    ).rejects.toMatchObject({ code: 'MHC_PROVIDERS_ONLY', statusCode: 403 });
  });

  it('allows providers to read their credit balance', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        { match: /SELECT balance::text FROM wallets/, rows: [{ balance: '75' }] },
        { match: /FROM mhc_credit_packages/, rows: [PACKAGE] },
      ]),
    );

    const result = await service.getMyCredits({ userId: 'provider-1', role: 'expert' });
    expect(result.balance).toBe(75);
    // MHC must never be presented as withdrawable money.
    expect(result.withdrawable).toBe(false);
    expect(result.currencyLabel).toBe('MHC');
  });
});

describe('MhcService — InstaPay credit purchase', () => {
  it('refuses to create a purchase when the method flag is disabled', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([{ match: /payment_methods_enabled/, rows: [{ enabled: false }] }]),
    );

    await expect(
      service.submitInstapayCreditPurchase({
        userId: 'provider-1',
        role: 'expert',
        packageId: 'pkg-1',
        proofUploadId: 'upload-1',
        transferReference: 'REF-123',
      }),
    ).rejects.toMatchObject({ code: 'MHC_METHOD_DISABLED' });
  });

  it('rejects a purchase whose proof upload belongs to another user', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /payment_methods_enabled/, rows: [{ enabled: true }] },
        { match: /FROM mhc_credit_packages WHERE id/, rows: [PACKAGE] },
        { match: /COUNT\(\*\)::text AS c FROM deposit_requests/, rows: [{ c: '0' }] },
        // Proof lookup returns nothing => not owned by this user.
        { match: /FROM private_uploads/, rows: [] },
      ]),
    );

    await expect(
      service.submitInstapayCreditPurchase({
        userId: 'provider-1',
        role: 'expert',
        packageId: 'pkg-1',
        proofUploadId: 'someone-elses-upload',
        transferReference: 'REF-123',
      }),
    ).rejects.toMatchObject({ code: 'MHC_INVALID_PROOF' });
  });

  it('blocks a provider who already has too many pending purchases', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /payment_methods_enabled/, rows: [{ enabled: true }] },
        { match: /FROM mhc_credit_packages WHERE id/, rows: [PACKAGE] },
        { match: /COUNT\(\*\)::text AS c FROM deposit_requests/, rows: [{ c: '3' }] },
      ]),
    );

    await expect(
      service.submitInstapayCreditPurchase({
        userId: 'provider-1',
        role: 'expert',
        packageId: 'pkg-1',
        proofUploadId: 'upload-1',
        transferReference: 'REF-123',
      }),
    ).rejects.toMatchObject({ code: 'MHC_TOO_MANY_PENDING_PURCHASES' });
  });

  it('creates a pending_review purchase that grants no credits yet', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /payment_methods_enabled/, rows: [{ enabled: true }] },
        { match: /FROM mhc_credit_packages WHERE id/, rows: [PACKAGE] },
        { match: /COUNT\(\*\)::text AS c FROM deposit_requests/, rows: [{ c: '0' }] },
        { match: /FROM private_uploads/, rows: [{ id: 'upload-1' }] },
        { match: /instapay_deposit_account/, rows: [{ instapay_deposit_account: { bank: 'X' } }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /INSERT INTO deposit_requests/,
          rows: [{ id: 'dep-1', order_id: 'MHC-IP-1', status: 'pending_review' }],
        },
      ]),
    );

    const result = await service.submitInstapayCreditPurchase({
      userId: 'provider-1',
      role: 'expert',
      packageId: 'pkg-1',
      proofUploadId: 'upload-1',
      transferReference: 'REF-123',
    });

    expect(result.status).toBe('pending_review');
    expect(result.mhcOnApproval).toBe(100);
  });

  // uq_deposit_requests_credit_purchase_reference cannot deduplicate NULLs, so a
  // missing reference would let the same transfer be claimed repeatedly.
  it.each(['', '   ', 'ab'])('requires a usable transfer reference (%j)', async (reference) => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([{ match: /payment_methods_enabled/, rows: [{ enabled: true }] }]),
    );

    await expect(
      service.submitInstapayCreditPurchase({
        userId: 'provider-1',
        role: 'expert',
        packageId: 'pkg-1',
        proofUploadId: 'upload-1',
        transferReference: reference,
      }),
    ).rejects.toMatchObject({ code: 'MHC_TRANSFER_REFERENCE_REQUIRED', statusCode: 400 });
  });

  it('snapshots the package so later price edits cannot rewrite history', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /payment_methods_enabled/, rows: [{ enabled: true }] },
        { match: /FROM mhc_credit_packages WHERE id/, rows: [PACKAGE] },
        { match: /COUNT\(\*\)::text AS c FROM deposit_requests/, rows: [{ c: '0' }] },
        { match: /FROM private_uploads/, rows: [{ id: 'upload-1' }] },
        { match: /instapay_deposit_account/, rows: [{ instapay_deposit_account: { bank: 'X' } }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /INSERT INTO deposit_requests/,
          rows: [{ id: 'dep-1', order_id: 'MHC-IP-1', status: 'pending_review' }],
        },
      ]),
    );

    await service.submitInstapayCreditPurchase({
      userId: 'provider-1',
      role: 'expert',
      packageId: 'pkg-1',
      proofUploadId: 'upload-1',
      transferReference: 'REF-123',
    });

    const insertCall = poolQueryMock.mock.calls.find((c) =>
      /INSERT INTO deposit_requests/.test(String(c[0])),
    );
    expect(insertCall).toBeDefined();
    const payload = JSON.stringify(insertCall![1]);
    expect(payload).toContain('package_snapshot');
    expect(payload).toContain('starter');
  });

  it('surfaces a reused transfer reference as a conflict', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation((sql: string) => {
      if (/INSERT INTO deposit_requests/.test(sql)) {
        throw new Error(
          'duplicate key value violates unique constraint "uq_deposit_requests_credit_purchase_reference"',
        );
      }
      return routeQuery([
        { match: /payment_methods_enabled/, rows: [{ enabled: true }] },
        { match: /FROM mhc_credit_packages WHERE id/, rows: [PACKAGE] },
        { match: /COUNT\(\*\)::text AS c FROM deposit_requests/, rows: [{ c: '0' }] },
        { match: /FROM private_uploads/, rows: [{ id: 'upload-1' }] },
        { match: /instapay_deposit_account/, rows: [{ instapay_deposit_account: {} }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
      ])(sql);
    });

    await expect(
      service.submitInstapayCreditPurchase({
        userId: 'provider-1',
        role: 'expert',
        packageId: 'pkg-1',
        proofUploadId: 'upload-1',
        transferReference: 'REF-ALREADY-USED',
      }),
    ).rejects.toMatchObject({ code: 'MHC_TRANSFER_REFERENCE_ALREADY_USED', statusCode: 409 });
  });
});

describe('MhcService — purchase rejection', () => {
  it('grants nothing when a purchase is rejected', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        {
          match: /UPDATE deposit_requests\s+SET status = 'rejected'/,
          rows: [{ id: 'dep-1', user_id: 'provider-1', status: 'rejected', order_id: 'MHC-IP-1' }],
        },
      ]),
    );

    const row = await service.rejectPurchase({
      purchaseId: 'dep-1',
      adminId: 'admin-1',
      reason: 'No matching transfer found',
    });

    expect(row.status).toBe('rejected');
    // No ledger transaction and no wallet mutation may occur on rejection.
    const sql = poolQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /INSERT INTO transactions/.test(s))).toBe(false);
    expect(sql.some((s) => /UPDATE wallets SET balance/.test(s))).toBe(false);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('refuses to reject a purchase that is no longer pending', async () => {
    const service = new MhcService();
    // The UPDATE is guarded by status IN ('pending','pending_review'), so an
    // already-paid purchase matches no row.
    poolQueryMock.mockImplementation(routeQuery([]));

    await expect(
      service.rejectPurchase({ purchaseId: 'dep-1', adminId: 'admin-1', reason: 'too late' }),
    ).rejects.toMatchObject({ code: 'MHC_PURCHASE_NOT_ACTIONABLE', statusCode: 404 });
  });
});

/**
 * Decision D5: activation now requires the provider to have somewhere to be
 * paid, checked BEFORE any debit. Award tests that expect to reach the charging
 * transaction must satisfy it.
 */
const HAS_PAYMENT_METHOD = { match: /FROM provider_payment_methods/, rows: [{ c: '1' }] };

/**
 * Rows the charging transaction locks before it will charge: the need and its
 * bid, re-read under FOR UPDATE. Without these the transaction correctly refuses
 * to charge, so every test that expects a charge must supply them.
 */
const LOCKED_AWARD_ROWS = [
  {
    match: /FROM needs WHERE id = \$1 FOR UPDATE/,
    rows: [
      {
        id: 'need-1',
        status: 'awarded_pending_provider_acceptance',
        pending_award_bid_id: 'bid-1',
        pending_award_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        activated_at: null,
      },
    ],
  },
  {
    match: /FROM bids WHERE id = \$1 FOR UPDATE/,
    rows: [{ id: 'bid-1', need_id: 'need-1', expert_id: 'provider-1', status: 'awarded_pending' }],
  },
];

describe('MhcService — award activation gate', () => {
  /**
   * A live award OFFER: the customer selected this bid, the provider has not paid
   * yet. Charging is only reachable from this shape — `awarded_bid_id` stays NULL
   * and `activated_at` stays NULL until the provider pays.
   */
  const awardedBid = {
    bid_id: 'bid-1',
    need_id: 'need-1',
    expert_id: 'provider-1',
    bid_status: 'awarded_pending',
    need_status: 'awarded_pending_provider_acceptance',
    awarded_bid_id: null,
    pending_award_bid_id: 'bid-1',
    pending_award_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    activated_at: null,
  };

  it('refuses activation by a provider who does not own the bid', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM bids b/, rows: [{ ...awardedBid, expert_id: 'other-provider' }] },
      ]),
    );

    await expect(
      service.activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' }),
    ).rejects.toMatchObject({ code: 'NOT_BID_OWNER', statusCode: 403 });
  });

  it('refuses activation when the customer has not awarded the bid', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM bids b/,
          rows: [
            {
              ...awardedBid,
              bid_status: 'pending',
              need_status: 'open',
              pending_award_bid_id: null,
              pending_award_expires_at: null,
            },
          ],
        },
      ]),
    );

    await expect(
      service.activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' }),
    ).rejects.toMatchObject({ code: 'BID_NOT_AWARDED', statusCode: 409 });
  });

  // Decision D5. The check must happen BEFORE the charging transaction: taking
  // credits and only then discovering the customer has no way to pay would be
  // the worst possible ordering.
  it('refuses activation when the provider has no active payment method', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM bids b/, rows: [awardedBid] },
        { match: /FROM provider_payment_methods/, rows: [{ c: '0' }] },
      ]),
    );

    await expect(
      service.activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' }),
    ).rejects.toMatchObject({ code: 'NO_ACTIVE_PAYMENT_METHOD', statusCode: 409 });

    // No charging transaction may even be opened.
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('refuses to charge for an offer that has already expired', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM bids b/,
          rows: [
            {
              ...awardedBid,
              pending_award_expires_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ],
        },
      ]),
    );

    await expect(
      service.activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' }),
    ).rejects.toMatchObject({ code: 'AWARD_OFFER_EXPIRED', statusCode: 409 });

    // Nothing may be charged for a lapsed offer.
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('treats a never-expiring offer as still open', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        // `awardBid` stores 'infinity' when the admin sets 0 expiry hours.
        { match: /FROM bids b/, rows: [{ ...awardedBid, pending_award_expires_at: 'infinity' }] },
        HAS_PAYMENT_METHOD,
      ]),
    );

    clientQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM mhc_job_activations/, rows: [] },
        ...LOCKED_AWARD_ROWS,
        { match: /FROM mhc_action_prices/, rows: [{ mhc_price: '10', is_active: true }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /SELECT balance::text, is_frozen FROM wallets/,
          rows: [{ balance: '100', is_frozen: false }],
        },
        { match: /INSERT INTO transactions/, rows: [{ id: 'tx-1' }] },
      ]),
    );

    const result = await service.activateAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });
    expect(result.mhcCharged).toBe(10);
  });

  it('returns the existing state without charging when the award is already activated', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM bids b/,
          rows: [
            {
              ...awardedBid,
              bid_status: 'accepted',
              need_status: 'awarded',
              awarded_bid_id: 'bid-1',
              pending_award_bid_id: null,
              activated_at: new Date().toISOString(),
            },
          ],
        },
        { match: /SELECT balance::text FROM wallets/, rows: [{ balance: '60' }] },
      ]),
    );

    const result = await service.activateAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });

    expect(result).toMatchObject({ alreadyActivated: true, mhcCharged: 0, balance: 60 });
    // The charging transaction must never be opened for an activated award.
    expect(clientQueryMock).not.toHaveBeenCalled();
  });

  it('returns 402 with the shortfall when the provider lacks credits', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([{ match: /FROM bids b/, rows: [awardedBid] }, HAS_PAYMENT_METHOD]));

    clientQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM mhc_job_activations/, rows: [] },
        ...LOCKED_AWARD_ROWS,
        { match: /FROM mhc_action_prices/, rows: [{ mhc_price: '50', is_active: true }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        // Provider only has 10 MHC but the action costs 50.
        {
          match: /SELECT balance::text, is_frozen FROM wallets/,
          rows: [{ balance: '10', is_frozen: false }],
        },
      ]),
    );

    const error = await service
      .activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ code: 'MHC_INSUFFICIENT_CREDITS', statusCode: 402 });
    expect((error as HttpError).details).toEqual({ required: 50, available: 10 });
  });

  it('charges the provider once and unlocks the job', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([{ match: /FROM bids b/, rows: [awardedBid] }, HAS_PAYMENT_METHOD]));

    clientQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM mhc_job_activations/, rows: [] },
        ...LOCKED_AWARD_ROWS,
        { match: /FROM mhc_action_prices/, rows: [{ mhc_price: '40', is_active: true }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /SELECT balance::text, is_frozen FROM wallets/,
          rows: [{ balance: '100', is_frozen: false }],
        },
        { match: /INSERT INTO transactions/, rows: [{ id: 'tx-1' }] },
      ]),
    );

    const result = await service.activateAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });

    expect(result.mhcCharged).toBe(40);
    expect(result.balance).toBe(60);
    expect(result.alreadyActivated).toBe(false);
    expect(result.needId).toBe('need-1');

    // A ledger row must be written for the spend, and the activation recorded.
    const sqlCalls = clientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => /INSERT INTO transactions/.test(sql))).toBe(true);
    expect(sqlCalls.some((sql) => /INSERT INTO mhc_job_activations/.test(sql))).toBe(true);
    expect(sqlCalls.some((sql) => /COMMIT/.test(sql))).toBe(true);
  });

  it('does not double-charge an already activated award', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([{ match: /FROM bids b/, rows: [awardedBid] }, HAS_PAYMENT_METHOD]));

    clientQueryMock.mockImplementation(
      routeQuery([
        // An activation already exists for this bid.
        { match: /FROM mhc_job_activations/, rows: [{ id: 'act-1', mhc_charged: '40' }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
      ]),
    );

    const result = await service.activateAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });

    expect(result.alreadyActivated).toBe(true);
    const sqlCalls = clientQueryMock.mock.calls.map((c) => String(c[0]));
    // No new spend may be recorded on a repeat activation.
    expect(sqlCalls.some((sql) => /INSERT INTO transactions/.test(sql))).toBe(false);
    expect(sqlCalls.some((sql) => /INSERT INTO mhc_job_activations/.test(sql))).toBe(false);
  });

  // PROVISIONAL (MHC-27): decision D6 requires an inactive action to be *disabled*
  // rather than silently free, unless an explicit zero-price promotional policy is
  // configured. That semantic change lands with the paid-actions migration; this
  // test asserts today's behaviour so the suite reflects reality until then.
  it('opens the gate for free when the action price is inactive', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([{ match: /FROM bids b/, rows: [awardedBid] }, HAS_PAYMENT_METHOD]));

    clientQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM mhc_job_activations/, rows: [] },
        ...LOCKED_AWARD_ROWS,
        // Price configured but disabled => free activation (beta mode).
        { match: /FROM mhc_action_prices/, rows: [{ mhc_price: '40', is_active: false }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /SELECT balance::text, is_frozen FROM wallets/,
          rows: [{ balance: '0', is_frozen: false }],
        },
      ]),
    );

    const result = await service.activateAwardForProvider({
      userId: 'provider-1',
      role: 'expert',
      bidId: 'bid-1',
    });

    expect(result.mhcCharged).toBe(0);
    const sqlCalls = clientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sqlCalls.some((sql) => /INSERT INTO transactions/.test(sql))).toBe(false);
    // The activation is still recorded so the job unlocks.
    expect(sqlCalls.some((sql) => /INSERT INTO mhc_job_activations/.test(sql))).toBe(true);
  });

  it('blocks activation when the credit wallet is frozen', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([{ match: /FROM bids b/, rows: [awardedBid] }, HAS_PAYMENT_METHOD]));

    clientQueryMock.mockImplementation(
      routeQuery([
        { match: /FROM mhc_job_activations/, rows: [] },
        ...LOCKED_AWARD_ROWS,
        { match: /FROM mhc_action_prices/, rows: [{ mhc_price: '40', is_active: true }] },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /SELECT balance::text, is_frozen FROM wallets/,
          rows: [{ balance: '100', is_frozen: true }],
        },
      ]),
    );

    await expect(
      service.activateAwardForProvider({ userId: 'provider-1', role: 'expert', bidId: 'bid-1' }),
    ).rejects.toMatchObject({ code: 'MHC_WALLET_FROZEN', statusCode: 403 });
  });
});

describe('MhcService — credit purchase fulfilment states', () => {
  /** Mock the FOR UPDATE read of the purchase row at a given status. */
  const purchaseAt = (status: string) => [
    {
      match: /FROM deposit_requests\s+WHERE id = \$1 AND purpose = 'credit_purchase'\s+FOR UPDATE/,
      rows: [
        {
          id: 'dep-1',
          user_id: 'provider-1',
          status,
          mhc_grant_amount: '100',
          order_id: 'MHC-IP-1',
        },
      ],
    },
    { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
    { match: /SELECT balance::text FROM wallets WHERE id = \$1 FOR UPDATE/, rows: [{ balance: '20' }] },
    { match: /INSERT INTO transactions/, rows: [{ id: 'tx-1' }] },
  ];

  const grantWasWritten = (): boolean =>
    clientQueryMock.mock.calls.map((c) => String(c[0])).some((sql) => /INSERT INTO transactions/.test(sql));

  it.each(['pending', 'pending_review'])('grants credits from %s', async (status) => {
    const service = new MhcService();
    clientQueryMock.mockImplementation(routeQuery(purchaseAt(status)));
    poolQueryMock.mockImplementation(routeQuery([]));

    const result = await service.approvePurchase({ purchaseId: 'dep-1', adminId: 'admin-1' });
    expect(result).toMatchObject({ mhcGranted: 100, balance: 120, alreadyGranted: false });
    expect(grantWasWritten()).toBe(true);
  });

  // These statuses all mean the money did not arrive as expected. The previous
  // implementation granted for every one of them.
  it.each(['expired', 'failed', 'underpaid', 'rejected', 'cancelled'])(
    'refuses to grant from %s',
    async (status) => {
      const service = new MhcService();
      clientQueryMock.mockImplementation(routeQuery(purchaseAt(status)));

      await expect(
        service.approvePurchase({ purchaseId: 'dep-1', adminId: 'admin-1' }),
      ).rejects.toMatchObject({ code: 'MHC_PURCHASE_NOT_ACTIONABLE', statusCode: 409 });
      expect(grantWasWritten()).toBe(false);
    },
  );

  it('is idempotent when the purchase is already paid', async () => {
    const service = new MhcService();
    clientQueryMock.mockImplementation(routeQuery(purchaseAt('paid')));
    poolQueryMock.mockImplementation(
      routeQuery([{ match: /SELECT balance::text FROM wallets/, rows: [{ balance: '120' }] }]),
    );

    const result = await service.approvePurchase({ purchaseId: 'dep-1', adminId: 'admin-1' });
    expect(result).toMatchObject({ mhcGranted: 0, balance: 120, alreadyGranted: true });
    expect(grantWasWritten()).toBe(false);
  });

  it('reports a missing purchase distinctly from an unactionable one', async () => {
    const service = new MhcService();
    clientQueryMock.mockImplementation(routeQuery([]));

    await expect(
      service.approvePurchase({ purchaseId: 'nope', adminId: 'admin-1' }),
    ).rejects.toMatchObject({ code: 'MHC_PURCHASE_NOT_FOUND', statusCode: 404 });
  });

  it.each([0, -50])('rejects an admin override amount of %s', async (amount) => {
    const service = new MhcService();
    clientQueryMock.mockImplementation(routeQuery(purchaseAt('pending_review')));

    await expect(
      service.approvePurchase({
        purchaseId: 'dep-1',
        adminId: 'admin-1',
        overrideMhcAmount: amount,
      }),
    ).rejects.toMatchObject({ code: 'MHC_INVALID_GRANT_AMOUNT', statusCode: 400 });
    expect(grantWasWritten()).toBe(false);
  });
});

describe('MhcService — webhook fulfilment', () => {
  const purchaseRow = {
    id: 'dep-1',
    user_id: 'provider-1',
    order_id: 'MHC-NP-1',
    status: 'pending',
    provider: 'nowpayments',
    purpose: 'credit_purchase',
    mhc_grant_amount: '100',
    external_price_amount: '250',
    external_price_currency: 'EGP',
    credit_package_id: 'pkg-1',
    credited_transaction_id: null,
  };

  // A webhook that is authentic but reports a non-settled state must never move
  // credits. The previous implementation passed any status through to fulfilment.
  it.each(['waiting', 'confirming', 'sending', 'partially_paid', 'failed', 'refunded', 'expired'])(
    'does not grant on provider status %s',
    async (providerStatus) => {
      const service = new MhcService();
      poolQueryMock.mockImplementation(
        routeQuery([{ match: /FROM deposit_requests\s+WHERE order_id/, rows: [purchaseRow] }]),
      );

      const result = await service.fulfilPurchaseFromWebhook({
        orderId: 'MHC-NP-1',
        providerStatus,
      });

      expect(result).toMatchObject({ fulfilled: false });
      expect(result?.reason).toMatch(/not settled/);
      // No charging transaction may be opened at all.
      expect(connectMock).not.toHaveBeenCalled();
      // The callback is still recorded for audit.
      const sql = poolQueryMock.mock.calls.map((c) => String(c[0]));
      expect(sql.some((s) => /UPDATE deposit_requests/.test(s))).toBe(true);
    },
  );

  it('grants on a settled provider status', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([{ match: /FROM deposit_requests\s+WHERE order_id/, rows: [purchaseRow] }]),
    );
    clientQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM deposit_requests\s+WHERE id = \$1 AND purpose = 'credit_purchase'\s+FOR UPDATE/,
          rows: [
            { id: 'dep-1', user_id: 'provider-1', status: 'pending', mhc_grant_amount: '100', order_id: 'MHC-NP-1' },
          ],
        },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        { match: /SELECT balance::text FROM wallets WHERE id = \$1 FOR UPDATE/, rows: [{ balance: '0' }] },
        { match: /INSERT INTO transactions/, rows: [{ id: 'tx-1' }] },
      ]),
    );

    const result = await service.fulfilPurchaseFromWebhook({
      orderId: 'MHC-NP-1',
      providerStatus: 'FINISHED', // case/whitespace normalised before matching
    });
    expect(result).toEqual({ fulfilled: true });
  });

  it('returns null for an unknown order', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([]));
    await expect(
      service.fulfilPurchaseFromWebhook({ orderId: 'nope', providerStatus: 'finished' }),
    ).resolves.toBeNull();
  });
});

describe('MhcService — NOWPayments IPN', () => {
  const IPN_SECRET = 'test-ipn-secret';

  /** Build a body + matching signature the way NOWPayments does (sorted keys, HMAC-SHA512). */
  const sign = (payload: Record<string, unknown>): { raw: string; signature: string } => {
    const sortDeep = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(sortDeep);
      if (v && typeof v === 'object') {
        return Object.keys(v as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = sortDeep((v as Record<string, unknown>)[k]);
            return acc;
          }, {});
      }
      return v;
    };
    const raw = JSON.stringify(payload);
    const signature = createHmac('sha512', IPN_SECRET)
      .update(JSON.stringify(sortDeep(JSON.parse(raw))))
      .digest('hex');
    return { raw, signature };
  };

  const purchaseRow = {
    id: 'dep-np-1',
    user_id: 'provider-1',
    order_id: 'MHC-NP-1',
    status: 'pending',
    provider: 'nowpayments',
    purpose: 'credit_purchase',
    mhc_grant_amount: '100',
    external_price_amount: '250',
    external_price_currency: 'EGP',
    credit_package_id: 'pkg-1',
    credited_transaction_id: null,
  };

  const settledBody = {
    order_id: 'MHC-NP-1',
    payment_status: 'finished',
    payment_id: 'np-99',
    price_amount: 250,
    price_currency: 'EGP',
    actually_paid: 250,
  };

  const mockPurchaseLookup = () =>
    poolQueryMock.mockImplementation(
      routeQuery([{ match: /FROM deposit_requests\s+WHERE order_id/, rows: [purchaseRow] }]),
    );

  const mockFulfilment = () =>
    clientQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM deposit_requests\s+WHERE id = \$1 AND purpose = 'credit_purchase'\s+FOR UPDATE/,
          rows: [
            {
              id: 'dep-np-1',
              user_id: 'provider-1',
              status: 'pending',
              mhc_grant_amount: '100',
              order_id: 'MHC-NP-1',
            },
          ],
        },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
        {
          match: /SELECT balance::text FROM wallets WHERE id = \$1 FOR UPDATE/,
          rows: [{ balance: '0' }],
        },
        { match: /INSERT INTO transactions/, rows: [{ id: 'tx-np-1' }] },
      ]),
    );

  it('rejects a callback with an invalid signature before touching the database', async () => {
    const service = new MhcService();
    const { raw } = sign(settledBody);

    await expect(
      service.handleNowPaymentsCreditIpn(raw, 'deadbeef'),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', statusCode: 400 });

    expect(poolQueryMock).not.toHaveBeenCalled();
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('rejects a callback whose body was tampered with after signing', async () => {
    const service = new MhcService();
    const { signature } = sign(settledBody);
    // Same signature, inflated amount.
    const tampered = JSON.stringify({ ...settledBody, price_amount: 999999 });

    await expect(
      service.handleNowPaymentsCreditIpn(tampered, signature),
    ).rejects.toMatchObject({ code: 'INVALID_SIGNATURE' });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('credits exactly once on a verified settled callback', async () => {
    const service = new MhcService();
    mockPurchaseLookup();
    mockFulfilment();
    const { raw, signature } = sign(settledBody);

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ handled: true, fulfilled: true });

    const sql = clientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.filter((s) => /INSERT INTO transactions/.test(s))).toHaveLength(1);
  });

  it.each(['waiting', 'confirming', 'sending', 'partially_paid', 'failed', 'refunded', 'expired'])(
    'does not credit on a verified but non-settled status: %s',
    async (payment_status) => {
      const service = new MhcService();
      mockPurchaseLookup();
      const { raw, signature } = sign({ ...settledBody, payment_status });

      const result = await service.handleNowPaymentsCreditIpn(raw, signature);
      expect(result).toMatchObject({ handled: true, fulfilled: false });
      expect(connectMock).not.toHaveBeenCalled();
    },
  );

  // Underpayment and overpayment are commercial decisions, not something a
  // webhook handler should guess at.
  it.each([
    ['underpayment', 200],
    ['overpayment', 400],
  ])('holds a settled %s for admin review instead of guessing', async (_label, price_amount) => {
    const service = new MhcService();
    mockPurchaseLookup();
    const { raw, signature } = sign({ ...settledBody, price_amount, actually_paid: price_amount });

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ handled: true, fulfilled: false });
    expect(result.reason).toMatch(/review/);
    // No credits moved.
    expect(connectMock).not.toHaveBeenCalled();
    // Flagged with the numbers a reviewer needs.
    const recorded = poolQueryMock.mock.calls.find((c) =>
      /UPDATE deposit_requests/.test(String(c[0])),
    );
    expect(JSON.stringify(recorded?.[1])).toContain('amount_mismatch_review');
    expect(JSON.stringify(recorded?.[1])).toContain('reconciliation');
  });

  it('holds a settled payment in the wrong currency for review', async () => {
    const service = new MhcService();
    mockPurchaseLookup();
    const { raw, signature } = sign({ ...settledBody, price_currency: 'USD' });

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ handled: true, fulfilled: false });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('ignores child payments so a split settlement cannot double-credit', async () => {
    const service = new MhcService();
    mockPurchaseLookup();
    const { raw, signature } = sign({ ...settledBody, parent_payment_id: 'np-parent' });

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ handled: true, fulfilled: false });
    expect(result.reason).toMatch(/child/);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('ignores a callback for an unknown order', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(routeQuery([]));
    const { raw, signature } = sign({ ...settledBody, order_id: 'MHC-NP-UNKNOWN' });

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ handled: false, fulfilled: false });
  });

  it('is idempotent when the same settled callback arrives twice', async () => {
    const service = new MhcService();
    mockPurchaseLookup();
    // Second delivery: the row is already 'paid'.
    clientQueryMock.mockImplementation(
      routeQuery([
        {
          match: /FROM deposit_requests\s+WHERE id = \$1 AND purpose = 'credit_purchase'\s+FOR UPDATE/,
          rows: [
            {
              id: 'dep-np-1',
              user_id: 'provider-1',
              status: 'paid',
              mhc_grant_amount: '100',
              order_id: 'MHC-NP-1',
            },
          ],
        },
        { match: /INSERT INTO wallets/, rows: [CREDIT_WALLET] },
      ]),
    );
    const { raw, signature } = sign(settledBody);

    const result = await service.handleNowPaymentsCreditIpn(raw, signature);
    expect(result).toMatchObject({ fulfilled: false });
    expect(result.reason).toMatch(/already fulfilled/);
    const sql = clientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(sql.some((s) => /INSERT INTO transactions/.test(s))).toBe(false);
  });
});

describe('MhcService — admin pricing validation', () => {
  it('rejects a negative action price', async () => {
    const service = new MhcService();
    await expect(
      service.upsertActionPrice({
        actionKey: 'award_activation',
        name: 'Award',
        mhcPrice: -1,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: 'MHC_INVALID_PRICE' });
  });

  it('accepts a zero action price (free action)', async () => {
    const service = new MhcService();
    poolQueryMock.mockImplementation(
      routeQuery([
        {
          match: /INSERT INTO mhc_action_prices/,
          rows: [
            {
              id: 'p1',
              action_key: 'award_activation',
              name: 'Award',
              mhc_price: '0',
              is_active: false,
            },
          ],
        },
      ]),
    );

    const row = await service.upsertActionPrice({
      actionKey: 'award_activation',
      name: 'Award',
      mhcPrice: 0,
      isActive: false,
    });
    expect(row.mhc_price).toBe('0');
  });

  it('rejects a package with a non-positive credit amount or price', async () => {
    const service = new MhcService();
    await expect(
      service.upsertPackage({
        code: 'bad',
        name: 'Bad',
        mhcAmount: 0,
        externalPriceAmount: 100,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: 'MHC_INVALID_PACKAGE' });

    await expect(
      service.upsertPackage({
        code: 'bad2',
        name: 'Bad2',
        mhcAmount: 100,
        externalPriceAmount: 0,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: 'MHC_INVALID_PACKAGE' });
  });
});
