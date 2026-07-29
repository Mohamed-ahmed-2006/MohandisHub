import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  InsufficientCreditsError,
  MhcActionDisabledError,
  MhcActionPriceMissingError,
  MhcInvalidChargeReferenceError,
  MhcRepository,
  MhcTransactionRequiredError,
} from '../modules/mhc/mhc.repository.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

import { FakeCreditDb, type FakeConnection } from './support/fake-credit-db.js';

// ---------------------------------------------------------------------------
// The generic MHC charging primitive (P0-07).
// ---------------------------------------------------------------------------
// Every assertion here is about resulting DATABASE STATE — balances, ledger
// rows, charge rows — not about which methods were called. The claims this file
// has to establish are outcome claims: "ten concurrent charges produce exactly
// one debit", "a caller rollback leaves nothing behind", "the balance never goes
// negative". None of those can be proven by counting mock invocations, so the
// tests run against an in-memory model of the credit tables that implements
// READ COMMITTED visibility, savepoints, FOR UPDATE row locks and unique
// indexes (see support/fake-credit-db.ts).
//
// The activation path is not exercised here. It has its own suite
// (mhc.activation-race.test.ts) which must keep passing unmodified.
// ---------------------------------------------------------------------------

vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: vi.fn(), connect: vi.fn() }),
}));
vi.mock('../config/env.js', () => ({ env: {} }));

const PROVIDER = '11111111-1111-4111-8111-111111111111';
const OTHER_PROVIDER = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const AD_ONE = 'aaaaaaaa-0000-4000-8000-000000000001';
const AD_TWO = 'aaaaaaaa-0000-4000-8000-000000000002';

const ACTION = 'advertisement';

let db: FakeCreditDb;

const setup = (opts?: { balance?: number; price?: number; frozen?: boolean }): void => {
  db = new FakeCreditDb();
  db.seedUser(PROVIDER, 'expert');
  db.seedUser(OTHER_PROVIDER, 'business');
  db.seedUser(CUSTOMER, 'customer');
  db.seedWallet({ userId: PROVIDER, mhc: opts?.balance ?? 100, isFrozen: opts?.frozen ?? false });
  db.seedWallet({ userId: OTHER_PROVIDER, mhc: 100 });
  db.seedPrice(ACTION, opts?.price ?? 25, true);
};

/** Run a unit of work the way a real consumer does: inside its own transaction. */
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

const charge = (
  conn: FakeConnection,
  overrides?: Partial<Parameters<MhcRepository['chargeAction']>[0]>,
) =>
  new MhcRepository().chargeAction({
    client: conn.asPoolClient(),
    userId: PROVIDER,
    actionKey: ACTION,
    referenceType: 'advertisement',
    referenceId: AD_ONE,
    ...overrides,
  });

beforeEach(() => {
  setup();
});

