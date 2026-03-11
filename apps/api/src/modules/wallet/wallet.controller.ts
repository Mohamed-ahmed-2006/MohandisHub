// ---------------------------------------------------------------------------
// Wallet controller - HTTP handlers
// ---------------------------------------------------------------------------

import type {
  ApiSuccessBody,
  CreateDepositCheckoutBody,
  CreateWithdrawalRequestBody,
  DepositCheckoutResponse,
  Wallet,
  WithdrawalRequest,
} from '@mohandishub/shared';
import type { NextFunction, Request, Response } from 'express';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { WalletService } from './wallet.service.js';

const walletService = new WalletService();

function extractRawBody(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') return body;
  return JSON.stringify(body ?? '');
}

function getUser(req: { user?: { id: string; role: string } }): { id: string; role: string } {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

function parseDepositBody(body: unknown): CreateDepositCheckoutBody {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const amountRaw = source.amount;
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string'
        ? parseFloat(amountRaw)
        : NaN;
  const method = source.method;
  if (method !== 'crypto' && method !== 'card') {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_METHOD',
      message: 'Deposit method must be crypto or card.',
    });
  }

  const payload: CreateDepositCheckoutBody = {
    amount,
    method,
    ...(typeof source.currency === 'string' ? { currency: source.currency } : {}),
    ...(typeof source.payCurrency === 'string' ? { payCurrency: source.payCurrency } : {}),
    ...(typeof source.returnUrl === 'string' ? { returnUrl: source.returnUrl } : {}),
  };
  return payload;
}

function parseWithdrawalBody(body: unknown): CreateWithdrawalRequestBody {
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const amountRaw = source.amount;
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string'
        ? parseFloat(amountRaw)
        : NaN;

  return {
    amount,
    ...(typeof source.currency === 'string' ? { currency: source.currency } : {}),
    ...(typeof source.address === 'string' ? { address: source.address } : {}),
    ...(typeof source.extraId === 'string' ? { extraId: source.extraId } : {}),
    ...(typeof source.saveAddress === 'boolean' ? { saveAddress: source.saveAddress } : {}),
  };
}

const getMyWallet = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const wallet = await walletService.getOrCreateWallet(user.id);
  const response: ApiSuccessBody<Wallet> = { ok: true, data: wallet };
  res.json(response);
});

const getMyTransactions = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const result = await walletService.getTransactions(user.id, page, limit);
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

const getDepositCurrencies = asyncHandler(async (_req, res) => {
  const currencies = await walletService.getDepositCurrencies();
  const response: ApiSuccessBody<{ currencies: string[] }> = {
    ok: true,
    data: { currencies },
  };
  res.json(response);
});

const getDepositEstimate = asyncHandler(async (req, res) => {
  const amountRaw = req.query.amount;
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string'
        ? parseFloat(amountRaw)
        : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }

  const currencyFrom = typeof req.query.currencyFrom === 'string' ? req.query.currencyFrom : undefined;
  const currencyTo = typeof req.query.currencyTo === 'string' ? req.query.currencyTo : undefined;
  const estimate = await walletService.estimateDeposit({
    amount,
    ...(currencyFrom !== undefined && { currencyFrom }),
    ...(currencyTo !== undefined && { currencyTo }),
  });
  const response: ApiSuccessBody<typeof estimate> = { ok: true, data: estimate };
  res.json(response);
});

const createDepositCheckout = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const payload = parseDepositBody(req.body);
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }

  const result = await walletService.createDepositCheckout(user.id, payload);
  const response: ApiSuccessBody<DepositCheckoutResponse> = { ok: true, data: result };
  res.json(response);
});

const createLegacyCryptoDeposit = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const source = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const amountRaw = source.amount;
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string'
        ? parseFloat(amountRaw)
        : NaN;
  const payCurrency = typeof source.currency === 'string' ? source.currency : 'USDTTRC20';
  const returnUrl = typeof source.returnUrl === 'string' ? source.returnUrl : undefined;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }
  const result = await walletService.createDepositCheckout(user.id, {
    amount,
    method: 'crypto',
    currency: 'USD',
    payCurrency,
    ...(returnUrl ? { returnUrl } : {}),
  });
  res.json({ ok: true, data: { paymentUrl: result.checkoutUrl, orderId: result.orderId } });
});

