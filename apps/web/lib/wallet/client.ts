import type {
  ApiErrorBody,
  ApiSuccessBody,
  CreateDepositCheckoutBody,
  CreateWithdrawalRequestBody,
  DepositCheckoutResponse,
  ManualDepositRequest,
  Wallet,
  WithdrawalQuoteResponse,
  WithdrawalRequest,
} from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

type RequestOptions = {
  accessToken: string;
  path: string;
  method?: 'GET' | 'POST';
  body?: unknown;
};

async function requestJson<T>({ accessToken, path, method = 'GET', body }: RequestOptions): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${accessToken}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const rawErrorBody: unknown = await response.json().catch(() => null);
    const maybeError = rawErrorBody as ApiErrorBody | null;
    if (maybeError && maybeError.error) {
      throw new ApiClientRequestError({
        code: maybeError.error.code,
        message: maybeError.error.message,
        status: response.status,
        details: maybeError.error.details,
      });
    }
    throw new ApiClientRequestError({
      code: 'HTTP_ERROR',
      message: `Request failed with status ${response.status}`,
      status: response.status,
    });
  }

  const bodyJson = (await response.json()) as ApiSuccessBody<T>;
  return bodyJson.data;
}

export const walletApiClient = {
  getMyWallet: async (accessToken: string): Promise<Wallet> =>
    requestJson<Wallet>({ accessToken, path: '/api/wallet/me' }),

  getDepositCurrencies: async (accessToken: string): Promise<string[]> => {
    const data = await requestJson<{ currencies: string[] }>({
      accessToken,
      path: '/api/wallet/deposit/currencies',
    });
    return data.currencies;
  },

  getDepositEstimate: async (
    accessToken: string,
    amount: number,
    currencyFrom: string = 'USD',
    currencyTo: string = 'USDTTRC20',
  ): Promise<{
    amountFrom: number;
    currencyFrom: string;
    currencyTo: string;
    estimatedAmount: number;
    rate: number | null;
  }> =>
    requestJson<{
      amountFrom: number;
      currencyFrom: string;
      currencyTo: string;
      estimatedAmount: number;
      rate: number | null;
    }>({
      accessToken,
      path: `/api/wallet/deposit/estimate?amount=${encodeURIComponent(String(amount))}&currencyFrom=${encodeURIComponent(
        currencyFrom,
      )}&currencyTo=${encodeURIComponent(currencyTo)}`,
    }),

  createDepositCheckout: async (
    accessToken: string,
    payload: CreateDepositCheckoutBody,
  ): Promise<DepositCheckoutResponse> =>
    requestJson<DepositCheckoutResponse>({
      accessToken,
      path: '/api/wallet/deposit/checkout',
      method: 'POST',
      body: payload,
    }),

  // Backward compatibility wrappers
  createCryptoDeposit: async (
    accessToken: string,
    amount: number,
    payCurrency: string = 'USDTTRC20',
  ): Promise<{ paymentUrl: string; orderId: string }> => {
    const result = await walletApiClient.createDepositCheckout(accessToken, {
      amount,
      currency: 'EGP',
      method: 'crypto',
      payCurrency,
    });
    return { paymentUrl: result.checkoutUrl, orderId: result.orderId };
  },

  createStripeCheckout: async (
    accessToken: string,
    amount: number,
    currency: string = 'USD',
    returnUrl?: string,
  ): Promise<{ checkoutUrl: string; sessionId: string }> => {
    const result = await walletApiClient.createDepositCheckout(accessToken, {
      amount,
      currency: currency === 'USD' ? 'EGP' : currency,
      method: 'card',
      ...(returnUrl ? { returnUrl } : {}),
    });
    return { checkoutUrl: result.checkoutUrl, sessionId: result.orderId };
  },

  createWithdrawal: async (
    accessToken: string,
    payload: CreateWithdrawalRequestBody,
  ): Promise<WithdrawalRequest> =>
    requestJson<WithdrawalRequest>({
      accessToken,
      path: '/api/wallet/withdrawals',
      method: 'POST',
      body: payload,
    }),

  verifyWithdrawal: async (
    accessToken: string,
    withdrawalId: string,
    verificationCode: string,
  ): Promise<WithdrawalRequest> =>
    requestJson<WithdrawalRequest>({
      accessToken,
      path: `/api/wallet/withdrawals/${encodeURIComponent(withdrawalId)}/verify`,
      method: 'POST',
      body: { verificationCode },
    }),

  listWithdrawals: async (accessToken: string): Promise<WithdrawalRequest[]> =>
    requestJson<WithdrawalRequest[]>({ accessToken, path: '/api/wallet/withdrawals' }),

  getWithdrawalQuote: async (
    accessToken: string,
    amountEgp: number,
    payoutCurrency: string,
  ): Promise<WithdrawalQuoteResponse> =>
    requestJson<WithdrawalQuoteResponse>({
      accessToken,
      path: `/api/wallet/withdrawals/quote?amountEgp=${encodeURIComponent(String(amountEgp))}&payoutCurrency=${encodeURIComponent(payoutCurrency)}`,
    }),

  getInstapayDepositInfo: async (
    accessToken: string,
  ): Promise<{ platformInstapayDisplay: Record<string, unknown> }> =>
    requestJson<{ platformInstapayDisplay: Record<string, unknown> }>({
      accessToken,
      path: '/api/wallet/deposit/instapay/info',
    }),

  submitInstapayDeposit: async (
    accessToken: string,
    body: { amountEgp: number; proofUploadId: string },
  ): Promise<ManualDepositRequest> =>
    requestJson<ManualDepositRequest>({
      accessToken,
      path: '/api/wallet/deposits/instapay',
      method: 'POST',
      body,
    }),

  cancelWithdrawal: async (accessToken: string, withdrawalId: string): Promise<WithdrawalRequest> =>
    requestJson<WithdrawalRequest>({
      accessToken,
      path: `/api/wallet/withdrawals/${encodeURIComponent(withdrawalId)}/cancel`,
      method: 'POST',
    }),
};