describe('chargeAction — a single successful charge', () => {
  it('debits exactly the configured price and reports the resulting balance', async () => {
    const result = await inTransaction((conn) => charge(conn));

    expect(result).toMatchObject({
      outcome: 'charged',
      mhcCharged: 25,
      balanceAfter: 75,
      alreadyCharged: false,
    });
    expect(db.balanceOf(PROVIDER)).toBe(75);
  });

  it('writes exactly one ledger row and exactly one charge row', async () => {
    const result = await inTransaction((conn) => charge(conn));

    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(1);

    const charged = db.charges()[0]!;
    expect(charged).toMatchObject({
      user_id: PROVIDER,
      action_key: ACTION,
      reference_type: 'advertisement',
      reference_id: AD_ONE,
      charged_cents: 2500,
      refunded_at: null,
    });
    // The charge row and the ledger row point at each other, so neither can be
    // read without finding the other.
    expect(charged.transaction_id).toBe(result.transactionId);
    expect(db.ledger()[0]!.reference_id).toBe(result.chargeId);
  });

  it('writes the debit as a provider_credit payment, never as a money movement', async () => {
    await inTransaction((conn) => charge(conn));

    const entry = db.ledger()[0]!;
    expect(entry).toMatchObject({
      type: 'payment',
      amount_cents: 2500,
      balance_delta_cents: -2500,
      balance_after_cents: 7500,
      status: 'completed',
      reference_type: 'mhc_action_charge',
    });
    expect(entry.metadata.asset).toBe('MHC');
  });

  it('records enough metadata on the ledger row to identify what was charged', async () => {
    const result = await inTransaction((conn) =>
      charge(conn, { idempotencyKey: 'ad:one', actorUserId: OTHER_PROVIDER }),
    );

    const entry = db.ledger()[0]!;
    expect(entry.metadata).toMatchObject({
      action_key: ACTION,
      charge_id: result.chargeId,
      charge_reference_type: 'advertisement',
      charge_reference_id: AD_ONE,
      idempotency_key: 'ad:one',
    });
    // The acting user is recorded, so a business team member's charge is
    // attributable without putting identity into the metadata blob.
    expect(entry.created_by).toBe(OTHER_PROVIDER);
  });

  it('leaves the balance equal to the sum of the ledger deltas', async () => {
    await inTransaction((conn) => charge(conn));
    await inTransaction((conn) => charge(conn, { referenceId: AD_TWO }));

    expect(db.balanceOf(PROVIDER)).toBe(50);
    expect(100 + db.ledgerSumFor(PROVIDER)).toBe(db.balanceOf(PROVIDER));
  });

  it('charges independently for different references under the same action', async () => {
    const first = await inTransaction((conn) => charge(conn));
    const second = await inTransaction((conn) => charge(conn, { referenceId: AD_TWO }));

    expect(first.chargeId).not.toBe(second.chargeId);
    expect(db.charges()).toHaveLength(2);
    expect(db.ledger()).toHaveLength(2);
    expect(db.balanceOf(PROVIDER)).toBe(50);
  });
});