const createLegacyCardDeposit = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const source = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const amountRaw = source.amount;
  const amount =
    typeof amountRaw === 'number'
      ? amountRaw
      : typeof amountRaw === 'string'
        ? parseFloat(amountRaw)
        : NaN;
  const currency = typeof source.currency === 'string' ? source.currency : 'USD';
  const returnUrl = typeof source.returnUrl === 'string' ? source.returnUrl : undefined;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }
  const result = await walletService.createDepositCheckout(user.id, {
    amount,
    method: 'card',
    currency,
    ...(returnUrl ? { returnUrl } : {}),
  });
  res.json({ ok: true, data: { checkoutUrl: result.checkoutUrl, sessionId: result.orderId } });
});

const confirmLegacyStripeSession = asyncHandler((_req, res) => {
  res.json({ ok: true, data: { credited: false } });
});

const createWithdrawal = asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role !== 'expert') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts can request withdrawals.',
    });
  }

  const payload = parseWithdrawalBody(req.body);
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_AMOUNT',
      message: 'Valid amount is required.',
    });
  }

  const result = await walletService.createWithdrawalRequest(user.id, payload);
  const response: ApiSuccessBody<WithdrawalRequest> = { ok: true, data: result };
  res.status(201).json(response);
});

const verifyWithdrawal = asyncHandler(async (req, res) => {
  const user = getUser(req);
  if (user.role !== 'expert') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts can verify withdrawals.',
    });
  }

  const withdrawalId = (req.params.withdrawalId ?? '').trim();
  if (!withdrawalId) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_REQUEST',
      message: 'withdrawalId is required.',
    });
  }

  const body = req.body as { verificationCode?: unknown } | undefined;
  const verificationCode =
    typeof body?.verificationCode === 'string' ? body.verificationCode.trim() : '';
  if (!verificationCode) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_VERIFICATION_CODE',
      message: 'verificationCode is required.',
    });
  }

  const result = await walletService.verifyWithdrawal(user.id, withdrawalId, verificationCode);
  const response: ApiSuccessBody<WithdrawalRequest> = { ok: true, data: result };
  res.json(response);
});

const listWithdrawals = asyncHandler(async (req, res) => {
  const user = getUser(req);
  const result = await walletService.listWithdrawals(user.id);
  const response: ApiSuccessBody<WithdrawalRequest[]> = { ok: true, data: result };
  res.json(response);
});

async function nowPaymentsDepositIpn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = extractRawBody(req.body);
    const signature = (req.headers['x-nowpayments-sig'] as string) ?? '';
    await walletService.handleNowPaymentsDepositIpn(rawBody, signature);
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function nowPaymentsPayoutIpn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = extractRawBody(req.body);
    const signature = (req.headers['x-nowpayments-sig'] as string) ?? '';
    await walletService.handleNowPaymentsPayoutIpn(rawBody, signature);
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

async function nowPaymentsIpn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = extractRawBody(req.body);
    const signature = (req.headers['x-nowpayments-sig'] as string) ?? '';
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const isPayoutEvent =
      Array.isArray(payload.withdrawals) ||
      payload.batch_withdrawal_id != null ||
      payload.withdrawal_id != null;

    if (isPayoutEvent) {
      await walletService.handleNowPaymentsPayoutIpn(rawBody, signature);
    } else {
      await walletService.handleNowPaymentsDepositIpn(rawBody, signature);
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export const walletController = {
  getMyWallet,
  getMyTransactions,
  getDepositCurrencies,
  getDepositEstimate,
  createDepositCheckout,
  createLegacyCryptoDeposit,
  createLegacyCardDeposit,
  confirmLegacyStripeSession,
  createWithdrawal,
  verifyWithdrawal,
  listWithdrawals,
  nowPaymentsIpn,
  nowPaymentsDepositIpn,
  nowPaymentsPayoutIpn,
};
