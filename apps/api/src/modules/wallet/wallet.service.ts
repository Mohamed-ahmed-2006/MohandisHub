// ---------------------------------------------------------------------------
// Wallet service — business logic
// ---------------------------------------------------------------------------

import type { Transaction, Wallet } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import {
  createPayment as cryptomusCreatePayment,
  verifyWebhookSign,
} from '../../lib/cryptomus.client.js';
import { stripe } from '../../lib/stripe.client.js';
import { HttpError } from '../../utils/http-error.js';
import { SettingsService } from '../settings/settings.service.js';

import { WalletRepository } from './wallet.repository.js';
import type { TransactionRow, WalletRow } from './wallet.repository.js';

export class WalletService {
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

  async createCryptoDeposit(
    userId: string,
    amount: number,
    currency: string,
    baseUrlFromEnvOrReq?: string,
  ): Promise<{ paymentUrl: string; orderId: string }> {
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }
    if (status.disableCryptoDeposits) {
      throw new HttpError({
        statusCode: 503,
        code: 'CRYPTO_DEPOSITS_DISABLED',
        message: 'Crypto deposits are not available.',
      });
    }
    if (status.minDepositAmount != null && amount < status.minDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum deposit is ${status.minDepositAmount}.`,
      });
    }
    if (status.maxDepositAmount != null && amount > status.maxDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_HIGH',
        message: `Maximum deposit is ${status.maxDepositAmount}.`,
      });
    }
    if (!env.CRYPTOMUS_MERCHANT_ID || !env.CRYPTOMUS_API_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'CRYPTO_UNAVAILABLE',
        message: 'Crypto payments are not configured.',
      });
    }
    const wallet = await this.getOrCreateWallet(userId);
    const orderId = `deposit_${wallet.id.replace(/-/g, '')}_${Date.now()}`.slice(0, 128);
    await this.repo.createDepositRequest(userId, wallet.id, amount, currency, orderId);

    const baseUrl =
      baseUrlFromEnvOrReq ?? env.API_PUBLIC_URL ?? env.CORS_ORIGIN ?? 'http://localhost:4000';
    const res = await cryptomusCreatePayment(
      {
        amount: amount.toFixed(2),
        currency: 'USDT',
        orderId,
        urlCallback: `${baseUrl.replace(/\/$/, '')}/api/wallet/cryptomus-webhook`,
        urlReturn: baseUrl.replace(/\/$/, ''),
        urlSuccess: baseUrl.replace(/\/$/, ''),
        lifetime: 3600,
      },
      env.CRYPTOMUS_MERCHANT_ID,
      env.CRYPTOMUS_API_KEY,
    );

    const url = res.result?.url;
    if (!url) {
      throw new HttpError({
        statusCode: 502,
        code: 'CRYPTO_GATEWAY_ERROR',
        message: 'Could not create payment link.',
      });
    }
    return { paymentUrl: url, orderId };
  }

  async createStripeCheckout(
    userId: string,
    amount: number,
    currency: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }
    if (status.disableCardDeposits) {
      throw new HttpError({
        statusCode: 503,
        code: 'CARD_DEPOSITS_DISABLED',
        message: 'Card deposits are not available.',
      });
    }
    if (status.minDepositAmount != null && amount < status.minDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_LOW',
        message: `Minimum deposit is ${status.minDepositAmount}.`,
      });
    }
    if (status.maxDepositAmount != null && amount > status.maxDepositAmount) {
      throw new HttpError({
        statusCode: 400,
        code: 'AMOUNT_TOO_HIGH',
        message: `Maximum deposit is ${status.maxDepositAmount}.`,
      });
    }
    if (!stripe || !env.STRIPE_SECRET_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'STRIPE_UNAVAILABLE',
        message: 'Card payments are not configured.',
      });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_AMOUNT',
        message: 'Valid amount is required.',
      });
    }
    const wallet = await this.getOrCreateWallet(userId);
    const orderId = `stripe_${userId.replace(/-/g, '')}_${Date.now()}`.slice(0, 128);
    await this.repo.createDepositRequest(userId, wallet.id, amount, currency, orderId);

    const amountInCents = Math.round(amount * 100);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: 'Wallet Deposit',
              description: `Deposit ${amount.toFixed(2)} ${currency} to your MohandisHub wallet`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { order_id: orderId, user_id: userId },
    });

    const url = session.url;
    if (!url) {
      throw new HttpError({
        statusCode: 502,
        code: 'STRIPE_ERROR',
        message: 'Could not create checkout session.',
      });
    }
    return { checkoutUrl: url, sessionId: session.id };
  }

  /**
   * Confirm a Stripe Checkout session and credit the wallet if not already done.
   * Safe to call when returning from success URL (idempotent if webhook already ran).
   */
  async confirmStripeSession(userId: string, sessionId: string): Promise<{ credited: boolean }> {
    const status = await this.settingsService.getAppStatus();
    if (status.depositsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'DEPOSITS_PAUSED',
        message: 'Deposits are temporarily disabled.',
      });
    }
    if (!stripe || !env.STRIPE_SECRET_KEY) {
      throw new HttpError({
        statusCode: 503,
        code: 'STRIPE_UNAVAILABLE',
        message: 'Card payments are not configured.',
      });
    }
    let session: { metadata?: { order_id?: string; user_id?: string }; payment_status?: string; amount_total?: number; id: string };
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId, { expand: [] }) as typeof session;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Stripe session could not be retrieved.';
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SESSION',
        message: msg,
      });
    }
    const orderId = session.metadata?.order_id;
    const metaUserId = session.metadata?.user_id;
    if (!orderId || metaUserId !== userId) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SESSION',
        message: 'Invalid or expired checkout session.',
      });
    }
    if (session.payment_status !== 'paid') {
      return { credited: false };
    }
    const deposit = await this.repo.findDepositRequestByOrderId(orderId);
    if (!deposit || deposit.status !== 'pending') {
      return { credited: deposit?.status === 'paid' };
    }
    const amount = (session.amount_total ?? 0) / 100;
    const referenceIdForDb = session.id ? session.id : null;

    await this.repo.creditWallet(
      deposit.wallet_id,
      deposit.user_id,
      amount,
      `Card deposit (Stripe)`,
      'stripe',
      referenceIdForDb,
    );
    await this.repo.updateDepositRequestStatus(orderId, 'paid', session.id);
    return { credited: true };
  }

  async handleStripeWebhook(rawBody: Buffer | string, signature: string): Promise<void> {
    if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
      throw new HttpError({
        statusCode: 503,
        code: 'STRIPE_WEBHOOK_NOT_CONFIGURED',
        message: 'Stripe webhook secret is not configured. Set STRIPE_WEBHOOK_SECRET.',
      });
    }
    let event: {
      type: string;
      data: {
        object?: {
          id?: string;
          metadata?: { order_id?: string };
          amount_total?: number;
          currency?: string;
        };
      };
    };
    try {
      const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, 'utf8');
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET,
      ) as typeof event;
    } catch {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid webhook signature.',
      });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      const orderId = session?.metadata?.order_id;
      if (!orderId) return;
      const deposit = await this.repo.findDepositRequestByOrderId(orderId);
      if (!deposit || deposit.status !== 'pending') return;
      const amount = (session?.amount_total ?? 0) / 100;
      const refId = session?.id ? session.id : null;
      await this.repo.creditWallet(
        deposit.wallet_id,
        deposit.user_id,
        amount,
        `Card deposit (Stripe)`,
        'stripe',
        refId,
      );
      await this.repo.updateDepositRequestStatus(orderId, 'paid', session?.id);
    }
  }

  async handleCryptomusWebhook(rawBody: string, signHeader: string): Promise<void> {
    const key = env.CRYPTOMUS_WEBHOOK_KEY ?? env.CRYPTOMUS_API_KEY;
    if (!key) return;
    if (!verifyWebhookSign(rawBody, signHeader, key)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid webhook signature.',
      });
    }
    const body = JSON.parse(rawBody) as {
      order_id?: string;
      status?: string;
      uuid?: string;
      merchant?: string;
    };
    const orderId = body.order_id;
    if (!orderId) return;
    const deposit = await this.repo.findDepositRequestByOrderId(orderId);
    if (!deposit || deposit.status !== 'pending') return;
    const status = String(body.status ?? '').toLowerCase();
    if (status !== 'paid' && status !== 'confirmed') {
      if (status === 'expired' || status === 'canceled' || status === 'failed') {
        await this.repo.updateDepositRequestStatus(
          orderId,
          status === 'canceled' ? 'cancelled' : status,
          body.uuid,
        );
      }
      return;
    }
    const amount = parseFloat(deposit.amount);
    await this.repo.creditWallet(
      deposit.wallet_id,
      deposit.user_id,
      amount,
      'Crypto deposit (Cryptomus)',
      'cryptomus',
      body.uuid ?? null,
    );
    await this.repo.updateDepositRequestStatus(orderId, 'paid', body.uuid);
  }

  private toWallet(row: WalletRow): Wallet {
    return {
      id: row.id,
      userId: row.user_id,
      balance: parseFloat(row.balance),
      currency: row.currency,
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
}
