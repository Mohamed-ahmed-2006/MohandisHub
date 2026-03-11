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
  provider: string;
  provider_payment_id: string | null;
  provider_invoice_id: string | null;
  provider_purchase_id: string | null;
  provider_parent_payment_id: string | null;
  provider_status: string | null;
  provider_payload: Record<string, unknown>;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

type ExpertPayoutSettingsRow = {
  payout_currency: string | null;
  payout_address: string | null;
  payout_extra_id: string | null;
  payout_updated_at: string | null;
};

type WithdrawalRequestRow = {
  id: string;
  user_id: string;
  wallet_id: string;
  hold_id: string | null;
  amount: string;
  currency: string;
  payout_address: string | null;
  payout_extra_id: string | null;
  status: string;
  provider: string;
  provider_batch_withdrawal_id: string | null;
  provider_withdrawal_id: string | null;
  provider_status: string | null;
  provider_error: string | null;
  provider_payload: Record<string, unknown>;
  verification_required: boolean;
  verified_at: string | null;
  processed_at: string | null;
  failed_at: string | null;
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

  private splitReferenceId(referenceId: string | null): {
    validReferenceId: string | null;
    metadata: Record<string, unknown>;
  } {
    if (!referenceId) return { validReferenceId: null, metadata: {} };
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(referenceId)) {
      return { validReferenceId: referenceId, metadata: {} };
    }
    return { validReferenceId: null, metadata: { original_reference_id: referenceId } };
  }

  private depositSelectColumns = `id, user_id, wallet_id, amount::text, currency, order_id, cryptomus_uuid, status,
    provider, provider_payment_id, provider_invoice_id, provider_purchase_id, provider_parent_payment_id,
    provider_status, provider_payload, paid_at, created_at, updated_at`;

  private withdrawalSelectColumns = `id, user_id, wallet_id, hold_id, amount::text, currency, payout_address,
    payout_extra_id, status, provider, provider_batch_withdrawal_id, provider_withdrawal_id, provider_status,
    provider_error, provider_payload, verification_required, verified_at, processed_at, failed_at, created_at, updated_at`;

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
    provider: string = 'legacy',
    providerInvoiceId: string | null = null,
    providerPayload: Record<string, unknown> = {},
  ): Promise<DepositRequestRow> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `INSERT INTO deposit_requests (
        user_id, wallet_id, amount, currency, order_id, provider, provider_invoice_id, provider_payload
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       RETURNING ${this.depositSelectColumns}`,
      [userId, walletId, amount, currency, orderId, provider, providerInvoiceId, JSON.stringify(providerPayload)],
    );
    return rows[0]!;
  }

  async findDepositRequestByOrderId(orderId: string): Promise<DepositRequestRow | null> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `SELECT ${this.depositSelectColumns}
       FROM deposit_requests WHERE order_id = $1`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  async findDepositRequestByProviderPaymentId(
    providerPaymentId: string,
  ): Promise<DepositRequestRow | null> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `SELECT ${this.depositSelectColumns}
       FROM deposit_requests
       WHERE provider_payment_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [providerPaymentId],
    );
    return rows[0] ?? null;
  }

  async updateDepositProviderStateByOrderId(params: {
    orderId: string;
    providerStatus: string | null;
    providerPaymentId?: string | null;
    providerInvoiceId?: string | null;
    providerPurchaseId?: string | null;
    providerParentPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
  }): Promise<DepositRequestRow | null> {
    const { rows } = await this.db.query<DepositRequestRow>(
      `UPDATE deposit_requests
       SET provider_status = COALESCE($2, provider_status),
           provider_payment_id = COALESCE($3, provider_payment_id),
           provider_invoice_id = COALESCE($4, provider_invoice_id),
           provider_purchase_id = COALESCE($5, provider_purchase_id),
           provider_parent_payment_id = COALESCE($6, provider_parent_payment_id),
           provider_payload = provider_payload || COALESCE($7::jsonb, '{}'::jsonb),
           updated_at = now()
       WHERE order_id = $1
       RETURNING ${this.depositSelectColumns}`,
      [
        params.orderId,
        params.providerStatus ?? null,
        params.providerPaymentId ?? null,
        params.providerInvoiceId ?? null,
        params.providerPurchaseId ?? null,
        params.providerParentPaymentId ?? null,
        params.providerPayload ? JSON.stringify(params.providerPayload) : null,
      ],
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

  async creditDepositIfPendingByOrderId(params: {
    orderId: string;
    providerStatus: string;
    referenceType: string;
    referenceId: string | null;
    description: string;
    providerPaymentId?: string | null;
    providerInvoiceId?: string | null;
    providerPurchaseId?: string | null;
    providerParentPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
  }): Promise<{ credited: boolean; row: DepositRequestRow | null }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: depositRows } = await client.query<DepositRequestRow>(
        `SELECT ${this.depositSelectColumns}
         FROM deposit_requests
         WHERE order_id = $1
         FOR UPDATE`,
        [params.orderId],
      );
      const deposit = depositRows[0] ?? null;
      if (!deposit) {
        await client.query('ROLLBACK');
        return { credited: false, row: null };
      }

      await client.query(
        `UPDATE deposit_requests
         SET provider_status = COALESCE($2, provider_status),
             provider_payment_id = COALESCE($3, provider_payment_id),
             provider_invoice_id = COALESCE($4, provider_invoice_id),
             provider_purchase_id = COALESCE($5, provider_purchase_id),
             provider_parent_payment_id = COALESCE($6, provider_parent_payment_id),
             provider_payload = provider_payload || COALESCE($7::jsonb, '{}'::jsonb),
             updated_at = now()
         WHERE id = $1`,
        [
          deposit.id,
          params.providerStatus,
          params.providerPaymentId ?? null,
          params.providerInvoiceId ?? null,
          params.providerPurchaseId ?? null,
          params.providerParentPaymentId ?? null,
          params.providerPayload ? JSON.stringify(params.providerPayload) : null,
        ],
      );

      if (deposit.status !== 'pending') {
        const { rows: currentRows } = await client.query<DepositRequestRow>(
          `SELECT ${this.depositSelectColumns}
           FROM deposit_requests WHERE id = $1`,
          [deposit.id],
        );
        await client.query('COMMIT');
        return { credited: false, row: currentRows[0] ?? deposit };
      }

      const amount = parseFloat(deposit.amount);
      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $1 WHERE id = $2 RETURNING balance::text`,
        [amount, deposit.wallet_id],
      );
      if (walletRows.length === 0) {
        throw new Error('Wallet not found');
      }
      const balanceAfter = parseFloat(walletRows[0]!.balance);
      const reference = this.splitReferenceId(params.referenceId);
      const metadata = {
        ...reference.metadata,
        provider_status: params.providerStatus,
        provider_payment_id: params.providerPaymentId ?? null,
        provider_invoice_id: params.providerInvoiceId ?? null,
        provider_purchase_id: params.providerPurchaseId ?? null,
      };
      await client.query(
        `INSERT INTO transactions (
          wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata
        ) VALUES ($1, $2, 'deposit', $3, $4, 'completed', $5, $6, $7, $8)`,
        [
          deposit.wallet_id,
          deposit.user_id,
          amount,
          balanceAfter,
          params.description,
          params.referenceType,
          reference.validReferenceId,
          metadata,
        ],
      );
      await client.query(
        `UPDATE deposit_requests
         SET status = 'paid', paid_at = now(), updated_at = now()
         WHERE id = $1`,
        [deposit.id],
      );
      const { rows: updatedRows } = await client.query<DepositRequestRow>(
        `SELECT ${this.depositSelectColumns}
         FROM deposit_requests WHERE id = $1`,
        [deposit.id],
      );
      await client.query('COMMIT');
      return { credited: true, row: updatedRows[0] ?? null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
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

  async getExpertPayoutSettings(userId: string): Promise<ExpertPayoutSettingsRow | null> {
    const { rows } = await this.db.query<ExpertPayoutSettingsRow>(
      `SELECT payout_currency, payout_address, payout_extra_id, payout_updated_at
       FROM expert_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async updateExpertPayoutSettings(
    userId: string,
    params: {
      payoutCurrency: string;
      payoutAddress: string;
      payoutExtraId?: string | null;
    },
  ): Promise<ExpertPayoutSettingsRow | null> {
    const { rows } = await this.db.query<ExpertPayoutSettingsRow>(
      `UPDATE expert_profiles
       SET payout_currency = $2,
           payout_address = $3,
           payout_extra_id = $4,
           payout_updated_at = now()
       WHERE user_id = $1
       RETURNING payout_currency, payout_address, payout_extra_id, payout_updated_at`,
      [userId, params.payoutCurrency, params.payoutAddress, params.payoutExtraId ?? null],
    );
    return rows[0] ?? null;
  }

  async createWithdrawalRequestWithHold(params: {
    userId: string;
    amount: number;
    currency: string;
    payoutAddress: string;
    payoutExtraId?: string | null;
    verificationRequired: boolean;
    providerPayload?: Record<string, unknown>;
  }): Promise<WithdrawalRequestRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: walletRows } = await client.query<{ id: string }>(
        `SELECT id FROM wallets WHERE user_id = $1 LIMIT 1`,
        [params.userId],
      );
      if (walletRows.length === 0) {
        throw new Error('WALLET_NOT_FOUND');
      }
      const walletId = walletRows[0]!.id;
      const hold = await this.createHoldInTransaction(
        client,
        walletId,
        params.userId,
        params.amount,
        'EGP',
        'withdrawal_request',
        null,
        {
          payout_currency: params.currency,
          payout_address: params.payoutAddress,
        },
      );
      const { rows } = await client.query<WithdrawalRequestRow>(
        `INSERT INTO withdrawal_requests (
          user_id, wallet_id, hold_id, amount, currency, payout_address, payout_extra_id,
          status, provider, verification_required, provider_payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_verification', 'nowpayments', $8, $9::jsonb)
        RETURNING ${this.withdrawalSelectColumns}`,
        [
          params.userId,
          walletId,
          hold.id,
          params.amount,
          params.currency,
          params.payoutAddress,
          params.payoutExtraId ?? null,
          params.verificationRequired,
          JSON.stringify(params.providerPayload ?? {}),
        ],
      );
      const row = rows[0]!;
      await client.query(`UPDATE wallet_holds SET reference_id = $2 WHERE id = $1`, [hold.id, row.id]);
      await client.query('COMMIT');
      return row;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async listWithdrawalRequestsByUserId(userId: string): Promise<WithdrawalRequestRow[]> {
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `SELECT ${this.withdrawalSelectColumns}
       FROM withdrawal_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async findWithdrawalRequestByIdForUser(
    withdrawalId: string,
    userId: string,
  ): Promise<WithdrawalRequestRow | null> {
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `SELECT ${this.withdrawalSelectColumns}
       FROM withdrawal_requests
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [withdrawalId, userId],
    );
    return rows[0] ?? null;
  }

  async findWithdrawalRequestByProviderIds(params: {
    batchWithdrawalId?: string | null;
    withdrawalId?: string | null;
  }): Promise<WithdrawalRequestRow | null> {
    if (!params.batchWithdrawalId && !params.withdrawalId) return null;
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `SELECT ${this.withdrawalSelectColumns}
       FROM withdrawal_requests
       WHERE (
         ($1::text IS NOT NULL AND provider_batch_withdrawal_id = $1::text)
         OR ($2::text IS NOT NULL AND provider_withdrawal_id = $2::text)
       )
       ORDER BY created_at DESC
       LIMIT 1`,
      [params.batchWithdrawalId ?? null, params.withdrawalId ?? null],
    );
    return rows[0] ?? null;
  }

  async setWithdrawalAfterPayoutCreate(params: {
    withdrawalId: string;
    batchWithdrawalId?: string | null;
    providerWithdrawalId?: string | null;
    providerStatus?: string | null;
    providerPayload?: Record<string, unknown>;
    status: 'pending_verification' | 'processing';
  }): Promise<WithdrawalRequestRow | null> {
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `UPDATE withdrawal_requests
       SET provider_batch_withdrawal_id = COALESCE($2, provider_batch_withdrawal_id),
           provider_withdrawal_id = COALESCE($3, provider_withdrawal_id),
           provider_status = COALESCE($4, provider_status),
           provider_payload = provider_payload || COALESCE($5::jsonb, '{}'::jsonb),
           provider_error = NULL,
           status = $6,
           updated_at = now()
       WHERE id = $1
       RETURNING ${this.withdrawalSelectColumns}`,
      [
        params.withdrawalId,
        params.batchWithdrawalId ?? null,
        params.providerWithdrawalId ?? null,
        params.providerStatus ?? null,
        params.providerPayload ? JSON.stringify(params.providerPayload) : null,
        params.status,
      ],
    );
    return rows[0] ?? null;
  }

  async setWithdrawalBlocked(params: {
    withdrawalId: string;
    error: string;
    providerStatus?: string | null;
    providerPayload?: Record<string, unknown>;
  }): Promise<WithdrawalRequestRow | null> {
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `UPDATE withdrawal_requests
       SET status = 'blocked',
           provider_status = COALESCE($3, provider_status),
           provider_error = $2,
           provider_payload = provider_payload || COALESCE($4::jsonb, '{}'::jsonb),
           updated_at = now()
       WHERE id = $1
       RETURNING ${this.withdrawalSelectColumns}`,
      [
        params.withdrawalId,
        params.error,
        params.providerStatus ?? null,
        params.providerPayload ? JSON.stringify(params.providerPayload) : null,
      ],
    );
    return rows[0] ?? null;
  }

  async markWithdrawalVerified(
    withdrawalId: string,
    providerStatus: string | null,
    providerPayload?: Record<string, unknown>,
  ): Promise<WithdrawalRequestRow | null> {
    const { rows } = await this.db.query<WithdrawalRequestRow>(
      `UPDATE withdrawal_requests
       SET status = 'processing',
           verified_at = now(),
           provider_status = COALESCE($2, provider_status),
           provider_payload = provider_payload || COALESCE($3::jsonb, '{}'::jsonb),
           updated_at = now()
       WHERE id = $1
       RETURNING ${this.withdrawalSelectColumns}`,
      [
        withdrawalId,
        providerStatus,
        providerPayload ? JSON.stringify(providerPayload) : null,
      ],
    );
    return rows[0] ?? null;
  }

  async applyWithdrawalWebhookStatus(params: {
    batchWithdrawalId?: string | null;
    withdrawalId?: string | null;
    providerStatus: string;
    providerPayload?: Record<string, unknown>;
  }): Promise<{ updated: boolean; status: string | null; row: WithdrawalRequestRow | null }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: wrRows } = await client.query<WithdrawalRequestRow>(
        `SELECT ${this.withdrawalSelectColumns}
         FROM withdrawal_requests
         WHERE (
           ($1::text IS NOT NULL AND provider_batch_withdrawal_id = $1::text)
           OR ($2::text IS NOT NULL AND provider_withdrawal_id = $2::text)
         )
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [params.batchWithdrawalId ?? null, params.withdrawalId ?? null],
      );
      const row = wrRows[0] ?? null;
      if (!row) {
        await client.query('ROLLBACK');
        return { updated: false, status: null, row: null };
      }

      await client.query(
        `UPDATE withdrawal_requests
         SET provider_status = $2,
             provider_payload = provider_payload || COALESCE($3::jsonb, '{}'::jsonb),
             updated_at = now()
         WHERE id = $1`,
        [row.id, params.providerStatus, params.providerPayload ? JSON.stringify(params.providerPayload) : null],
      );

      const terminalStatuses = new Set(['finished', 'failed', 'rejected', 'cancelled']);
      if (terminalStatuses.has(row.status)) {
        const { rows: refreshed } = await client.query<WithdrawalRequestRow>(
          `SELECT ${this.withdrawalSelectColumns}
           FROM withdrawal_requests WHERE id = $1`,
          [row.id],
        );
        await client.query('COMMIT');
        return { updated: false, status: refreshed[0]?.status ?? row.status, row: refreshed[0] ?? row };
      }

      const normalizedProviderStatus = params.providerStatus.toLowerCase();
      if (normalizedProviderStatus === 'finished') {
        if (row.hold_id) {
          await this.captureHoldInTransaction(client, row.hold_id, 'Withdrawal payout finished', {
            provider_status: params.providerStatus,
          });
        }
        const { rows: walletRows } = await client.query<{ balance: string }>(
          `SELECT balance::text FROM wallets WHERE id = $1`,
          [row.wallet_id],
        );
        const balanceAfter = parseFloat(walletRows[0]?.balance ?? '0');
        const ref = this.splitReferenceId(row.provider_withdrawal_id ?? params.withdrawalId ?? null);
        const metadata = {
          ...ref.metadata,
          provider_batch_withdrawal_id: row.provider_batch_withdrawal_id,
          provider_withdrawal_id: row.provider_withdrawal_id,
          provider_status: params.providerStatus,
        };
        await client.query(
          `INSERT INTO transactions (
            wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata
          ) VALUES ($1, $2, 'withdrawal', $3, $4, 'completed', $5, 'nowpayments_payout', $6, $7)`,
          [
            row.wallet_id,
            row.user_id,
            parseFloat(row.amount),
            balanceAfter,
            'Freelancer withdrawal payout',
            ref.validReferenceId,
            metadata,
          ],
        );
        await client.query(
          `UPDATE withdrawal_requests
           SET status = 'finished',
               processed_at = COALESCE(processed_at, now()),
               updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
      } else if (
        normalizedProviderStatus === 'failed' ||
        normalizedProviderStatus === 'rejected' ||
        normalizedProviderStatus === 'cancelled'
      ) {
        if (row.hold_id) {
          await this.releaseHoldInTransaction(client, row.hold_id, 'Withdrawal payout failed', {
            provider_status: params.providerStatus,
          });
        }
        await client.query(
          `UPDATE withdrawal_requests
           SET status = $2,
               failed_at = COALESCE(failed_at, now()),
               updated_at = now()
           WHERE id = $1`,
          [row.id, normalizedProviderStatus],
        );
      } else {
        await client.query(
          `UPDATE withdrawal_requests
           SET status = 'processing',
               updated_at = now()
           WHERE id = $1`,
          [row.id],
        );
      }

      const { rows: refreshed } = await client.query<WithdrawalRequestRow>(
        `SELECT ${this.withdrawalSelectColumns}
         FROM withdrawal_requests WHERE id = $1`,
        [row.id],
      );
      await client.query('COMMIT');
      return { updated: true, status: refreshed[0]?.status ?? null, row: refreshed[0] ?? null };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}

export type {
  WalletRow,
  TransactionRow,
  DepositRequestRow,
  WalletHoldRow,
  ExpertPayoutSettingsRow,
  WithdrawalRequestRow,
};
