import type {
  ApiErrorBody,
  ApiSuccessBody,
  CreateDepositCheckoutBody,
  CreateWithdrawalRequestBody,
  DepositCheckoutResponse,
  Wallet,
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
    currency: string = 'EGP',
    returnUrl?: string,
  ): Promise<{ checkoutUrl: string; sessionId: string }> => {
    const result = await walletApiClient.createDepositCheckout(accessToken, {
      amount,
      currency,
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
};
