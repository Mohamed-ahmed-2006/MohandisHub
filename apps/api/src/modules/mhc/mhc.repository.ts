// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) repository — closed-loop provider credit
// ---------------------------------------------------------------------------
// MHC is a non-withdrawable, non-transferable platform credit stored in the
// shared wallets/transactions ledger under account_type = 'provider_credit'
// (asset_code = 'MHC'). Grants use type='deposit', spends use type='payment',
// and audited corrections use type='adjustment'. All balance mutations are
// performed inside a single transaction with row locking for correctness.
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

export type MhcWalletRow = {
  id: string;
  user_id: string;
  balance: string;
  is_frozen: boolean;
  created_at: string;
  updated_at: string;
};

export type MhcActionPriceRow = {
  id: string;
  action_key: string;
  name: string;
  mhc_price: string;
  is_active: boolean;
};

export type MhcCreditPackageRow = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  mhc_amount: string;
  external_price_amount: string;
  external_price_currency: string;
  is_active: boolean;
  sort_order: number;
};

export type CreditPurchaseRow = {
  id: string;
  user_id: string;
  order_id: string;
  status: string;
  provider: string;
  purpose: string;
  mhc_grant_amount: string | null;
  external_price_amount: string | null;
  external_price_currency: string | null;
  credit_package_id: string | null;
  credited_transaction_id: string | null;
  proof_upload_id?: string | null;
  transfer_reference?: string | null;
  created_at?: string;
};

export type MhcActivationRow = {
  id: string;
  activation_type: 'award' | 'booking';
  provider_user_id: string;
  acting_user_id: string;
  need_id: string | null;
  bid_id: string | null;
  reservation_id: string | null;
  action_key: string;
  mhc_charged: string;
  transaction_id: string | null;
  created_at: string;
};

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super('INSUFFICIENT_CREDITS');
    this.name = 'InsufficientCreditsError';
  }
}

export class MhcRepository {
  private get db(): Pool {
    return getPool();
  }

  private mhcWalletColumns = `id, user_id, balance::text, is_frozen, created_at, updated_at`;

  /** Get or create the MHC (provider_credit) wallet for a user. */
  async getOrCreateCreditWallet(userId: string): Promise<MhcWalletRow> {
    const { rows } = await this.db.query<MhcWalletRow>(
      `INSERT INTO wallets (user_id, currency, account_type, asset_code)
       VALUES ($1, 'EGP', 'provider_credit', 'MHC')
       ON CONFLICT (user_id, account_type) DO UPDATE SET user_id = wallets.user_id
       RETURNING ${this.mhcWalletColumns}`,
      [userId],
    );
    return rows[0]!;
  }

  private async getOrCreateCreditWalletInTx(
    client: PoolClient,
    userId: string,
  ): Promise<MhcWalletRow> {
    const { rows } = await client.query<MhcWalletRow>(
      `INSERT INTO wallets (user_id, currency, account_type, asset_code)
       VALUES ($1, 'EGP', 'provider_credit', 'MHC')
       ON CONFLICT (user_id, account_type) DO UPDATE SET user_id = wallets.user_id
       RETURNING ${this.mhcWalletColumns}`,
      [userId],
    );
    return rows[0]!;
  }

  async getBalance(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ balance: string }>(
      `SELECT balance::text FROM wallets
       WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );
    return parseFloat(rows[0]?.balance ?? '0');
  }

  async listTransactions(
    userId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const offset = (page - 1) * limit;
    const { rows: walletRows } = await this.db.query<{ id: string }>(
      `SELECT id FROM wallets WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );
    const walletId = walletRows[0]?.id;
    if (!walletId) return { rows: [], total: 0 };

