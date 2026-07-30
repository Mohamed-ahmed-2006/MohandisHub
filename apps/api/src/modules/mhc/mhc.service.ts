// ---------------------------------------------------------------------------
// MHC (Mohandis Credits) service — business rules for the closed-loop credit
// ---------------------------------------------------------------------------
// Launch model: customers pay providers DIRECTLY. MohandisHub never holds
// customer job money. The platform's only revenue rail is MHC, a non-cashable
// credit that providers buy and spend on platform actions (award/booking
// activation, promotions, plans, ads).
//
// Because MHC can never be withdrawn, converted back to money, or transferred
// between users, it is a prepaid access product rather than stored value.
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { createInvoice, verifyNowPaymentsIpnSignature } from '../../lib/nowpayments.client.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProviderPaymentsService } from '../provider-payments/provider-payments.service.js';

import {
  ActivationStateError,
  InsufficientCreditsError,
  MhcActionDisabledError,
  MhcActionPriceMissingError,
  MhcActionScopePriceMissingError,
  MhcChargeNotFoundError,
  MhcInvalidChargeReferenceError,
  MhcRepository,
  MhcTransactionRequiredError,
  type ChargeMhcActionResult,
  type CreditPurchaseRow,
  type MhcActionChargeRow,
  type MhcActionPriceRow,
  type MhcPriceScope,
  type MhcCreditPackageRow,
  type RefundMhcActionResult,
} from './mhc.repository.js';

/** Roles allowed to hold and spend MHC. Customers never buy credits. */
const PROVIDER_ROLES = new Set(['expert', 'craftsman', 'business']);

/** Max concurrent unreviewed manual purchases per provider (anti-spam). */
const MAX_PENDING_PURCHASES_PER_USER = 3;

/**
 * Payment-provider statuses that mean the money is SETTLED and credits may be
 * granted. Deliberately an allow-list, not a deny-list: an unrecognised status
 * must never grant.
 *
 * 'finished' matches how the existing EGP deposit rail treats NOWPayments
 * (see WalletService.handleNowPaymentsDepositIpn). Statuses such as `waiting`,
 * `confirming`, `sending`, `partially_paid`, `failed`, `refunded` and `expired`
 * are NOT settled.
 */
const SETTLED_PROVIDER_STATUSES = new Set(['finished']);

export type MhcActionKey =
  | 'award_activation'
  | 'booking_activation'
  | 'subscription_upgrade'
  | 'advertisement'
  | 'service_promotion'
  | 'featured_provider'
  | 'promoted_proposal';

export class MhcService {
  private repo = new MhcRepository();
  private notifications = new NotificationsService();

  /** Lazily constructed to avoid a module cycle with the payments service. */
  private get providerPayments(): ProviderPaymentsService {
    this.providerPaymentsInstance ??= new ProviderPaymentsService();
    return this.providerPaymentsInstance;
  }
  private providerPaymentsInstance: ProviderPaymentsService | undefined;

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------
  private assertProviderRole(role: string): void {
    if (!PROVIDER_ROLES.has(role)) {
      throw new HttpError({
        statusCode: 403,
        code: 'MHC_PROVIDERS_ONLY',
        message: 'Only providers (expert, craftsman, business) can hold or buy credits.',
      });
    }
  }

