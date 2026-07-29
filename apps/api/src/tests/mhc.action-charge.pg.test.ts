import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InsufficientCreditsError, MhcRepository } from '../modules/mhc/mhc.repository.js';
import { MhcService } from '../modules/mhc/mhc.service.js';

import {
  balanceOf,
  countRows,
  createScratchDatabase,
  pgIntegrationEnabled,
  readMigration,
  seedProvider,
  setActionPrice,
  type ScratchDatabase,
} from './support/pg-scratch.js';

// ---------------------------------------------------------------------------
// P0-07 acceptance against a REAL PostgreSQL server.
// ---------------------------------------------------------------------------
// The unit suite proves these properties against a model of PostgreSQL. This
// suite proves the same properties against the real thing, on a disposable
// database built by replaying every migration into an empty schema — so real
// FOR UPDATE blocking, real READ COMMITTED visibility, real unique indexes and
// real CHECK constraints are what the assertions land on.
//
// Opt-in, because the default test run must not require a database:
//   RUN_PG_INTEGRATION=1 npm run test -w @mohandishub/api
//
// The scratch database is created and dropped by this file. No pre-existing
// database is read from or written to.
// ---------------------------------------------------------------------------

const CHARGE_MIGRATION = '20260729140000_mhc_action_charges.sql';
const ROLLBACK_SQL = 'DROP TABLE IF EXISTS public.mhc_action_charges;';

let scratch: ScratchDatabase;
let pool: Pool;

// The repository only reaches for the shared pool on paths this suite does not
// exercise, but mock it anyway so an accidental use hits the scratch database
// rather than the configured one.
vi.mock('../db/pool.js', () => ({
  getPool: () => pool,
  hasDatabaseConfig: () => true,
}));

const repo = new MhcRepository();
const ACTION = 'advertisement';

/** Run work inside a caller-owned transaction, exactly as a consumer would. */
const inTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

const newReference = (): string => crypto.randomUUID();

const chargeCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM mhc_action_charges WHERE user_id = $1`, [userId]);

const ledgerCount = (userId: string): Promise<number> =>
  countRows(pool, `SELECT count(*)::text c FROM transactions WHERE user_id = $1`, [userId]);

// One scratch database shared by all three describes in this file: replaying 96
// migrations is the expensive part, and every suite here wants the same schema.
beforeAll(async () => {
  if (!pgIntegrationEnabled()) return;
  scratch = await createScratchDatabase('p007');
  pool = scratch.pool;
}, 1_800_000);

afterAll(async () => {
  if (scratch) await scratch.drop();
}, 300_000);

beforeEach(async () => {
  if (!pgIntegrationEnabled()) return;
  await setActionPrice(pool, ACTION, 25, true);
});

describe.skipIf(!pgIntegrationEnabled())('P0-07 against real PostgreSQL', () => {
  // -- 1 ---------------------------------------------------------------------
  it('debits once, ledgers once and records one charge for a sufficient balance', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const referenceId = newReference();

    const result = await inTransaction((client) =>
      repo.chargeAction({
        client,
        userId,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId,
      }),
    );

    expect(result).toMatchObject({ outcome: 'charged', mhcCharged: 25, balanceAfter: 75 });
    expect(await balanceOf(pool, userId)).toBe(75);
    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);

    const { rows } = await pool.query<{
      type: string;
      amount: string;
      balance_delta: string;
      balance_after: string;
      reference_type: string;
      reference_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT type, amount::text, balance_delta::text, balance_after::text,
              reference_type, reference_id, metadata
       FROM transactions WHERE user_id = $1`,
      [userId],
    );
    expect(rows[0]).toMatchObject({
      type: 'payment',
      amount: '25.00',
      balance_delta: '-25.00',
      balance_after: '75.00',
      reference_type: 'mhc_action_charge',
      reference_id: result.chargeId,
    });
    expect(rows[0]!.metadata).toMatchObject({
      asset: 'MHC',
      action_key: ACTION,
      charge_reference_id: referenceId,
    });

    // The charge row points back at the ledger row that moved the credits.
    const { rows: chargeRows } = await pool.query<{ transaction_id: string }>(
      `SELECT transaction_id FROM mhc_action_charges WHERE id = $1`,
      [result.chargeId],
    );
    expect(chargeRows[0]!.transaction_id).toBe(result.transactionId);
  });

  // -- 2 ---------------------------------------------------------------------
  it('charges exactly once when ten identical requests run concurrently', async () => {
    const { userId } = await seedProvider(pool, { mhc: 1000 });
    const referenceId = newReference();

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        inTransaction((client) =>
          repo.chargeAction({
            client,
            userId,
            actionKey: ACTION,
            referenceType: 'advertisement',
            referenceId,
          }),
        ),
      ),
    );

    expect(await chargeCount(userId)).toBe(1);
    expect(await ledgerCount(userId)).toBe(1);
    expect(await balanceOf(pool, userId)).toBe(975);

    expect(results.filter((r) => r.outcome === 'charged')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_charged')).toHaveLength(9);
    // Every caller sees the same charge, so a retrying client gets a stable answer.
    expect(new Set(results.map((r) => r.chargeId)).size).toBe(1);
  }, 120_000);

  it('never oversells a balance under concurrent charges for different references', async () => {
    // Balance covers four charges; ten distinct references race for it.
    const { userId } = await seedProvider(pool, { mhc: 100 });

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        inTransaction((client) =>
          repo.chargeAction({
            client,
            userId,
            actionKey: ACTION,
            referenceType: 'advertisement',
            referenceId: newReference(),
          }),
        ),
      ),
    );

    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(4);
    expect(await balanceOf(pool, userId)).toBe(0);
    expect(await chargeCount(userId)).toBe(4);
    expect(await ledgerCount(userId)).toBe(4);
  }, 120_000);

  // -- 3 ---------------------------------------------------------------------
  it('refuses an insufficient balance with 402 and leaves no partial state', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    await setActionPrice(pool, ACTION, 40, true);

    await expect(
      inTransaction((client) =>
        new MhcService().chargeAction({
          client,
          userId,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: newReference(),
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 402,
      code: 'MHC_INSUFFICIENT_CREDITS',
      details: { required: 40, available: 10 },
    });

    expect(await balanceOf(pool, userId)).toBe(10);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });

  it('leaves nothing behind when the caller swallows the 402 and commits', async () => {
    const { userId } = await seedProvider(pool, { mhc: 10 });
    await setActionPrice(pool, ACTION, 40, true);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        repo.chargeAction({
          client,
          userId,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: newReference(),
        }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      // The caller's transaction must still be usable after a caught 402.
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await balanceOf(pool, userId)).toBe(10);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });

  // -- 4 ---------------------------------------------------------------------
  it('rolls the whole charge back when the caller rolls back', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const referenceId = newReference();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const charged = await repo.chargeAction({
        client,
        userId,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId,
      });
      expect(charged.outcome).toBe('charged');

      // The consumer's own domain write fails after the charge succeeded.
      await expect(
        client.query(`INSERT INTO advertisements (id) VALUES ($1)`, [referenceId]),
      ).rejects.toBeTruthy();
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });

  // -- 5 ---------------------------------------------------------------------
  it('has PostgreSQL itself reject a negative credit balance', async () => {
    const { userId, walletId } = await seedProvider(pool, { mhc: 5 });

    await expect(
      pool.query(`UPDATE wallets SET balance = -1 WHERE id = $1`, [walletId]),
    ).rejects.toMatchObject({ code: '23514' });

    expect(await balanceOf(pool, userId)).toBe(5);
  });

  it('has PostgreSQL itself reject a duplicate charge for the same reference', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const referenceId = newReference();

    await inTransaction((client) =>
      repo.chargeAction({
        client,
        userId,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId,
      }),
    );

    // Bypass the primitive entirely: the index, not the code, is the authority.
    await expect(
      pool.query(
        `INSERT INTO mhc_action_charges (user_id, action_key, reference_type, reference_id, mhc_charged)
         VALUES ($1, $2, 'advertisement', $3, 25)`,
        [userId, ACTION, referenceId],
      ),
    ).rejects.toMatchObject({ code: '23505', constraint: 'uq_mhc_action_charge_reference' });
  });

  it('refuses to charge outside a transaction, enforced by PostgreSQL', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const client = await pool.connect();
    try {
      await expect(
        repo.chargeAction({
          client,
          userId,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: newReference(),
        }),
      ).rejects.toMatchObject({ name: 'MhcTransactionRequiredError' });
    } finally {
      client.release();
    }
    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await chargeCount(userId)).toBe(0);
  });

  it('writes no durable charge row for a zero-price action', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    await setActionPrice(pool, ACTION, 0, true);

    const result = await inTransaction((client) =>
      repo.chargeAction({
        client,
        userId,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId: newReference(),
      }),
    );

    expect(result).toMatchObject({ outcome: 'free', chargeId: null, mhcCharged: 0 });
    expect(await balanceOf(pool, userId)).toBe(100);
    expect(await chargeCount(userId)).toBe(0);
    expect(await ledgerCount(userId)).toBe(0);
  });

  it('rejects a non-UUID referenceId before PostgreSQL sees it', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });

    await expect(
      inTransaction((client) =>
        repo.chargeAction({
          client,
          userId,
          actionKey: ACTION,
          referenceType: 'advertisement',
          referenceId: 'ad-42',
        }),
      ),
    ).rejects.toMatchObject({ name: 'MhcInvalidChargeReferenceError' });
    expect(await chargeCount(userId)).toBe(0);
  });
});