    const countResult = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM transactions WHERE wallet_id = $1`,
      [walletId],
    );
    const total = parseInt(countResult.rows[0]!.count, 10);

    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT id, type, amount::text, balance_delta::text, balance_after::text, status,
              description, reference_type, reference_id, metadata, created_at
       FROM transactions WHERE wallet_id = $1
       ORDER BY created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [walletId, limit, offset],
    );
    return { rows, total };
  }

  // -------------------------------------------------------------------------
  // Credit packages
  // -------------------------------------------------------------------------
  async listCreditPackages(activeOnly = true): Promise<MhcCreditPackageRow[]> {
    const { rows } = await this.db.query<MhcCreditPackageRow>(
      `SELECT id, code, name, name_ar, mhc_amount::text, external_price_amount::text,
              external_price_currency, is_active, sort_order
       FROM mhc_credit_packages
       ${activeOnly ? 'WHERE is_active = true' : ''}
       ORDER BY sort_order, external_price_amount`,
    );
    return rows;
  }

  async findCreditPackageById(id: string): Promise<MhcCreditPackageRow | null> {
    const { rows } = await this.db.query<MhcCreditPackageRow>(
      `SELECT id, code, name, name_ar, mhc_amount::text, external_price_amount::text,
              external_price_currency, is_active, sort_order
       FROM mhc_credit_packages WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async upsertCreditPackage(params: {
    code: string;
    name: string;
    nameAr?: string | null;
    mhcAmount: number;
    externalPriceAmount: number;
    externalPriceCurrency?: string;
    isActive: boolean;
    sortOrder?: number;
  }): Promise<MhcCreditPackageRow> {
    const { rows } = await this.db.query<MhcCreditPackageRow>(
      `INSERT INTO mhc_credit_packages (
         code, name, name_ar, mhc_amount, external_price_amount, external_price_currency,
         is_active, sort_order
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name,
             name_ar = EXCLUDED.name_ar,
             mhc_amount = EXCLUDED.mhc_amount,
             external_price_amount = EXCLUDED.external_price_amount,
             external_price_currency = EXCLUDED.external_price_currency,
             is_active = EXCLUDED.is_active,
             sort_order = EXCLUDED.sort_order,
             updated_at = now()
       RETURNING id, code, name, name_ar, mhc_amount::text, external_price_amount::text,
                 external_price_currency, is_active, sort_order`,
      [
        params.code,
        params.name,
        params.nameAr ?? null,
        params.mhcAmount,
        params.externalPriceAmount,
        params.externalPriceCurrency ?? 'EGP',
        params.isActive,
        params.sortOrder ?? 0,
      ],
    );
    return rows[0]!;
  }

  // -------------------------------------------------------------------------
  // Credit purchases (deposit_requests with purpose = 'credit_purchase')
  // -------------------------------------------------------------------------
  /**
   * Create a pending MHC credit-purchase request. The MHC grant amount and the
   * external price are snapshotted from the package so later price changes never
   * retroactively alter an in-flight purchase.
   */
  async createCreditPurchase(params: {
    userId: string;
    orderId: string;
    provider: 'instapay_manual' | 'nowpayments';
    status: 'pending' | 'pending_review';
    pkg: MhcCreditPackageRow;
    proofUploadId?: string | null;
    transferReference?: string | null;
    destinationAccountSnapshot?: Record<string, unknown>;
    providerPayload?: Record<string, unknown>;
  }): Promise<{ id: string; order_id: string; status: string }> {
    const creditWallet = await this.getOrCreateCreditWallet(params.userId);
    const externalPrice = parseFloat(params.pkg.external_price_amount);
    const { rows } = await this.db.query<{ id: string; order_id: string; status: string }>(
      `INSERT INTO deposit_requests (
         user_id, wallet_id, amount, currency, order_id, provider, status,
         purpose, target_account_type, credit_package_id, mhc_grant_amount,
         external_price_amount, external_price_currency,
         proof_upload_id, transfer_reference, destination_account_snapshot, provider_payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7,
         'credit_purchase', 'provider_credit', $8, $9,
         $3, $4,
         $10, $11, $12::jsonb, $13::jsonb)
       RETURNING id, order_id, status`,
      [
        params.userId,
        creditWallet.id,
        externalPrice,
        params.pkg.external_price_currency,
        params.orderId,
        params.provider,
        params.status,
        params.pkg.id,
        parseFloat(params.pkg.mhc_amount),
        params.proofUploadId ?? null,
        params.transferReference ?? null,
        JSON.stringify(params.destinationAccountSnapshot ?? {}),
        JSON.stringify(params.providerPayload ?? {}),
      ],
    );
    return rows[0]!;
  }

  async findCreditPurchaseByOrderId(orderId: string): Promise<CreditPurchaseRow | null> {
    const { rows } = await this.db.query<CreditPurchaseRow>(
      `SELECT id, user_id, order_id, status, provider, purpose,
              mhc_grant_amount::text, external_price_amount::text, external_price_currency,
              credit_package_id, credited_transaction_id
       FROM deposit_requests
       WHERE order_id = $1 AND purpose = 'credit_purchase'`,
      [orderId],
    );
    return rows[0] ?? null;
  }

