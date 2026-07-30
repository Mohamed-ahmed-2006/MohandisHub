// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) repository — closed-loop provider credit
// ---------------------------------------------------------------------------
// MHC is a non-withdrawable, non-transferable platform credit stored in the
// shared wallets/transactions ledger under account_type = 'provider_credit'
// (asset_code = 'MHC'). Grants use type='deposit', spends use type='payment',
// and audited corrections use type='adjustment'. All balance mutations are
// performed inside a single transaction with row locking for correctness.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';

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
  rejection_reason?: string | null;
  paid_at?: string | null;
  created_at?: string;
  /** Snapshot joined from the package, for display. */
  package_code?: string | null;
  package_name?: string | null;
};

/** Credit purchase enriched with buyer + reviewer identity for the admin queue. */
export type AdminCreditPurchaseRow = CreditPurchaseRow & {
  provider_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  buyer_name: string | null;
  buyer_email: string;
  buyer_role: string;
  reviewer_name: string | null;
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

/**
 * The only `deposit_requests.status` values a credit purchase may be fulfilled
 * from. Everything else means money did not arrive as expected, or the purchase
 * is already resolved.
 *
 * The effective status domain is the INTERSECTION of two CHECK constraints:
 * `deposit_requests_status_check` (validated) and
 * `deposit_requests_provider_status_check_publish_ready` (NOT VALID, but still
 * enforced for new rows) — i.e.
 *   pending | paid | expired | failed | cancelled | pending_review | rejected
 * Note 'completed' is NOT reachable, despite older code testing for it.
 */
const FULFILLABLE_PURCHASE_STATUSES = new Set(['pending', 'pending_review']);

/** Statuses that mean the purchase was already granted; re-running is a no-op. */
const ALREADY_FULFILLED_STATUSES = new Set(['paid']);

/**
 * Outcome of a fulfilment attempt. Deliberately a discriminated union rather
 * than a nullable result: an admin approving an already-approved purchase and an
 * admin approving a rejected one are different situations, and collapsing both
 * to `null` loses the distinction at exactly the point where money is granted.
 */
export type FulfillOutcome =
  | { outcome: 'fulfilled'; mhcGranted: number; balance: number }
  | { outcome: 'already_fulfilled'; mhcGranted: 0; balance: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_actionable'; status: string };

/**
 * The award is no longer in a state that may be charged for. Raised from INSIDE
 * the charging transaction, after the need and bid rows are locked, so it
 * reflects committed state rather than a stale read.
 */
export class ActivationStateError extends Error {
  constructor(
    public readonly reason:
      | 'BID_NOT_FOUND'
      | 'NOT_BID_OWNER'
      | 'BID_NOT_AWARDED'
      | 'AWARD_OFFER_EXPIRED'
      | 'AWARD_STATE_CHANGED',
  ) {
    super(reason);
    this.name = 'ActivationStateError';
  }
}

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super('INSUFFICIENT_CREDITS');
    this.name = 'InsufficientCreditsError';
  }
}

// ---------------------------------------------------------------------------
// Generic action charging (P0-07) — errors, shapes and constants
// ---------------------------------------------------------------------------
// These belong to `chargeAction` / `refundActionCharge` at the bottom of this
// file. They are deliberately distinct error classes rather than one error with
// a reason string, because the four configuration states below have genuinely
// different operational responses:
//
//   price row absent   -> nobody configured this action. Ops problem. Fail closed.
//   price row inactive -> an admin switched the action off. Product decision.
//   price = 0          -> the action is deliberately free. Not an error at all.
//   balance short      -> the provider must buy credits. User-facing 402.
//
// The activation path deliberately conflates the first three into "price 0"
// (see chargeActivation) because an activation must never be blocked by a
// missing config row — the job is already awarded and paid-for state must be
// reachable. A generic charge has no such obligation, so it fails closed on
// configuration instead of silently giving the action away. That divergence is
// intentional and is why the two paths do not share price resolution.
// ---------------------------------------------------------------------------

/** No `mhc_action_prices` row exists for this key. Fail closed; never guess a price. */
export class MhcActionPriceMissingError extends Error {
  constructor(public readonly actionKey: string) {
    super('MHC_ACTION_PRICE_MISSING');
    this.name = 'MhcActionPriceMissingError';
  }
}

/** The price row exists but `is_active = false`. The action is switched off. */
export class MhcActionDisabledError extends Error {
  constructor(public readonly actionKey: string) {
    super('MHC_ACTION_DISABLED');
    this.name = 'MhcActionDisabledError';
  }
}

/**
 * Identifies ONE entity whose price overrides the global action price, e.g.
 * `{ scopeType: 'plan', scopeId: <plan uuid> }`. A consumer names the entity; it
 * never names an amount.
 */
export type MhcPriceScope = {
  scopeType: 'plan';
  scopeId: string;
};

/**
 * A scope was supplied but no ACTIVE scoped price row exists for it.
 *
 * Deliberately distinct from MhcActionPriceMissingError: "this plan has no price
 * configured" is an admin task, and it must never degrade into "charge the global
 * default". Fails closed.
 */
export class MhcActionScopePriceMissingError extends Error {
  constructor(
    public readonly actionKey: string,
    public readonly scope: MhcPriceScope,
  ) {
    super('MHC_ACTION_SCOPE_PRICE_MISSING');
    this.name = 'MhcActionScopePriceMissingError';
  }
}

/** A charge id was supplied that does not exist. */
export class MhcChargeNotFoundError extends Error {
  constructor(public readonly chargeId: string) {
    super('MHC_CHARGE_NOT_FOUND');
    this.name = 'MhcChargeNotFoundError';
  }
}

/** A reference id / action key / reference type that cannot be stored as given. */
export class MhcInvalidChargeReferenceError extends Error {
  constructor(
    public readonly field:
      | 'actionKey'
      | 'referenceType'
      | 'referenceId'
      | 'idempotencyKey'
      | 'reason',
  ) {
    super('MHC_INVALID_CHARGE_REFERENCE');
    this.name = 'MhcInvalidChargeReferenceError';
  }
}

