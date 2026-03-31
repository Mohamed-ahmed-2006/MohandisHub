'use client';

import type { AppStatus } from '@mohandishub/shared';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { fetchAppStatus } from '@/lib/app-status/client';

type AppStatusContextValue = {
  status: AppStatus | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

const AppStatusContext = createContext<AppStatusContextValue | null>(null);

export function AppStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAppStatus();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refetch();
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [refetch]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refetch();
      }
    };
    const handleRealtimeRefresh = () => {
      void refetch();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('app-status-updated', handleRealtimeRefresh);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('app-status-updated', handleRealtimeRefresh);
    };
  }, [refetch]);

  return (
    <AppStatusContext.Provider value={{ status, loading, refetch }}>
      {children}
    </AppStatusContext.Provider>
  );
}

export function useAppStatus(): AppStatusContextValue {
  const ctx = useContext(AppStatusContext);
  if (!ctx) {
    throw new Error('useAppStatus must be used within AppStatusProvider');
  }
  return ctx;
}
