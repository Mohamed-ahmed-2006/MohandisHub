'use client';

import type { AuthUser, LoginBody, RegisterBody, UserRole } from '@mohandishub/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { authUserCache } from '@/lib/auth/auth-cache';
import { authApiClient } from '@/lib/auth/client';
import { sessionStore } from '@/lib/auth/session-store';

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
const AUTH_SESSION_HINT_KEY = 'mohandishub-has-session';

type AuthProviderProps = {
  children: React.ReactNode;
};

const clearSessionState = (
  setAccessToken: (value: string | null) => void,
  setAuthUser: (value: AuthUser | null) => void,
): void => {
  sessionStore.clear();
  setAccessToken(null);
  setAuthUser(null);
  authUserCache.clear();
  window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const setSessionToken = useCallback((token: string | null) => {
    if (token) {
      sessionStore.setAccessToken(token);
      setAccessToken(token);
      window.localStorage.setItem(AUTH_SESSION_HINT_KEY, '1');
      return;
    }

    sessionStore.clear();
    setAccessToken(null);
    window.localStorage.removeItem(AUTH_SESSION_HINT_KEY);
  }, []);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    try {
      const refreshed = await authApiClient.refresh();
      setSessionToken(refreshed.tokens.accessToken);

      const me = await authApiClient.me(refreshed.tokens.accessToken);
      setAuthUser(me);
      authUserCache.set(me);

      return refreshed.tokens.accessToken;
    } catch {
      clearSessionState(setAccessToken, setAuthUser);
      return null;
    }
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
      const restored = await refreshSession();

      if (!restored && isMounted) {
        clearSessionState(setAccessToken, setAuthUser);
      }

      if (isMounted) {
        setIsReady(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  const login = useCallback(
    async (input: LoginBody): Promise<AuthUser> => {
      const result = await authApiClient.login(input);
      setSessionToken(result.tokens.accessToken);

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
      setSessionToken(result.tokens.accessToken);

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