/**
 * The caller did not pass a client that is inside a transaction. Raised by the
 * database itself (SQLSTATE 25P01 on the opening SAVEPOINT), not by a comment —
 * a charge that commits independently of the caller's business write is exactly
 * the failure mode this primitive exists to prevent.
 */
export class MhcTransactionRequiredError extends Error {
  constructor() {
    super('MHC_CHARGE_REQUIRES_TRANSACTION');
    this.name = 'MhcTransactionRequiredError';
  }
}

/**
 * `free`            — the action price is 0. Nothing debited, no rows written.
 * `charged`         — credits left the wallet; one ledger row, one charge row.
 * `already_charged` — this (action, reference) was already paid for.
 */
export type MhcActionChargeOutcome = 'charged' | 'already_charged' | 'free';

export type ChargeMhcActionInput = {
  /** MUST already be inside a transaction owned by the caller. */
  client: PoolClient;
  userId: string;
  actionKey: string;
  referenceType: string;
  referenceId: string;
  idempotencyKey?: string | null;
  description?: string;
  /** Merged into the ledger row's metadata. Never put contact details here. */
  metadata?: Record<string, unknown>;
  /** Team member acting for the charged account, recorded on the ledger row. */
  actorUserId?: string | null;
  /**
   * Price this action per ENTITY rather than from the global catalogue. Names
   * the entity only — there is deliberately no way to pass an amount, so no
   * controller, client or consumer can choose what something costs.
   *
   * When set, the active scoped row is the sole authority and its absence is an
   * error, never a fallback to the global price.
   */
  priceScope?: MhcPriceScope | null;
};

export type ChargeMhcActionResult = {
  outcome: MhcActionChargeOutcome;
  chargeId: string | null;
  transactionId: string | null;
  mhcCharged: number;
  balanceAfter: number;
  alreadyCharged: boolean;
};

/**
 * `refunded`           — credits returned; one ledger row written.
 * `already_refunded`   — a previous refund stands. Nothing written.
 * `nothing_to_refund`  — the charge is for 0 MHC, so there is nothing to return.
 */
export type RefundMhcActionOutcome = 'refunded' | 'already_refunded' | 'nothing_to_refund';

export type RefundMhcActionInput = {
  /** MUST already be inside a transaction owned by the caller. */
  client: PoolClient;
  chargeId: string;
  reason: string;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
};

export type RefundMhcActionResult = {
  outcome: RefundMhcActionOutcome;
  chargeId: string;
  refundTransactionId: string | null;
  mhcRefunded: number;
  balanceAfter: number;
  alreadyRefunded: boolean;
};

export type MhcActionChargeRow = {
  id: string;
  user_id: string;
  action_key: string;
  reference_type: string;
  reference_id: string;
  mhc_charged: string;
  transaction_id: string | null;
  idempotency_key: string | null;
  refunded_at: string | null;
  refund_transaction_id: string | null;
  created_at: string;
};

/** `transactions.reference_type` for the two legs of a generic action charge. */
const ACTION_CHARGE_REFERENCE_TYPE = 'mhc_action_charge';
const ACTION_REFUND_REFERENCE_TYPE = 'mhc_action_refund';

const CHARGE_COLUMNS = `id, user_id, action_key, reference_type, reference_id,
       mhc_charged::text, transaction_id, idempotency_key,
       refunded_at::text, refund_transaction_id, created_at::text`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL SQLSTATE of an error, when it is one. */