describe.skipIf(!pgIntegrationEnabled())('P0-07 refunds against real PostgreSQL', () => {
  const chargeOnce = async (userId: string): Promise<string> => {
    const result = await inTransaction((client) =>
      repo.chargeAction({
        client,
        userId,
        actionKey: ACTION,
        referenceType: 'advertisement',
        referenceId: newReference(),
      }),
    );
    return result.chargeId!;
  };

  // -- 6 ---------------------------------------------------------------------
  it('credits exactly once when refunds run concurrently', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const chargeId = await chargeOnce(userId);
    expect(await balanceOf(pool, userId)).toBe(75);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        inTransaction((client) =>
          repo.refundActionCharge({ client, chargeId, reason: 'need expired unawarded' }),
        ),
      ),
    );

    expect(results.filter((r) => r.outcome === 'refunded')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'already_refunded')).toHaveLength(4);
    expect(await balanceOf(pool, userId)).toBe(100);

    const refunds = await countRows(
      pool,
      `SELECT count(*)::text c FROM transactions WHERE user_id = $1 AND type = 'refund'`,
      [userId],
    );
    expect(refunds).toBe(1);

    const { rows } = await pool.query<{
      refunded_at: string | null;
      refund_transaction_id: string;
    }>(`SELECT refunded_at::text, refund_transaction_id FROM mhc_action_charges WHERE id = $1`, [
      chargeId,
    ]);
    expect(rows[0]!.refunded_at).not.toBeNull();
    expect(rows[0]!.refund_transaction_id).not.toBeNull();
  }, 120_000);

  // -- 7 ---------------------------------------------------------------------
  it('leaves the charge unrefunded when the caller rolls the refund back', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const chargeId = await chargeOnce(userId);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const refunded = await repo.refundActionCharge({
        client,
        chargeId,
        reason: 'operator error',
      });
      expect(refunded.outcome).toBe('refunded');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await balanceOf(pool, userId)).toBe(75);
    const refunds = await countRows(
      pool,
      `SELECT count(*)::text c FROM transactions WHERE user_id = $1 AND type = 'refund'`,
      [userId],
    );
    expect(refunds).toBe(0);

    const { rows } = await pool.query<{ refunded_at: string | null }>(
      `SELECT refunded_at::text FROM mhc_action_charges WHERE id = $1`,
      [chargeId],
    );
    expect(rows[0]!.refunded_at).toBeNull();
  });

  it('balances the ledger exactly after a charge and its refund', async () => {
    const { userId } = await seedProvider(pool, { mhc: 100 });
    const chargeId = await chargeOnce(userId);
    await inTransaction((client) =>
      repo.refundActionCharge({ client, chargeId, reason: 'need expired unawarded' }),
    );

    const { rows } = await pool.query<{ delta: string }>(
      `SELECT COALESCE(sum(balance_delta), 0)::text AS delta FROM transactions WHERE user_id = $1`,
      [userId],
    );
    expect(100 + parseFloat(rows[0]!.delta)).toBe(await balanceOf(pool, userId));
    expect(await balanceOf(pool, userId)).toBe(100);
  });
});

