// ---------------------------------------------------------------------------
// Wallet service - business logic
// ---------------------------------------------------------------------------

import type {
  DepositCheckoutResponse,
  DepositMethod,
  Transaction,
  Wallet,
  WithdrawalRequest,
} from '@mohandishub/shared';

import { env } from '../../config/env.js';
import {
  authenticateNowPayments,
  createInvoice,
  createPayout,
  estimatePrice,
  getAvailableCurrencies,
  getAvailableCurrenciesDetailed,
  NowPaymentsApiError,
  verifyNowPaymentsIpnSignature,
  verifyPayout,
} from '../../lib/nowpayments.client.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import { WalletRepository } from './wallet.repository.js';
import type {
  TransactionRow,
  WalletRow,
  WithdrawalRequestRow,
} from './wallet.repository.js';

const FAILED_DEPOSIT_STATUSES = new Set([
  'failed',
  'expired',
  'cancelled',
  'canceled',
  'refunded',
]);

type CreateDepositCheckoutInput = {
  amount: number;
  method: DepositMethod;
  currency?: string;
  payCurrency?: string;
  returnUrl?: string;
};

type EstimateDepositInput = {
  amount: number;
  currencyFrom?: string;
  currencyTo?: string;
};

type CreateWithdrawalInput = {
  amount: number;
  currency?: string;
  address?: string;
  extraId?: string;
  saveAddress?: boolean;
};

