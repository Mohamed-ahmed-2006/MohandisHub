import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MhcRepository } from '../modules/mhc/mhc.repository.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

// ---------------------------------------------------------------------------
// Concurrency and no-charge-failure coverage for award activation.
// ---------------------------------------------------------------------------
// The charging transaction is the only authority on whether an award may be
// paid for. The service performs the same checks first, but against an unlocked
// read — so every test here drives the state THROUGH the transaction rather than
// relying on the pre-check, and asserts on whether a ledger row was written.
//
// The rule under test is single: no MHC leaves a provider's wallet unless the
// job opens in the same commit, and vice versa.
// ---------------------------------------------------------------------------

const poolQueryMock = vi.fn();
const clientQueryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({ query: clientQueryMock, release: releaseMock }));

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: connectMock }),
}));

vi.mock('../config/env.js', () => ({ env: {} }));

const CREDIT_WALLET = {
  id: 'wallet-mhc-1',
  user_id: 'provider-1',
  balance: '500',
  is_frozen: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

/** A live offer: customer selected bid-1, provider has not paid. */
const liveOffer = {
  need: {
    id: 'need-1',
    status: 'awarded_pending_provider_acceptance',
    pending_award_bid_id: 'bid-1',
    pending_award_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    activated_at: null,
  },
  bid: { id: 'bid-1', need_id: 'need-1', expert_id: 'provider-1', status: 'awarded_pending' },
};

type TxState = {
  need: Record<string, unknown> | null;
  bid: Record<string, unknown> | null;
  activationExists: boolean;
  price: { mhc_price: string; is_active: boolean } | null;
  walletBalance: string;
  walletFrozen: boolean;
  /** Simulates the guarded UPDATE matching zero rows (lost race). */
  bidUpdateRows?: number;
  needUpdateRows?: number;
};

/**
 * Drive the charging transaction against a mutable state object, so a test can
 * model "the world changed between the pre-check and the transaction".
 */
function mockTransaction(state: TxState) {
  clientQueryMock.mockImplementation((sql: string) => {
    if (/FROM mhc_job_activations/.test(sql)) {
      return { rows: state.activationExists ? [{ id: 'act-1', mhc_charged: '40' }] : [] };
    }
    if (/FROM needs WHERE id = \$1 FOR UPDATE/.test(sql)) {
      return { rows: state.need ? [state.need] : [] };
    }
    if (/FROM bids WHERE id = \$1 FOR UPDATE/.test(sql)) {
      return { rows: state.bid ? [state.bid] : [] };
    }
    if (/FROM mhc_action_prices/.test(sql)) {
      return { rows: state.price ? [state.price] : [] };
    }
    if (/INSERT INTO wallets/.test(sql)) return { rows: [CREDIT_WALLET] };
    if (/SELECT balance::text, is_frozen FROM wallets/.test(sql)) {
      return { rows: [{ balance: state.walletBalance, is_frozen: state.walletFrozen }] };
    }
    if (/INSERT INTO transactions/.test(sql)) return { rows: [{ id: 'tx-1' }] };
    if (/UPDATE bids\s+SET status = 'accepted'/.test(sql)) {
      return { rows: [], rowCount: state.bidUpdateRows ?? 1 };
    }
    if (/UPDATE needs\s+SET status = 'awarded'/.test(sql)) {
      return { rows: [], rowCount: state.needUpdateRows ?? 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const executed = (): string[] => clientQueryMock.mock.calls.map((c) => String(c[0]));
const chargedLedger = (): boolean => executed().some((s) => /INSERT INTO transactions/.test(s));
const committed = (): boolean => executed().some((s) => /COMMIT/.test(s));
const rolledBack = (): boolean => executed().some((s) => /ROLLBACK/.test(s));

/** Bypass the service pre-check so the transaction itself is what is tested. */
const chargeDirect = () =>
  new MhcRepository().chargeActivation({
    activationType: 'award',
    providerUserId: 'provider-1',
    actingUserId: 'provider-1',
    actionKey: 'award_activation',
    needId: 'need-1',
    bidId: 'bid-1',
    description: 'Award activation',
  });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('award activation — state is re-validated under lock', () => {
  it('charges and opens the job when the offer is still live', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    const result = await chargeDirect();
    expect(result).toMatchObject({ charged: true, mhcCharged: 40, balance: 460 });
    expect(chargedLedger()).toBe(true);
    expect(committed()).toBe(true);
    // The debit and the state change must be in the same transaction.
    const order = executed();
    const txIdx = order.findIndex((s) => /INSERT INTO transactions/.test(s));
    const needIdx = order.findIndex((s) => /UPDATE needs\s+SET status = 'awarded'/.test(s));
    const commitIdx = order.findIndex((s) => /COMMIT/.test(s));
    expect(txIdx).toBeGreaterThan(-1);
    expect(needIdx).toBeGreaterThan(txIdx);
    expect(commitIdx).toBeGreaterThan(needIdx);
  });

  it('locks the need before the bid, so concurrent activations cannot deadlock', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '10', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await chargeDirect();
    const order = executed();
    const needLock = order.findIndex((s) => /FROM needs WHERE id = \$1 FOR UPDATE/.test(s));
    const bidLock = order.findIndex((s) => /FROM bids WHERE id = \$1 FOR UPDATE/.test(s));
    expect(needLock).toBeGreaterThan(-1);
    expect(bidLock).toBeGreaterThan(needLock);
  });
});

describe('award activation — re-award versus activation', () => {
  it('refuses to charge when the customer re-awarded to another provider', async () => {
    // The customer moved the offer to bid-2 after our caller read the state.
    mockTransaction({
      need: { ...liveOffer.need, pending_award_bid_id: 'bid-2' },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'AWARD_STATE_CHANGED' });
    expect(chargedLedger()).toBe(false);
    expect(rolledBack()).toBe(true);
  });

  it('refuses to charge when the need was already activated for another bid', async () => {
    mockTransaction({
      need: {
        ...liveOffer.need,
        status: 'awarded',
        pending_award_bid_id: null,
        activated_at: new Date().toISOString(),
      },
      bid: { ...liveOffer.bid, status: 'rejected' },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'AWARD_STATE_CHANGED' });
    expect(chargedLedger()).toBe(false);
  });

  it('aborts if the guarded bid update matches no row', async () => {
    // Passes validation, then loses the race before the write lands. Without the
    // rowCount guard this would overwrite a newer award.
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
      bidUpdateRows: 0,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'AWARD_STATE_CHANGED' });
    // The debit happened inside the transaction but the transaction rolled back,
    // so no credits actually left the wallet.
    expect(rolledBack()).toBe(true);
    expect(committed()).toBe(false);
  });

  it('aborts if the guarded need update matches no row', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
      needUpdateRows: 0,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'AWARD_STATE_CHANGED' });
    expect(rolledBack()).toBe(true);
    expect(committed()).toBe(false);
  });
});

