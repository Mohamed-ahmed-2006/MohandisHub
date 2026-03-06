import type { ApiErrorBody, ApiSuccessBody, Wallet } from '@mohandishub/shared';

import { ApiClientRequestError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

export const walletApiClient = {
  getMyWallet: async (accessToken: string): Promise<Wallet> => {
    const response = await fetch(`${getApiBaseUrl()}/api/wallet/me`, {
      credentials: 'include',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const rawErrorBody: unknown = await response.json().catch(() => null);
      const maybeError = rawErrorBody as ApiErrorBody | null;
      if (maybeError && maybeError.error) {
        throw new ApiClientRequestError({
          code: maybeError.error.code,
          message: maybeError.error.message,
          status: response.status,
        });
      }
      throw new ApiClientRequestError({
        code: 'HTTP_ERROR',
        message: `Request failed with status ${response.status}`,
        status: response.status,
      });
    }

    const body = (await response.json()) as ApiSuccessBody<Wallet>;
    return body.data;
  },

  createCryptoDeposit: async (
    accessToken: string,
    amount: number,
    currency: string = 'EGP',
  ): Promise<{ paymentUrl: string; orderId: string }> => {
    const response = await fetch(`${getApiBaseUrl()}/api/wallet/deposit/crypto`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ amount, currency }),
    });

    if (!response.ok) {
      const rawErrorBody: unknown = await response.json().catch(() => null);
      const maybeError = rawErrorBody as ApiErrorBody | null;
      if (maybeError && maybeError.error) {
        throw new ApiClientRequestError({
          code: maybeError.error.code,
          message: maybeError.error.message,
          status: response.status,
        });
      }
      throw new ApiClientRequestError({
        code: 'HTTP_ERROR',
        message: `Request failed with status ${response.status}`,
        status: response.status,
      });
    }

    const body = (await response.json()) as ApiSuccessBody<{ paymentUrl: string; orderId: string }>;
    return body.data;
  },

  createStripeCheckout: async (
    accessToken: string,
    amount: number,
    currency: string = 'EGP',
  ): Promise<{ checkoutUrl: string; sessionId: string }> => {
    const response = await fetch(`${getApiBaseUrl()}/api/wallet/deposit/stripe`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ amount, currency }),
    });

    if (!response.ok) {
      const rawErrorBody: unknown = await response.json().catch(() => null);
      const maybeError = rawErrorBody as ApiErrorBody | null;
      if (maybeError && maybeError.error) {
        throw new ApiClientRequestError({
          code: maybeError.error.code,
          message: maybeError.error.message,
          status: response.status,
        });
      }
      throw new ApiClientRequestError({
        code: 'HTTP_ERROR',
        message: `Request failed with status ${response.status}`,
        status: response.status,
      });
    }

    const body = (await response.json()) as ApiSuccessBody<{
      checkoutUrl: string;
      sessionId: string;
    }>;
    return body.data;
  },
};