describe('chargeAction — insufficient balance', () => {
  it('refuses with the MHC-specific credits error and charges nothing', async () => {
    setup({ balance: 10, price: 40 });

    await expect(inTransaction((conn) => charge(conn))).rejects.toBeInstanceOf(
      InsufficientCreditsError,
    );
    expect(db.balanceOf(PROVIDER)).toBe(10);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('surfaces a 402 through the service, carrying required and available', async () => {
    setup({ balance: 10, price: 40 });

    await expect(
      inTransaction((conn) =>
        new MhcService().chargeAction({
          client: conn.asPoolClient(),
          userId: PROVIDER,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: AD_ONE,
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
      details: { required: 40, available: 10 },
    });
  });

  it('leaves no partial row behind even when the caller swallows the error', async () => {
    setup({ balance: 10, price: 40 });

    // A consumer that treats a failed charge as "skip the paid extra" and
    // commits anyway must not commit half a charge.
    const conn = db.connect();
    await conn.query('BEGIN');
    await expect(charge(conn)).rejects.toBeInstanceOf(InsufficientCreditsError);
    await conn.query('COMMIT');

    expect(db.balanceOf(PROVIDER)).toBe(10);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('spends the balance down to exactly zero and no further', async () => {
    setup({ balance: 50, price: 50 });

    await inTransaction((conn) => charge(conn));
    expect(db.balanceOf(PROVIDER)).toBe(0);

    await expect(
      inTransaction((conn) => charge(conn, { referenceId: AD_TWO })),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(db.balanceOf(PROVIDER)).toBe(0);
  });

  it('guards the debit in SQL, so the balance floor is not a JavaScript check', async () => {
    await inTransaction((conn) => charge(conn));

    // The application check happens under the row lock, but the UPDATE itself
    // carries the predicate too: if the locked read were ever wrong, the write
    // still cannot take a wallet below zero.
    const debit = db.statements.find((s) => /^UPDATE wallets SET balance = balance - /.test(s));
    expect(debit).toBeDefined();
    expect(debit).toMatch(/WHERE id = \$1 AND balance >= \$2::numeric/);
  });
});

describe('chargeAction — action price configuration', () => {
  it('treats a price of zero as free: no debit, no ledger row, no charge row', async () => {
    setup({ price: 0 });

    const result = await inTransaction((conn) => charge(conn));

    expect(result).toMatchObject({
      outcome: 'free',
      chargeId: null,
      transactionId: null,
      mhcCharged: 0,
      balanceAfter: 100,
      alreadyCharged: false,
    });
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('does not provision a credit wallet as a side effect of a free action', async () => {
    setup({ price: 0 });
    const fresh = new FakeCreditDb();
    fresh.seedUser(PROVIDER, 'expert');
    fresh.seedPrice(ACTION, 0, true);
    db = fresh;

    const result = await inTransaction((conn) => charge(conn));

    expect(result.outcome).toBe('free');
    expect(result.balanceAfter).toBe(0);
    expect(db.balanceOf(PROVIDER)).toBe(0);
  });

  it('refuses to invent a price when no price row exists', async () => {
    db.removePrice(ACTION);

    await expect(inTransaction((conn) => charge(conn))).rejects.toBeInstanceOf(
      MhcActionPriceMissingError,
    );
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('fails closed with a 503 on a missing price, rather than giving the action away', async () => {
    db.removePrice(ACTION);

    await expect(
      inTransaction((conn) =>
        new MhcService().chargeAction({
          client: conn.asPoolClient(),
          userId: PROVIDER,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: AD_ONE,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 503, code: 'MHC_ACTION_PRICE_MISSING' });
  });

  it('does not charge for an inactive action, and reports it as disabled not free', async () => {
    db.seedPrice(ACTION, 25, false);

    await expect(inTransaction((conn) => charge(conn))).rejects.toBeInstanceOf(
      MhcActionDisabledError,
    );
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);

    await expect(
      inTransaction((conn) =>
        new MhcService().chargeAction({
          client: conn.asPoolClient(),
          userId: PROVIDER,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: AD_ONE,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409, code: 'MHC_ACTION_DISABLED' });
  });

  it('keeps disabled, unconfigured and free as three distinguishable states', async () => {
    // The whole point of failing closed: an admin switching an action off, an
    // action nobody priced, and an action deliberately priced at 0 must never
    // collapse into the same outcome.
    db.seedPrice('free_action', 0, true);
    db.seedPrice('off_action', 10, false);

    const free = await inTransaction((conn) =>
      charge(conn, { actionKey: 'free_action', referenceId: AD_TWO }),
    );
    expect(free.outcome).toBe('free');

    await expect(
      inTransaction((conn) => charge(conn, { actionKey: 'off_action' })),
    ).rejects.toBeInstanceOf(MhcActionDisabledError);

    await expect(
      inTransaction((conn) => charge(conn, { actionKey: 'never_configured' })),
    ).rejects.toBeInstanceOf(MhcActionPriceMissingError);
  });
});

describe('chargeAction — transactional contract with the caller', () => {
  it('rolls back the debit, the ledger row and the charge row when the caller rolls back', async () => {
    const conn = db.connect();
    await conn.query('BEGIN');
    const result = await charge(conn);
    expect(result.outcome).toBe('charged');
    // The caller's own domain write fails after the charge succeeded.
    await conn.query('ROLLBACK');

    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('refuses to run outside a transaction instead of committing on its own', async () => {
    const conn = db.connect();

    await expect(charge(conn)).rejects.toBeInstanceOf(MhcTransactionRequiredError);
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
    expect(db.ledger()).toHaveLength(0);
  });

  it('never issues its own BEGIN or COMMIT', async () => {
    await inTransaction((conn) => charge(conn));

    const repositoryStatements = db.statements.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(s));
    expect(repositoryStatements.some((s) => /^BEGIN/i.test(s))).toBe(false);
    expect(repositoryStatements.some((s) => /^COMMIT/i.test(s))).toBe(false);
  });

  it('locks the wallet row before reading the balance it is about to spend', async () => {
    await inTransaction((conn) => charge(conn));

    const lockIdx = db.statements.findIndex((s) =>
      /SELECT balance::text, is_frozen FROM wallets WHERE id = \$1 FOR UPDATE/.test(s),
    );
    const debitIdx = db.statements.findIndex((s) =>
      /^UPDATE wallets SET balance = balance - /.test(s),
    );
    const insertIdx = db.statements.findIndex((s) => /^INSERT INTO mhc_action_charges/.test(s));
    expect(lockIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(lockIdx);
    // The charge row is written before any money moves, so a duplicate collides
    // on the unique index before the wallet is touched.
    expect(debitIdx).toBeGreaterThan(insertIdx);
  });
});

describe('chargeAction — guards', () => {
  it('rejects a frozen credit wallet without charging', async () => {
    setup({ frozen: true });

    await expect(inTransaction((conn) => charge(conn))).rejects.toThrow('MHC_WALLET_FROZEN');
    expect(db.balanceOf(PROVIDER)).toBe(100);
    expect(db.charges()).toHaveLength(0);
  });

  it('rejects a malformed reference id before it can abort the caller transaction', async () => {
    await expect(
      inTransaction((conn) => charge(conn, { referenceId: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(MhcInvalidChargeReferenceError);
    expect(db.ledger()).toHaveLength(0);
  });

  it('refuses to charge a non-provider account', async () => {
    await expect(
      inTransaction((conn) =>
        new MhcService().chargeAction({
          client: conn.asPoolClient(),
          userId: CUSTOMER,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: AD_ONE,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'MHC_PROVIDERS_ONLY' });
    expect(db.balanceOf(CUSTOMER)).toBe(0);
    expect(db.charges()).toHaveLength(0);
  });

  it('refuses to charge an account that does not exist', async () => {
    await expect(
      inTransaction((conn) =>
        new MhcService().chargeAction({
          client: conn.asPoolClient(),
          userId: '44444444-4444-4444-8444-444444444444',
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: AD_ONE,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404, code: 'MHC_ACCOUNT_NOT_FOUND' });
  });
});

describe('chargeAction — idempotency and concurrency', () => {
  it('charges once for ten concurrent identical requests', async () => {
    setup({ balance: 1000, price: 25 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => inTransaction((conn) => charge(conn))),
    );

    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(975);

    const charged = results.filter((r) => r.outcome === 'charged');
    const repeats = results.filter((r) => r.outcome === 'already_charged');
    expect(charged).toHaveLength(1);
    expect(repeats).toHaveLength(9);
    // Every repeat reports the same charge, so a retrying client sees a stable
    // answer rather than a different one per attempt.
    expect(new Set(results.map((r) => r.chargeId)).size).toBe(1);
    expect(repeats.every((r) => r.alreadyCharged && r.mhcCharged === 25)).toBe(true);
  });

  it('never lets concurrent charging drive the balance negative', async () => {
    // Balance covers four charges; ten different references are attempted at once.
    setup({ balance: 100, price: 25 });

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        inTransaction((conn) =>
          charge(conn, { referenceId: `aaaaaaaa-0000-4000-8000-00000000000${i}` }),
        ),
      ),
    );

    const succeeded = attempts.filter((a) => a.status === 'fulfilled');
    const refused = attempts.filter((a) => a.status === 'rejected');
    expect(succeeded).toHaveLength(4);
    expect(refused).toHaveLength(6);
    expect(refused.every((a) => a.reason instanceof InsufficientCreditsError)).toBe(true);
    expect(db.balanceOf(PROVIDER)).toBe(0);
    expect(db.charges()).toHaveLength(4);
    expect(db.ledger()).toHaveLength(4);
    expect(100 + db.ledgerSumFor(PROVIDER)).toBe(0);
  });

  it('returns the original charge on a sequential retry without debiting again', async () => {
    const first = await inTransaction((conn) => charge(conn));
    const retry = await inTransaction((conn) => charge(conn));

    expect(retry).toMatchObject({
      outcome: 'already_charged',
      chargeId: first.chargeId,
      transactionId: first.transactionId,
      mhcCharged: 25,
      alreadyCharged: true,
    });
    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(1);
  });

  it('absorbs a unique-index collision instead of surfacing a database error', async () => {
    // The wallet lock normally makes the pre-check sufficient. This forces the
    // case it cannot cover: a competing transaction commits the same charge in
    // the instant between our pre-check and our INSERT. The unique index — not
    // the pre-check — is what must stop the second debit.
    db.beforeChargeInsert = () => {
      db.beforeChargeInsert = null;
      db.seedCharge({
        userId: PROVIDER,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId: AD_ONE,
        mhc: 25,
        transactionId: 'tx-winner',
      });
    };

    const result = await inTransaction((conn) => charge(conn));

    expect(result).toMatchObject({
      outcome: 'already_charged',
      mhcCharged: 25,
      transactionId: 'tx-winner',
      alreadyCharged: true,
    });
    // Our transaction wrote nothing: no second charge row, no ledger row, no
    // credits moved.
    expect(db.charges()).toHaveLength(1);
    expect(db.ledger()).toHaveLength(0);
    expect(db.balanceOf(PROVIDER)).toBe(100);
  });

  it('will not create a second charge for a reused idempotency key', async () => {
    const first = await inTransaction((conn) => charge(conn, { idempotencyKey: 'ad:one' }));
    // Same key, DIFFERENT reference: the key means "this is the same logical
    // operation", so the original charge is returned and nothing is debited.
    const second = await inTransaction((conn) =>
      charge(conn, { idempotencyKey: 'ad:one', referenceId: AD_TWO }),
    );

    expect(second.outcome).toBe('already_charged');
    expect(second.chargeId).toBe(first.chargeId);
    expect(db.charges()).toHaveLength(1);
    expect(db.balanceOf(PROVIDER)).toBe(75);
  });

  it('scopes the idempotency key per provider, so unrelated accounts never collide', async () => {
    const mine = await inTransaction((conn) => charge(conn, { idempotencyKey: 'retry-1' }));
    const theirs = await inTransaction((conn) =>
      charge(conn, { userId: OTHER_PROVIDER, referenceId: AD_TWO, idempotencyKey: 'retry-1' }),
    );

    expect(mine.outcome).toBe('charged');
    expect(theirs.outcome).toBe('charged');
    expect(theirs.chargeId).not.toBe(mine.chargeId);
    expect(db.charges()).toHaveLength(2);
    expect(db.balanceOf(PROVIDER)).toBe(75);
    expect(db.balanceOf(OTHER_PROVIDER)).toBe(75);
  });

  it('lets unrelated references charge concurrently without blocking each other', async () => {
    setup({ balance: 500, price: 25 });

    const [a, b] = await Promise.all([
      inTransaction((conn) => charge(conn, { referenceId: AD_ONE })),
      inTransaction((conn) => charge(conn, { referenceId: AD_TWO })),
    ]);

    expect(a.outcome).toBe('charged');
    expect(b.outcome).toBe('charged');
    expect(db.charges()).toHaveLength(2);
    expect(db.ledger()).toHaveLength(2);
    expect(db.balanceOf(PROVIDER)).toBe(450);
  });

  it('does not treat the same reference under a different action as a duplicate', async () => {
    db.seedPrice('service_promotion', 10, true);

    await inTransaction((conn) => charge(conn));
    const promoted = await inTransaction((conn) =>
      charge(conn, { actionKey: 'service_promotion' }),
    );

    expect(promoted.outcome).toBe('charged');
    expect(db.charges()).toHaveLength(2);
    expect(db.balanceOf(PROVIDER)).toBe(65);
  });
});
