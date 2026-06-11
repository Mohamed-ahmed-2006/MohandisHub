import type { AuthUser } from '@mohandishub/shared';
import type { Wallet } from '@mohandishub/shared';
import useSWR from 'swr';

import { authApiClient } from '@/lib/auth/client';
import { walletApiClient } from '@/lib/wallet/client';

const AUTH_ME_KEY = 'api/auth/me';
const WALLET_ME_KEY = 'api/wallet/me';

export function useAuthMe(accessToken: string | null) {
  const { data, error, mutate } = useSWR<AuthUser | null, Error>(
    accessToken ? [AUTH_ME_KEY, accessToken] : null,
    async ([, token]: [string, string]) => {
      if (!token) return null;
      return authApiClient.me(token);
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 60_000,
    },
  );
  return { authUser: data ?? null, error, mutate };
}

export function useWallet(accessToken: string | null, options?: { revalidateOnFocus?: boolean }) {
  const { data, error, mutate } = useSWR<Wallet | null, Error>(
    accessToken ? [WALLET_ME_KEY, accessToken] : null,
    async ([, token]: [string, string]) => {
      if (!token) return null;
      return walletApiClient.getMyWallet(token);
    },
    {
      revalidateOnFocus: options?.revalidateOnFocus ?? true,
      dedupingInterval: 30_000,
      shouldRetryOnError: false,
    },
  );
  return { wallet: data ?? null, error, mutate };
}
