'use client';

import type { AdminDashboardStats } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

export const AdminDashboardTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApiClient.getDashboardStats(accessToken, { refreshSession });
      setStats(data);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const d = dictionary.admin.dashboard;

  if (loading || !stats) {
    return <p className="admin-empty">{dictionary.admin.loading}</p>;
  }

  const cards = [
    { label: d.totalUsers, value: stats.totalUsers },
    { label: d.activeUsers, value: stats.activeUsers },
    { label: d.totalRevenue, value: `${stats.totalRevenue.toFixed(2)} EGP` },
    { label: d.totalTransactions, value: stats.totalTransactions },
    { label: d.pendingVerifications, value: stats.pendingVerifications },
    { label: d.activeServices, value: stats.activeServices },
    { label: d.totalPlans, value: stats.totalPlans },
  ];

  return (
    <>
      <div className="admin-stats-grid">
        {cards.map((c) => (
          <div key={c.label} className="admin-stat-card">
            <p className="admin-stat-label">{c.label}</p>
            <p className="admin-stat-value">{c.value}</p>
          </div>
        ))}
      </div>

      <div className="admin-stat-card" style={{ marginTop: '0.5rem' }}>
        <p className="admin-stat-label">{d.usersByRole}</p>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {Object.entries(stats.usersByRole).map(([role, count]) => (
            <div key={role}>
              <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{role}</span>
              <span style={{ marginInlineStart: '0.5rem', fontWeight: 700, fontSize: '1.1rem' }}>
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};
