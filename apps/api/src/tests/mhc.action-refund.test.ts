import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MhcChargeNotFoundError,
  MhcInvalidChargeReferenceError,
  MhcRepository,
  MhcTransactionRequiredError,
} from '../modules/mhc/mhc.repository.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

import { FakeCreditDb, type FakeConnection } from './support/fake-credit-db.js';

// ---------------------------------------------------------------------------
// Refunding a generic MHC action charge (P0-07).
// ---------------------------------------------------------------------------
// The refund primitive exists so that a consumer with a legitimate reversal —
// the bid fee on a need that expired without an award being the motivating case
// — never has to reach for `UPDATE wallets SET balance = ...`. Every assertion
// here is therefore about the pair of writes that must happen together: the
// credit and the ledger row explaining it.
//
// Nothing is wired to this yet: there is no refund endpoint and no consumer.
// ---------------------------------------------------------------------------

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: vi.fn(), connect: vi.fn() }),
}));
vi.mock('../config/env.js', () => ({ env: {} }));

const PROVIDER = '11111111-1111-4111-8111-111111111111';
const AD_ONE = 'aaaaaaaa-0000-4000-8000-000000000001';
const ACTION = 'advertisement';
const REASON = 'need expired without an award';

let db: FakeCreditDb;

const inTransaction = async <T>(fn: (conn: FakeConnection) => Promise<T>): Promise<T> => {
  const conn = db.connect();
  await conn.query('BEGIN');
  try {
    const result = await fn(conn);
    await conn.query('COMMIT');
    return result;
  } catch (e) {
    await conn.query('ROLLBACK');
    throw e;
  }
};

/** Charge first, so every refund test starts from a real, ledgered charge. */
const chargeOnce = async (): Promise<string> => {
  const result = await inTransaction((conn) =>
    new MhcRepository().chargeAction({
      client: conn.asPoolClient(),
      userId: PROVIDER,
      actionKey: ACTION,
      referenceType: 'advertisement',
      referenceId: AD_ONE,
    }),
  );
  return result.chargeId!;
};

const refund = (conn: FakeConnection, chargeId: string, reason = REASON) =>
  new MhcRepository().refundActionCharge({
    client: conn.asPoolClient(),
    chargeId,
    reason,
  });

beforeEach(() => {
  db = new FakeCreditDb();
  db.seedUser(PROVIDER, 'expert');
  db.seedWallet({ userId: PROVIDER, mhc: 100 });
  db.seedPrice(ACTION, 25, true);
});

describe('refundActionCharge — a single refund', () => {
  it('credits back exactly what was charged', async () => {
    const chargeId = await chargeOnce();
    expect(db.balanceOf(PROVIDER)).toBe(75);

    const result = await inTransaction((conn) => refund(conn, chargeId));

    expect(result).toMatchObject({
      outcome: 'refunded',
      chargeId,
      mhcRefunded: 25,
      balanceAfter: 100,
      alreadyRefunded: false,
    });
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });

  it('writes exactly one refund ledger row and marks the charge once', async () => {
    const chargeId = await chargeOnce();
    const result = await inTransaction((conn) => refund(conn, chargeId));

    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(1);
    expect(db.ledger()).toHaveLength(2); // the original payment plus this refund

    const entry = db.ledgerFor('mhc_action_refund')[0]!;
    expect(entry).toMatchObject({
      type: 'refund',
      amount_cents: 2500,
      balance_delta_cents: 2500,
      balance_after_cents: 10000,
      status: 'completed',
      reference_id: chargeId,
    });

    const charge = db.chargeById(chargeId)!;
    expect(charge.refunded_at).not.toBeNull();
    expect(charge.refund_transaction_id).toBe(result.refundTransactionId);
    expect(charge.refund_transaction_id).toBe(entry.id);
  });

  it('records the reason and the original charge on the refund ledger row', async () => {
    const chargeId = await chargeOnce();
    await inTransaction((conn) => refund(conn, chargeId, 'customer never awarded'));

    const entry = db.ledgerFor('mhc_action_refund')[0]!;
    expect(entry.metadata).toMatchObject({
      asset: 'MHC',
      action_key: ACTION,
      charge_id: chargeId,
      charge_reference_type: 'advertisement',
      charge_reference_id: AD_ONE,
      refund_reason: 'customer never awarded',
    });
  });

  it('leaves the balance equal to the sum of the ledger deltas', async () => {
    const chargeId = await chargeOnce();
    await inTransaction((conn) => refund(conn, chargeId));

    expect(100 + db.ledgerSumFor(PROVIDER)).toBe(db.balanceOf(PROVIDER));
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });
});

