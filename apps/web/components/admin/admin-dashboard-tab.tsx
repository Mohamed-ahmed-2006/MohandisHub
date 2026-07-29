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

const Sparkline = ({
  points,
  color = 'hsl(var(--primary))',
}: {
  points: number[];
  color?: string;
}) => {
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const range = max - min || 1;
  const width = 120;
  const height = 36;
  const coords = points.map((val, idx) => {
    const x = (idx / (points.length - 1)) * width;
    const y = height - ((val - min) / range) * (height - 8) - 4;
    return `${x},${y}`;
  });
  const pathD = `M ${coords.join(' L ')}`;
  return (
    <div className="admin-sparkline-container">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
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
  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const formatNumber = (val: number, isCurrency = false) => {
    const formatted = new Intl.NumberFormat(isArabic ? 'ar-EG' : 'en-US', {
      minimumFractionDigits: isCurrency ? 2 : 0,
      maximumFractionDigits: isCurrency ? 2 : 0,
    }).format(val);
    return isCurrency ? `${formatted} EGP` : formatted;
  };

  if (loading || !stats) {
    return <p className="admin-empty">{dictionary.admin.loading}</p>;
  }

  const heroCards = [
    {
      label: d.totalRevenue,
      value: formatNumber(stats.totalRevenue, true),
      sparkline: [120, 300, 450, 600, 900, 1200, stats.totalRevenue],
      variant: 'hero-revenue',
      color: '#10b981',
    },
    {
      label: tr('Total Transaction Volume', 'إجمالي حجم المعاملات'),
      value: formatNumber(stats.transactionVolume, true),
      sparkline: [500, 1200, 2400, 3800, stats.transactionVolume],
      variant: 'hero-volume',
      color: '#6366f1',
    },
    {
      label: tr('Total Commission Volume', 'إجمالي حجم العمولة'),
      value: formatNumber(stats.platformCommissionVolume, true),
      sparkline: [50, 150, 280, 420, stats.platformCommissionVolume],
      variant: 'hero-commission',
      color: '#f59e0b',
    },
  ];

  const secondaryCards = [
    {
      label: d.totalUsers,
      value: formatNumber(stats.totalUsers),
      sparkline: [12, 18, 25, 30, 42, 55, stats.totalUsers],
    },
    {
      label: d.activeUsers,
      value: formatNumber(stats.activeUsers),
      sparkline: [8, 14, 20, 28, 35, 40, stats.activeUsers],
    },
    {
      label: d.totalTransactions,
      value: formatNumber(stats.totalTransactions),
      sparkline: [5, 10, 15, 22, 30, stats.totalTransactions],
    },
    {
      label: d.platformWallet ?? tr('Platform commission balance', 'رصيد عمولة المنصة'),
      value: formatNumber(stats.platformWalletBalance, true),
      sparkline: [100, 250, 500, 800, stats.platformWalletBalance],
    },
    {
      label: d.pendingVerifications,
      value: formatNumber(stats.pendingVerifications),
      sparkline: [2, 4, 3, 5, stats.pendingVerifications],
      highlight: stats.pendingVerifications > 0,
    },
    {
      label: d.activeServices,
      value: formatNumber(stats.activeServices),
      sparkline: [10, 15, 22, 28, stats.activeServices],
    },
    {
      label: d.totalPlans,
      value: formatNumber(stats.totalPlans),
      sparkline: [1, 2, 3, 3, stats.totalPlans],
    },
  ];

  return (
    <div className="admin-dashboard-wrapper">
      {/* Featured Executive Hero Metrics */}
      <div className="admin-hero-grid">
        {heroCards.map((c) => (
          <article key={c.label} className={`admin-hero-card admin-hero-card--${c.variant}`}>
            <div className="admin-hero-card-header">
              <span className="admin-hero-card-label">{c.label}</span>
              <span className="admin-hero-badge">{tr('Primary Metric', 'مؤشر رئيسي')}</span>
            </div>
            <div className="admin-hero-card-body">
              <p className="admin-hero-card-value">{c.value}</p>
              <Sparkline points={c.sparkline} color={c.color} />
            </div>
          </article>
        ))}
      </div>

      {/* Secondary Metrics Responsive Grid */}
      <div className="admin-secondary-grid">
        {secondaryCards.map((c) => (
          <article
            key={c.label}
            className={`admin-stat-card ${c.highlight ? 'admin-stat-card--highlight' : ''}`}
          >
            <div className="admin-stat-card-top">
              <p className="admin-stat-label">{c.label}</p>
              <p className="admin-stat-value">{c.value}</p>
            </div>
            <Sparkline points={c.sparkline} />
          </article>
        ))}
      </div>

      {/* User Demographics Breakdown */}
      <div className="admin-role-breakdown-card">
        <div className="admin-role-breakdown-header">
          <h3 className="admin-role-breakdown-title">{d.usersByRole}</h3>
          <span className="admin-role-total-badge">
            {tr('Total', 'الإجمالي')}: {formatNumber(stats.totalUsers)}
          </span>
        </div>
        <div className="admin-role-pills-list">
          {Object.entries(stats.usersByRole).map(([role, count]) => (
            <div key={role} className="admin-role-pill">
              <span className="admin-role-name">{role}</span>
              <span className="admin-role-count">{formatNumber(count)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
