// ---------------------------------------------------------------------------
// Wallet service - business logic
// ---------------------------------------------------------------------------

import type {
  DepositCheckoutResponse,
  ManualDepositRequest,
  Transaction,
  Wallet,
  WithdrawalQuoteResponse,
  WithdrawalRequest,
} from '@mohandishub/shared';
import { isPaymentMethodEnabled } from '@mohandishub/shared';

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
import {
  authenticatePaymobPayout,
  createPaymobDisbursement,
  createPaymobIntention,
  isPaymobDepositConfigured,
  isPaymobPayoutConfigured,
  PaymobNotConfiguredError,
  verifyPaymobHmac,
} from '../../lib/paymob.client.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { WalletFxService } from './wallet-fx.service.js';
import {
  WalletRepository,
  type DepositRequestRow,
  type TransactionRow,
  type WalletRow,
  type WithdrawalRequestRow,
} from './wallet.repository.js';

const FAILED_DEPOSIT_STATUSES = new Set(['failed', 'expired', 'cancelled', 'canceled', 'refunded']);
const MIN_CRYPTO_DEPOSIT_PROVIDER_USD = 10;

type CreateDepositCheckoutInput = {
  amount: number;
  method: 'crypto' | 'card' | 'paymob';
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
  method: 'crypto' | 'instapay' | 'paymob';
  amountEgp: number;
  currency?: string;
  address?: string;
  extraId?: string;
  saveAddress?: boolean;
  instapayRecipient?: string;
  saveInstapayRecipient?: boolean;
  paymobRecipient?: string;
  savePaymobRecipient?: boolean;
};

type UserPayoutPreferences = Awaited<ReturnType<WalletRepository['getUserPayoutPreferences']>>;
type IndividualProviderPayoutSettings = Awaited<
  ReturnType<WalletRepository['getIndividualProviderPayoutSettings']>
>;

export class WalletService {
  private payoutAuthCache: { token: string; expiresAt: number } | null = null;
  private readonly fx: WalletFxService;

  constructor(
    private readonly repo: WalletRepository = new WalletRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
  ) {
    this.fx = new WalletFxService(this.settingsService);
  }

  private async assertWalletFeatureEnabled(): Promise<void> {
    const status = await this.settingsService.getAppStatus();
    if (!status.featureWalletEnabled) {
      throw new HttpError({
        statusCode: 503,
        code: 'FEATURE_DISABLED',
        message: 'Wallet is currently disabled.',
      });
    }
  }

  async getOrCreateWallet(userId: string): Promise<Wallet> {
    await this.assertWalletFeatureEnabled();
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
    await this.assertWalletFeatureEnabled();
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
    await this.assertWalletFeatureEnabled();
    const row = await this.repo.getTransactionById(userId, transactionId);
    return row ? this.toTransaction(row) : null;
  }