  async findCreditPurchaseById(id: string): Promise<CreditPurchaseRow | null> {
    const { rows } = await this.db.query<CreditPurchaseRow>(
      `SELECT id, user_id, order_id, status, provider, purpose,
              mhc_grant_amount::text, external_price_amount::text, external_price_currency,
              credit_package_id, credited_transaction_id
       FROM deposit_requests
       WHERE id = $1 AND purpose = 'credit_purchase'`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listCreditPurchasesForAdmin(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: CreditPurchaseRow[]; total: number }> {
    const filters = [`purpose = 'credit_purchase'`];
    const values: unknown[] = [];
    if (params.status) {
      values.push(params.status);
      filters.push(`status = $${values.length}`);
    }
    const where = `WHERE ${filters.join(' AND ')}`;

    const { rows: countRows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM deposit_requests ${where}`,
      values,
    );
    const total = parseInt(countRows[0]?.c ?? '0', 10);

    const { rows } = await this.db.query<CreditPurchaseRow>(
      `SELECT id, user_id, order_id, status, provider, purpose,
              mhc_grant_amount::text, external_price_amount::text, external_price_currency,
              credit_package_id, credited_transaction_id, proof_upload_id, transfer_reference,
              created_at
       FROM deposit_requests ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}::int OFFSET $${values.length + 2}::int`,
      [...values, params.limit, params.offset],
    );
    return { rows, total };
  }

  /**
   * Mark a credit purchase paid and grant the snapshotted MHC amount. Idempotent:
   * a purchase already in a terminal paid state is not granted twice.
   */
  async fulfillCreditPurchase(params: {
    purchaseId: string;
    reviewedBy?: string | null;
    providerStatus?: string | null;
    providerPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
    /** Overrides the snapshotted grant (e.g. admin corrects an underpayment). */
    overrideMhcAmount?: number | null;
  }): Promise<{ fulfilled: boolean; mhcGranted: number; balance: number } | null> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: purchaseRows } = await client.query<{
        id: string;
        user_id: string;
        status: string;
        mhc_grant_amount: string;
        order_id: string;
      }>(
        `SELECT id, user_id, status, mhc_grant_amount::text, order_id
         FROM deposit_requests
         WHERE id = $1 AND purpose = 'credit_purchase'
         FOR UPDATE`,
        [params.purchaseId],
      );
      const purchase = purchaseRows[0];
      if (!purchase) {
        await client.query('ROLLBACK');
        return null;
      }

      await client.query(
        `UPDATE deposit_requests
         SET provider_status = COALESCE($2, provider_status),
             provider_payment_id = COALESCE($3, provider_payment_id),
             provider_payload = provider_payload || COALESCE($4::jsonb, '{}'::jsonb),
             updated_at = now()
         WHERE id = $1`,
        [
          purchase.id,
          params.providerStatus ?? null,
          params.providerPaymentId ?? null,
          params.providerPayload ? JSON.stringify(params.providerPayload) : null,
        ],
      );

      // Already fulfilled — do not grant twice.
      if (purchase.status === 'paid' || purchase.status === 'completed') {
        await client.query('COMMIT');
        const balance = await this.getBalance(purchase.user_id);
        return { fulfilled: false, mhcGranted: 0, balance };
      }
      if (purchase.status === 'rejected' || purchase.status === 'cancelled') {
        await client.query('ROLLBACK');
        return null;
      }

      const mhcAmount =
        params.overrideMhcAmount != null && Number.isFinite(params.overrideMhcAmount)
          ? params.overrideMhcAmount
          : parseFloat(purchase.mhc_grant_amount);

      // Grant inside this same transaction for atomicity.
      const creditWallet = await this.getOrCreateCreditWalletInTx(client, purchase.user_id);
      const { rows: lockRows } = await client.query<{ balance: string }>(
        `SELECT balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
        [creditWallet.id],
      );
      const currentBalance = parseFloat(lockRows[0]!.balance);
      const balanceAfter = currentBalance + mhcAmount;

      await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [
        balanceAfter,
        creditWallet.id,
      ]);
      const { rows: txRows } = await client.query<{ id: string }>(
        `INSERT INTO transactions (
           wallet_id, user_id, type, amount, balance_delta, balance_after, status,
           description, reference_type, reference_id, metadata, created_by
         ) VALUES ($1, $2, 'deposit', $3, $3, $4, 'completed', $5, 'mhc_credit_purchase', $6, $7::jsonb, $8)
         RETURNING id`,
        [
          creditWallet.id,
          purchase.user_id,
          mhcAmount,
          balanceAfter,
          'MHC credit purchase',
          purchase.id,
          JSON.stringify({
            asset: 'MHC',
            order_id: purchase.order_id,
            declared_mhc: parseFloat(purchase.mhc_grant_amount),
            granted_mhc: mhcAmount,
          }),
          params.reviewedBy ?? null,
        ],
      );

      await client.query(
        `UPDATE deposit_requests
         SET status = 'paid', paid_at = now(),
             reviewed_by = COALESCE($2, reviewed_by),
             reviewed_at = CASE WHEN $2::uuid IS NULL THEN reviewed_at ELSE now() END,
             credited_transaction_id = $3,
             updated_at = now()
         WHERE id = $1`,
        [purchase.id, params.reviewedBy ?? null, txRows[0]!.id],
      );

      await client.query('COMMIT');
      return { fulfilled: true, mhcGranted: mhcAmount, balance: balanceAfter };
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async rejectCreditPurchase(params: {
    purchaseId: string;
    reviewedBy: string;
    reason: string;
  }): Promise<CreditPurchaseRow | null> {
    const { rows } = await this.db.query<CreditPurchaseRow>(
      `UPDATE deposit_requests
       SET status = 'rejected', reviewed_by = $2, reviewed_at = now(),
           rejection_reason = $3, updated_at = now()
       WHERE id = $1 AND purpose = 'credit_purchase'
         AND status IN ('pending', 'pending_review')
       RETURNING id, user_id, order_id, status, provider, purpose,
                 mhc_grant_amount::text, external_price_amount::text, external_price_currency,
                 credit_package_id, credited_transaction_id`,
      [params.purchaseId, params.reviewedBy, params.reason],
    );
    return rows[0] ?? null;
  }

  async countPendingCreditPurchasesForUser(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM deposit_requests
       WHERE user_id = $1 AND purpose = 'credit_purchase'
         AND status IN ('pending', 'pending_review')`,
      [userId],
    );
    return parseInt(rows[0]?.c ?? '0', 10);
  }

  // -------------------------------------------------------------------------
  // Action pricing
  // -------------------------------------------------------------------------

  async getActionPrice(actionKey: string): Promise<MhcActionPriceRow | null> {
    const { rows } = await this.db.query<MhcActionPriceRow>(
      `SELECT id, action_key, name, mhc_price::text, is_active
       FROM mhc_action_prices WHERE action_key = $1`,
      [actionKey],
    );
    return rows[0] ?? null;
  }

  async listActionPrices(): Promise<MhcActionPriceRow[]> {
    const { rows } = await this.db.query<MhcActionPriceRow>(
      `SELECT id, action_key, name, mhc_price::text, is_active
       FROM mhc_action_prices ORDER BY action_key`,
    );
    return rows;
  }

  async upsertActionPrice(params: {
    actionKey: string;
    name: string;
    mhcPrice: number;
    isActive: boolean;
  }): Promise<MhcActionPriceRow> {
    const { rows } = await this.db.query<MhcActionPriceRow>(
      `INSERT INTO mhc_action_prices (action_key, name, mhc_price, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (action_key) DO UPDATE
         SET name = EXCLUDED.name,
             mhc_price = EXCLUDED.mhc_price,
             is_active = EXCLUDED.is_active,
             updated_at = now()
       RETURNING id, action_key, name, mhc_price::text, is_active`,
      [params.actionKey, params.name, params.mhcPrice, params.isActive],
    );
    return rows[0]!;
  }

  // -------------------------------------------------------------------------
  // Grants (from a completed MHC purchase / admin bonus)
  // -------------------------------------------------------------------------
  /**
   * Grant MHC to a user's credit wallet. Idempotent by (referenceType, referenceId):
   * if a completed grant transaction already exists for that reference, it is a no-op.
   * Returns the new balance.
   */
  async grantCredits(params: {
    userId: string;
    amount: number;
    description: string;
    referenceType: string;
    referenceId: string; // e.g. deposit_request id
    grantedBy?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<{ granted: boolean; balance: number }> {
    if (!(params.amount > 0)) {
      throw new Error('MHC_GRANT_AMOUNT_INVALID');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const wallet = await this.getOrCreateCreditWalletInTx(client, params.userId);

      // Lock the wallet row and check idempotency inside the transaction.
      const { rows: lockRows } = await client.query<{ balance: string }>(
        `SELECT balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
        [wallet.id],
      );
      const currentBalance = parseFloat(lockRows[0]!.balance);

      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM transactions
         WHERE wallet_id = $1 AND type = 'deposit' AND status = 'completed'
           AND reference_type = $2 AND reference_id = $3
         LIMIT 1`,
        [wallet.id, params.referenceType, params.referenceId],
      );
      if (existing.length > 0) {
        await client.query('COMMIT');
        return { granted: false, balance: currentBalance };
      }

      const balanceAfter = currentBalance + params.amount;
      await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [
        balanceAfter,
        wallet.id,
      ]);
      await client.query(
        `INSERT INTO transactions (
           wallet_id, user_id, type, amount, balance_delta, balance_after, status,
           description, reference_type, reference_id, metadata, created_by
         ) VALUES ($1, $2, 'deposit', $3, $3, $4, 'completed', $5, $6, $7, $8::jsonb, $9)`,
        [
          wallet.id,
          params.userId,
          params.amount,
          balanceAfter,
          params.description,
          params.referenceType,
          params.referenceId,
          JSON.stringify({ ...(params.metadata ?? {}), asset: 'MHC' }),
          params.grantedBy ?? null,
        ],
      );
      await client.query('COMMIT');
      return { granted: true, balance: balanceAfter };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Spend on a job activation (award / booking)
  // -------------------------------------------------------------------------
  /**
   * Charge the provider's MHC balance for a one-time job activation. Idempotent
   * per (activationType, bidId|reservationId): a second call returns the existing
   * activation without double-charging. Throws InsufficientCreditsError if the
   * provider lacks balance. If the action price is 0 or inactive, records a
   * zero-charge activation so the gate opens without spending credits.
   */
  async chargeActivation(params: {
    activationType: 'award' | 'booking';
    providerUserId: string;
    actingUserId: string;
    actionKey: string;
    needId?: string | null;
    bidId?: string | null;
    reservationId?: string | null;
    description: string;
    metadata?: Record<string, unknown>;
  }): Promise<{
    charged: boolean;
    alreadyActivated: boolean;
    mhcCharged: number;
    balance: number;
  }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Idempotency check first (partial unique indexes also enforce this).
      const dedupeColumn = params.activationType === 'award' ? 'bid_id' : 'reservation_id';
      const dedupeValue = params.activationType === 'award' ? params.bidId : params.reservationId;
      if (!dedupeValue) {
        throw new Error('MHC_ACTIVATION_REFERENCE_REQUIRED');
      }

      const { rows: existingRows } = await client.query<MhcActivationRow>(
        `SELECT id, mhc_charged::text FROM mhc_job_activations
         WHERE activation_type = $1 AND ${dedupeColumn} = $2
         LIMIT 1`,
        [params.activationType, dedupeValue],
      );
      if (existingRows.length > 0) {
        const wallet = await this.getOrCreateCreditWalletInTx(client, params.providerUserId);
        const balance = parseFloat(wallet.balance);
        await client.query('COMMIT');
        return {
          charged: false,
          alreadyActivated: true,
          mhcCharged: parseFloat(existingRows[0]!.mhc_charged),
          balance,
        };
      }

      // Resolve price.
      const { rows: priceRows } = await client.query<{ mhc_price: string; is_active: boolean }>(
        `SELECT mhc_price::text, is_active FROM mhc_action_prices WHERE action_key = $1`,
        [params.actionKey],
      );
      const price = priceRows[0];
      const mhcPrice = price && price.is_active ? parseFloat(price.mhc_price) : 0;

      const wallet = await this.getOrCreateCreditWalletInTx(client, params.providerUserId);
      const { rows: lockRows } = await client.query<{ balance: string; is_frozen: boolean }>(
        `SELECT balance::text, is_frozen FROM wallets WHERE id = $1 FOR UPDATE`,
        [wallet.id],
      );
      const currentBalance = parseFloat(lockRows[0]!.balance);
      if (lockRows[0]!.is_frozen) {
        throw new Error('MHC_WALLET_FROZEN');
      }

      let transactionId: string | null = null;
      let balanceAfter = currentBalance;

      if (mhcPrice > 0) {
        if (currentBalance < mhcPrice) {
          await client.query('ROLLBACK');
          throw new InsufficientCreditsError(mhcPrice, currentBalance);
        }
        balanceAfter = currentBalance - mhcPrice;
        await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [
          balanceAfter,
          wallet.id,
        ]);
        const { rows: txRows } = await client.query<{ id: string }>(
          `INSERT INTO transactions (
             wallet_id, user_id, type, amount, balance_delta, balance_after, status,
             description, reference_type, reference_id, metadata
           ) VALUES ($1, $2, 'payment', $3, -$3, $4, 'completed', $5, $6, $7, $8::jsonb)
           RETURNING id`,
          [
            wallet.id,
            params.providerUserId,
            mhcPrice,
            balanceAfter,
            params.description,
            `mhc_${params.activationType}_activation`,
            dedupeValue,
            JSON.stringify({
              ...(params.metadata ?? {}),
              asset: 'MHC',
              action_key: params.actionKey,
            }),
          ],
        );
        transactionId = txRows[0]!.id;
      }

      await client.query(
        `INSERT INTO mhc_job_activations (
           activation_type, provider_user_id, acting_user_id, need_id, bid_id, reservation_id,
           action_key, mhc_charged, transaction_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          params.activationType,
          params.providerUserId,
          params.actingUserId,
          params.needId ?? null,
          params.bidId ?? null,
          params.reservationId ?? null,
          params.actionKey,
          mhcPrice,
          transactionId,
        ],
      );

      // Open the job in the SAME transaction as the debit. If this failed while
      // the debit succeeded, the provider would lose credits for a job that never
      // unlocked; committing them together makes that impossible.
      if (params.activationType === 'award' && params.needId && params.bidId) {
        await client.query(
          `UPDATE bids
           SET status = 'accepted', award_accepted_at = now(), updated_at = now()
           WHERE id = $1`,
          [params.bidId],
        );
        await client.query(
          `UPDATE needs
           SET status = 'awarded',
               awarded_bid_id = $1,
               activated_at = now(),
               pending_award_bid_id = NULL,
               pending_award_at = NULL,
               pending_award_expires_at = NULL,
               updated_at = now()
           WHERE id = $2`,
          [params.bidId, params.needId],
        );
      }

      await client.query('COMMIT');
      return {
        charged: mhcPrice > 0,
        alreadyActivated: false,
        mhcCharged: mhcPrice,
        balance: balanceAfter,
      };
    } catch (e) {
      // ROLLBACK is safe to call even if a prior ROLLBACK ran; guard for that.
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Release a pending award (provider declined, or it expired). No MHC is
   * involved: nothing was ever charged for a pending award.
   */
  async releasePendingAwardForBid(
    needId: string,
    bidId: string,
    reason: 'rejected' | 'expired',
  ): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const timestampColumn = reason === 'rejected' ? 'award_rejected_at' : 'award_expired_at';
      const nextBidStatus = reason === 'rejected' ? 'rejected' : 'expired';
      await client.query(
        `UPDATE bids
         SET status = $2, ${timestampColumn} = now(), updated_at = now()
         WHERE id = $1 AND status = 'awarded_pending'`,
        [bidId, nextBidStatus],
      );
      await client.query(
        `UPDATE needs
         SET status = 'open',
             pending_award_bid_id = NULL,
             pending_award_at = NULL,
             pending_award_expires_at = NULL,
             updated_at = now()
         WHERE id = $1 AND status = 'awarded_pending_provider_acceptance'`,
        [needId],
      );
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async isActivated(params: {
    activationType: 'award' | 'booking';
    bidId?: string | null;
    reservationId?: string | null;
  }): Promise<boolean> {
    const dedupeColumn = params.activationType === 'award' ? 'bid_id' : 'reservation_id';
    const dedupeValue = params.activationType === 'award' ? params.bidId : params.reservationId;
    if (!dedupeValue) return false;
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM mhc_job_activations
       WHERE activation_type = $1 AND ${dedupeColumn} = $2 LIMIT 1`,
      [params.activationType, dedupeValue],
    );
    return rows.length > 0;
  }
}
