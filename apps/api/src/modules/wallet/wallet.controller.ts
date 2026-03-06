// ---------------------------------------------------------------------------
// Wallet controller — HTTP handlers
// ---------------------------------------------------------------------------

import type { ApiSuccessBody, Wallet } from '@mohandishub/shared';
import type { Request, Response, NextFunction } from 'express';

import { env } from '../../config/env.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { WalletService } from './wallet.service.js';

const walletService = new WalletService();

function getUserId(req: { user?: { id: string } }): string {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
}

const getMyWallet = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const wallet = await walletService.getOrCreateWallet(userId);
  const response: ApiSuccessBody<Wallet> = { ok: true, data: wallet };
  res.json(response);
});

const getMyTransactions = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const result = await walletService.getTransactions(userId, page, limit);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

function parseDepositBody(body: unknown): { amount: number; currency: string; returnUrl?: string } {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const rawAmount = b.amount;
  const amount =
    typeof rawAmount === 'number'
      ? rawAmount
      : typeof rawAmount === 'string'
        ? parseFloat(rawAmount)
        : 0;
  const currency = typeof b.currency === 'string' ? b.currency : 'EGP';
  const returnUrl = typeof b.returnUrl === 'string' ? b.returnUrl : undefined;
  const out: { amount: number; currency: string; returnUrl?: string } = { amount, currency };
  if (returnUrl !== undefined) out.returnUrl = returnUrl;
  return out;
}

const STRIPE_MIN_AMOUNT_EGP = 50;

const createStripeCheckout = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { amount, currency, returnUrl } = parseDepositBody(req.body);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }
  const currencyUpper = currency.toUpperCase();
  if (currencyUpper === 'EGP' && amount < STRIPE_MIN_AMOUNT_EGP) {
    throw new HttpError({
      statusCode: 400,
      code: 'AMOUNT_TOO_LOW',
      message: `Minimum card deposit is ${STRIPE_MIN_AMOUNT_EGP} EGP.`,
    });
  }
  const base = (
    returnUrl ||
    env.CORS_ORIGIN ||
    env.API_PUBLIC_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
  const successBase = returnUrl ? returnUrl.replace(/\/$/, '') : base;
  const result = await walletService.createStripeCheckout(
    userId,
    amount,
    currency,
    `${successBase}?stripe=success`,
    `${successBase}?stripe=cancelled`,
  );
  res.json({ ok: true, data: result });
});

const createCryptoDeposit = asyncHandler(async (req, res) => {
  const userId = getUserId(req);
  const { amount, currency, returnUrl } = parseDepositBody(req.body);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }
  const baseUrl = returnUrl;
  const result = await walletService.createCryptoDeposit(userId, amount, currency, baseUrl);
  res.json({ ok: true, data: result });
});

async function cryptomusWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body ?? '');
    const sign = (req.headers.sign as string) ?? '';
    await walletService.handleCryptomusWebhook(rawBody, sign);
    res.status(200).json({ ok: true });
  } catch (e) {
    next(e);
  }
}

async function stripeWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : (req.body as string);
    const signature = (req.headers['stripe-signature'] as string) ?? '';
    await walletService.handleStripeWebhook(rawBody, signature);
    res.status(200).json({ received: true });
  } catch (e) {
    next(e);
  }
}

export const walletController = {
  getMyWallet,
  getMyTransactions,
  createStripeCheckout,
  createCryptoDeposit,
  cryptomusWebhook,
  stripeWebhook,
};