  async getDepositCurrencies(): Promise<string[]> {
    await this.assertWalletFeatureEnabled();
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
    await this.assertWalletFeatureEnabled();
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

    const requestedCurrencyFrom = (input.currencyFrom || 'EGP').toUpperCase();
    const currencyTo = (
      input.currencyTo || env.NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY
    ).toUpperCase();
    let amountForProvider = amount;
    let currencyFromForProvider = requestedCurrencyFrom;
    if (requestedCurrencyFrom === 'EGP') {
      const egpPerUsd = await this.fx.getEgpPerUsd();
      amountForProvider = amount / egpPerUsd;
      currencyFromForProvider = 'USD';
    }

    const estimate = await estimatePrice(
      env.NOWPAYMENTS_API_KEY,
      amountForProvider,
      currencyFromForProvider,
      currencyTo,
    );
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
      currencyFrom: requestedCurrencyFrom,
      currencyTo,
      estimatedAmount,
      rate: rate != null && Number.isFinite(rate) ? rate : null,
    };
  }

  async createDepositCheckout(
    userId: string,
    input: CreateDepositCheckoutInput,
  ): Promise<DepositCheckoutResponse> {
    await this.assertWalletFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }

    if (
      input.method === 'crypto' &&
      !isPaymentMethodEnabled(status.paymentMethodsEnabled, 'deposit_crypto')
    ) {
      throw new HttpError({
        statusCode: 503,
        code: 'CRYPTO_DEPOSITS_DISABLED',
        message: 'Crypto deposits are not available.',
      });
    }

    if (
      input.method === 'card' &&
      (!isPaymentMethodEnabled(status.paymentMethodsEnabled, 'deposit_card') ||
        !env.NOWPAYMENTS_FIAT_ENABLED)
    ) {
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

    if (input.method === 'paymob') {
      return this.createPaymobDepositCheckout(userId, input, status.paymentMethodsEnabled);
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
    const requestedPriceCurrency = (input.currency || 'EGP').toUpperCase();
    let invoicePriceAmount = input.amount;
    let invoicePriceCurrency = requestedPriceCurrency;
    // NOWPayments does not always accept EGP as invoice currency.
    // For crypto checkout we convert requested EGP to USD for provider pricing.
    if (input.method === 'crypto' && requestedPriceCurrency === 'EGP') {
      const egpPerUsd = await this.fx.getEgpPerUsd();
      invoicePriceAmount = Math.round((input.amount / egpPerUsd) * 100) / 100;
      invoicePriceCurrency = 'USD';
    }
    if (
      input.method === 'crypto' &&
      invoicePriceCurrency === 'USD' &&
      invoicePriceAmount < MIN_CRYPTO_DEPOSIT_PROVIDER_USD
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'CRYPTO_AMOUNT_TOO_LOW',
        message: `Crypto deposit must be at least ${MIN_CRYPTO_DEPOSIT_PROVIDER_USD} USD (USDT equivalent).`,
      });
    }
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

    const webBase = this.resolveTrustedWebReturnBase(input.returnUrl);
    const apiBase = (env.API_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');

    const successUrl = this.withQueryParams(webBase, { deposit: 'success', order_id: orderId });
    const cancelUrl = this.withQueryParams(webBase, { deposit: 'cancelled', order_id: orderId });

    const invoice = await createInvoice(env.NOWPAYMENTS_API_KEY, {
      price_amount: invoicePriceAmount,
      price_currency: invoicePriceCurrency,
      ...(payCurrency ? { pay_currency: payCurrency } : {}),
      order_id: orderId,
      order_description: `Wallet deposit ${input.amount.toFixed(2)} ${requestedPriceCurrency}`,
      ipn_callback_url: `${apiBase}/api/wallet/nowpayments/ipn`,
      success_url: successUrl,
      cancel_url: cancelUrl,
      is_fee_paid_by_user: false,
    });

    await this.repo.createDepositRequest(
      userId,
      wallet.id,
      invoicePriceAmount,
      invoicePriceCurrency,
      orderId,
      'nowpayments',
      this.toStringOrNull(invoice.id),
      {
        method: input.method,
        requested_price_amount: input.amount,
        requested_price_currency: requestedPriceCurrency,
        provider_price_amount: invoicePriceAmount,
        provider_price_currency: invoicePriceCurrency,
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

  private async createPaymobDepositCheckout(
    userId: string,
    input: CreateDepositCheckoutInput,
    paymentMethodsEnabled: Record<string, boolean>,
  ): Promise<DepositCheckoutResponse> {
    if (!isPaymentMethodEnabled(paymentMethodsEnabled, 'deposit_paymob')) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMOB_DEPOSITS_DISABLED',
        message: 'Paymob deposits are not available.',
      });
    }
    if (!isPaymobDepositConfigured()) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMOB_NOT_CONFIGURED',
        message: 'Paymob is not configured yet.',
      });
    }

    const wallet = await this.getOrCreateWallet(userId);
    // Paymob is EGP-native: no FX, store the EGP amount directly.
    const orderId = `pm_dep_${wallet.id.replace(/-/g, '')}_${Date.now()}`.slice(0, 128);
    const webBase = this.resolveTrustedWebReturnBase(input.returnUrl);
    const apiBase = (env.API_PUBLIC_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '');
    const redirectionUrl = this.withQueryParams(webBase, { deposit: 'success', order_id: orderId });
    const notificationUrl = `${apiBase}/api/wallet/paymob/webhook`;

    const billing = await this.repo.getUserBillingInfo(userId);
    const billingData = this.toPaymobBillingData(billing);

    try {
      const intention = await createPaymobIntention({
        amountEgp: input.amount,
        specialReference: orderId,
        billingData,
        notificationUrl,
        redirectionUrl,
      });

      await this.repo.createDepositRequest(
        userId,
        wallet.id,
        input.amount,
        'EGP',
        orderId,
        'paymob',
        intention.intentionId || null,
        {
          method: 'paymob',
          requested_price_amount: input.amount,
          requested_price_currency: 'EGP',
          paymob_intention_id: intention.intentionId,
        },
      );

      return {
        checkoutUrl: intention.checkoutUrl,
        orderId,
        method: 'paymob',
        provider: 'paymob',
      };
    } catch (error) {
      if (error instanceof PaymobNotConfiguredError) {
        throw new HttpError({
          statusCode: 503,
          code: 'PAYMOB_NOT_CONFIGURED',
          message: 'Paymob is not configured yet.',
        });
      }
      throw new HttpError({
        statusCode: 502,
        code: 'PAYMENT_GATEWAY_ERROR',
        message: 'Could not create Paymob checkout link.',
      });
    }
  }

  private toPaymobBillingData(billing: {
    email: string | null;
    displayName: string | null;
    phone: string | null;
  }): { first_name: string; last_name: string; email: string; phone_number: string } {
    const nameParts = (billing.displayName ?? '').trim().split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || 'MohandisHub';
    const lastName = nameParts.slice(1).join(' ') || 'User';
    return {
      first_name: firstName,
      last_name: lastName,
      email: billing.email || 'NA',
      phone_number: billing.phone || 'NA',
    };
  }

  /**
   * Paymob deposit callback. Verifies HMAC, then idempotently credits EGP on a
   * successful transaction. No FX (Paymob is EGP-native).
   */
  async handlePaymobDepositWebhook(rawBody: string, hmac: string | null): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_WEBHOOK',
        message: 'Invalid Paymob payload.',
      });
    }
    const payload = (parsed ?? {}) as Record<string, unknown>;
    const transaction = (payload.obj ?? {}) as Record<string, unknown>;

    if (!verifyPaymobHmac(transaction, hmac)) {
      throw new HttpError({
        statusCode: 401,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid Paymob signature.',
      });
    }

    const paymobOrderId = this.toStringOrNull(this.readPath(transaction, 'order.id'));
    const orderId =
      this.toStringOrNull(this.readPath(transaction, 'order.merchant_order_id')) ||
      this.toStringOrNull(transaction.merchant_order_id) ||
      this.toStringOrNull(transaction.special_reference) ||
      this.toStringOrNull(payload.merchant_order_id) ||
      this.toStringOrNull(payload.special_reference);
    if (!orderId) return;

    const transactionId =
      typeof transaction.id === 'string' || typeof transaction.id === 'number'
        ? String(transaction.id)
        : null;
    const deposit = await this.repo.findDepositRequestByOrderId(orderId);
    if (!deposit || deposit.provider !== 'paymob') return;

    const amountCents = this.toNumberOrNull(transaction.amount_cents);
    const paidAmountEgp = amountCents != null ? Math.round(amountCents) / 100 : null;
    const expectedAmountEgp = parseFloat(deposit.amount);
    const currency = this.toStringOrNull(transaction.currency)?.toUpperCase() ?? null;
    const success =
      transaction.success === true &&
      transaction.pending !== true &&
      transaction.error_occured !== true;
    const reconciliation = {
      paymob_order_id: paymobOrderId,
      paymob_transaction_id: transactionId,
      expected_amount_egp: expectedAmountEgp,
      paid_amount_egp: paidAmountEgp,
      currency,
      success,
      settled_at: new Date().toISOString(),
    };

    if (!success) {
      await this.repo.updateDepositProviderStateByOrderId({
        orderId,
        providerStatus: 'failed',
        providerPaymentId: transactionId,
        paymobOrderId,
        paymobTransactionId: transactionId,
        providerPayload: { paymob: transaction, reconciliation },
      });
      if (deposit.status === 'pending') {
        await this.repo.updateDepositRequestStatus(orderId, 'failed');
      }
      return;
    }

    if (currency !== 'EGP' || paidAmountEgp == null || !Number.isFinite(paidAmountEgp)) {
      await this.repo.updateDepositProviderStateByOrderId({
        orderId,
        providerStatus: 'invalid_amount',
        providerPaymentId: transactionId,
        paymobOrderId,
        paymobTransactionId: transactionId,
        providerPayload: {
          paymob: transaction,
          reconciliation,
          error: 'invalid_currency_or_amount',
        },
      });
      if (deposit.status === 'pending') {
        await this.repo.updateDepositRequestStatus(orderId, 'failed');
      }
      return;
    }

    if (paidAmountEgp + 0.01 < expectedAmountEgp) {
      await this.repo.updateDepositProviderStateByOrderId({
        orderId,
        providerStatus: 'underpaid',
        providerPaymentId: transactionId,
        paymobOrderId,
        paymobTransactionId: transactionId,
        providerPayload: { paymob: transaction, reconciliation, error: 'underpaid' },
      });
      if (deposit.status === 'pending') {
        await this.repo.updateDepositRequestStatus(orderId, 'failed');
      }
      return;
    }

    const creditAmountEgp = Math.min(paidAmountEgp, expectedAmountEgp);
    const overpaymentEgp = Math.max(0, paidAmountEgp - expectedAmountEgp);
    const rateSnapshot = {
      mode: 'paymob_deposit_settlement',
      ...reconciliation,
      credited_amount_egp: creditAmountEgp,
      overpayment_egp: overpaymentEgp,
    };

    await this.repo.creditDepositIfPendingByOrderId({
      orderId,
      providerStatus: 'finished',
      referenceType: 'paymob',
      referenceId: transactionId,
      description: 'Wallet deposit via Paymob',
      providerPaymentId: transactionId,
      paymobOrderId,
      paymobTransactionId: transactionId,
      providerPayload: {
        paymob_transaction_id: transactionId,
        paymob_order_id: paymobOrderId,
        paymob: transaction,
        reconciliation,
      },
      creditAmountEgp,
      rateSnapshot,
    });
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
    const providerStatus = (
      this.toStringOrNull(payload.payment_status) ||
      this.toStringOrNull(payload.status) ||
      this.toStringOrNull(payload.pay_status) ||
      'unknown'
    )
      .toLowerCase()
      .trim();

    const providerPaymentId =
      this.toStringOrNull(payload.payment_id) || this.toStringOrNull(payload.id);
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
      const dep = await this.repo.findDepositRequestByOrderId(orderId);
      if (!dep) return;
      const invoiceAmount = dep ? parseFloat(dep.amount) : 0;
      const invoiceCurrency = dep?.currency ?? 'EGP';
      const { egp, snapshot } = await this.fx.computeDepositCreditEgp({
        providerPayload,
        invoicePriceAmount: invoiceAmount,
        invoicePriceCurrency: invoiceCurrency,
      });
      const requestedAmount = this.toNumberOrNull(dep.provider_payload?.requested_price_amount);
      const requestedCurrency =
        typeof dep.provider_payload?.requested_price_currency === 'string'
          ? dep.provider_payload.requested_price_currency.toUpperCase()
          : null;
      const requestedCreditEgp =
        requestedCurrency === 'EGP' && requestedAmount != null && requestedAmount > 0
          ? requestedAmount
          : egp;
      if (egp + 0.01 < requestedCreditEgp) {
        await this.repo.updateDepositProviderStateByOrderId({
          orderId,
          providerStatus: 'underpaid',
          providerPaymentId,
          providerInvoiceId,
          providerPurchaseId,
          providerParentPaymentId,
          providerPayload: {
            nowpayments: providerPayload,
            settlement: {
              ...snapshot,
              requested_credit_egp: requestedCreditEgp,
              computed_credit_egp: egp,
              underpayment_egp: requestedCreditEgp - egp,
            },
          },
        });
        if (dep.status === 'pending') {
          await this.repo.updateDepositRequestStatus(orderId, 'failed');
        }
        return;
      }
      const cappedEgp = Math.min(egp, requestedCreditEgp);
      const settlementSnapshot = {
        ...snapshot,
        requested_credit_egp: requestedCreditEgp,
        computed_credit_egp: egp,
        credited_egp: cappedEgp,
        overpayment_egp: Math.max(0, egp - cappedEgp),
      };
      const { credited, row: depRow } = await this.repo.creditDepositIfPendingByOrderId({
        orderId,
        providerStatus,
        referenceType: 'nowpayments',
        referenceId: providerPaymentId ?? providerInvoiceId,
        description: 'Wallet deposit (NOWPayments)',
        providerPaymentId,
        providerInvoiceId,
        providerPurchaseId,
        providerParentPaymentId,
        providerPayload: { nowpayments: providerPayload, settlement: settlementSnapshot },
        creditAmountEgp: cappedEgp,
        rateSnapshot: settlementSnapshot,
      });
      if (credited && depRow) {
        const amt =
          depRow.credited_amount_egp != null
            ? parseFloat(depRow.credited_amount_egp)
            : parseFloat(depRow.amount);
        void this.notificationsService
          .createForUser(depRow.user_id, {
            type: 'wallet_deposit_confirmed',
            title: 'Deposit confirmed',
            message: `Your wallet was credited with ${amt.toFixed(2)} EGP.`,
            payload: { depositId: depRow.id, orderId },
          })
          .catch(() => {});
      }
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

  async estimateWithdrawalQuote(
    amountEgp: number,
    payoutCurrency: string,
  ): Promise<WithdrawalQuoteResponse> {
    await this.assertWalletFeatureEnabled();
    if (!Number.isFinite(amountEgp) || amountEgp <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid EGP amount is required.',
      });
    }
    const cur = payoutCurrency.toUpperCase();
    const { cryptoAmount, snapshot } = await this.fx.quoteCryptoPayoutFromEgp(amountEgp, cur);
    if (cryptoAmount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'QUOTE_FAILED',
        message: 'Could not quote crypto amount for this withdrawal.',
      });
    }
    return {
      amountEgp,
      payoutCurrency: cur,
      quotedCryptoAmount: cryptoAmount,
      rateSnapshot: snapshot,
    };
  }

  async createWithdrawalRequest(
    userId: string,
    role: 'expert' | 'craftsman' | 'business',
    input: CreateWithdrawalInput,
  ): Promise<WithdrawalRequest> {
    await this.assertWalletFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Money movements are temporarily disabled.',
      });
    }

    if (!Number.isFinite(input.amountEgp) || input.amountEgp <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid amount is required.',
      });
    }

    if (input.amountEgp < env.NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum withdrawal amount is ${env.NOWPAYMENTS_WITHDRAWAL_MIN_AMOUNT} EGP.`,
      });
    }

    if (
      input.method === 'instapay' &&
      !isPaymentMethodEnabled(status.paymentMethodsEnabled, 'withdrawal_instapay')
    ) {
      throw new HttpError({
        statusCode: 503,
        code: 'INSTAPAY_WITHDRAWALS_DISABLED',
        message: 'InstaPay withdrawals are not available.',
      });
    }
    if (
      input.method === 'crypto' &&
      !isPaymentMethodEnabled(status.paymentMethodsEnabled, 'withdrawal_crypto')
    ) {
      throw new HttpError({
        statusCode: 503,
        code: 'CRYPTO_WITHDRAWALS_DISABLED',
        message: 'Crypto withdrawals are not available.',
      });
    }
    if (
      input.method === 'paymob' &&
      !isPaymentMethodEnabled(status.paymentMethodsEnabled, 'withdrawal_paymob')
    ) {
      throw new HttpError({
        statusCode: 503,
        code: 'PAYMOB_WITHDRAWALS_DISABLED',
        message: 'Paymob withdrawals are not available.',
      });
    }

    const prefs = await this.repo.getUserPayoutPreferences(userId);
    const profilePayout =
      role === 'business'
        ? null
        : await this.repo.getIndividualProviderPayoutSettings(
            userId,
            role === 'craftsman' ? 'craftsman' : 'expert',
          );

    if (input.method === 'instapay') {
      const recipient = (input.instapayRecipient || prefs?.instapay_phone || '').trim();
      if (!recipient) {
        throw new HttpError({
          statusCode: 400,
          code: 'MISSING_INSTAPAY_RECIPIENT',
          message: 'InstaPay recipient phone or account is required.',
        });
      }

      if (input.saveInstapayRecipient === true) {
        await this.persistPayoutPrefs(userId, role, {
          instapay_phone: recipient,
          prefs,
          profilePayout,
        });
      }

      let created: WithdrawalRequestRow;
      try {
        created = await this.repo.createWithdrawalRequestWithHold({
          userId,
          amountEgp: input.amountEgp,
          payoutCurrency: 'EGP',
          payoutAddress: null,
          payoutExtraId: null,
          payoutCryptoAmount: null,
          verificationRequired: false,
          provider: 'instapay_manual',
          withdrawalMethod: 'instapay',
          instapayRecipient: recipient,
          initialStatus: 'awaiting_transfer',
          rateSnapshot: {},
          providerPayload: { created_via: 'wallet_withdrawal_instapay' },
        });
      } catch (error) {
        this.rethrowWalletCreateErrors(error);
      }
      return this.toWithdrawalRequest(created);
    }

    if (input.method === 'paymob') {
      const recipient = (input.paymobRecipient || prefs?.paymob_recipient || '').trim();
      if (!recipient) {
        throw new HttpError({
          statusCode: 400,
          code: 'MISSING_PAYMOB_RECIPIENT',
          message: 'Paymob payout recipient is required.',
        });
      }

      if (input.savePaymobRecipient === true) {
        await this.persistPayoutPrefs(userId, role, {
          paymob_recipient: recipient,
          prefs,
          profilePayout,
        });
      }

      let created: WithdrawalRequestRow;
      try {
        created = await this.repo.createWithdrawalRequestWithHold({
          userId,
          amountEgp: input.amountEgp,
          payoutCurrency: 'EGP',
          payoutAddress: null,
          payoutExtraId: null,
          payoutCryptoAmount: null,
          verificationRequired: false,
          provider: 'paymob',
          withdrawalMethod: 'paymob',
          paymobRecipient: recipient,
          initialStatus: 'processing',
          rateSnapshot: {},
          providerPayload: { created_via: 'wallet_withdrawal_paymob' },
        });
      } catch (error) {
        this.rethrowWalletCreateErrors(error);
      }

      if (!env.PAYMOB_WITHDRAWALS_ENABLED || !isPaymobPayoutConfigured()) {
        const blocked = await this.repo.setWithdrawalBlocked({
          withdrawalId: created.id,
          error: 'Paymob payouts are not configured yet.',
          providerStatus: 'blocked',
        });
        return this.toWithdrawalRequest(blocked ?? created);
      }

      const started = await this.tryStartPaymobPayout(created, recipient);
      return this.toWithdrawalRequest(started);
    }

    const payoutCurrency = (
      input.currency ||
      prefs?.crypto_payout_currency ||
      profilePayout?.payout_currency ||
      env.NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY
    ).toUpperCase();
    const payoutAddress = (
      input.address ||
      prefs?.crypto_payout_address ||
      profilePayout?.payout_address ||
      ''
    ).trim();
    const payoutExtraId =
      input.extraId ?? prefs?.crypto_payout_extra_id ?? profilePayout?.payout_extra_id ?? null;

    if (!payoutAddress) {
      throw new HttpError({
        statusCode: 400,
        code: 'MISSING_PAYOUT_ADDRESS',
        message: 'Payout address is required for crypto withdrawals.',
      });
    }

    const { cryptoAmount, snapshot } = await this.fx.quoteCryptoPayoutFromEgp(
      input.amountEgp,
      payoutCurrency,
    );
    if (cryptoAmount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: 'Withdrawal amount is too low for the selected payout currency.',
      });
    }

    if (input.saveAddress === true) {
      await this.persistPayoutPrefs(userId, role, {
        crypto_currency: payoutCurrency,
        crypto_address: payoutAddress,
        crypto_extra_id: payoutExtraId,
        prefs,
        profilePayout,
      });
    }

    let created: WithdrawalRequestRow;
    try {
      created = await this.repo.createWithdrawalRequestWithHold({
        userId,
        amountEgp: input.amountEgp,
        payoutCurrency,
        payoutAddress,
        payoutExtraId,
        payoutCryptoAmount: cryptoAmount,
        verificationRequired: env.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY,
        provider: 'nowpayments',
        withdrawalMethod: 'crypto',
        initialStatus: env.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY ? 'pending_verification' : 'processing',
        rateSnapshot: snapshot,
        providerPayload: {
          created_via: 'wallet_withdrawal_crypto',
          custody_enabled: env.NOWPAYMENTS_CUSTODY_ENABLED,
        },
      });
    } catch (error) {
      this.rethrowWalletCreateErrors(error);
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

  private rethrowWalletCreateErrors(error: unknown): never {
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
    if (message === 'WALLET_FROZEN') {
      throw new HttpError({
        statusCode: 403,
        code: 'WALLET_FROZEN',
        message: 'Wallet is frozen.',
      });
    }
    throw error;
  }

  private async persistPayoutPrefs(
    userId: string,
    role: 'expert' | 'craftsman' | 'business',
    patch: {
      instapay_phone?: string;
      crypto_currency?: string;
      crypto_address?: string;
      crypto_extra_id?: string | null;
      paymob_recipient?: string;
      prefs: UserPayoutPreferences;
      profilePayout: IndividualProviderPayoutSettings;
    },
  ): Promise<void> {
    const p = patch.prefs;
    await this.repo.upsertUserPayoutPreferencesFull({
      userId,
      instapay_phone: patch.instapay_phone ?? p?.instapay_phone ?? null,
      crypto_payout_currency: patch.crypto_currency ?? p?.crypto_payout_currency ?? null,
      crypto_payout_address: patch.crypto_address ?? p?.crypto_payout_address ?? null,
      crypto_payout_extra_id:
        patch.crypto_extra_id !== undefined
          ? patch.crypto_extra_id
          : (p?.crypto_payout_extra_id ?? null),
      paymob_recipient: patch.paymob_recipient ?? p?.paymob_recipient ?? null,
    });

    if (role !== 'business' && patch.crypto_currency && patch.crypto_address) {
      const updated = await this.repo.updateIndividualProviderPayoutSettings(userId, role, {
        payoutCurrency: patch.crypto_currency,
        payoutAddress: patch.crypto_address,
        payoutExtraId: patch.crypto_extra_id ?? patch.profilePayout?.payout_extra_id ?? null,
      });
      if (!updated) {
        throw new HttpError({
          statusCode: 404,
          code: 'PROFILE_NOT_FOUND',
          message: 'Provider profile not found.',
        });
      }
    }
  }

  async submitInstapayManualDeposit(params: {
    userId: string;
    amountEgp: number;
    proofUploadId: string;
    senderAccount: string;
  }): Promise<ManualDepositRequest> {
    await this.assertWalletFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }
    if (!isPaymentMethodEnabled(status.paymentMethodsEnabled, 'deposit_instapay')) {
      throw new HttpError({
        statusCode: 503,
        code: 'INSTAPAY_DEPOSITS_DISABLED',
        message: 'InstaPay deposits are not available.',
      });
    }
    const display = status.platformInstapayDisplay;
    if (!display || Object.keys(display).length === 0) {
      throw new HttpError({
        statusCode: 503,
        code: 'INSTAPAY_NOT_CONFIGURED',
        message: 'InstaPay deposits are not configured.',
      });
    }
    if (!Number.isFinite(params.amountEgp) || params.amountEgp <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid EGP amount is required.',
      });
    }
    if (status.minDepositAmount != null && params.amountEgp < status.minDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum deposit is ${status.minDepositAmount}.`,
      });
    }
    if (status.maxDepositAmount != null && params.amountEgp > status.maxDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_HIGH',
        message: `Maximum deposit is ${status.maxDepositAmount}.`,
      });
    }

    const pending = await this.repo.countPendingInstapayReviewDepositsForUser(params.userId);
    if (pending > 0) {
      throw new HttpError({
        statusCode: 409,
        code: 'PENDING_INSTAPAY_DEPOSIT',
        message: 'You already have a pending InstaPay deposit request.',
      });
    }
    const proofOwnedByUser = await this.repo.privateUploadBelongsToUser(
      params.proofUploadId,
      params.userId,
    );
    if (!proofOwnedByUser) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_PROOF_UPLOAD',
        message: 'Deposit proof upload was not found for this user.',
      });
    }

    const wallet = await this.getOrCreateWallet(params.userId);
    const orderId = `ip_dep_${wallet.id.replace(/-/g, '')}_${Date.now()}`.slice(0, 128);
    const row = await this.repo.createInstapayManualDepositRequest({
      userId: params.userId,
      walletId: wallet.id,
      amountEgp: params.amountEgp,
      orderId,
      proofUploadId: params.proofUploadId,
      destinationAccountSnapshot: display,
      providerPayload: {
        sender_account: params.senderAccount,
      },
    });
    return this.toManualDepositRequest(row);
  }

  async getInstapayDepositContext(): Promise<{ platformInstapayDisplay: Record<string, unknown> }> {
    await this.assertWalletFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
    const display = status.platformInstapayDisplay ?? {};
    return { platformInstapayDisplay: display };
  }

  async cancelInstapayWithdrawal(userId: string, withdrawalId: string): Promise<WithdrawalRequest> {
    await this.assertWalletFeatureEnabled();
    const row = await this.repo.cancelInstapayWithdrawalByUser(withdrawalId, userId);
    if (!row) {
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_CANCELLABLE',
        message: 'Withdrawal cannot be cancelled.',
      });
    }
    return this.toWithdrawalRequest(row);
  }

  async listManualDepositsForAdmin(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: ManualDepositRequest[]; total: number }> {
    const { rows, total } = await this.repo.listManualDepositsForAdmin(params);
    return { items: rows.map((r) => this.toManualDepositRequest(r)), total };
  }

  async approveManualInstapayDepositAdmin(
    depositId: string,
    adminId: string,
    creditedAmountEgp?: number,
  ): Promise<ManualDepositRequest> {
    const dep = await this.repo.findDepositRequestById(depositId);
    if (!dep) {
      throw new HttpError({
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'Deposit request not found.',
      });
    }
    const credit =
      creditedAmountEgp != null && Number.isFinite(creditedAmountEgp)
        ? creditedAmountEgp
        : parseFloat(dep.amount);
    const { ok, row } = await this.repo.approveManualDepositById({
      depositId,
      adminId,
      creditedAmountEgp: credit,
    });
    if (!ok || !row) {
      throw new HttpError({
        statusCode: 400,
        code: 'DEPOSIT_NOT_APPROVABLE',
        message: 'Deposit cannot be approved (wrong status or already processed).',
      });
    }
    const mapped = this.toManualDepositRequest(row);
    await this.notificationsService.createForUser(mapped.userId, {
      type: 'wallet_deposit_approved',
      title: 'InstaPay deposit approved',
      message: `Your InstaPay deposit request for ${mapped.amountEgp.toFixed(2)} EGP was approved.`,
      payload: { depositId: mapped.id, creditedAmountEgp: mapped.creditedAmountEgp },
    });
    return mapped;
  }

  async rejectManualInstapayDepositAdmin(
    depositId: string,
    adminId: string,
    reason: string,
  ): Promise<ManualDepositRequest> {
    const row = await this.repo.rejectManualDepositById({ depositId, adminId, reason });
    if (!row) {
      throw new HttpError({
        statusCode: 400,
        code: 'DEPOSIT_NOT_REJECTABLE',
        message: 'Deposit cannot be rejected.',
      });
    }
    const mapped = this.toManualDepositRequest(row);
    await this.notificationsService.createForUser(mapped.userId, {
      type: 'wallet_deposit_rejected',
      title: 'InstaPay deposit rejected',
      message: `Your InstaPay deposit request was rejected. Reason: ${reason}`,
      payload: { depositId: mapped.id, reason },
    });
    return mapped;
  }

  async listManualWithdrawalsForAdmin(params: {
    status?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: WithdrawalRequest[]; total: number }> {
    const { rows, total } = await this.repo.listManualWithdrawalsForAdmin(params);
    return { items: rows.map((r) => this.toWithdrawalRequest(r)), total };
  }

  async completeInstapayWithdrawalAdmin(
    withdrawalId: string,
    adminId: string,
    proofUploadId: string,
  ): Promise<WithdrawalRequest> {
    const row = await this.repo.completeInstapayWithdrawalByAdmin({
      withdrawalId,
      adminId,
      proofUploadId,
    });
    if (!row) {
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_COMPLETABLE',
        message: 'Withdrawal cannot be completed.',
      });
    }
    const mappedW = this.toWithdrawalRequest(row);
    void this.notificationsService
      .createForUser(row.user_id, {
        type: 'wallet_withdrawal_completed',
        title: 'Withdrawal completed',
        message: `Your InstaPay withdrawal of ${mappedW.sourceAmountEgp.toFixed(2)} EGP was marked completed.`,
        payload: { withdrawalId: row.id },
      })
      .catch(() => {});
    return mappedW;
  }

  async completePaymobWithdrawalAdmin(
    withdrawalId: string,
    adminId: string,
    input: { providerReference?: string | null; note?: string | null },
  ): Promise<WithdrawalRequest> {
    const row = await this.repo.completePaymobWithdrawalByAdmin({
      withdrawalId,
      adminId,
      providerReference: input.providerReference ?? null,
      note: input.note ?? null,
    });
    if (!row) {
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_COMPLETABLE',
        message: 'Paymob withdrawal cannot be completed.',
      });
    }
    const mapped = this.toWithdrawalRequest(row);
    void this.notificationsService
      .createForUser(row.user_id, {
        type: 'wallet_withdrawal_completed',
        title: 'Withdrawal completed',
        message: `Your Paymob withdrawal of ${mapped.sourceAmountEgp.toFixed(2)} EGP was marked completed.`,
        payload: { withdrawalId: row.id },
      })
      .catch(() => {});
    return mapped;
  }

  async rejectInstapayWithdrawalAdmin(
    withdrawalId: string,
    adminId: string,
    reason: string,
  ): Promise<WithdrawalRequest> {
    const row = await this.repo.rejectInstapayWithdrawalByAdmin({
      withdrawalId,
      adminId,
      reason,
    });
    if (!row) {
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_REJECTABLE',
        message: 'Withdrawal cannot be rejected.',
      });
    }
    const mappedR = this.toWithdrawalRequest(row);
    void this.notificationsService
      .createForUser(row.user_id, {
        type: 'wallet_withdrawal_rejected',
        title: 'Withdrawal rejected',
        message: `Your withdrawal request was rejected. Reason: ${reason}`,
        payload: { withdrawalId: row.id, reason },
      })
      .catch(() => {});
    return mappedR;
  }

  private toManualDepositRequest(row: DepositRequestRow): ManualDepositRequest {
    const senderAccountRaw = row.provider_payload?.sender_account;
    const senderAccount = typeof senderAccountRaw === 'string' ? senderAccountRaw : null;
    return {
      id: row.id,
      userId: row.user_id,
      amountEgp: parseFloat(row.amount),
      currency: row.currency,
      orderId: row.order_id,
      status: row.status as ManualDepositRequest['status'],
      provider: row.provider,
      proofUploadId: row.proof_upload_id,
      senderAccount,
      destinationAccountSnapshot: row.destination_account_snapshot,
      reviewedAt: row.reviewed_at,
      rejectionReason: row.rejection_reason,
      creditedAmountEgp:
        row.credited_amount_egp != null ? parseFloat(row.credited_amount_egp) : null,
      rateSnapshot: row.rate_snapshot,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async verifyWithdrawal(
    userId: string,
    withdrawalId: string,
    verificationCode: string,
  ): Promise<WithdrawalRequest> {
    await this.assertWalletFeatureEnabled();
    const row = await this.repo.findWithdrawalRequestByIdForUser(withdrawalId, userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'WITHDRAWAL_NOT_FOUND',
        message: 'Withdrawal request not found.',
      });
    }

    if (row.withdrawal_method === 'instapay') {
      throw new HttpError({
        statusCode: 400,
        code: 'WITHDRAWAL_NOT_VERIFIABLE',
        message: 'InstaPay withdrawals do not use payout verification.',
      });
    }

    if (
      (!env.NOWPAYMENTS_MANUAL_PAYOUT_VERIFY || !row.verification_required) &&
      (row.status === 'processing' || row.status === 'finished')
    ) {
      return this.toWithdrawalRequest(row);
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
    await this.assertWalletFeatureEnabled();
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

    const { updated, status, row } = await this.repo.applyWithdrawalWebhookStatus({
      batchWithdrawalId,
      withdrawalId,
      providerStatus: statusValue.toLowerCase(),
      providerPayload: parentPayload ? { parent: parentPayload, item: eventPayload } : eventPayload,
    });
    if (updated && row) {
      if (status === 'finished') {
        const egp = parseFloat(row.source_amount_egp ?? row.amount);
        void this.notificationsService
          .createForUser(row.user_id, {
            type: 'wallet_withdrawal_completed',
            title: 'Withdrawal completed',
            message: `Your crypto withdrawal of ${egp.toFixed(2)} EGP has been sent.`,
            payload: { withdrawalId: row.id },
          })
          .catch(() => {});
      } else if (status === 'failed' || status === 'rejected' || status === 'cancelled') {
        void this.notificationsService
          .createForUser(row.user_id, {
            type: 'wallet_withdrawal_rejected',
            title: 'Withdrawal failed',
            message: `Your withdrawal could not be completed (status: ${status}). Funds were returned where applicable.`,
            payload: { withdrawalId: row.id, reason: status },
          })
          .catch(() => {});
      }
    }
  }

  private async tryStartPaymobPayout(
    row: WithdrawalRequestRow,
    recipient: string,
  ): Promise<WithdrawalRequestRow> {
    try {
      const token = await authenticatePaymobPayout();
      const disbursement = await createPaymobDisbursement(token, {
        amountEgp: parseFloat(row.source_amount_egp ?? row.amount),
        recipient,
        reference: row.id,
      });
      const updated = await this.repo.markWithdrawalPaymobPayoutStarted({
        withdrawalId: row.id,
        payoutReference: disbursement.reference,
        providerStatus: disbursement.status,
        providerPayload: { paymob_disbursement: disbursement },
      });
      return updated ?? row;
    } catch (error) {
      const message =
        error instanceof PaymobNotConfiguredError
          ? 'Paymob payouts are not configured yet.'
          : error instanceof Error
            ? error.message
            : 'Failed to start Paymob payout.';
      const blocked = await this.repo.setWithdrawalBlocked({
        withdrawalId: row.id,
        error: message,
        providerStatus: 'blocked',
      });
      return blocked ?? row;
    }
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
            amount:
              row.payout_crypto_amount != null && String(row.payout_crypto_amount).length > 0
                ? parseFloat(row.payout_crypto_amount)
                : parseFloat(row.amount),
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
        this.toStringOrNull(payoutResult.withdrawal_id) || this.toStringOrNull(firstWithdrawal?.id);
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

    const auth = await authenticateNowPayments(
      env.NOWPAYMENTS_AUTH_EMAIL,
      env.NOWPAYMENTS_AUTH_PASSWORD,
    );
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

  private resolveTrustedWebReturnBase(returnUrl?: string): string {
    const fallback = (env.WEB_PUBLIC_URL || env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')[0]!
      .trim()
      .replace(/\/$/, '');
    if (!returnUrl) return fallback;
    try {
      const candidate = new URL(returnUrl);
      const allowedOrigins = [
        ...(env.WEB_PUBLIC_URL ? [env.WEB_PUBLIC_URL] : []),
        ...env.CORS_ORIGIN.split(','),
        ...(env.CORS_EXTRA_ORIGINS ? env.CORS_EXTRA_ORIGINS.split(',') : []),
      ]
        .map((origin) => origin.trim())
        .filter(Boolean)
        .map((origin) => new URL(origin).origin);
      return allowedOrigins.includes(candidate.origin) ? returnUrl.replace(/\/$/, '') : fallback;
    } catch {
      return fallback;
    }
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

  private toNumberOrNull(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  private readPath(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  }

  private toWallet(row: WalletRow): Wallet {
    return {
      id: row.id,
      userId: row.user_id,
      balance: parseFloat(row.balance),
      currency: 'EGP',
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
    const sourceEgp = parseFloat(row.source_amount_egp ?? row.amount);
    const destCrypto =
      row.payout_crypto_amount != null && String(row.payout_crypto_amount).length > 0
        ? parseFloat(row.payout_crypto_amount)
        : null;
    return {
      id: row.id,
      userId: row.user_id,
      walletId: row.wallet_id,
      holdId: row.hold_id,
      sourceAmountEgp: sourceEgp,
      sourceCurrency: 'EGP',
      method: (row.withdrawal_method === 'instapay'
        ? 'instapay'
        : row.withdrawal_method === 'paymob'
          ? 'paymob'
          : 'crypto') as WithdrawalRequest['method'],
      destinationCurrency: row.currency,
      destinationCryptoAmount: destCrypto,
      payoutAddress: row.payout_address,
      payoutExtraId: row.payout_extra_id,
      instapayRecipient: row.instapay_recipient,
      adminProofUploadId: row.admin_proof_upload_id,
      rateSnapshot: row.rate_snapshot,
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
      rejectionReason: row.rejection_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
