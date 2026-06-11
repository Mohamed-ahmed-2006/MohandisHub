'use client';

import type { AuthUser, LoginBody, RegisterBody, UserRole } from '@mohandishub/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { authUserCache } from '@/lib/auth/auth-cache';
import { authApiClient } from '@/lib/auth/client';
import {
  AUTH_SESSION_REFRESHED_EVENT,
  type AuthSessionRefreshedEventDetail,
} from '@/lib/auth/fetch-with-auth-retry';
import { coalescedRefresh } from '@/lib/auth/refresh-coalesced';
import { sessionStore } from '@/lib/auth/session-store';
import { disconnectChatSocket } from '@/lib/chat/socket';

type RegisterRole = Exclude<UserRole, 'admin'>;

type AuthGuardState = {
  role: RegisterRole | null;
  verificationStatus: AuthUser['verificationStatus'] | null;
  emailVerified: boolean;
};

type RegisterInput = Omit<RegisterBody, 'role'> & { role: RegisterRole };

type AuthContextValue = {
  authUser: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isReady: boolean;
  authGuard: AuthGuardState;
  login: (input: LoginBody) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<string | null>;
  updateAuthUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** localStorage key: set when user has logged in; used to attempt refresh on reload. */
export const AUTH_SESSION_HINT_KEY = 'mohandishub-has-session';
export const AUTH_SESSION_COOKIE_KEY = 'mohandishub-session';

type AuthProviderProps = {
  children: React.ReactNode;
};

const clearSessionState = (
  setAccessToken: (value: string | null) => void,
  setAuthUser: (value: AuthUser | null) => void,
): void => {
  disconnectChatSocket();
  sessionStore.clear();
  setAccessToken(null);
  setAuthUser(null);
  authUserCache.clear();
  window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
  document.cookie = `${AUTH_SESSION_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
};

/** Refresh this many milliseconds before the access token actually expires. */
const PROACTIVE_REFRESH_LEAD_MS = 60_000;

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  // Epoch ms at which the current access token expires (null when unknown).
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);

  const setSessionToken = useCallback((token: string | null, expiresInSeconds?: number) => {
    if (token) {
      sessionStore.setAccessToken(token);
      setAccessToken(token);
      setTokenExpiresAt(
        typeof expiresInSeconds === 'number' && expiresInSeconds > 0
          ? Date.now() + expiresInSeconds * 1000
          : null,
      );
      window.localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
      document.cookie = `${AUTH_SESSION_COOKIE_KEY}=1; Max-Age=2592000; Path=/; SameSite=Lax`;
      return;
    }

    sessionStore.clear();
    setAccessToken(null);
    setTokenExpiresAt(null);
    window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
    document.cookie = `${AUTH_SESSION_COOKIE_KEY}=; Max-Age=0; Path=/; SameSite=Lax`;
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    const result = await coalescedRefresh();

    if (result.kind === 'fatal') {
      clearSessionState(setAccessToken, setAuthUser);
      setTokenExpiresAt(null);
      return null;
    }

    if (result.kind === 'transient') {
      return null;
    }

    setSessionToken(result.accessToken, result.expiresIn);
    setAuthUser(result.user);
    authUserCache.set(result.user);

    return result.accessToken;
  }, [setSessionToken]);

  useEffect(() => {
    let isMounted = true;

    const hasSessionHint = window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1';

    if (!hasSessionHint) {
      setIsReady(true);
      return () => {
        isMounted = false;
      };
    }

    const cached = authUserCache.get();
    const cachedToken = sessionStore.getAccessToken();
    if (cached && cachedToken) {
      setAuthUser(cached);
      setAccessToken(cachedToken);
    }

    void (async () => {
      const token = await refreshSession();

      // A transient failure (network blip / 5xx) leaves the session hint in
      // place but yields no token. Retry once before giving up so a flaky
      // network on reload does not look like a logout.
      if (!token && isMounted && window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1') {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (isMounted) {
          await refreshSession();
        }
      }

      if (isMounted) {
        setIsReady(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (window.localStorage.getItem(AUTH_SESSION_HINT_KEY) !== '1') return;
      // Refresh when we have no token, or when the current one is expired or
      // about to expire. Coalescing dedupes concurrent refreshes.
      const expiringSoon =
        tokenExpiresAt !== null && Date.now() >= tokenExpiresAt - PROACTIVE_REFRESH_LEAD_MS;
      if (accessToken && !expiringSoon) return;
      void refreshSession();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [refreshSession, accessToken, tokenExpiresAt]);

  useEffect(() => {
    const onSessionRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<AuthSessionRefreshedEventDetail>).detail;
      if (!detail) return;
      if (detail.kind === 'fatal') {
        clearSessionState(setAccessToken, setAuthUser);
        setTokenExpiresAt(null);
        return;
      }
      setSessionToken(detail.accessToken, detail.expiresIn);
      setAuthUser(detail.user);
      authUserCache.set(detail.user);
    };
    window.addEventListener(AUTH_SESSION_REFRESHED_EVENT, onSessionRefreshed);
    return () => window.removeEventListener(AUTH_SESSION_REFRESHED_EVENT, onSessionRefreshed);
  }, [setSessionToken]);

  // Proactively refresh the access token shortly before it expires so a tab
  // left open does not start returning 401s.
  useEffect(() => {
    if (!accessToken || tokenExpiresAt === null) return;
    const delay = Math.max(0, tokenExpiresAt - Date.now() - PROACTIVE_REFRESH_LEAD_MS);
    const timer = setTimeout(() => {
      void refreshSession();
    }, delay);
    return () => clearTimeout(timer);
  }, [accessToken, tokenExpiresAt, refreshSession]);

  const login = useCallback(
    async (input: LoginBody): Promise<AuthUser> => {
      const result = await authApiClient.login(input);
      setSessionToken(result.tokens.accessToken, result.tokens.expiresIn);

      const me = await authApiClient.me(result.tokens.accessToken);
      setAuthUser(me);
      authUserCache.set(me);

      return me;
    },
    [setSessionToken],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<AuthUser> => {
      const result = await authApiClient.register(input);
      setSessionToken(result.tokens.accessToken, result.tokens.expiresIn);

      const me = await authApiClient.me(result.tokens.accessToken);
      setAuthUser(me);
      authUserCache.set(me);

      return me;
    },
    [setSessionToken],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authApiClient.logout();
    } finally {
      clearSessionState(setAccessToken, setAuthUser);
    }
  }, []);

  const updateAuthUser = useCallback(async (): Promise<void> => {
    const currentToken = sessionStore.getAccessToken();
    if (!currentToken) return;

    const me = await authApiClient.me(currentToken);
    setAuthUser(me);
    authUserCache.set(me);
  }, []);

  const authGuard = useMemo<AuthGuardState>(
    () => ({
      role:
        authUser?.role === 'customer' ||
        authUser?.role === 'expert' ||
        authUser?.role === 'craftsman' ||
        authUser?.role === 'business'
          ? authUser.role
          : null,
      verificationStatus: authUser?.verificationStatus ?? null,
      emailVerified: authUser?.emailVerified ?? false,
    }),
    [authUser],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      authUser,
      accessToken,
      isAuthenticated: Boolean(authUser && accessToken),
      isReady,
      authGuard,
      login,
      register,
      logout,
      refreshSession,
      updateAuthUser,
    }),
    [
      accessToken,
      authGuard,
      authUser,
      isReady,
      login,
      logout,
      refreshSession,
      register,
      updateAuthUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};

export { isApiClientError } from '@/lib/auth/client';