export class WalletService {
  private payoutAuthCache: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly repo: WalletRepository = new WalletRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
  ) {}

  async getOrCreateWallet(userId: string): Promise<Wallet> {
    let row = await this.repo.findByUserId(userId);
    if (!row) {
      row = await this.repo.createForUser(userId);
    }
    return this.toWallet(row);
  }

  async getTransactions(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    items: Transaction[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { rows, total } = await this.repo.listTransactions(userId, page, limit);
    return {
      items: rows.map((r) => this.toTransaction(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Get a single transaction as receipt (for invoicing/export). */
  async getReceipt(userId: string, transactionId: string): Promise<Transaction | null> {
    const row = await this.repo.getTransactionById(userId, transactionId);
    return row ? this.toTransaction(row) : null;
  }

  async getDepositCurrencies(): Promise<string[]> {
    if (!env.NOWPAYMENTS_API_KEY) {
      return [];
    }
    let currencies: string[] = [];
    try {
      currencies = await getAvailableCurrenciesDetailed(env.NOWPAYMENTS_API_KEY);
    } catch {
      currencies = await getAvailableCurrencies(env.NOWPAYMENTS_API_KEY);
    }
    const normalized = currencies.map((c) => c.toUpperCase());
    const allowlist = this.getPayCurrencyAllowlist();
    if (allowlist.length > 0) {
      return normalized.filter((c) => allowlist.includes(c));
    }
    return normalized;
  }

  async estimateDeposit(input: EstimateDepositInput): Promise<{
    amountFrom: number;
    currencyFrom: string;
    currencyTo: string;
    estimatedAmount: number;
    rate: number | null;
  }> {
    if (!env.NOWPAYMENTS_API_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMENT_UNAVAILABLE',
        message: 'NOWPayments is not configured.',
      });
    }

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid amount is required.',
      });
    }

    const currencyFrom = (input.currencyFrom || 'USD').toUpperCase();
    const currencyTo = (input.currencyTo || env.NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY).toUpperCase();
    const estimate = await estimatePrice(env.NOWPAYMENTS_API_KEY, amount, currencyFrom, currencyTo);
    const estimatedAmount = Number(estimate.estimated_amount);
    const rate = estimate.rate != null ? Number(estimate.rate) : null;

    if (!Number.isFinite(estimatedAmount) || estimatedAmount <= 0) {
      throw new HttpError({
        statusCode: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
        message: 'Could not estimate conversion amount.',
      });
    }

    return {
      amountFrom: amount,
      currencyFrom,
      currencyTo,
      estimatedAmount,
      rate: rate != null && Number.isFinite(rate) ? rate : null,
    };
  }

  async createDepositCheckout(
    userId: string,
    input: CreateDepositCheckoutInput,
  ): Promise<DepositCheckoutResponse> {
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }

    if (input.method === 'crypto' && status.disableCryptoDeposits) {
      throw new HttpError({
        statusCode: 503,
        code: 'CRYPTO_DEPOSITS_DISABLED',
        message: 'Crypto deposits are not available.',
      });
    }

    if (input.method === 'card' && (status.disableCardDeposits || !env.NOWPAYMENTS_FIAT_ENABLED)) {
      throw new HttpError({
        statusCode: 503,
        code: 'CARD_DEPOSITS_DISABLED',
        message: 'Card deposits are not available.',
      });
    }

    if (status.minDepositAmount != null && input.amount < status.minDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum deposit is ${status.minDepositAmount}.`,
      });
    }

    if (status.maxDepositAmount != null && input.amount > status.maxDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_HIGH',
        message: `Maximum deposit is ${status.maxDepositAmount}.`,
      });
    }

    if (!env.NOWPAYMENTS_API_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMENT_UNAVAILABLE',
        message: 'NOWPayments is not configured.',
      });
    }

    const wallet = await this.getOrCreateWallet(userId);
    const orderId = `np_dep_${wallet.id.replace(/-/g, '')}_${Date.now()}`.slice(0, 128);
    const priceCurrency = (input.currency || 'USD').toUpperCase();
    const requestedPayCurrency = input.payCurrency ? input.payCurrency.toUpperCase() : undefined;
    const defaultPayCurrency = env.NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY.toUpperCase();
    const payCurrency =
      input.method === 'crypto' ? requestedPayCurrency || defaultPayCurrency : requestedPayCurrency;

    const allowlist = this.getPayCurrencyAllowlist();
    if (payCurrency && allowlist.length > 0 && !allowlist.includes(payCurrency)) {
      throw new HttpError({
        statusCode: 400,
        code: 'UNSUPPORTED_CURRENCY',
        message: `Unsupported pay currency: ${payCurrency}`,
      });
    }

    const webBase = (
      input.returnUrl ||
      env.WEB_PUBLIC_URL ||
      env.CORS_ORIGIN ||
      'http://localhost:3000'
    ).replace(/\/$/, '');
    const apiBase = (env.API_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');

    const successUrl = this.withQueryParams(webBase, { deposit: 'success', order_id: orderId });
    const cancelUrl = this.withQueryParams(webBase, { deposit: 'cancelled', order_id: orderId });

    const invoice = await createInvoice(env.NOWPAYMENTS_API_KEY, {
      price_amount: input.amount,
      price_currency: priceCurrency,
      ...(payCurrency ? { pay_currency: payCurrency } : {}),
      order_id: orderId,
      order_description: `Wallet deposit ${input.amount.toFixed(2)} ${priceCurrency}`,
      ipn_callback_url: `${apiBase}/api/wallet/nowpayments/ipn`,
      success_url: successUrl,
      cancel_url: cancelUrl,
      is_fee_paid_by_user: false,
    });

    await this.repo.createDepositRequest(
      userId,
      wallet.id,
      input.amount,
      priceCurrency,
      orderId,
      'nowpayments',
      this.toStringOrNull(invoice.id),
      {
        method: input.method,
        pay_currency: payCurrency ?? null,
      },
    );

    const checkoutUrl = invoice.invoice_url;
    if (!checkoutUrl) {
      throw new HttpError({
        statusCode: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
        message: 'Could not create NOWPayments checkout link.',
      });
    }

    return {
      checkoutUrl,
      orderId,
      method: input.method,
      provider: 'nowpayments',
    };
  }

  async handleNowPaymentsDepositIpn(rawBody: string, signatureHeader: string): Promise<void> {
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
    const providerStatus =
      (this.toStringOrNull(payload.payment_status) ||
        this.toStringOrNull(payload.status) ||
        this.toStringOrNull(payload.pay_status) ||
        'unknown')
        .toLowerCase()
        .trim();

    const providerPaymentId = this.toStringOrNull(payload.payment_id) || this.toStringOrNull(payload.id);
    const providerInvoiceId = this.toStringOrNull(payload.invoice_id);
    const providerPurchaseId = this.toStringOrNull(payload.purchase_id);
    const providerParentPaymentId = this.toStringOrNull(payload.parent_payment_id);

    let orderId = this.toStringOrNull(payload.order_id);
    if (!orderId && providerPaymentId) {
      const row = await this.repo.findDepositRequestByProviderPaymentId(providerPaymentId);
      orderId = row?.order_id ?? null;
    }

    if (!orderId) {
      return;
    }

    const providerPayload = payload;

    if (providerStatus === 'finished' && !providerParentPaymentId) {
      await this.repo.creditDepositIfPendingByOrderId({
        orderId,
        providerStatus,
        referenceType: 'nowpayments',
        referenceId: providerPaymentId ?? providerInvoiceId,
        description: 'Wallet deposit (NOWPayments)',
        providerPaymentId,
        providerInvoiceId,
        providerPurchaseId,
        providerParentPaymentId,
        providerPayload,
      });
      return;
    }

    const row = await this.repo.updateDepositProviderStateByOrderId({
      orderId,
      providerStatus,
      providerPaymentId,
      providerInvoiceId,
      providerPurchaseId,
      providerParentPaymentId,
      providerPayload,
    });

    if (row?.status === 'pending' && FAILED_DEPOSIT_STATUSES.has(providerStatus)) {
      const mappedStatus =
        providerStatus === 'expired'
          ? 'expired'
          : providerStatus === 'cancelled' || providerStatus === 'canceled'
            ? 'cancelled'
            : 'failed';
      await this.repo.updateDepositRequestStatus(orderId, mappedStatus);
    }
  }

  async createWithdrawalRequest(
    userId: string,
    role: 'expert' | 'craftsman',
    input: CreateWithdrawalInput,
  ): Promise<WithdrawalRequest> {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Money movements are temporarily disabled.',
      });
    }

    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid amount is required.',
      });
    }

    if (input.amount < env.NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum withdrawal amount is ${env.NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT}.`,
      });
    }

    const payoutSettings = await this.repo.getIndividualProviderPayoutSettings(userId, role);
    const payoutCurrency = (
      input.currency ||
      payoutSettings?.payout_currency ||
      env.NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY
    ).toUpperCase();
    const payoutAddress = (input.address || payoutSettings?.payout_address || '').trim();

    if (!payoutAddress) {
      throw new HttpError({
        statusCode: 400,
        code: 'MISSING_PAYOUT_ADDRESS',
        message: 'Payout address is required for withdrawals.',
      });
    }

    if (input.saveAddress === true) {
      const updated = await this.repo.updateIndividualProviderPayoutSettings(userId, role, {
        payoutCurrency,
        payoutAddress,
        payoutExtraId: input.extraId ?? payoutSettings?.payout_extra_id ?? null,
      });
      if (!updated) {
        throw new HttpError({
          statusCode: 404,
          code: 'PROFILE_NOT_FOUND',
          message: 'Provider profile not found.',
        });
      }
    }

    let created: WithdrawalRequestRow;
    try {
      created = await this.repo.createWithdrawalRequestWithHold({
        userId,
        amount: input.amount,
        currency: payoutCurrency,
        payoutAddress,
        payoutExtraId: input.extraId ?? payoutSettings?.payout_extra_id ?? null,
        verificationRequired: env.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY,
        providerPayload: {
          created_via: 'wallet_withdrawal',
          custody_enabled: env.NOWPAYMENTS_CUSTODY_ENABLED,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 400,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance.',
        });
      }
      if (message === 'WALLET_NOT_FOUND') {
        throw new HttpError({
          statusCode: 404,
          code: 'WALLET_NOT_FOUND',
          message: 'Wallet not found.',
        });
      }
      throw error;
    }

    if (!env.NOWPAYMENTS_WITHDRAWALS_ENABLED || !env.NOWPAYMENTS_MASS_PAYOUTS_ENABLED) {
      const blocked = await this.repo.setWithdrawalBlocked({
        withdrawalId: created.id,
        error: 'Payout capability is not enabled for this account yet.',
        providerStatus: 'blocked',
      });
      return this.toWithdrawalRequest(blocked ?? created);
    }

    const started = await this.tryStartPayout(created);
    return this.toWithdrawalRequest(started);
  }

  async verifyWithdrawal(
    userId: string,
    withdrawalId: string,
    verificationCode: string,
  ): Promise<WithdrawalRequest> {
    const row = await this.repo.findWithdrawalRequestByIdForUser(withdrawalId, userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'WITHDRAWAL_NOT_FOUND',
        message: 'Withdrawal request not found.',
      });
    }

    if (row.status !== 'pending_verification') {
      if (row.status === 'processing' || row.status === 'finished') {
        return this.toWithdrawalRequest(row);
      }
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_VERIFIABLE',
        message: `Cannot verify withdrawal in status ${row.status}.`,
      });
    }

    if (!row.provider_batch_withdrawal_id) {
      throw new HttpError({
        statusCode: 400,
        code: 'MISSING_PROVIDER_REFERENCE',
        message: 'Withdrawal is missing payout reference.',
      });
    }

    if (!env.NOWPAYMENTS_API_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMENT_UNAVAILABLE',
        message: 'NOWPayments is not configured.',
      });
    }

    const trimmedCode = verificationCode.trim();
    if (!trimmedCode) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_VERIFICATION_CODE',
        message: 'Verification code is required.',
      });
    }

    try {
      const jwt = await this.getPayoutJwtToken();
      const verifyResult = await verifyPayout(
        env.NOWPAYMENTS_API_KEY,
        jwt,
        row.provider_batch_withdrawal_id,
        trimmedCode,
      );
      const updated = await this.repo.markWithdrawalVerified(withdrawalId, 'verifying', {
        verify_result: verifyResult,
      });
      return this.toWithdrawalRequest(updated ?? row);
    } catch (error) {
      if (error instanceof NowPaymentsApiError && error.status === 403) {
        const blocked = await this.repo.setWithdrawalBlocked({
          withdrawalId,
          error: 'NOWPayments payout access is currently blocked (403).',
          providerStatus: 'blocked',
          providerPayload: { verify_error: error.message },
        });
        return this.toWithdrawalRequest(blocked ?? row);
      }

      throw new HttpError({
        statusCode: 502,
        code: 'PAYOUT_VERIFY_FAILED',
        message: error instanceof Error ? error.message : 'Failed to verify payout.',
      });
    }
  }

  async listWithdrawals(userId: string): Promise<WithdrawalRequest[]> {
    const rows = await this.repo.listWithdrawalRequestsByUserId(userId);
    return rows.map((row) => this.toWithdrawalRequest(row));
  }

  async handleNowPaymentsPayoutIpn(rawBody: string, signatureHeader: string): Promise<void> {
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
    const nestedWithdrawals = Array.isArray(payload.withdrawals)
      ? (payload.withdrawals as Array<Record<string, unknown>>)
      : [];

    if (nestedWithdrawals.length > 0) {
      for (const item of nestedWithdrawals) {
        await this.applyPayoutIpnEvent(item, payload);
      }
      return;
    }

    await this.applyPayoutIpnEvent(payload, undefined);
  }

  private async applyPayoutIpnEvent(
    eventPayload: Record<string, unknown>,
    parentPayload?: Record<string, unknown>,
  ): Promise<void> {
    const statusValue =
      this.toStringOrNull(eventPayload.status) ||
      this.toStringOrNull(eventPayload.withdrawal_status) ||
      this.toStringOrNull(parentPayload?.status) ||
      this.toStringOrNull(parentPayload?.withdrawal_status);

    if (!statusValue) {
      return;
    }

    const batchWithdrawalId =
      this.toStringOrNull(eventPayload.batch_withdrawal_id) ||
      this.toStringOrNull(parentPayload?.batch_withdrawal_id) ||
      this.toStringOrNull(parentPayload?.id);
    const withdrawalId =
      this.toStringOrNull(eventPayload.withdrawal_id) ||
      this.toStringOrNull(eventPayload.id) ||
      this.toStringOrNull(parentPayload?.withdrawal_id);

    await this.repo.applyWithdrawalWebhookStatus({
      batchWithdrawalId,
      withdrawalId,
      providerStatus: statusValue.toLowerCase(),
      providerPayload: parentPayload ? { parent: parentPayload, item: eventPayload } : eventPayload,
    });
  }

  private async tryStartPayout(row: WithdrawalRequestRow): Promise<WithdrawalRequestRow> {
    if (!env.NOWPAYMENTS_API_KEY) {
      return (
        (await this.repo.setWithdrawalBlocked({
          withdrawalId: row.id,
          error: 'NOWPayments API key is missing.',
          providerStatus: 'blocked',
        })) ?? row
      );
    }

    if (!row.payout_address) {
      return (
        (await this.repo.setWithdrawalBlocked({
          withdrawalId: row.id,
          error: 'Missing payout address.',
          providerStatus: 'blocked',
        })) ?? row
      );
    }

    try {
      const jwt = await this.getPayoutJwtToken();
      const apiBase = (env.API_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');
      const payoutResult = await createPayout(env.NOWPAYMENTS_API_KEY, jwt, {
        payout_description: `Freelancer withdrawal ${row.id}`,
        ipn_callback_url: `${apiBase}/api/wallet/nowpayments/ipn`,
        withdrawals: [
          {
            address: row.payout_address,
            currency: row.currency,
            amount: parseFloat(row.amount),
            ...(row.payout_extra_id ? { extra_id: row.payout_extra_id } : {}),
          },
        ],
      });

      const firstWithdrawal = payoutResult.withdrawals?.[0];
      const batchWithdrawalId =
        this.toStringOrNull(payoutResult.batch_withdrawal_id) ||
        this.toStringOrNull(firstWithdrawal?.batch_withdrawal_id) ||
        this.toStringOrNull(payoutResult.id);
      const providerWithdrawalId =
        this.toStringOrNull(payoutResult.withdrawal_id) ||
        this.toStringOrNull(firstWithdrawal?.id);
      const providerStatus =
        this.toStringOrNull(firstWithdrawal?.status) || this.toStringOrNull(payoutResult.status);

      const updated = await this.repo.setWithdrawalAfterPayoutCreate({
        withdrawalId: row.id,
        batchWithdrawalId,
        providerWithdrawalId,
        providerStatus,
        providerPayload: payoutResult as unknown as Record<string, unknown>,
        status: env.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY ? 'pending_verification' : 'processing',
      });
      return updated ?? row;
    } catch (error) {
      const is403 = error instanceof NowPaymentsApiError && error.status === 403;
      const blockedParams: {
        withdrawalId: string;
        error: string;
        providerStatus: string;
        providerPayload?: Record<string, unknown>;
      } = {
        withdrawalId: row.id,
        error: is403
          ? 'NOWPayments payout capability is unavailable for this account (403).'
          : error instanceof Error
            ? error.message
            : 'Failed to start payout.',
        providerStatus: is403 ? 'blocked' : 'payout_init_failed',
      };
      if (error instanceof NowPaymentsApiError) {
        blockedParams.providerPayload = { status: error.status, payload: error.payload };
      }
      const blocked = await this.repo.setWithdrawalBlocked({
        ...blockedParams,
      });
      return blocked ?? row;
    }
  }

  private async getPayoutJwtToken(): Promise<string> {
    const now = Date.now();
    if (this.payoutAuthCache && this.payoutAuthCache.expiresAt > now + 30_000) {
      return this.payoutAuthCache.token;
    }

    if (!env.NOWPAYMENTS_AUTH_EMAIL || !env.NOWPAYMENTS_AUTH_PASSWORD) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYOUT_AUTH_NOT_CONFIGURED',
        message: 'NOWPayments payout auth credentials are not configured.',
      });
    }

    const auth = await authenticateNowPayments(env.NOWPAYMENTS_AUTH_EMAIL, env.NOWPAYMENTS_AUTH_PASSWORD);
    this.payoutAuthCache = {
      token: auth.token,
      expiresAt: now + 10 * 60 * 1000,
    };
    return auth.token;
  }

  private getPayCurrencyAllowlist(): string[] {
    if (!env.NOWPAYMENTS_ALLOWED_PAY_CURRENCIES) {
      return [];
    }
    return env.NOWPAYMENTS_ALLOWED_PAY_CURRENCIES.split(',')
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0);
  }

  private withQueryParams(baseUrl: string, params: Record<string, string>): string {
    try {
      const url = new URL(baseUrl);
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
      return url.toString();
    } catch {
      const pairs = Object.entries(params).map(
        ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
      );
      const separator = baseUrl.includes('?') ? '&' : '?';
      return `${baseUrl}${separator}${pairs.join('&')}`;
    }
  }

  private toStringOrNull(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private toWallet(row: WalletRow): Wallet {
    const normalizedCurrency = row.currency.toUpperCase() === 'EGP' ? 'USD' : row.currency;
    return {
      id: row.id,
      userId: row.user_id,
      balance: parseFloat(row.balance),
      currency: normalizedCurrency,
      isFrozen: row.is_frozen,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toTransaction(row: TransactionRow): Transaction {
    return {
      id: row.id,
      walletId: row.wallet_id,
      userId: row.user_id,
      type: row.type as Transaction['type'],
      amount: parseFloat(row.amount),
      balanceAfter: parseFloat(row.balance_after),
      status: row.status as Transaction['status'],
      description: row.description,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      metadata: row.metadata ?? {},
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private toWithdrawalRequest(row: WithdrawalRequestRow): WithdrawalRequest {
    return {
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      holdId: row.hold_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      payoutAddress: row.payout_address,
      payoutExtraId: row.payout_extra_id,
      status: row.status as WithdrawalRequest['status'],
      provider: row.provider,
      providerBatchWithdrawalId: row.provider_batch_withdrawal_id,
      providerWithdrawalId: row.provider_withdrawal_id,
      providerStatus: row.provider_status,
      providerError: row.provider_error,
      verificationRequired: row.verification_required,
      verifiedAt: row.verified_at,
      processedAt: row.processed_at,
      failedAt: row.failed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