  private async assertFeatureEnabled(flag: string): Promise<void> {
    const { rows } = await getPool().query<{ enabled: boolean | null }>(
      `SELECT (payment_methods_enabled ->> $1)::boolean AS enabled
       FROM app_settings LIMIT 1`,
      [flag],
    );
    if (rows[0]?.enabled !== true) {
      throw new HttpError({
        statusCode: 503,
        code: 'MHC_METHOD_DISABLED',
        message: 'This credit purchase method is currently unavailable.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------
  async getMyCredits(params: { userId: string; role: string }): Promise<{
    balance: number;
    currencyLabel: 'MHC';
    withdrawable: false;
    packages: MhcCreditPackageRow[];
  }> {
    this.assertProviderRole(params.role);
    await this.repo.getOrCreateCreditWallet(params.userId);
    const [balance, packages] = await Promise.all([
      this.repo.getBalance(params.userId),
      this.repo.listCreditPackages(true),
    ]);
    return { balance, currencyLabel: 'MHC', withdrawable: false, packages };
  }

  async listMyCreditTransactions(params: {
    userId: string;
    role: string;
    page: number;
    limit: number;
  }): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    this.assertProviderRole(params.role);
    return this.repo.listTransactions(params.userId, params.page, params.limit);
  }

  /** A provider's own purchase history, so in-flight requests are visible. */
  async listMyCreditPurchases(params: {
    userId: string;
    role: string;
    page: number;
    limit: number;
  }): Promise<{ rows: CreditPurchaseRow[]; total: number }> {
    this.assertProviderRole(params.role);
    return this.repo.listCreditPurchasesForUser({
      userId: params.userId,
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
    });
  }

  async listPackages(): Promise<MhcCreditPackageRow[]> {
    return this.repo.listCreditPackages(true);
  }

  async listActionPrices(): Promise<MhcActionPriceRow[]> {
    return this.repo.listActionPrices();
  }

  /** Price a provider will pay for an action, or 0 when the action is free. */
  async getEffectivePrice(actionKey: MhcActionKey): Promise<number> {
    const row = await this.repo.getActionPrice(actionKey);
    if (!row || !row.is_active) return 0;
    return parseFloat(row.mhc_price);
  }

  // -------------------------------------------------------------------------
  // Purchases — manual InstaPay (launch rail)
  // -------------------------------------------------------------------------
  /**
   * Provider declares an InstaPay transfer to the platform's collection account
   * and uploads proof. Credits are granted only after admin approval, so the
   * platform never auto-credits on an unverified claim.
   */
  async submitInstapayCreditPurchase(params: {
    userId: string;
    role: string;
    packageId: string;
    proofUploadId: string;
    transferReference: string;
  }): Promise<{ id: string; orderId: string; status: string; mhcOnApproval: number }> {
    this.assertProviderRole(params.role);
    await this.assertFeatureEnabled('credit_purchase_instapay');

    // The transfer reference is what makes a manual transfer traceable and what
    // uq_deposit_requests_credit_purchase_reference deduplicates on. Without it
    // the same transfer can be claimed repeatedly, so it is required rather than
    // optional — the anti-reuse index does nothing on NULLs.
    const transferReference = params.transferReference.trim();
    if (transferReference.length < 3) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_TRANSFER_REFERENCE_REQUIRED',
        message: 'Enter the InstaPay transfer reference shown on your receipt.',
      });
    }

    const pkg = await this.repo.findCreditPackageById(params.packageId);
    if (!pkg || !pkg.is_active) {
      throw new HttpError({
        statusCode: 404,
        code: 'MHC_PACKAGE_NOT_FOUND',
        message: 'Credit package not found or inactive.',
      });
    }

    const pending = await this.repo.countPendingCreditPurchasesForUser(params.userId);
    if (pending >= MAX_PENDING_PURCHASES_PER_USER) {
      throw new HttpError({
        statusCode: 429,
        code: 'MHC_TOO_MANY_PENDING_PURCHASES',
        message: 'You already have credit purchases awaiting review. Please wait for approval.',
      });
    }

    // Proof must belong to the requesting user.
    const { rows: proofRows } = await getPool().query<{ id: string }>(
      `SELECT id FROM private_uploads WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [params.proofUploadId, params.userId],
    );
    if (proofRows.length === 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_PROOF',
        message: 'Payment proof upload was not found for this account.',
      });
    }

    const destination = await this.getInstapayCollectionAccount();
    const orderId = `MHC-IP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    try {
      const created = await this.repo.createCreditPurchase({
        userId: params.userId,
        orderId,
        provider: 'instapay_manual',
        status: 'pending_review',
        pkg,
        proofUploadId: params.proofUploadId,
        transferReference,
        destinationAccountSnapshot: destination,
        // Snapshot the package as it was sold. `credit_package_id` is only a
        // pointer: an admin editing the package later would otherwise rewrite
        // what this purchase appears to have been for.
        providerPayload: {
          package_snapshot: {
            id: pkg.id,
            code: pkg.code,
            name: pkg.name,
            mhc_amount: pkg.mhc_amount,
            external_price_amount: pkg.external_price_amount,
            external_price_currency: pkg.external_price_currency,
            snapshotted_at: new Date().toISOString(),
          },
        },
      });
      return {
        id: created.id,
        orderId: created.order_id,
        status: created.status,
        mhcOnApproval: parseFloat(pkg.mhc_amount),
      };
    } catch (e) {
      // uq_deposit_requests_credit_purchase_reference blocks reusing a transfer
      // reference. The pre-20260729090000 name is matched too, so an environment
      // that has not yet applied the scope fix still gets a clean 409 rather than
      // a raw constraint error.
      if (
        e instanceof Error &&
        /uq_deposit_requests_(credit_purchase|instapay)_reference/.test(e.message)
      ) {
        throw new HttpError({
          statusCode: 409,
          code: 'MHC_TRANSFER_REFERENCE_ALREADY_USED',
          message: 'This transfer reference has already been submitted.',
        });
      }
      throw e;
    }
  }

  // -------------------------------------------------------------------------
  // Purchases — NOWPayments (automated crypto rail)
  // -------------------------------------------------------------------------
  /**
   * Create a NOWPayments invoice for an MHC package.
   *
   * The price is taken from the SERVER-side package row, never from the client:
   * a client-supplied amount would let a provider buy any package for any price.
   * The package is snapshotted onto the purchase so a later admin price edit
   * cannot retroactively change what this purchase was for.
   *
   * Nothing is credited here. Credits are granted only by a signature-verified
   * IPN reporting a settled payment (see handleNowPaymentsCreditIpn).
   */
  async createNowPaymentsCreditPurchase(params: {
    userId: string;
    role: string;
    packageId: string;
    payCurrency?: string | null;
  }): Promise<{ id: string; orderId: string; invoiceUrl: string | null; mhcOnPayment: number }> {
    this.assertProviderRole(params.role);
    await this.assertFeatureEnabled('credit_purchase_nowpayments');

    // Fail CLOSED on incomplete configuration. Creating an invoice we cannot
    // later verify the callback for would leave paid purchases unfulfillable.
    if (!env.NOWPAYMENTS_API_KEY || !env.NOWPAYMENTS_IPN_SECRET) {
      throw new HttpError({
        statusCode: 503,
        code: 'MHC_CRYPTO_NOT_CONFIGURED',
        message: 'Crypto credit purchase is not available right now.',
      });
    }

    const pkg = await this.repo.findCreditPackageById(params.packageId);
    if (!pkg || !pkg.is_active) {
      throw new HttpError({
        statusCode: 404,
        code: 'MHC_PACKAGE_NOT_FOUND',
        message: 'Credit package not found or inactive.',
      });
    }

    const pending = await this.repo.countPendingCreditPurchasesForUser(params.userId);
    if (pending >= MAX_PENDING_PURCHASES_PER_USER) {
      throw new HttpError({
        statusCode: 429,
        code: 'MHC_TOO_MANY_PENDING_PURCHASES',
        message: 'You already have credit purchases awaiting payment or review.',
      });
    }

    const orderId = `MHC-NP-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const priceAmount = parseFloat(pkg.external_price_amount);
    const apiBase = env.API_PUBLIC_URL?.replace(/\/$/, '') ?? '';

    const invoice = await createInvoice(env.NOWPAYMENTS_API_KEY, {
      price_amount: priceAmount,
      price_currency: pkg.external_price_currency,
      ...(params.payCurrency ? { pay_currency: params.payCurrency } : {}),
      order_id: orderId,
      order_description: `MohandisHub credits: ${pkg.name}`,
      ipn_callback_url: `${apiBase}/api/credits/nowpayments/ipn`,
      is_fixed_rate: true,
    });

    const created = await this.repo.createCreditPurchase({
      userId: params.userId,
      orderId,
      provider: 'nowpayments',
      status: 'pending',
      pkg,
      providerInvoiceId: invoice.id != null ? String(invoice.id) : null,
      checkoutUrl: invoice.invoice_url ?? null,
      // Everything needed to reconcile the callback against what we sold.
      providerPayload: {
        package_snapshot: {
          id: pkg.id,
          code: pkg.code,
          name: pkg.name,
          mhc_amount: pkg.mhc_amount,
          external_price_amount: pkg.external_price_amount,
          external_price_currency: pkg.external_price_currency,
          snapshotted_at: new Date().toISOString(),
        },
        expected_price_amount: priceAmount,
        expected_price_currency: pkg.external_price_currency,
        nowpayments_invoice: {
          id: invoice.id != null ? String(invoice.id) : null,
          invoice_url: invoice.invoice_url ?? null,
          pay_currency: invoice.pay_currency ?? null,
        },
      },
    });

    return {
      id: created.id,
      orderId: created.order_id,
      invoiceUrl: invoice.invoice_url ?? null,
      mhcOnPayment: parseFloat(pkg.mhc_amount),
    };
  }

  /**
   * Handle a NOWPayments IPN for an MHC credit purchase.
   *
   * Order of operations matters and is deliberate:
   *   1. Reject unverified callbacks outright — no database work at all.
   *   2. Resolve the purchase; ignore callbacks for unknown orders.
   *   3. Reconcile the amount actually paid against the price we snapshotted.
   *      Any shortfall routes to ADMIN REVIEW rather than being guessed at.
   *   4. Only then hand off to fulfilment, which independently re-checks the
   *      provider status and locks the row.
   */
  async handleNowPaymentsCreditIpn(
    rawBody: string,
    signatureHeader: string,
  ): Promise<{ handled: boolean; fulfilled: boolean; reason?: string }> {
    if (!env.NOWPAYMENTS_IPN_SECRET) {
      throw new HttpError({
        statusCode: 503,
        code: 'IPN_NOT_CONFIGURED',
        message: 'NOWPayments IPN secret is not configured.',
      });
    }
    if (!verifyNowPaymentsIpnSignature(rawBody, signatureHeader, env.NOWPAYMENTS_IPN_SECRET)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid NOWPayments IPN signature.',
      });
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const readString = (v: unknown): string | null =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
    const readNumber = (v: unknown): number | null => {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
      return Number.isFinite(n) ? n : null;
    };

    const providerStatus = (
      readString(payload.payment_status) ??
      readString(payload.status) ??
      'unknown'
    ).toLowerCase();
    const orderId = readString(payload.order_id);
    const providerPaymentId = readString(payload.payment_id) ?? readString(payload.id);

    if (!orderId) return { handled: false, fulfilled: false, reason: 'no order_id' };

    const purchase = await this.repo.findCreditPurchaseByOrderId(orderId);
    if (!purchase) return { handled: false, fulfilled: false, reason: 'unknown order' };

    // A child payment of a split/partial settlement. The parent callback is the
    // authoritative one; crediting on a child would double-count.
    if (readString(payload.parent_payment_id)) {
      await this.repo.recordPurchaseProviderState({
        purchaseId: purchase.id,
        providerStatus: `${providerStatus}_child`,
        providerPaymentId,
        providerPayload: { nowpayments: payload },
      });
      return { handled: true, fulfilled: false, reason: 'child payment ignored' };
    }

    // Amount reconciliation. `actually_paid` is in the pay currency, so we
    // compare the invoice-denominated fields NOWPayments echoes back.
    const expected = parseFloat(purchase.external_price_amount ?? '0');
    const outcomeAmount = readNumber(payload.price_amount);
    const paidAmount = readNumber(payload.actually_paid) ?? readNumber(payload.pay_amount);
    const outcomeCurrency = readString(payload.price_currency)?.toUpperCase() ?? null;
    const expectedCurrency = (purchase.external_price_currency ?? 'EGP').toUpperCase();

    const currencyMismatch = outcomeCurrency != null && outcomeCurrency !== expectedCurrency;
    const amountMismatch =
      outcomeAmount != null && expected > 0 && Math.abs(outcomeAmount - expected) > 0.01;

    if (SETTLED_PROVIDER_STATUSES.has(providerStatus) && (currencyMismatch || amountMismatch)) {
      // DO NOT GUESS. A settled payment that does not match what we sold is an
      // exception, and the decision (credit less, credit in full, refund) is a
      // commercial one. Park it for a human with everything they need.
      await this.repo.recordPurchaseProviderState({
        purchaseId: purchase.id,
        providerStatus: 'amount_mismatch_review',
        providerPaymentId,
        providerPayload: {
          nowpayments: payload,
          reconciliation: {
            expected_amount: expected,
            expected_currency: expectedCurrency,
            reported_amount: outcomeAmount,
            reported_currency: outcomeCurrency,
            actually_paid: paidAmount,
            flagged_at: new Date().toISOString(),
          },
        },
      });
      return { handled: true, fulfilled: false, reason: 'amount mismatch — held for review' };
    }

    const result = await this.fulfilPurchaseFromWebhook({
      orderId,
      providerStatus,
      providerPaymentId,
      providerPayload: { nowpayments: payload },
    });

    if (!result) return { handled: false, fulfilled: false, reason: 'unknown order' };
    return {
      handled: true,
      fulfilled: result.fulfilled,
      ...(result.reason ? { reason: result.reason } : {}),
    };
  }

  /** Platform InstaPay collection details shown to providers buying credits. */
  async getInstapayCollectionAccount(): Promise<Record<string, unknown>> {
    const { rows } = await getPool().query<{ instapay_deposit_account: unknown }>(
      `SELECT instapay_deposit_account FROM app_settings LIMIT 1`,
    );
    const account = rows[0]?.instapay_deposit_account;
    return account && typeof account === 'object' ? (account as Record<string, unknown>) : {};
  }

  // -------------------------------------------------------------------------
  // Purchases — admin review
  // -------------------------------------------------------------------------
  async listPurchasesForAdmin(params: { status?: string; page: number; limit: number }) {
    const offset = (params.page - 1) * params.limit;
    return this.repo.listCreditPurchasesForAdmin({
      ...(params.status ? { status: params.status } : {}),
      limit: params.limit,
      offset,
    });
  }

  async approvePurchase(params: {
    purchaseId: string;
    adminId: string;
    /** Admin may grant a corrected amount when the transfer was short/over. */
    overrideMhcAmount?: number | null;
  }): Promise<{ mhcGranted: number; balance: number; alreadyGranted: boolean }> {
    if (params.overrideMhcAmount != null && !(params.overrideMhcAmount > 0)) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_GRANT_AMOUNT',
        message: 'The corrected credit amount must be greater than zero.',
      });
    }

    const result = await this.repo.fulfillCreditPurchase({
      purchaseId: params.purchaseId,
      reviewedBy: params.adminId,
      providerStatus: 'admin_approved',
      overrideMhcAmount: params.overrideMhcAmount ?? null,
    });

    switch (result.outcome) {
      case 'fulfilled':
        return { mhcGranted: result.mhcGranted, balance: result.balance, alreadyGranted: false };
      // Approving twice is safe and reports the existing state rather than
      // pretending a second grant happened.
      case 'already_fulfilled':
        return { mhcGranted: 0, balance: result.balance, alreadyGranted: true };
      case 'not_found':
        throw new HttpError({
          statusCode: 404,
          code: 'MHC_PURCHASE_NOT_FOUND',
          message: 'Credit purchase not found.',
        });
      case 'not_actionable':
        throw new HttpError({
          statusCode: 409,
          code: 'MHC_PURCHASE_NOT_ACTIONABLE',
          message: `This purchase cannot be approved because it is '${result.status}'.`,
          details: { status: result.status },
        });
    }
  }

  async rejectPurchase(params: {
    purchaseId: string;
    adminId: string;
    reason: string;
  }): Promise<CreditPurchaseRow> {
    const row = await this.repo.rejectCreditPurchase({
      purchaseId: params.purchaseId,
      reviewedBy: params.adminId,
      reason: params.reason,
    });
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'MHC_PURCHASE_NOT_ACTIONABLE',
        message: 'Credit purchase not found or already resolved.',
      });
    }
    return row;
  }

  /**
   * Fulfil a purchase from a VERIFIED payment-provider webhook.
   *
   * The caller is responsible for authenticating the callback (signature check)
   * before calling this. This method is responsible for the second half: only a
   * provider status that explicitly means "settled" may grant credits. The
   * previous implementation passed any status straight through to fulfilment, so
   * a `failed` or `expired` callback would have granted in full.
   *
   * Non-settled callbacks are still recorded against the purchase for audit —
   * they simply do not move credits.
   */
  async fulfilPurchaseFromWebhook(params: {
    orderId: string;
    providerStatus: string;
    providerPaymentId?: string | null;
    providerPayload?: Record<string, unknown>;
  }): Promise<{ fulfilled: boolean; reason?: string } | null> {
    const purchase = await this.repo.findCreditPurchaseByOrderId(params.orderId);
    if (!purchase) return null;

    const normalizedStatus = params.providerStatus.toLowerCase().trim();
    if (!SETTLED_PROVIDER_STATUSES.has(normalizedStatus)) {
      // Record the callback without granting anything.
      await this.repo.recordPurchaseProviderState({
        purchaseId: purchase.id,
        providerStatus: normalizedStatus,
        providerPaymentId: params.providerPaymentId ?? null,
        ...(params.providerPayload ? { providerPayload: params.providerPayload } : {}),
      });
      return { fulfilled: false, reason: `provider status '${normalizedStatus}' is not settled` };
    }

    const result = await this.repo.fulfillCreditPurchase({
      purchaseId: purchase.id,
      providerStatus: normalizedStatus,
      providerPaymentId: params.providerPaymentId ?? null,
      ...(params.providerPayload ? { providerPayload: params.providerPayload } : {}),
    });

    switch (result.outcome) {
      case 'fulfilled':
        return { fulfilled: true };
      case 'already_fulfilled':
        return { fulfilled: false, reason: 'already fulfilled' };
      case 'not_found':
        return null;
      case 'not_actionable':
        return { fulfilled: false, reason: `purchase is '${result.status}'` };
    }
  }

  // -------------------------------------------------------------------------
  // Activation spending (the anti-bypass revenue gate)
  // -------------------------------------------------------------------------
  /**
   * Charge the provider for unlocking an awarded job. Called when the provider
   * ACCEPTS an award — not when the customer awards it — so a provider is never
   * billed for work they did not agree to take.
   */
  async activateAward(params: {
    providerUserId: string;
    actingUserId: string;
    bidId: string;
    needId?: string | null;
  }): Promise<{ mhcCharged: number; balance: number; alreadyActivated: boolean }> {
    return this.chargeOrThrow({
      activationType: 'award',
      actionKey: 'award_activation',
      providerUserId: params.providerUserId,
      actingUserId: params.actingUserId,
      bidId: params.bidId,
      needId: params.needId ?? null,
      description: 'Award activation (unlock customer contact & job workspace)',
    });
  }

  /**
   * Provider-facing entry point: the provider ACCEPTS a pending award and pays the
   * MHC activation price. Charging is provider-initiated (never at customer
   * award) so a provider is never billed for a job they did not accept.
   *
   * The MHC debit and the "job is open" state change happen in ONE transaction
   * (see MhcRepository.chargeActivation + markAwardAcceptedInTransaction), so we
   * can never end up having taken credits without opening the job, or vice versa.
   */
  async activateAwardForProvider(params: { userId: string; role: string; bidId: string }): Promise<{
    mhcCharged: number;
    balance: number;
    alreadyActivated: boolean;
    needId: string;
  }> {
    this.assertProviderRole(params.role);

    const { rows } = await getPool().query<{
      bid_id: string;
      need_id: string;
      expert_id: string;
      bid_status: string;
      need_status: string;
      awarded_bid_id: string | null;
      pending_award_bid_id: string | null;
      pending_award_expires_at: string | null;
      activated_at: string | null;
    }>(
      `SELECT b.id AS bid_id, b.need_id, b.expert_id, b.status AS bid_status,
              n.status AS need_status, n.awarded_bid_id,
              n.pending_award_bid_id, n.pending_award_expires_at, n.activated_at
       FROM bids b
       JOIN needs n ON n.id = b.need_id
       WHERE b.id = $1`,
      [params.bidId],
    );
    const bid = rows[0];
    if (!bid) {
      throw new HttpError({
        statusCode: 404,
        code: 'BID_NOT_FOUND',
        message: 'Bid not found.',
      });
    }
    if (bid.expert_id !== params.userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'NOT_BID_OWNER',
        message: 'You can only activate your own bid.',
      });
    }

    // Already paid for: return the existing state rather than charging again.
    if (bid.activated_at != null && bid.awarded_bid_id === bid.bid_id) {
      const balance = await this.repo.getBalance(params.userId);
      return { mhcCharged: 0, balance, alreadyActivated: true, needId: bid.need_id };
    }

    // The customer must currently be offering THIS bid.
    const isPendingForThisBid =
      bid.need_status === 'awarded_pending_provider_acceptance' &&
      bid.pending_award_bid_id === bid.bid_id &&
      bid.bid_status === 'awarded_pending';
    if (!isPendingForThisBid) {
      throw new HttpError({
        statusCode: 409,
        code: 'BID_NOT_AWARDED',
        message: 'This bid has not been awarded to you, or the award is no longer available.',
      });
    }

    // Expired offers must not be chargeable — otherwise a provider could spend
    // credits on a job the customer has already moved on from.
    if (bid.pending_award_expires_at != null) {
      const expiresAt = new Date(bid.pending_award_expires_at).getTime();
      if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        throw new HttpError({
          statusCode: 409,
          code: 'AWARD_OFFER_EXPIRED',
          message: 'This award offer has expired. No credits were charged.',
        });
      }
    }

    // Decision D5: a provider must have somewhere to be paid BEFORE any credits
    // are debited. Checking after the charge would take real money for a job the
    // customer then has no way to pay for.
    await this.providerPayments.assertHasActivePaymentMethod(params.userId);

    const result = await this.activateAward({
      providerUserId: params.userId,
      actingUserId: params.userId,
      bidId: bid.bid_id,
      needId: bid.need_id,
    });
    return { ...result, needId: bid.need_id };
  }

  /**
   * Provider declines a pending award. No MHC is charged and the need reopens so
   * the customer can select someone else.
   */
  async rejectAwardForProvider(params: {
    userId: string;
    role: string;
    bidId: string;
  }): Promise<{ needId: string; rejected: true }> {
    this.assertProviderRole(params.role);

    const { rows } = await getPool().query<{
      bid_id: string;
      need_id: string;
      expert_id: string;
      bid_status: string;
      need_status: string;
      customer_id: string;
    }>(
      `SELECT b.id AS bid_id, b.need_id, b.expert_id, b.status AS bid_status,
              n.status AS need_status, n.customer_id
       FROM bids b
       JOIN needs n ON n.id = b.need_id
       WHERE b.id = $1`,
      [params.bidId],
    );
    const bid = rows[0];
    if (!bid) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found.' });
    }
    if (bid.expert_id !== params.userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'NOT_BID_OWNER',
        message: 'You can only decline your own award.',
      });
    }
    if (
      bid.bid_status !== 'awarded_pending' ||
      bid.need_status !== 'awarded_pending_provider_acceptance'
    ) {
      throw new HttpError({
        statusCode: 409,
        code: 'NO_PENDING_AWARD',
        message: 'There is no pending award to decline on this bid.',
      });
    }

    const { released } = await this.repo.releasePendingAwardForBid(
      bid.need_id,
      bid.bid_id,
      'rejected',
    );
    if (!released) {
      // The offer moved on between the check above and the locked release —
      // most likely the customer withdrew it or it expired.
      throw new HttpError({
        statusCode: 409,
        code: 'NO_PENDING_AWARD',
        message: 'This award is no longer pending.',
      });
    }

    void this.notifications
      .createForUser(bid.customer_id, {
        type: 'need_bid_rejected',
        title: 'Provider declined',
        message: 'The provider declined your award. You can select another provider.',
        payload: { needId: bid.need_id, bidId: bid.bid_id, reason: 'declined' },
      })
      .catch(() => {});

    return { needId: bid.need_id, rejected: true };
  }

  /**
   * The customer withdraws an award they made, before the provider accepts.
   *
   * Decision D4 pairs this with expiry: without it a customer is stuck behind a
   * silent provider for the whole acceptance window with no way out but closing
   * the need. Nothing is charged, and the bid returns to the pool so the same
   * provider can be chosen again later.
   */
  async withdrawAwardForCustomer(params: {
    userId: string;
    needId: string;
  }): Promise<{ needId: string; withdrawn: true; bidId: string }> {
    const { rows } = await getPool().query<{
      customer_id: string;
      status: string;
      pending_award_bid_id: string | null;
      expert_id: string | null;
    }>(
      `SELECT n.customer_id, n.status, n.pending_award_bid_id, b.expert_id
       FROM needs n
       LEFT JOIN bids b ON b.id = n.pending_award_bid_id
       WHERE n.id = $1`,
      [params.needId],
    );
    const need = rows[0];
    if (!need) {
      throw new HttpError({ statusCode: 404, code: 'NEED_NOT_FOUND', message: 'Need not found.' });
    }
    if (need.customer_id !== params.userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
    }
    if (need.status !== 'awarded_pending_provider_acceptance' || !need.pending_award_bid_id) {
      throw new HttpError({
        statusCode: 409,
        code: 'NO_PENDING_AWARD',
        message: 'There is no pending award to withdraw on this need.',
      });
    }

    const bidId = need.pending_award_bid_id;
    const { released } = await this.repo.releasePendingAwardForBid(
      params.needId,
      bidId,
      'withdrawn',
    );
    if (!released) {
      // The provider paid first. Their credits are spent, so the job stands.
      throw new HttpError({
        statusCode: 409,
        code: 'AWARD_ALREADY_ACTIVATED',
        message:
          'The provider already accepted and paid for this job, so the award can no longer be withdrawn.',
      });
    }

    if (need.expert_id) {
      void this.notifications
        .createForUser(need.expert_id, {
          type: 'need_bid_rejected',
          title: 'Award withdrawn',
          message:
            'The customer withdrew this award before it was activated. No credits were charged.',
          payload: { needId: params.needId, bidId, reason: 'withdrawn' },
        })
        .catch(() => {});
    }

    return { needId: params.needId, withdrawn: true, bidId };
  }

  /**
   * Release pending awards whose acceptance window has closed. Driven by the
   * expiry worker.
   */
  async expirePendingAwards(limit = 50): Promise<{ examined: number; released: number }> {
    const due = await this.repo.listExpiredPendingAwards(limit);
    let released = 0;

    for (const row of due) {
      const result = await this.repo.releasePendingAwardForBid(row.need_id, row.bid_id, 'expired');
      if (!result.released) continue;
      released += 1;

      void this.notifications
        .createForUser(row.provider_user_id, {
          type: 'need_bid_rejected',
          title: 'Award offer expired',
          message: 'You did not activate this job in time. No credits were charged.',
          payload: { needId: row.need_id, bidId: row.bid_id, reason: 'expired' },
        })
        .catch(() => {});
      void this.notifications
        .createForUser(row.customer_id, {
          type: 'need_bid_rejected',
          title: 'Award offer expired',
          message: 'The provider did not activate in time. You can select another provider.',
          payload: { needId: row.need_id, bidId: row.bid_id, reason: 'expired' },
        })
        .catch(() => {});
    }

    return { examined: due.length, released };
  }

  /** Charge the provider for accepting a service booking. */

  async activateBooking(params: {
    providerUserId: string;
    actingUserId: string;
    reservationId: string;
  }): Promise<{ mhcCharged: number; balance: number; alreadyActivated: boolean }> {
    return this.chargeOrThrow({
      activationType: 'booking',
      actionKey: 'booking_activation',
      providerUserId: params.providerUserId,
      actingUserId: params.actingUserId,
      reservationId: params.reservationId,
      description: 'Booking activation (unlock customer contact & job workspace)',
    });
  }

  private async chargeOrThrow(params: {
    activationType: 'award' | 'booking';
    actionKey: MhcActionKey;
    providerUserId: string;
    actingUserId: string;
    bidId?: string | null;
    reservationId?: string | null;
    needId?: string | null;
    description: string;
  }): Promise<{ mhcCharged: number; balance: number; alreadyActivated: boolean }> {
    try {
      const result = await this.repo.chargeActivation({
        activationType: params.activationType,
        providerUserId: params.providerUserId,
        actingUserId: params.actingUserId,
        actionKey: params.actionKey,
        bidId: params.bidId ?? null,
        reservationId: params.reservationId ?? null,
        needId: params.needId ?? null,
        description: params.description,
      });
      return {
        mhcCharged: result.mhcCharged,
        balance: result.balance,
        alreadyActivated: result.alreadyActivated,
      };
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        throw new HttpError({
          statusCode: 402,
          code: 'MHC_INSUFFICIENT_CREDITS',
          message: `You need ${e.required} MHC to activate this job. Your balance is ${e.available} MHC.`,
          details: { required: e.required, available: e.available },
        });
      }
      if (e instanceof Error && e.message === 'MHC_WALLET_FROZEN') {
        throw new HttpError({
          statusCode: 403,
          code: 'MHC_WALLET_FROZEN',
          message: 'Your credit account is frozen. Please contact support.',
        });
      }
      // Raised from inside the charging transaction with the need and bid rows
      // locked, so it reflects committed state. Nothing was charged.
      if (e instanceof ActivationStateError) {
        const messages: Record<ActivationStateError['reason'], string> = {
          BID_NOT_FOUND: 'Bid not found.',
          NOT_BID_OWNER: 'You can only activate your own bid.',
          BID_NOT_AWARDED: 'This bid has not been awarded to you.',
          AWARD_OFFER_EXPIRED: 'This award offer has expired. No credits were charged.',
          AWARD_STATE_CHANGED:
            'This award is no longer available — the customer changed their selection. No credits were charged.',
        };
        const statusCodes: Record<ActivationStateError['reason'], number> = {
          BID_NOT_FOUND: 404,
          NOT_BID_OWNER: 403,
          BID_NOT_AWARDED: 409,
          AWARD_OFFER_EXPIRED: 409,
          AWARD_STATE_CHANGED: 409,
        };
        throw new HttpError({
          statusCode: statusCodes[e.reason],
          code: e.reason,
          message: messages[e.reason],
        });
      }
      throw e;
    }
  }

  /** Has this award/booking already been paid for (gate open)? */
  async isActivated(params: {
    activationType: 'award' | 'booking';
    bidId?: string | null;
    reservationId?: string | null;
  }): Promise<boolean> {
    return this.repo.isActivated(params);
  }

  // -------------------------------------------------------------------------
  // Generic action charging (P0-07)
  // -------------------------------------------------------------------------
  // The reusable charge primitive for paid actions that are NOT activations.
  // Nothing consumes it yet — advertisements, subscriptions, bid fees, spotlight
  // and paid tools are each migrated onto it as their own change, so a defect in
  // any one of them cannot be attributed to the primitive.
  //
  // A consumer calls this from INSIDE its own transaction:
  //
  //   const client = await pool.connect();
  //   await client.query('BEGIN');
  //   const ad = await adsRepo.createInTransaction(client, ...);
  //   await mhcService.chargeAction({
  //     client, userId, actionKey: 'advertisement',
  //     referenceType: 'advertisement', referenceId: ad.id,
  //     idempotencyKey: `ad:${ad.id}`,
  //   });
  //   await client.query('COMMIT');
  //
  // If the ad insert fails, nothing is charged. If the charge fails, no ad
  // exists. There is no ordering of those two writes that can diverge.
  //
  // The caller remains responsible for its own authorization. This method
  // enforces only what is true of every MHC spend: the account must exist and
  // must be a provider account.

  async chargeAction(params: {
    client: PoolClient;
    userId: string;
    /**
     * A key in `mhc_action_prices`. Typed as a plain string, not MhcActionKey:
     * the price catalogue is admin-editable data, and a future consumer adding
     * a key must be able to charge for it without a code change here.
     */
    actionKey: string;
    referenceType: string;
    referenceId: string;
    idempotencyKey?: string | null;
    description?: string;
    metadata?: Record<string, unknown>;
    actorUserId?: string | null;
    /**
     * Price this action from a per-entity scope instead of the global catalogue.
     * Names the entity only; there is no way to pass an amount.
     */
    priceScope?: MhcPriceScope | null;
  }): Promise<ChargeMhcActionResult> {
    // Read through the caller's client so an account created earlier in the same
    // transaction is visible.
    const { rows } = await params.client.query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [params.userId],
    );
    const role = rows[0]?.primary_role;
    if (!role) {
      throw new HttpError({
        statusCode: 404,
        code: 'MHC_ACCOUNT_NOT_FOUND',
        message: 'The account being charged does not exist.',
      });
    }
    this.assertProviderRole(role);

    try {
      return await this.repo.chargeAction(params);
    } catch (e) {
      throw this.toChargeHttpError(e);
    }
  }

  /**
   * Reverse a generic action charge. Internal only for now: there is no public
   * refund endpoint and no consumer wired to it, by design — a refund policy is
   * per-action (a bid fee on an unawarded need is refundable, a spent ad is not)
   * and belongs with the consumer that defines it.
   */
  async refundActionCharge(params: {
    client: PoolClient;
    chargeId: string;
    reason: string;
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<RefundMhcActionResult> {
    try {
      return await this.repo.refundActionCharge(params);
    } catch (e) {
      throw this.toChargeHttpError(e);
    }
  }

  async findActionCharge(chargeId: string): Promise<MhcActionChargeRow | null> {
    return this.repo.findActionChargeById(chargeId);
  }

  // -------------------------------------------------------------------------
  // Scoped (per-entity) action pricing
  // -------------------------------------------------------------------------
  // Reads are public so a screen can DISPLAY a price. Charging never uses these:
  // it re-resolves the price inside the transaction from the same table, so what
  // a user was shown can never become what they are charged.

  async getScopedPrice(
    actionKey: string,
    scopeType: 'plan',
    scopeId: string,
  ): Promise<number | null> {
    return this.repo.getScopedActionPrice(actionKey, scopeType, scopeId);
  }

  /**
   * Provider credit balance, without the role guard that `getMyCredits` applies.
   * For internal consumers that have already authorised the caller and only need
   * a figure to report back.
   */
  async getBalanceFor(userId: string): Promise<number> {
    return this.repo.getBalance(userId);
  }

  async listScopedPrices(actionKey: string, scopeType: 'plan'): Promise<Map<string, number>> {
    return this.repo.listScopedActionPrices(actionKey, scopeType);
  }

  async setScopedPrice(params: {
    actionKey: string;
    scopeType: 'plan';
    scopeId: string;
    mhcPrice: number;
    updatedBy?: string | null;
  }): Promise<void> {
    // Rejects NaN and Infinity as well as negatives: a malformed decimal from an
    // admin form must not become a price.
    if (!Number.isFinite(params.mhcPrice) || params.mhcPrice < 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_PRICE',
        message: 'Credit price must be a number greater than or equal to zero.',
      });
    }
    await this.repo.setScopedActionPrice(params);
  }

  async clearScopedPrice(actionKey: string, scopeType: 'plan', scopeId: string): Promise<void> {
    await this.repo.clearScopedActionPrice(actionKey, scopeType, scopeId);
  }

  async listActionChargesForReference(
    referenceType: string,
    referenceId: string,
  ): Promise<MhcActionChargeRow[]> {
    return this.repo.listActionChargesForReference(referenceType, referenceId);
  }

  /**
   * Map the charge primitive's typed failures onto the HTTP conventions already
   * used by the activation path. Each state stays distinct: a provider who needs
   * to buy credits, an admin who switched an action off, and an unconfigured
   * action key are three different problems with three different fixes.
   */
  private toChargeHttpError(e: unknown): unknown {
    if (e instanceof InsufficientCreditsError) {
      return new HttpError({
        statusCode: 402,
        code: 'MHC_INSUFFICIENT_CREDITS',
        message: `You need ${e.required} MHC for this action. Your balance is ${e.available} MHC.`,
        details: { required: e.required, available: e.available },
      });
    }
    if (e instanceof MhcActionDisabledError) {
      return new HttpError({
        statusCode: 409,
        code: 'MHC_ACTION_DISABLED',
        message: 'This paid action is currently switched off.',
        details: { actionKey: e.actionKey },
      });
    }
    if (e instanceof MhcActionScopePriceMissingError) {
      // Distinct from a missing global price: this entity specifically has no
      // active price. Fails closed rather than falling back to a default.
      return new HttpError({
        statusCode: 503,
        code: 'MHC_ACTION_SCOPE_PRICE_MISSING',
        message: 'This item has no credit price configured and cannot be charged.',
        details: { actionKey: e.actionKey, scopeType: e.scope.scopeType },
      });
    }
    if (e instanceof MhcActionPriceMissingError) {
      // Fail CLOSED on absent configuration, exactly as isPaymentMethodEnabledStrict
      // does for retired money rails: an unpriced action is never given away.
      return new HttpError({
        statusCode: 503,
        code: 'MHC_ACTION_PRICE_MISSING',
        message: 'This action has no credit price configured and cannot be charged.',
        details: { actionKey: e.actionKey },
      });
    }
    if (e instanceof MhcChargeNotFoundError) {
      return new HttpError({
        statusCode: 404,
        code: 'MHC_CHARGE_NOT_FOUND',
        message: 'Credit charge not found.',
      });
    }
    if (e instanceof MhcInvalidChargeReferenceError) {
      return new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_CHARGE_REFERENCE',
        message: 'The action reference supplied for this credit charge is not valid.',
        details: { field: e.field },
      });
    }
    if (e instanceof MhcTransactionRequiredError) {
      // A programming error in a consumer, not anything the user did.
      return new HttpError({
        statusCode: 500,
        code: 'MHC_CHARGE_REQUIRES_TRANSACTION',
        message: 'Credit charging must run inside a database transaction.',
      });
    }
    if (e instanceof Error && e.message === 'MHC_WALLET_FROZEN') {
      return new HttpError({
        statusCode: 403,
        code: 'MHC_WALLET_FROZEN',
        message: 'Your credit account is frozen. Please contact support.',
      });
    }
    return e;
  }

  // -------------------------------------------------------------------------
  // Admin pricing configuration
  // -------------------------------------------------------------------------
  async upsertActionPrice(params: {
    actionKey: string;
    name: string;
    mhcPrice: number;
    isActive: boolean;
  }): Promise<MhcActionPriceRow> {
    if (!(params.mhcPrice >= 0)) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_PRICE',
        message: 'Price must be zero or greater.',
      });
    }
    return this.repo.upsertActionPrice(params);
  }

  async upsertPackage(params: {
    code: string;
    name: string;
    nameAr?: string | null;
    mhcAmount: number;
    externalPriceAmount: number;
    externalPriceCurrency?: string;
    isActive: boolean;
    sortOrder?: number;
  }): Promise<MhcCreditPackageRow> {
    if (!(params.mhcAmount > 0) || !(params.externalPriceAmount > 0)) {
      throw new HttpError({
        statusCode: 400,
        code: 'MHC_INVALID_PACKAGE',
        message: 'Credit amount and price must both be greater than zero.',
      });
    }
    return this.repo.upsertCreditPackage(params);
  }

  async listAllPackagesForAdmin(): Promise<MhcCreditPackageRow[]> {
    return this.repo.listCreditPackages(false);
  }
}
