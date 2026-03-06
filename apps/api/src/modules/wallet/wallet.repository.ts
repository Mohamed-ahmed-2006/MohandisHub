// ---------------------------------------------------------------------------
// Wallet repository — database access layer
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

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
       LIMIT $2 OFFSET $3`,
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
      await client.query(
        `INSERT INTO transactions (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id)
         VALUES ($1, $2, 'deposit', $3, $4, 'completed', $5, $6, $7)`,
        [walletId, userId, amount, balanceAfter, description, referenceType, referenceId],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export type { WalletRow, TransactionRow, DepositRequestRow };
