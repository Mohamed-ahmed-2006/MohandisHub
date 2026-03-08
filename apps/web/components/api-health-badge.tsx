'use client';

import { useEffect, useMemo, useState } from 'react';

type HealthState =
  | { status: 'loading'; label: string }
  | { status: 'healthy'; label: string }
  | { status: 'db-unhealthy'; label: string }
  | { status: 'error'; label: string };

const statusClassMap: Record<HealthState['status'], string> = {
  loading: 'api-health-badge-loading',
  healthy: 'api-health-badge-healthy',
  'db-unhealthy': 'api-health-badge-error',
  error: 'api-health-badge-error',
};

export const ApiHealthBadge = () => {
  const [state, setState] = useState<HealthState>({ status: 'loading', label: 'Checking API...' });

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/health', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Health failed with status ${response.status}`);
        }

        const body = (await response.json()) as { ok?: boolean; database?: boolean };

        if (body.ok) {
          if (body.database === false) {
            setState({ status: 'db-unhealthy', label: 'Database unhealthy' });
            return;
          }
          setState({ status: 'healthy', label: 'API healthy' });
          return;
        }

        setState({ status: 'error', label: 'API response invalid' });
      })
      .catch(() => {
        setState({ status: 'error', label: 'API unavailable' });
      });

    return () => {
      controller.abort();
    };
  }, []);

  const statusClassName = useMemo(() => statusClassMap[state.status], [state.status]);
  const badgeClassName = ['api-health-badge', statusClassName].join(' ');

  return <div className={badgeClassName}>{state.label}</div>;
};