const sqlState = (e: unknown): string | null =>
  typeof e === 'object' &&
  e !== null &&
  'code' in e &&
  typeof (e as { code: unknown }).code === 'string'
    ? (e as { code: string }).code
    : null;

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

  // -------------------------------------------------------------------------
  // Low-level primitives shared by every MHC spend path
  // -------------------------------------------------------------------------
  // Extracted from chargeActivation so the generic charge/refund methods below
  // reuse the exact locking and ledger-writing behaviour of the reference
  // implementation instead of growing a second, subtly different copy of it.
  // The SQL is unchanged from what chargeActivation already ran.

  /**
   * Take the row lock on a credit wallet and read the balance under it. Every
   * balance check in this file happens AFTER this returns, never before: an
   * unlocked read can be stale by the time the debit lands.
   */
  private async lockCreditWallet(
    client: PoolClient,
    walletId: string,
  ): Promise<{ balance: number; isFrozen: boolean }> {
    const { rows } = await client.query<{ balance: string; is_frozen: boolean }>(
      `SELECT balance::text, is_frozen FROM wallets WHERE id = $1 FOR UPDATE`,
      [walletId],
    );
    return { balance: parseFloat(rows[0]!.balance), isFrozen: rows[0]!.is_frozen };
  }

  /**
   * Write one ledger row. `amount` is always positive (the ledger has a
   * non-negative CHECK on it) and the direction is carried by `balanceDelta`,
   * matching every other debit and credit in this ledger.
   */
  private async writeCreditLedgerRow(
    client: PoolClient,
    params: {
      walletId: string;
      userId: string;
      type: 'payment' | 'refund';
      amount: number;
      balanceDelta: number;
      balanceAfter: number;
      description: string;
      referenceType: string;
      referenceId: string;
      metadata: Record<string, unknown>;
      createdBy?: string | null;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO transactions (
         wallet_id, user_id, type, amount, balance_delta, balance_after, status,
         description, reference_type, reference_id, metadata, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $10::jsonb, $11)
       RETURNING id`,
      [
        params.walletId,
        params.userId,
        params.type,
        params.amount,
        params.balanceDelta,
        params.balanceAfter,
        params.description,
        params.referenceType,
        params.referenceId,
        JSON.stringify({ ...params.metadata, asset: 'MHC' }),
        params.createdBy ?? null,
      ],
    );
    return rows[0]!.id;
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
    /** NOWPayments invoice id, so a callback can be matched even without order_id. */
    providerInvoiceId?: string | null;
    /** Hosted checkout URL the provider is sent to. */
    checkoutUrl?: string | null;
  }): Promise<{ id: string; order_id: string; status: string }> {
    const creditWallet = await this.getOrCreateCreditWallet(params.userId);
    const externalPrice = parseFloat(params.pkg.external_price_amount);
    const { rows } = await this.db.query<{ id: string; order_id: string; status: string }>(
      `INSERT INTO deposit_requests (
         user_id, wallet_id, amount, currency, order_id, provider, status,
         purpose, target_account_type, credit_package_id, mhc_grant_amount,
         external_price_amount, external_price_currency,
         proof_upload_id, transfer_reference, destination_account_snapshot, provider_payload,
         provider_invoice_id, checkout_url, provider_requested_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7,
         'credit_purchase', 'provider_credit', $8, $9,
         $3, $4,
         $10, $11, $12::jsonb, $13::jsonb,
         $14, $15, now())
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
        params.providerInvoiceId ?? null,
        params.checkoutUrl ?? null,
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

  /**
   * Admin review queue. Carries the buyer's identity and the package snapshot,
   * because an admin approving a transfer needs to know WHO paid and WHAT they
   * expect to receive — the bare deposit_requests row answers neither.
   *
   * This is an admin-permission-gated surface (`manage_transactions`), so
   * returning the buyer's email here is deliberate, not a contact-gate leak.
   */
  async listCreditPurchasesForAdmin(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: AdminCreditPurchaseRow[]; total: number }> {
    const filters = [`d.purpose = 'credit_purchase'`];
    const values: unknown[] = [];
    if (params.status) {
      values.push(params.status);
      filters.push(`d.status = $${values.length}`);
    }
    const where = `WHERE ${filters.join(' AND ')}`;

    const { rows: countRows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM deposit_requests d ${where}`,
      values,
    );
    const total = parseInt(countRows[0]?.c ?? '0', 10);

    const { rows } = await this.db.query<AdminCreditPurchaseRow>(
      `SELECT d.id, d.user_id, d.order_id, d.status, d.provider, d.purpose,
              d.mhc_grant_amount::text, d.external_price_amount::text, d.external_price_currency,
              d.credit_package_id, d.credited_transaction_id, d.proof_upload_id,
              d.transfer_reference, d.provider_status, d.rejection_reason,
              d.reviewed_by, d.reviewed_at, d.paid_at, d.created_at,
              u.display_name AS buyer_name,
              u.email        AS buyer_email,
              u.primary_role AS buyer_role,
              p.code         AS package_code,
              p.name         AS package_name,
              r.display_name AS reviewer_name
       FROM deposit_requests d
       JOIN users u ON u.id = d.user_id
       LEFT JOIN mhc_credit_packages p ON p.id = d.credit_package_id
       LEFT JOIN users r ON r.id = d.reviewed_by
       ${where}
       ORDER BY
         -- Unreviewed purchases first: this is a work queue, not an archive.
         CASE WHEN d.status IN ('pending', 'pending_review') THEN 0 ELSE 1 END,
         d.created_at DESC
       LIMIT $${values.length + 1}::int OFFSET $${values.length + 2}::int`,
      [...values, params.limit, params.offset],
    );
    return { rows, total };
  }

  /** A provider's own credit-purchase history, including in-flight requests. */
  async listCreditPurchasesForUser(params: {
    userId: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: CreditPurchaseRow[]; total: number }> {
    const { rows: countRows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM deposit_requests
       WHERE user_id = $1 AND purpose = 'credit_purchase'`,
      [params.userId],
    );
    const total = parseInt(countRows[0]?.c ?? '0', 10);

    const { rows } = await this.db.query<CreditPurchaseRow>(
      `SELECT d.id, d.user_id, d.order_id, d.status, d.provider, d.purpose,
              d.mhc_grant_amount::text, d.external_price_amount::text, d.external_price_currency,
              d.credit_package_id, d.credited_transaction_id, d.proof_upload_id,
              d.transfer_reference, d.rejection_reason, d.paid_at, d.created_at,
              p.code AS package_code,
              p.name AS package_name
       FROM deposit_requests d
       LEFT JOIN mhc_credit_packages p ON p.id = d.credit_package_id
       WHERE d.user_id = $1 AND d.purpose = 'credit_purchase'
       ORDER BY d.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [params.userId, params.limit, params.offset],
    );
    return { rows, total };
  }

  /**
   * Mark a credit purchase paid and grant the snapshotted MHC amount.
   *
   * Fulfilment proceeds ONLY from a status in FULFILLABLE_PURCHASE_STATUSES. The
   * previous implementation returned early for paid/completed/rejected/cancelled
   * and granted for everything else, which meant a purchase sitting in 'expired'
   * or 'failed' — statuses that specifically mean the money did not arrive —
   * would be granted in full if an admin clicked approve.
   *
   * The row is locked FOR UPDATE before the status is read, so two concurrent
   * approvals cannot both pass the check.
   */
  async fulfillCreditPurchase(params: {
    purchaseId: string;
    reviewedBy?: string | null;
    providerStatus?: string | null;
    providerPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
    /** Overrides the snapshotted grant (e.g. admin corrects an underpayment). */
    overrideMhcAmount?: number | null;
  }): Promise<FulfillOutcome> {
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
        return { outcome: 'not_found' };
      }

      // Record what the provider told us regardless of whether we grant. This is
      // the audit trail for callbacks that arrive out of order or after the
      // purchase is already resolved.
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

      // Already granted — commit the provider metadata but never grant twice.
      if (ALREADY_FULFILLED_STATUSES.has(purchase.status)) {
        await client.query('COMMIT');
        const balance = await this.getBalance(purchase.user_id);
        return { outcome: 'already_fulfilled', mhcGranted: 0, balance };
      }

      // Anything not explicitly fulfillable is refused. This covers rejected and
      // cancelled (deliberately resolved) as well as expired and failed (money
      // did not arrive), which the previous implementation would have granted.
      if (!FULFILLABLE_PURCHASE_STATUSES.has(purchase.status)) {
        await client.query('COMMIT');
        return { outcome: 'not_actionable', status: purchase.status };
      }

      // An admin override must still be a real grant. Number.isFinite alone let
      // 0 through (marking the purchase paid while granting nothing) and let a
      // negative through (silently DEBITING the provider on an "approval").
      const mhcAmount =
        params.overrideMhcAmount != null
          ? params.overrideMhcAmount
          : parseFloat(purchase.mhc_grant_amount);
      if (!Number.isFinite(mhcAmount) || mhcAmount <= 0) {
        await client.query('ROLLBACK');
        throw new Error('MHC_GRANT_AMOUNT_INVALID');
      }

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
      return { outcome: 'fulfilled', mhcGranted: mhcAmount, balance: balanceAfter };
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

  /**
   * Record what a payment provider reported, without touching credits or the
   * purchase status. Used for callbacks that are authentic but not settled, so
   * the audit trail is complete even when nothing is granted.
   */
  async recordPurchaseProviderState(params: {
    purchaseId: string;
    providerStatus?: string | null;
    providerPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.query(
      `UPDATE deposit_requests
       SET provider_status = COALESCE($2, provider_status),
           provider_payment_id = COALESCE($3, provider_payment_id),
           provider_payload = provider_payload || COALESCE($4::jsonb, '{}'::jsonb),
           updated_at = now()
       WHERE id = $1 AND purpose = 'credit_purchase'`,
      [
        params.purchaseId,
        params.providerStatus ?? null,
        params.providerPaymentId ?? null,
        params.providerPayload ? JSON.stringify(params.providerPayload) : null,
      ],
    );
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

  // -------------------------------------------------------------------------
  // Scoped action prices (per-entity overrides)
  // -------------------------------------------------------------------------

  /** The active scoped price for one entity, or null when none is configured. */
  async getScopedActionPrice(
    actionKey: string,
    scopeType: 'plan',
    scopeId: string,
  ): Promise<number | null> {
    if (!UUID_PATTERN.test(scopeId)) return null;
    const { rows } = await this.db.query<{ mhc_price: string }>(
      `SELECT mhc_price::text FROM mhc_action_price_scopes
       WHERE action_key = $1 AND scope_type = $2 AND scope_id = $3 AND is_active = true`,
      [actionKey, scopeType, scopeId],
    );
    if (!rows[0]) return null;
    const price = parseFloat(rows[0].mhc_price);
    return Number.isFinite(price) && price >= 0 ? price : null;
  }

  /** Active scoped prices for many entities at once, for list screens. */
  async listScopedActionPrices(actionKey: string, scopeType: 'plan'): Promise<Map<string, number>> {
    const { rows } = await this.db.query<{ scope_id: string; mhc_price: string }>(
      `SELECT scope_id, mhc_price::text FROM mhc_action_price_scopes
       WHERE action_key = $1 AND scope_type = $2 AND is_active = true`,
      [actionKey, scopeType],
    );
    const out = new Map<string, number>();
    for (const row of rows) {
      const price = parseFloat(row.mhc_price);
      if (Number.isFinite(price) && price >= 0) out.set(row.scope_id, price);
    }
    return out;
  }

  /**
   * Set the scoped price for one entity.
   *
   * Supersedes rather than overwrites: the previous row is deactivated and a new
   * active row is written, so the price history of a plan survives an edit. The
   * partial unique index guarantees only one active row exists at a time, and
   * both statements run in one transaction so a failure cannot leave an entity
   * with no active price at all.
   */
  async setScopedActionPrice(params: {
    actionKey: string;
    scopeType: 'plan';
    scopeId: string;
    mhcPrice: number;
    updatedBy?: string | null;
  }): Promise<void> {
    if (!(params.mhcPrice >= 0) || !Number.isFinite(params.mhcPrice)) {
      throw new MhcInvalidChargeReferenceError('reason');
    }
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE mhc_action_price_scopes SET is_active = false, updated_at = now()
         WHERE action_key = $1 AND scope_type = $2 AND scope_id = $3 AND is_active = true`,
        [params.actionKey, params.scopeType, params.scopeId],
      );
      await client.query(
        `INSERT INTO mhc_action_price_scopes (action_key, scope_type, scope_id, mhc_price, is_active, updated_by)
         VALUES ($1, $2, $3, $4, true, $5)`,
        [
          params.actionKey,
          params.scopeType,
          params.scopeId,
          params.mhcPrice,
          params.updatedBy ?? null,
        ],
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /** Remove the price configuration for an entity, which fails its charging closed. */
  async clearScopedActionPrice(
    actionKey: string,
    scopeType: 'plan',
    scopeId: string,
  ): Promise<void> {
    await this.db.query(
      `UPDATE mhc_action_price_scopes SET is_active = false, updated_at = now()
       WHERE action_key = $1 AND scope_type = $2 AND scope_id = $3 AND is_active = true`,
      [actionKey, scopeType, scopeId],
    );
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
  /**
   * Lock the need and its bid, then verify the award may still be charged for.
   * Throws ActivationStateError if not. Must be called inside a transaction.
   */
  private async assertAwardChargeable(
    client: PoolClient,
    params: { needId: string | null; bidId: string | null; providerUserId: string },
  ): Promise<void> {
    if (!params.needId || !params.bidId) {
      throw new ActivationStateError('BID_NOT_FOUND');
    }

    // Need first, then bid — see the lock-order note at the call site.
    const { rows: needRows } = await client.query<{
      id: string;
      status: string;
      pending_award_bid_id: string | null;
      pending_award_expires_at: string | null;
      activated_at: string | null;
    }>(
      `SELECT id, status, pending_award_bid_id,
              pending_award_expires_at::text, activated_at::text
       FROM needs WHERE id = $1 FOR UPDATE`,
      [params.needId],
    );
    const need = needRows[0];
    if (!need) throw new ActivationStateError('BID_NOT_FOUND');

    const { rows: bidRows } = await client.query<{
      id: string;
      need_id: string;
      expert_id: string;
      status: string;
    }>(`SELECT id, need_id, expert_id, status FROM bids WHERE id = $1 FOR UPDATE`, [params.bidId]);
    const bid = bidRows[0];
    if (!bid || bid.need_id !== need.id) throw new ActivationStateError('BID_NOT_FOUND');

    if (bid.expert_id !== params.providerUserId) {
      throw new ActivationStateError('NOT_BID_OWNER');
    }

    // The customer must still be offering THIS bid.
    if (
      need.status !== 'awarded_pending_provider_acceptance' ||
      need.pending_award_bid_id !== bid.id ||
      bid.status !== 'awarded_pending'
    ) {
      // Distinguish "someone else got it / customer moved on" from "never offered",
      // because the first is a race and the second is a client bug.
      throw new ActivationStateError(
        need.activated_at != null || need.pending_award_bid_id !== bid.id
          ? 'AWARD_STATE_CHANGED'
          : 'BID_NOT_AWARDED',
      );
    }

    // Expiry is re-checked here for the same reason as everything else: the
    // window may have closed since the service read it.
    if (need.pending_award_expires_at != null) {
      const expiresAt = new Date(need.pending_award_expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        throw new ActivationStateError('AWARD_OFFER_EXPIRED');
      }
    }
  }

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

      // Idempotency BEFORE state validation, and the order matters. Once an
      // award is activated the need moves to 'awarded' and pending_award_bid_id
      // is cleared — so validating first would make a retry of an
      // already-paid activation fail as AWARD_STATE_CHANGED instead of
      // returning the existing result. A retry must be a no-op, not an error.
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

      // Re-validate the award INSIDE the transaction, with the need and bid rows
      // locked. The service performs the same checks first for a fast, friendly
      // error, but those run against an unlocked read: between them and here the
      // customer may have re-awarded, withdrawn, or let the offer lapse. Only the
      // locked check can be trusted to authorise a charge.
      //
      // Lock order is always need -> bid. Every path that locks both uses this
      // order so concurrent activations cannot deadlock.
      if (params.activationType === 'award') {
        await this.assertAwardChargeable(client, {
          needId: params.needId ?? null,
          bidId: params.bidId ?? null,
          providerUserId: params.providerUserId,
        });
      }

      // Resolve price.
      const { rows: priceRows } = await client.query<{ mhc_price: string; is_active: boolean }>(
        `SELECT mhc_price::text, is_active FROM mhc_action_prices WHERE action_key = $1`,
        [params.actionKey],
      );
      const price = priceRows[0];
      const mhcPrice = price && price.is_active ? parseFloat(price.mhc_price) : 0;

      const wallet = await this.getOrCreateCreditWalletInTx(client, params.providerUserId);
      const locked = await this.lockCreditWallet(client, wallet.id);
      const currentBalance = locked.balance;
      if (locked.isFrozen) {
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
        transactionId = await this.writeCreditLedgerRow(client, {
          walletId: wallet.id,
          userId: params.providerUserId,
          type: 'payment',
          amount: mhcPrice,
          balanceDelta: -mhcPrice,
          balanceAfter,
          description: params.description,
          referenceType: `mhc_${params.activationType}_activation`,
          referenceId: dedupeValue,
          metadata: { ...(params.metadata ?? {}), action_key: params.actionKey },
        });
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
        // Both writes carry guard predicates and their row counts are checked.
        // A bare `WHERE id = $1` would happily overwrite a newer award that was
        // created after our validating read — the exact race this guards.
        const bidUpdate = await client.query(
          `UPDATE bids
           SET status = 'accepted', award_accepted_at = now(), updated_at = now()
           WHERE id = $1 AND status = 'awarded_pending'`,
          [params.bidId],
        );
        if (bidUpdate.rowCount !== 1) {
          throw new ActivationStateError('AWARD_STATE_CHANGED');
        }

        const needUpdate = await client.query(
          `UPDATE needs
           SET status = 'awarded',
               awarded_bid_id = $1,
               activated_at = now(),
               pending_award_bid_id = NULL,
               pending_award_at = NULL,
               pending_award_expires_at = NULL,
               updated_at = now()
           WHERE id = $2
             AND status = 'awarded_pending_provider_acceptance'
             AND pending_award_bid_id = $1`,
          [params.bidId, params.needId],
        );
        if (needUpdate.rowCount !== 1) {
          throw new ActivationStateError('AWARD_STATE_CHANGED');
        }

        // Reject the losing bids at ACTIVATION — the point the winner actually
        // paid and the job is real.
        //
        // Today this is a no-op: NeedsService.awardBid still rejects them at
        // offer time. That is wrong per decision D4 (alternatives must stay
        // available until the selected provider activates, or a lapsed offer
        // reopens a need whose other bidders have all been told they lost), and
        // moving it is step 10 of the recovery plan. Putting the correct
        // transition here now means step 10 only has to delete the premature one.
        await client.query(
          `UPDATE bids
           SET status = 'rejected', updated_at = now()
           WHERE need_id = $1 AND id <> $2 AND status IN ('pending', 'awarded_pending')`,
          [params.needId, params.bidId],
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
  /**
   * Release a pending award: the provider declined, the customer withdrew it, or
   * it expired. No MHC is involved — nothing is ever charged for a pending
   * award, which is the whole point of awarding being an offer.
   *
   * The single release path for all three reasons. Two divergent copies of a
   * money-adjacent state transition is how they drift.
   *
   * Race-safe: locks the need, verifies it still carries THIS pending award, and
   * guards both writes. If the provider activated a moment earlier, the release
   * finds nothing to release and reports it rather than tearing down a paid job.
   */
  async releasePendingAwardForBid(
    needId: string,
    bidId: string,
    reason: 'rejected' | 'withdrawn' | 'expired',
  ): Promise<{ released: boolean }> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Same lock order as chargeActivation (need -> bid) so the two cannot
      // deadlock against each other.
      const { rows: needRows } = await client.query<{
        status: string;
        pending_award_bid_id: string | null;
      }>(`SELECT status, pending_award_bid_id FROM needs WHERE id = $1 FOR UPDATE`, [needId]);
      const need = needRows[0];
      if (
        !need ||
        need.status !== 'awarded_pending_provider_acceptance' ||
        need.pending_award_bid_id !== bidId
      ) {
        await client.query('COMMIT');
        return { released: false };
      }

      const timestampColumn =
        reason === 'expired'
          ? 'award_expired_at'
          : reason === 'withdrawn'
            ? 'award_rejected_at'
            : 'award_rejected_at';
      // A declined bid is out. A withdrawn or expired offer returns the bid to
      // the pool so the customer can award it again later.
      const nextBidStatus = reason === 'rejected' ? 'rejected' : 'pending';

      await client.query(
        `UPDATE bids
         SET status = $2, ${timestampColumn} = now(),
             award_offered_at = NULL, updated_at = now()
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
      return { released: true };
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

  /** Pending awards whose acceptance window has passed (worker sweep). */
  async listExpiredPendingAwards(
    limit: number,
  ): Promise<
    Array<{ need_id: string; bid_id: string; provider_user_id: string; customer_id: string }>
  > {
    const { rows } = await this.db.query<{
      need_id: string;
      bid_id: string;
      provider_user_id: string;
      customer_id: string;
    }>(
      `SELECT n.id AS need_id, n.pending_award_bid_id AS bid_id,
              b.expert_id AS provider_user_id, n.customer_id
       FROM needs n
       JOIN bids b ON b.id = n.pending_award_bid_id
       WHERE n.status = 'awarded_pending_provider_acceptance'
         AND n.pending_award_expires_at IS NOT NULL
         AND n.pending_award_expires_at <= now()
       ORDER BY n.pending_award_expires_at ASC
       LIMIT $1::int`,
      [limit],
    );
    return rows;
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

  // -------------------------------------------------------------------------
  // Generic action charging (P0-07)
  // -------------------------------------------------------------------------
  // The reusable half of chargeActivation, for actions that are NOT activations:
  // advertisements, subscriptions, bid submission, spotlight, paid tools. It
  // records into `mhc_action_charges` rather than `mhc_job_activations`, so the
  // activation gate keeps exactly one meaning and one table.
  //
  // The one structural difference from chargeActivation: this method NEVER opens
  // or commits a transaction. It runs inside the caller's, so the charge and the
  // caller's business write commit or roll back together. A caller that forgets
  // to open one is rejected by PostgreSQL on the opening SAVEPOINT.
  //
  // Lock order, everywhere in this section:  charge row -> wallet row.
  // chargeAction never locks an existing charge row (it inserts a new one) and
  // refundActionCharge takes the charge row first, so the two cannot deadlock.

  /**
   * Open a nested scope inside the caller's transaction.
   *
   * Two jobs: it is the recovery point for a unique-index collision (so a lost
   * idempotency race is absorbed without poisoning the caller's transaction),
   * and it is the proof that a transaction exists at all — SAVEPOINT outside a
   * transaction block is SQLSTATE 25P01.
   */
  private async openChargeScope(client: PoolClient): Promise<string> {
    const name = `mhc_scope_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      await client.query(`SAVEPOINT ${name}`);
    } catch (e) {
      if (sqlState(e) === '25P01') throw new MhcTransactionRequiredError();
      throw e;
    }
    return name;
  }

  /**
   * Resolve what an action costs, refusing to invent a price.
   *
   * Unlike the activation path, an absent or switched-off price is an error
   * here, not a free pass — see the note on MhcActionPriceMissingError. A price
   * of 0 on an ACTIVE row is the supported way to make an action free.
   *
   * When the caller supplies a SCOPE (e.g. one specific plan), the scoped row is
   * the sole authority: it does NOT fall back to the global catalogue price. A
   * silent fallback is the whole danger of per-entity pricing — a plan whose
   * price row was never created or was switched off would otherwise be sold at
   * whatever the global default happened to be. Absent or inactive means refuse.
   *
   * The price is read from the database here, inside the charging transaction.
   * No caller can pass an amount in; a consumer names an entity and this decides
   * what that entity costs.
   */
  private async resolveActionPrice(
    client: PoolClient,
    actionKey: string,
    scope: MhcPriceScope | null,
  ): Promise<number> {
    if (scope) {
      const { rows } = await client.query<{ mhc_price: string }>(
        `SELECT mhc_price::text FROM mhc_action_price_scopes
         WHERE action_key = $1 AND scope_type = $2 AND scope_id = $3 AND is_active = true`,
        [actionKey, scope.scopeType, scope.scopeId],
      );
      const row = rows[0];
      if (!row) throw new MhcActionScopePriceMissingError(actionKey, scope);
      const scopedPrice = parseFloat(row.mhc_price);
      if (!Number.isFinite(scopedPrice) || scopedPrice < 0) {
        throw new MhcActionScopePriceMissingError(actionKey, scope);
      }
      return scopedPrice;
    }

    const { rows } = await client.query<{ mhc_price: string; is_active: boolean }>(
      `SELECT mhc_price::text, is_active FROM mhc_action_prices WHERE action_key = $1`,
      [actionKey],
    );
    const row = rows[0];
    if (!row) throw new MhcActionPriceMissingError(actionKey);
    if (!row.is_active) throw new MhcActionDisabledError(actionKey);
    const price = parseFloat(row.mhc_price);
    // A NULL/NaN price is a broken config row, not a free action.
    if (!Number.isFinite(price) || price < 0) throw new MhcActionPriceMissingError(actionKey);
    return price;
  }

  /** The charge that already covers this call, by natural key or retry token. */
  private async findExistingCharge(
    client: PoolClient,
    params: {
      userId: string;
      actionKey: string;
      referenceType: string;
      referenceId: string;
      idempotencyKey: string | null;
    },
  ): Promise<MhcActionChargeRow | null> {
    const { rows } = await client.query<MhcActionChargeRow>(
      `SELECT ${CHARGE_COLUMNS} FROM mhc_action_charges
       WHERE (action_key = $1 AND reference_type = $2 AND reference_id = $3)
          OR ($4::text IS NOT NULL AND user_id = $5 AND action_key = $1 AND idempotency_key = $4)
       ORDER BY created_at
       LIMIT 1`,
      [
        params.actionKey,
        params.referenceType,
        params.referenceId,
        params.idempotencyKey,
        params.userId,
      ],
    );
    return rows[0] ?? null;
  }

  async findActionChargeById(chargeId: string): Promise<MhcActionChargeRow | null> {
    if (!UUID_PATTERN.test(chargeId)) return null;
    const { rows } = await this.db.query<MhcActionChargeRow>(
      `SELECT ${CHARGE_COLUMNS} FROM mhc_action_charges WHERE id = $1`,
      [chargeId],
    );
    return rows[0] ?? null;
  }

  /** Charges recorded against one business entity (admin/audit read). */
  async listActionChargesForReference(
    referenceType: string,
    referenceId: string,
  ): Promise<MhcActionChargeRow[]> {
    if (!UUID_PATTERN.test(referenceId)) return [];
    const { rows } = await this.db.query<MhcActionChargeRow>(
      `SELECT ${CHARGE_COLUMNS} FROM mhc_action_charges
       WHERE reference_type = $1 AND reference_id = $2
       ORDER BY created_at DESC`,
      [referenceType, referenceId],
    );
    return rows;
  }

  /**
   * Charge a provider's MHC balance for one paid action, inside the caller's
   * transaction.
   *
   * Idempotency is structural: `uq_mhc_action_charge_reference` makes a second
   * charge for the same (action, reference) impossible at the database, and
   * `uq_mhc_action_charge_idempotency` does the same for a repeated retry token
   * within one provider+action. The pre-check below is only a fast path; the
   * indexes are the authority, and a collision is recovered by returning the
   * charge that won rather than by surfacing a constraint error.
   *
   * Ordering inside the scope is deliberate:
   *   1. wallet row lock       — serialises concurrent charges for this provider
   *   2. existing-charge read  — under READ COMMITTED this sees the winner of a
   *                              race, because the statement runs after the lock
   *   3. balance check         — no writes yet, so a 402 leaves nothing behind
   *   4. charge row insert     — the unique indexes fire here, before any money
   *                              moves
   *   5. guarded debit         — `WHERE balance >= amount`, so the balance cannot
   *                              go negative even if steps 1-3 were wrong
   *   6. ledger row            — exactly one, pointing back at the charge row
   */
  async chargeAction(input: ChargeMhcActionInput): Promise<ChargeMhcActionResult> {
    const { client } = input;
    const actionKey = input.actionKey.trim();
    const referenceType = input.referenceType.trim();
    const referenceId = input.referenceId.trim();
    const idempotencyKey = input.idempotencyKey?.trim() || null;

    if (!actionKey || actionKey.length > 80) {
      throw new MhcInvalidChargeReferenceError('actionKey');
    }
    if (!referenceType || referenceType.length > 80) {
      throw new MhcInvalidChargeReferenceError('referenceType');
    }
    // Checked here rather than left to the UUID column, because a malformed id
    // would abort the CALLER's transaction with a raw 22P02.
    if (!UUID_PATTERN.test(referenceId)) {
      throw new MhcInvalidChargeReferenceError('referenceId');
    }
    if (idempotencyKey !== null && idempotencyKey.length > 200) {
      throw new MhcInvalidChargeReferenceError('idempotencyKey');
    }

    const scope = await this.openChargeScope(client);
    try {
      const price = await this.resolveActionPrice(client, actionKey, input.priceScope ?? null);

      // Zero-price policy: a free action moves no credits, so it writes NO
      // ledger row and NO charge row. There is nothing to be idempotent about
      // and nothing to refund; the caller's own business row records that the
      // action happened. (This is the one place the generic primitive diverges
      // from chargeActivation, which must write a zero-charge row because that
      // row IS the contact-unlock gate.)
      if (price === 0) {
        const balance = await this.readCreditBalance(client, input.userId);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        return {
          outcome: 'free',
          chargeId: null,
          transactionId: null,
          mhcCharged: 0,
          balanceAfter: balance,
          alreadyCharged: false,
        };
      }

      const wallet = await this.getOrCreateCreditWalletInTx(client, input.userId);
      const locked = await this.lockCreditWallet(client, wallet.id);
      if (locked.isFrozen) {
        throw new Error('MHC_WALLET_FROZEN');
      }

      const existing = await this.findExistingCharge(client, {
        userId: input.userId,
        actionKey,
        referenceType,
        referenceId,
        idempotencyKey,
      });
      if (existing) {
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        return this.existingChargeResult(existing, locked.balance);
      }

      if (locked.balance < price) {
        // Roll back to the scope so the caller's transaction stays usable and
        // no partial row survives a caught 402.
        await client.query(`ROLLBACK TO SAVEPOINT ${scope}`);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        throw new InsufficientCreditsError(price, locked.balance);
      }

      const { rows: chargeRows } = await client.query<{ id: string }>(
        `INSERT INTO mhc_action_charges (
           user_id, action_key, reference_type, reference_id, mhc_charged, idempotency_key
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [input.userId, actionKey, referenceType, referenceId, price, idempotencyKey],
      );
      const chargeId = chargeRows[0]!.id;

      // Guarded debit. The predicate is the database-level guarantee that the
      // balance cannot go negative; `chk_wallets_balance_nonnegative` is the
      // backstop behind it. Arithmetic happens in NUMERIC, not in JS floats.
      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance - $2::numeric
         WHERE id = $1 AND balance >= $2::numeric
         RETURNING balance::text`,
        [wallet.id, price],
      );
      if (walletRows.length === 0) {
        await client.query(`ROLLBACK TO SAVEPOINT ${scope}`);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        throw new InsufficientCreditsError(price, locked.balance);
      }
      const balanceAfter = parseFloat(walletRows[0]!.balance);

      const transactionId = await this.writeCreditLedgerRow(client, {
        walletId: wallet.id,
        userId: input.userId,
        type: 'payment',
        amount: price,
        balanceDelta: -price,
        balanceAfter,
        description: input.description ?? `MHC action charge (${actionKey})`,
        referenceType: ACTION_CHARGE_REFERENCE_TYPE,
        referenceId: chargeId,
        metadata: {
          ...(input.metadata ?? {}),
          action_key: actionKey,
          charge_id: chargeId,
          charge_reference_type: referenceType,
          charge_reference_id: referenceId,
          ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        },
        createdBy: input.actorUserId ?? null,
      });

      await client.query(`UPDATE mhc_action_charges SET transaction_id = $2 WHERE id = $1`, [
        chargeId,
        transactionId,
      ]);

      await client.query(`RELEASE SAVEPOINT ${scope}`);
      return {
        outcome: 'charged',
        chargeId,
        transactionId,
        mhcCharged: price,
        balanceAfter,
        alreadyCharged: false,
      };
    } catch (e) {
      if (sqlState(e) === '23505') {
        // Lost the insert race against an identical request. Unwind to the
        // scope — the caller's transaction is untouched — and report the charge
        // that won, so a double submit is a no-op rather than an error.
        await client.query(`ROLLBACK TO SAVEPOINT ${scope}`);
        const winner = await this.findExistingCharge(client, {
          userId: input.userId,
          actionKey,
          referenceType,
          referenceId,
          idempotencyKey,
        });
        const balance = await this.readCreditBalance(client, input.userId);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        if (winner) return this.existingChargeResult(winner, balance);
        throw e;
      }
      if (e instanceof InsufficientCreditsError || e instanceof MhcTransactionRequiredError) {
        throw e;
      }
      // Everything else (frozen wallet, bad config, an unexpected database
      // error) unwinds to the scope so the caller decides whether to abandon
      // its own transaction or carry on without this charge.
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${scope}`);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
      } catch {
        /* the caller's transaction is already unusable; the original error wins */
      }
      throw e;
    }
  }

  /**
   * Refund a previously recorded generic action charge, inside the caller's
   * transaction.
   *
   * Never a balance edit on its own: the credit and the `refunded_at` stamp are
   * written together with a `refund` ledger row, so the wallet can always be
   * reconciled from the ledger alone.
   *
   * Concurrency: the charge row is locked FIRST. A second refund blocks on that
   * lock, then re-reads the row (READ COMMITTED re-evaluates a locked row) and
   * finds `refunded_at` already set, so it credits nothing.
   */
  async refundActionCharge(input: RefundMhcActionInput): Promise<RefundMhcActionResult> {
    const { client } = input;
    const reason = input.reason.trim();
    if (!reason) throw new MhcInvalidChargeReferenceError('reason');
    if (!UUID_PATTERN.test(input.chargeId)) {
      throw new MhcChargeNotFoundError(input.chargeId);
    }

    const scope = await this.openChargeScope(client);
    try {
      const { rows } = await client.query<MhcActionChargeRow>(
        `SELECT ${CHARGE_COLUMNS} FROM mhc_action_charges WHERE id = $1 FOR UPDATE`,
        [input.chargeId],
      );
      const charge = rows[0];
      if (!charge) {
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        throw new MhcChargeNotFoundError(input.chargeId);
      }

      const amount = parseFloat(charge.mhc_charged);

      if (charge.refunded_at != null) {
        const balance = await this.readCreditBalance(client, charge.user_id);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        return {
          outcome: 'already_refunded',
          chargeId: charge.id,
          refundTransactionId: charge.refund_transaction_id,
          mhcRefunded: 0,
          balanceAfter: balance,
          alreadyRefunded: true,
        };
      }

      // A zero-value charge cannot produce a positive refund. Nothing is written
      // at all, so repeating the call keeps returning the same answer rather
      // than closing a row that was never open.
      if (!(amount > 0)) {
        const balance = await this.readCreditBalance(client, charge.user_id);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
        return {
          outcome: 'nothing_to_refund',
          chargeId: charge.id,
          refundTransactionId: null,
          mhcRefunded: 0,
          balanceAfter: balance,
          alreadyRefunded: false,
        };
      }

      // A frozen wallet does not block a refund: freezing an account must not
      // destroy credits the platform already owes back. Matches grantCredits,
      // which likewise credits without a freeze check.
      const wallet = await this.getOrCreateCreditWalletInTx(client, charge.user_id);
      await this.lockCreditWallet(client, wallet.id);

      const { rows: walletRows } = await client.query<{ balance: string }>(
        `UPDATE wallets SET balance = balance + $2::numeric WHERE id = $1
         RETURNING balance::text`,
        [wallet.id, amount],
      );
      const balanceAfter = parseFloat(walletRows[0]!.balance);

      const refundTransactionId = await this.writeCreditLedgerRow(client, {
        walletId: wallet.id,
        userId: charge.user_id,
        type: 'refund',
        amount,
        balanceDelta: amount,
        balanceAfter,
        description: `MHC action refund (${charge.action_key})`,
        referenceType: ACTION_REFUND_REFERENCE_TYPE,
        referenceId: charge.id,
        metadata: {
          ...(input.metadata ?? {}),
          action_key: charge.action_key,
          charge_id: charge.id,
          charge_reference_type: charge.reference_type,
          charge_reference_id: charge.reference_id,
          charge_transaction_id: charge.transaction_id,
          refund_reason: reason,
          ...(charge.idempotency_key ? { idempotency_key: charge.idempotency_key } : {}),
        },
        createdBy: input.actorUserId ?? null,
      });

      // Guarded: if anything refunded this row between the lock and here, the
      // update matches nothing and we refuse rather than credit twice.
      const marked = await client.query(
        `UPDATE mhc_action_charges
         SET refunded_at = now(), refund_transaction_id = $2
         WHERE id = $1 AND refunded_at IS NULL`,
        [charge.id, refundTransactionId],
      );
      if (marked.rowCount !== 1) {
        throw new Error('MHC_REFUND_STATE_CHANGED');
      }

      await client.query(`RELEASE SAVEPOINT ${scope}`);
      return {
        outcome: 'refunded',
        chargeId: charge.id,
        refundTransactionId,
        mhcRefunded: amount,
        balanceAfter,
        alreadyRefunded: false,
      };
    } catch (e) {
      if (e instanceof MhcChargeNotFoundError || e instanceof MhcTransactionRequiredError) {
        throw e;
      }
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${scope}`);
        await client.query(`RELEASE SAVEPOINT ${scope}`);
      } catch {
        /* the caller's transaction is already unusable; the original error wins */
      }
      throw e;
    }
  }

  /**
   * Balance without creating a wallet. A free action must not have the side
   * effect of provisioning a credit account for someone who has never had one.
   */
  private async readCreditBalance(client: PoolClient, userId: string): Promise<number> {
    const { rows } = await client.query<{ balance: string }>(
      `SELECT balance::text FROM wallets
       WHERE user_id = $1 AND account_type = 'provider_credit'`,
      [userId],
    );
    return parseFloat(rows[0]?.balance ?? '0');
  }

  private existingChargeResult(charge: MhcActionChargeRow, balance: number): ChargeMhcActionResult {
    return {
      outcome: 'already_charged',
      chargeId: charge.id,
      transactionId: charge.transaction_id,
      mhcCharged: parseFloat(charge.mhc_charged),
      balanceAfter: balance,
      alreadyCharged: true,
    };
  }
}