describe('refundActionCharge — repeat and concurrent attempts', () => {
  it('does not credit again on a second refund', async () => {
    const chargeId = await chargeOnce();
    const first = await inTransaction((conn) => refund(conn, chargeId));
    const second = await inTransaction((conn) => refund(conn, chargeId));

    expect(second).toMatchObject({
      outcome: 'already_refunded',
      chargeId,
      refundTransactionId: first.refundTransactionId,
      mhcRefunded: 0,
      alreadyRefunded: true,
    });
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(1);
  });

  it('credits exactly once when five refunds run concurrently', async () => {
    const chargeId = await chargeOnce();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => inTransaction((conn) => refund(conn, chargeId))),
    );

    expect(results.filter((r) => r.outcome === 'refunded')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_refunded')).toHaveLength(4);
    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.chargeById(chargeId)!.refunded_at).not.toBeNull();
  });

  it('locks the charge row before the wallet row', async () => {
    const chargeId = await chargeOnce();
    await inTransaction((conn) => refund(conn, chargeId));

    const chargeLock = db.statements.findIndex((s) =>
      /FROM mhc_action_charges WHERE id = \$1 FOR UPDATE/.test(s),
    );
    const walletLock = db.statements.findIndex(
      (s, i) =>
        i > chargeLock &&
        /SELECT balance::text, is_frozen FROM wallets WHERE id = \$1 FOR UPDATE/.test(s),
    );
    expect(chargeLock).toBeGreaterThan(-1);
    expect(walletLock).toBeGreaterThan(chargeLock);
  });
});

describe('refundActionCharge — transactional contract with the caller', () => {
  it('reverses completely when the caller rolls back', async () => {
    const chargeId = await chargeOnce();

    const conn = db.connect();
    await conn.query('BEGIN');
    const result = await refund(conn, chargeId);
    expect(result.outcome).toBe('refunded');
    await conn.query('ROLLBACK');

    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(0);
    expect(db.chargeById(chargeId)!.refunded_at).toBeNull();
    expect(db.chargeById(chargeId)!.refund_transaction_id).toBeNull();
  });

  it('refuses to run outside a transaction', async () => {
    const chargeId = await chargeOnce();
    const conn = db.connect();

    await expect(refund(conn, chargeId)).rejects.toBeInstanceOf(MhcTransactionRequiredError);
    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(0);
  });

  it('never adjusts a balance without writing a ledger row', async () => {
    const chargeId = await chargeOnce();
    await inTransaction((conn) => refund(conn, chargeId));

    const balanceWrites = db.statements.filter((s) => /^UPDATE wallets SET balance/.test(s));
    // Two balance writes across charge + refund, and two ledger rows explaining
    // them. Neither number may exceed the other.
    expect(balanceWrites).toHaveLength(2);
    expect(db.ledger()).toHaveLength(2);
  });
});

describe('refundActionCharge — guards', () => {
  it('reports an unknown charge rather than crediting anything', async () => {
    await chargeOnce();

    await expect(
      inTransaction((conn) => refund(conn, 'bbbbbbbb-0000-4000-8000-000000000009')),
    ).rejects.toBeInstanceOf(MhcChargeNotFoundError);
    expect(db.balanceOf(PROVIDER)).toBe(75);

    await expect(
      inTransaction((conn) =>
        new MhcService().refundActionCharge({
          client: conn.asPoolClient(),
          chargeId: 'bbbbbbbb-0000-4000-8000-000000000009',
          reason: REASON,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'MHC_CHARGE_NOT_FOUND' });
  });

  it('treats a malformed charge id as not found, not as a database error', async () => {
    await expect(inTransaction((conn) => refund(conn, 'nonsense'))).rejects.toBeInstanceOf(
      MhcChargeNotFoundError,
    );
  });

  it('requires a reason, because an unexplained credit is not auditable', async () => {
    const chargeId = await chargeOnce();

    await expect(inTransaction((conn) => refund(conn, chargeId, '   '))).rejects.toBeInstanceOf(
      MhcInvalidChargeReferenceError,
    );
    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.ledgerFor('mhc_action_refund')).toHaveLength(0);
  });

  it('cannot turn a zero-value charge into a positive refund', async () => {
    // The charging primitive never writes a zero-value row, so this state can
    // only arrive by hand. It must still not mint credits.
    const zero = db.seedCharge({
      userId: PROVIDER,
      actionKey: 'service_promotion',
      referenceType: 'service',
      referenceId: AD_ONE,
      mhc: 0,
    });

    const result = await inTransaction((conn) => refund(conn, zero.id));

    expect(result).toMatchObject({
      outcome: 'nothing_to_refund',
      mhcRefunded: 0,
      refundTransactionId: null,
      alreadyRefunded: false,
    });
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.ledger()).toHaveLength(0);
    expect(db.chargeById(zero.id)!.refunded_at).toBeNull();
  });

  it('refunds a charge on a frozen wallet, because a freeze must not destroy credits owed', async () => {
    const chargeId = await chargeOnce();
    db.seedWallet({ userId: PROVIDER, mhc: 75, isFrozen: true });

    const result = await inTransaction((conn) => refund(conn, chargeId));

    expect(result.outcome).toBe('refunded');
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });
});
