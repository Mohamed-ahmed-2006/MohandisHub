// ---------------------------------------------------------------------------
// Wallet repository — database access layer
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

type WalletRow = {
  id: string;
  user_id: string;
  balance: string;
  currency: string;
  is_frozen: boolean;
  created_at: string;
  updated_at: string;
};

type TransactionRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  type: string;
  amount: string;
  balance_after: string;
  status: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

type DepositRequestRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  amount: string;
  currency: string;
  order_id: string;
  cryptomus_uuid: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

type WalletHoldRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  amount: string;
  currency: string;
  status: string;
  reference_type: string;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  released_at: string | null;
  captured_at: string | null;
};

export class WalletRepository {
  private get db(): Pool {
    return getPool();
  }

  async findByUserId(userId: string): Promise<WalletRow | null> {
    const { rows } = await this.db.query<WalletRow>(
      `SELECT id, user_id, balance::text, currency, is_frozen, created_at, updated_at
       FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async createForUser(userId: string): Promise<WalletRow> {
    const { rows } = await this.db.query<WalletRow>(
      `INSERT INTO wallets (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id
       RETURNING id, user_id, balance::text, currency, is_frozen, created_at, updated_at`,
      [userId],
    );
    return rows[0]!;
  }

  async listTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: TransactionRow[]; total: number }> {
    const offset = (page - 1) * limit;

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const { rows } = await this.db.query<TransactionRow>(
      `SELECT id, wallet_id, user_id, type, amount::text, balance_after::text, status,
              description, reference_type, reference_id, metadata, created_by, created_at
       FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );

    return { rows, total };
  }

  async createDepositRequest(
    userId: string,
    walletId: string,
    amount: number,
    currency: string,
    orderId: string,
  ): Promise<DepositRequestRow> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `INSERT INTO deposit_requests (user_id, wallet_id, amount, currency, order_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, wallet_id, amount::text, currency, order_id, cryptomus_uuid, status, created_at, updated_at`,
      [userId, walletId, amount, currency, orderId],
    );
    return rows[0]!;
  }

  async findDepositRequestByOrderId(orderId: string): Promise<DepositRequestRow | null> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `SELECT id, user_id, wallet_id, amount::text, currency, order_id, cryptomus_uuid, status, created_at, updated_at
       FROM deposit_requests WHERE order_id = $1`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  async updateDepositRequestStatus(
    orderId: string,
    status: string,
    cryptomusUuid?: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE deposit_requests SET status = $1, cryptomus_uuid = COALESCE($2, cryptomus_uuid) WHERE order_id = $3`,
      [status, cryptomusUuid ?? null, orderId],
    );
  }

  async creditWallet(
    walletId: string,
    userId: string,
    amount: number,
    description: string,
    referenceType: string,
    referenceId: string | null,
  ): Promise<void> {
    return this.creditWithType(walletId, userId, amount, 'deposit', description, referenceType, referenceId);
  }

  /** Credit wallet with a specific transaction type (e.g. deposit, payment, commission) */
  async creditWithType(
    walletId: string,
    userId: string,
    amount: number,
    txType:
      | 'deposit'
      | 'payment'
      | 'commission'
      | 'adjustment'
      | 'bonus'
      | 'refund'
      | 'hold'
      | 'release',
    description: string,
    referenceType: string,
    referenceId: string | null,
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING balance::text`,
        [amount, walletId],
      );
      if (walletRows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Wallet not found');
      }
      const balanceAfter = parseFloat(walletRows[0]!.balance);
      
      // Check schema if reference_id is UUID or text. It's usually text, but if it was defined as UUID, we need to pass NULL if it's not a valid UUID.
      // In MohandisHub schema it is defined as: reference_id UUID
      // So if referenceId is a Stripe string like 'cs_test_...', we cannot store it here without a cast error.
      // We will store it in metadata if it's not a valid UUID.
      let validReferenceId: string | null = null;
      let extraMetadata = {};
      if (referenceId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(referenceId)) {
          validReferenceId = referenceId;
        } else {
          extraMetadata = { original_reference_id: referenceId };
        }
      }

      await client.query(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9)`,
        [walletId, userId, txType, amount, balanceAfter, description, referenceType, validReferenceId, extraMetadata],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Debit wallet (for customer payment). Throws if insufficient balance. */
  async debitWallet(
    walletId: string,
    userId: string,
    amount: number,
    description: string,
    referenceType: string,
    referenceId: string | null,
  ): Promise<string> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: walletRows } = await client.query<{ balance: string; id: string }>(
        `SELECT id, balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
        [walletId],
      );
      if (walletRows.length === 0) {
        await client.query('ROLLBACK');
        throw new Error('Wallet not found');
      }
      const currentBalance = parseFloat(walletRows[0]!.balance);
      if (currentBalance < amount) {
        await client.query('ROLLBACK');
        throw new Error('INSUFFICIENT_BALANCE');
      }
      const balanceAfter = currentBalance - amount;
      await client.query(
        `UPDATE wallets SET balance = balance - $1 WHERE id = $2`,
        [amount, walletId],
      );

      let validReferenceId: string | null = null;
      let extraMetadata = {};
      if (referenceId) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(referenceId)) {
          validReferenceId = referenceId;
        } else {
          extraMetadata = { original_reference_id: referenceId };
        }
      }

      const { rows: txRows } = await client.query<{ id: string }>(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
         VALUES ($1, $2, 'payment', $3, $4, 'completed', $5, $6, $7, $8)
         RETURNING id`,
        [walletId, userId, amount, balanceAfter, description, referenceType, validReferenceId, extraMetadata],
      );
      await client.query('COMMIT');
      return txRows[0]!.id;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async findWalletByUserId(userId: string): Promise<{ id: string; balance: string } | null> {
    const { rows } = await this.db.query<{ id: string; balance: string }>(
      `SELECT id, balance::text FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  /** Get or create wallet for commission receiver. Must be called within transaction. */
  async getOrCreateCommissionWallet(client: PoolClient, receiverId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM wallets WHERE user_id = $1`,
      [receiverId],
    );
    if (rows.length === 0) {
      const ins = await client.query<{ id: string }>(
        `INSERT INTO wallets (user_id) VALUES ($1) RETURNING id`,
        [receiverId],
      );
      return ins.rows[0]!.id;
    }
    return rows[0]!.id;
  }

  /** Backward-compatible alias for platform commission wallet. */
  async getOrCreatePlatformWallet(client: PoolClient): Promise<string> {
    return this.getOrCreateCommissionWallet(client, PLATFORM_USER_ID);
  }

  /** Debit wallet within existing transaction. Returns payment transaction id. */
  async debitWalletInTransaction(
    client: PoolClient,
    walletId: string,
    userId: string,
    amount: number,
    description: string,
    referenceType: string,
    referenceId: string | null,
  ): Promise<string> {
    const { rows: lockRows } = await client.query<{ balance: string }>(
      `SELECT balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId],
    );
    if (lockRows.length === 0) throw new Error('Wallet not found');
    const currentBalance = parseFloat(lockRows[0]!.balance);
    if (currentBalance < amount) throw new Error('INSUFFICIENT_BALANCE');
    const balanceAfter = currentBalance - amount;
    await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [balanceAfter, walletId]);

    let validReferenceId: string | null = null;
    let extraMetadata = {};
    if (referenceId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(referenceId)) {
        validReferenceId = referenceId;
      } else {
        extraMetadata = { original_reference_id: referenceId };
      }
    }

    const { rows: txRows } = await client.query<{ id: string }>(
      `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
       VALUES ($1, $2, 'payment', $3, $4, 'completed', $5, $6, $7, $8) RETURNING id`,
      [walletId, userId, amount, balanceAfter, description, referenceType, validReferenceId, extraMetadata],
    );
    return txRows[0]!.id;
  }

  /** Credit wallet within existing transaction (payment or commission). */
  async creditWithTypeInTransaction(
    client: PoolClient,
    walletId: string,
    userId: string,
    amount: number,
    txType: 'payment' | 'commission' | 'refund' | 'release' | 'hold',
    description: string,
    referenceType: string,
    referenceId: string | null,
  ): Promise<void> {
    const { rows: walletRows } = await client.query<{ balance: string }>(
      `UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING balance::text`,
      [amount, walletId],
    );
    if (walletRows.length === 0) throw new Error('Wallet not found');
    const balanceAfter = parseFloat(walletRows[0]!.balance);

    let validReferenceId: string | null = null;
    let extraMetadata = {};
    if (referenceId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(referenceId)) {
        validReferenceId = referenceId;
      } else {
        extraMetadata = { original_reference_id: referenceId };
      }
    }

    await client.query(
      `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9)`,
      [walletId, userId, txType, amount, balanceAfter, description, referenceType, validReferenceId, extraMetadata],
    );
  }

  async findWalletHoldById(id: string): Promise<WalletHoldRow | null> {
    const { rows } = await this.db.query<WalletHoldRow>(
      `SELECT id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
              created_at, updated_at, released_at, captured_at
       FROM wallet_holds
       WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createHoldInTransaction(
    client: PoolClient,
    walletId: string,
    userId: string,
    amount: number,
    currency: string,
    referenceType: string,
    referenceId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<WalletHoldRow> {
    const { rows: lockRows } = await client.query<{ balance: string }>(
      `SELECT balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId],
    );
    if (lockRows.length === 0) throw new Error('Wallet not found');
    const currentBalance = parseFloat(lockRows[0]!.balance);
    if (currentBalance < amount) throw new Error('INSUFFICIENT_BALANCE');
    const balanceAfter = currentBalance - amount;

    await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [balanceAfter, walletId]);

    await client.query(
      `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
       VALUES ($1, $2, 'hold', $3, $4, 'completed', $5, $6, $7, $8)`,
      [
        walletId,
        userId,
        amount,
        balanceAfter,
        `Hold created for ${referenceType}`,
        referenceType,
        referenceId,
        metadata,
      ],
    );

    const { rows } = await client.query<WalletHoldRow>(
      `INSERT INTO wallet_holds (wallet_id, user_id, amount, currency, status, reference_type, reference_id, metadata)
       VALUES ($1, $2, $3, $4, 'held', $5, $6, $7)
       RETURNING id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
                 created_at, updated_at, released_at, captured_at`,
      [walletId, userId, amount, currency, referenceType, referenceId, metadata],
    );
    return rows[0]!;
  }

  async releaseHoldInTransaction(
    client: PoolClient,
    holdId: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<WalletHoldRow> {
    const { rows: holdRows } = await client.query<WalletHoldRow>(
      `SELECT id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
              created_at, updated_at, released_at, captured_at
       FROM wallet_holds
       WHERE id = $1
       FOR UPDATE`,
      [holdId],
    );
    if (holdRows.length === 0) throw new Error('HOLD_NOT_FOUND');
    const hold = holdRows[0]!;
    if (hold.status !== 'held') return hold;

    const { rows: walletRows } = await client.query<{ balance: string }>(
      `UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING balance::text`,
      [hold.amount, hold.wallet_id],
    );
    const balanceAfter = parseFloat(walletRows[0]!.balance);

    await client.query(
      `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
       VALUES ($1, $2, 'release', $3, $4, 'completed', $5, $6, $7, $8)`,
      [
        hold.wallet_id,
        hold.user_id,
        parseFloat(hold.amount),
        balanceAfter,
        reason,
        hold.reference_type,
        hold.reference_id,
        metadata,
      ],
    );

    const { rows } = await client.query<WalletHoldRow>(
      `UPDATE wallet_holds
       SET status = 'released', released_at = now(), updated_at = now(), metadata = metadata || $2::jsonb
       WHERE id = $1
       RETURNING id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
                 created_at, updated_at, released_at, captured_at`,
      [holdId, JSON.stringify(metadata)],
    );
    return rows[0]!;
  }

  async captureHoldInTransaction(
    client: PoolClient,
    holdId: string,
    reason: string,
    metadata: Record<string, unknown> = {},
  ): Promise<WalletHoldRow> {
    const { rows: holdRows } = await client.query<WalletHoldRow>(
      `SELECT id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
              created_at, updated_at, released_at, captured_at
       FROM wallet_holds
       WHERE id = $1
       FOR UPDATE`,
      [holdId],
    );
    if (holdRows.length === 0) throw new Error('HOLD_NOT_FOUND');
    const hold = holdRows[0]!;
    if (hold.status !== 'held') return hold;

    const { rows } = await client.query<WalletHoldRow>(
      `UPDATE wallet_holds
       SET status = 'captured', captured_at = now(), updated_at = now(), metadata = metadata || $2::jsonb
       WHERE id = $1
       RETURNING id, wallet_id, user_id, amount::text, currency, status, reference_type, reference_id, metadata,
                 created_at, updated_at, released_at, captured_at`,
      [holdId, JSON.stringify({ ...metadata, capture_reason: reason })],
    );
    return rows[0]!;
  }
}

export type { WalletRow, TransactionRow, DepositRequestRow, WalletHoldRow };