describe.skipIf(!pgIntegrationEnabled())('P0-07 migration against real PostgreSQL', () => {
  // -- 8 ---------------------------------------------------------------------
  it('applies twice without error', async () => {
    await scratch.exec(readMigration(CHARGE_MIGRATION));
    await scratch.exec(readMigration(CHARGE_MIGRATION));

    const { rows } = await pool.query<{ t: string | null }>(
      `SELECT to_regclass('public.mhc_action_charges')::text AS t`,
    );
    expect(rows[0]!.t).toBe('mhc_action_charges');
  }, 180_000);

  // -- 9 ---------------------------------------------------------------------
  it('creates every intended constraint and index', async () => {
    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'mhc_action_charges'
       ORDER BY indexname`,
    );
    expect(indexes.map((r) => r.indexname)).toEqual([
      'idx_mhc_action_charges_reference',
      'idx_mhc_action_charges_transaction',
      'idx_mhc_action_charges_unrefunded',
      'idx_mhc_action_charges_user',
      'mhc_action_charges_pkey',
      'uq_mhc_action_charge_idempotency',
      'uq_mhc_action_charge_reference',
    ]);

    const { rows: constraints } = await pool.query<{ conname: string; def: string }>(
      `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       WHERE c.conrelid = 'public.mhc_action_charges'::regclass
       ORDER BY c.conname`,
    );
    const byName = new Map(constraints.map((r) => [r.conname, r.def]));
    expect(byName.get('chk_mhc_action_charge_refund_shape')).toContain('refund_transaction_id');
    expect(byName.get('mhc_action_charges_mhc_charged_check')).toContain('mhc_charged >=');
    expect(byName.get('mhc_action_charges_user_id_fkey')).toContain('ON DELETE RESTRICT');
    expect(byName.get('mhc_action_charges_transaction_id_fkey')).toContain('ON DELETE RESTRICT');

    // The unique index really is on the natural key, not merely present.
    const { rows: uq } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_mhc_action_charge_reference'`,
    );
    expect(uq[0]!.indexdef).toMatch(/UNIQUE INDEX .* \(action_key, reference_type, reference_id\)/);

    const { rows: idem } = await pool.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_mhc_action_charge_idempotency'`,
    );
    // Scoped per user: an unrelated provider cannot be blocked by a shared string.
    expect(idem[0]!.indexdef).toMatch(/\(user_id, action_key, idempotency_key\)/);
    expect(idem[0]!.indexdef).toMatch(/WHERE \(idempotency_key IS NOT NULL\)/);
  });

  // -- 10 --------------------------------------------------------------------
  it('runs the documented rollback twice on a scratch copy', async () => {
    const copy = await createScratchDatabase('rollback');
    try {
      const before = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.mhc_action_charges')::text AS t`,
      );
      expect(before.rows[0]!.t).toBe('mhc_action_charges');

      await copy.exec(ROLLBACK_SQL);
      await copy.exec(ROLLBACK_SQL);

      const after = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.mhc_action_charges')::text AS t`,
      );
      expect(after.rows[0]!.t).toBeNull();

      // Nothing else went with it: the ledger the table referenced survives.
      const survivors = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.transactions')::text AS t`,
      );
      expect(survivors.rows[0]!.t).toBe('transactions');

      const activations = await copy.pool.query<{ t: string | null }>(
        `SELECT to_regclass('public.mhc_job_activations')::text AS t`,
      );
      expect(activations.rows[0]!.t).toBe('mhc_job_activations');
    } finally {
      await copy.drop();
    }
  }, 900_000);
});