describe('award activation — duplicate activation', () => {
  it('does not charge twice when an activation already exists', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: true,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    const result = await chargeDirect();
    expect(result).toMatchObject({ charged: false, alreadyActivated: true, mhcCharged: 40 });
    expect(chargedLedger()).toBe(false);
    expect(committed()).toBe(true);
  });

  // Regression: state validation must NOT run before the idempotency check.
  // After activation the need moves to 'awarded' and pending_award_bid_id is
  // cleared, so validating first would make a retry fail as AWARD_STATE_CHANGED
  // instead of returning the existing result.
  it('returns idempotently even though the need has moved past the offer state', async () => {
    mockTransaction({
      need: {
        id: 'need-1',
        status: 'awarded',
        pending_award_bid_id: null,
        pending_award_expires_at: null,
        activated_at: new Date().toISOString(),
      },
      bid: { ...liveOffer.bid, status: 'accepted' },
      activationExists: true,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '460',
      walletFrozen: false,
    });

    const result = await chargeDirect();
    expect(result).toMatchObject({ charged: false, alreadyActivated: true, mhcCharged: 40 });
    expect(chargedLedger()).toBe(false);
    expect(committed()).toBe(true);
  });

  it('checks for an existing activation before doing any pricing or wallet work', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: true,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await chargeDirect();
    expect(executed().some((s) => /FROM mhc_action_prices/.test(s))).toBe(false);
    expect(executed().some((s) => /UPDATE wallets SET balance/.test(s))).toBe(false);
  });
});

describe('award activation — expiry versus activation', () => {
  it('refuses to charge an offer that lapsed before the transaction ran', async () => {
    mockTransaction({
      need: {
        ...liveOffer.need,
        pending_award_expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'AWARD_OFFER_EXPIRED' });
    expect(chargedLedger()).toBe(false);
    expect(rolledBack()).toBe(true);
  });

  it('allows a never-expiring offer', async () => {
    mockTransaction({
      need: { ...liveOffer.need, pending_award_expires_at: 'infinity' },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '25', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    const result = await chargeDirect();
    expect(result.mhcCharged).toBe(25);
  });
});

describe('award activation — no-charge failure paths', () => {
  it('charges nothing when the provider does not own the bid', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid, expert_id: 'someone-else' },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'NOT_BID_OWNER' });
    expect(chargedLedger()).toBe(false);
  });

  it('charges nothing when the bid belongs to a different need', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid, need_id: 'other-need' },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ reason: 'BID_NOT_FOUND' });
    expect(chargedLedger()).toBe(false);
  });

  it('charges nothing when the balance is short', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '10',
      walletFrozen: false,
    });

    await expect(chargeDirect()).rejects.toMatchObject({ required: 40, available: 10 });
    expect(chargedLedger()).toBe(false);
    expect(committed()).toBe(false);
  });

  it('charges nothing when the credit wallet is frozen', async () => {
    mockTransaction({
      need: { ...liveOffer.need },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: true,
    });

    await expect(chargeDirect()).rejects.toThrow('MHC_WALLET_FROZEN');
    expect(chargedLedger()).toBe(false);
    expect(committed()).toBe(false);
  });

  it('maps the locked-state failure to a clean 409 through the service', async () => {
    mockTransaction({
      need: { ...liveOffer.need, pending_award_bid_id: 'bid-2' },
      bid: { ...liveOffer.bid },
      activationExists: false,
      price: { mhc_price: '40', is_active: true },
      walletBalance: '500',
      walletFrozen: false,
    });
    // Service pre-check sees a still-live offer; the transaction disagrees.
    poolQueryMock.mockImplementation((sql: string) => {
      if (/FROM bids b/.test(sql)) {
        return {
          rows: [
            {
              bid_id: 'bid-1',
              need_id: 'need-1',
              expert_id: 'provider-1',
              bid_status: 'awarded_pending',
              need_status: 'awarded_pending_provider_acceptance',
              awarded_bid_id: null,
              pending_award_bid_id: 'bid-1',
              pending_award_expires_at: liveOffer.need.pending_award_expires_at,
              activated_at: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      new MhcService().activateAwardForProvider({
        userId: 'provider-1',
        role: 'expert',
        bidId: 'bid-1',
      }),
    ).rejects.toMatchObject({ code: 'AWARD_STATE_CHANGED', statusCode: 409 });
    expect(chargedLedger()).toBe(false);
  });
});
