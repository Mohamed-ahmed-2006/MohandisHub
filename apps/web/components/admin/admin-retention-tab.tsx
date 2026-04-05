'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

import './admin-panel.css';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

const CATEGORY_DEFS: Array<{
  key: string;
  labelEn: string;
  labelAr: string;
  suggest: 'hours' | 'days';
  envKey?: string;
}> = [
  {
    key: 'verificationCodesAfterExpiry',
    labelEn: 'OTP / verification codes',
    labelAr: 'رموز التحقق',
    suggest: 'hours',
    envKey: 'RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS',
  },
  {
    key: 'otpRateLimitWindows',
    labelEn: 'OTP rate-limit rows',
    labelAr: 'حدود إرسال OTP',
    suggest: 'hours',
    envKey: 'RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS',
  },
  {
    key: 'refreshTokensAfterExpiry',
    labelEn: 'Expired refresh tokens',
    labelAr: 'رموز التحديث المنتهية',
    suggest: 'days',
    envKey: 'RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS',
  },
  {
    key: 'verificationRequestsTerminal',
    labelEn: 'Terminal verification requests',
    labelAr: 'طلبات تحقق منتهية',
    suggest: 'days',
    envKey: 'RETENTION_VERIFICATION_REQUESTS_DAYS',
  },
  {
    key: 'dmMessages',
    labelEn: 'DM messages (1:1 chat)',
    labelAr: 'رسائل الدردشة',
    suggest: 'days',
    envKey: 'RETENTION_CHAT_MESSAGES_DAYS',
  },
  {
    key: 'needReferenceAfterCompleted',
    labelEn: 'Completed need reference media',
    labelAr: 'وسائط الطلبات المكتملة',
    suggest: 'days',
    envKey: 'RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED',
  },
  {
    key: 'bidMessageAttachments',
    labelEn: 'Bid message attachments',
    labelAr: 'مرفقات عروض الأسعار',
    suggest: 'days',
    envKey: 'RETENTION_BID_MESSAGE_ATTACHMENT_DAYS',
  },
  {
    key: 'verifiedPrivateUploads',
    labelEn: 'Verified private uploads (not implemented)',
    labelAr: 'رفع خاص (غير مفعّل)',
    suggest: 'days',
  },
];

type CategoryCfg = { enabled: boolean; unit: 'hours' | 'days'; value: number };

function stringFromUnknown(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export const AdminRetentionTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const row = await adminApiClient.getRetentionDashboard(accessToken, { refreshSession });
      setData(row);
    } catch (e: unknown) {
      if (isApiClientError(e) && e.status === 404) {
        setError(
          tr(
            'Retention admin API returned 404. Production is probably running an older API build — redeploy the API (latest main) so GET /api/admin/retention is registered, then hard-refresh.',
            'واجهة إدارة الاحتفاظ غير موجودة (404). غالباً الـ API المنشور قديم — أعد نشر أحدث نسخة من الـ API ثم حدّث الصفحة.',
          ),
        );
      } else {
        setError(isApiClientError(e) ? e.message : tr('Failed to load', 'فشل التحميل'));
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, isArabic]);

  useEffect(() => {
    void load();
  }, [load]);

  const policy = (data?.policy as Record<string, unknown>) ?? {};
  const categories = (policy.categories as Record<string, CategoryCfg>) ?? {};
  const effectiveHours = (data?.effectiveHours as Record<string, number | null>) ?? {};
  const envSnapshot = (data?.envSnapshot as Record<string, number>) ?? {};
  const upload = (data?.upload as Record<string, unknown>) ?? {};
  const recentLogs = (data?.recentLogs as Array<Record<string, unknown>>) ?? [];
  const alerts = (data?.alerts as Record<string, unknown>) ?? {};

  const setCategory = (key: string, patch: Partial<CategoryCfg>) => {
    setData((prev) => {
      if (!prev) return prev;
      const prevPolicy = (prev.policy as Record<string, unknown>) ?? {};
      const prevCategories = (prevPolicy.categories as Record<string, CategoryCfg>) ?? {};
      const def = CATEGORY_DEFS.find((c) => c.key === key);
      const cur = prevCategories[key] ?? {
        enabled: false,
        unit: def?.suggest ?? 'days',
        value: 0,
      };
      return {
        ...prev,
        policy: {
          ...prevPolicy,
          categories: { ...prevCategories, [key]: { ...cur, ...patch } },
        },
      };
    });
  };

  const setPolicyField = (field: string, value: unknown) => {
    setData((prev) => {
      if (!prev) return prev;
      const prevPolicy = (prev.policy as Record<string, unknown>) ?? {};
      return { ...prev, policy: { ...prevPolicy, [field]: value } };
    });
  };

  const setAlertsField = (field: string, value: unknown) => {
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, alerts: { ...alerts, [field]: value } };
    });
  };

  const savePolicy = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApiClient.patchRetentionGovernance(
        accessToken,
        {
          policy: {
            masterEnabled: policy.masterEnabled !== false,
            dryRunNextScheduled: policy.dryRunNextScheduled === true,
            categories,
          },
        },
        { refreshSession },
      );
      await load();
    } catch (e: unknown) {
      setError(isApiClientError(e) ? e.message : tr('Save failed', 'فشل الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  const saveAlerts = async () => {
    setSaving(true);
    setError(null);
    try {
      await adminApiClient.patchRetentionGovernance(
        accessToken,
        {
          alerts: {
            webhookUrl: (alerts.webhookUrl as string) || null,
            alertEmail: (alerts.alertEmail as string) || null,
          },
        },
        { refreshSession },
      );
      await load();
    } catch (e: unknown) {
      setError(isApiClientError(e) ? e.message : tr('Save failed', 'فشل الحفظ'));
    } finally {
      setSaving(false);
    }
  };

  const runSweep = async (dryRun: boolean) => {
    setRunMsg(null);
    try {
      const res = await adminApiClient.postRetentionRun(accessToken, { dryRun }, { refreshSession });
      setRunMsg(JSON.stringify(res, null, 2));
      await load();
    } catch (e: unknown) {
      setRunMsg(isApiClientError(e) ? e.message : 'Run failed');
    }
  };

  if (loading) {
    return <p className="admin-settings-desc">{tr('Loading…', 'جاري التحميل…')}</p>;
  }

  return (
    <div className="admin-settings-tab">
      <h2 className="admin-settings-title">{tr('Retention & storage', 'الاحتفاظ والتخزين')}</h2>
      {error && <p className="admin-settings-error">{error}</p>}

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Health', 'الحالة')}</h3>
        <p className="admin-settings-desc admin-settings-desc--block">
          {tr(
            'Run the worker process (npm run worker) alongside the API so retention sweeps execute.',
            'شغّل npm run worker مع الـ API لتنفيذ المسح.',
          )}
        </p>
        {typeof data?.workerDocUrl === 'string' && data.workerDocUrl ? (
          <p className="admin-settings-desc">
            <a href={data.workerDocUrl} target="_blank" rel="noreferrer">
              {tr('Deployment runbook', 'دليل النشر')}
            </a>
          </p>
        ) : null}
        <p className="admin-settings-desc">
          {tr('Upload size ceiling (bytes)', 'سقف حجم الرفع')}:{' '}
          {stringFromUnknown(upload.ceilingBytes)}
        </p>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Master switch', 'التشغيل الرئيسي')}</h3>
        <label className="admin-settings-label">
          <input
            type="checkbox"
            checked={policy.masterEnabled !== false}
            onChange={(e) => setPolicyField('masterEnabled', e.target.checked)}
          />{' '}
          {tr('Retention sweeps enabled', 'تفعيل عمليات المسح')}
        </label>
        <label className="admin-settings-label" style={{ display: 'block', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={policy.dryRunNextScheduled === true}
            onChange={(e) => setPolicyField('dryRunNextScheduled', e.target.checked)}
          />{' '}
          {tr('Next scheduled worker sweep is dry-run only', 'المسح القادم تجريبي فقط')}
        </label>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="admin-btn" disabled={saving} onClick={() => void savePolicy()}>
            {tr('Save policy', 'حفظ السياسة')}
          </button>
          <button type="button" className="admin-btn" onClick={() => void runSweep(true)}>
            {tr('Run dry sweep now', 'مسح تجريبي')}
          </button>
          <button type="button" className="admin-btn" onClick={() => void runSweep(false)}>
            {tr('Run sweep now', 'مسح فعلي')}
          </button>
        </div>
        {runMsg && (
          <pre className="admin-settings-desc" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
            {runMsg}
          </pre>
        )}
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Categories (env = ceiling)', 'الفئات')}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: 4 }}>{tr('Category', 'الفئة')}</th>
              <th style={{ padding: 4 }}>{tr('On', 'تشغيل')}</th>
              <th style={{ padding: 4 }}>{tr('Value', 'قيمة')}</th>
              <th style={{ padding: 4 }}>{tr('Unit', 'وحدة')}</th>
              <th style={{ padding: 4 }}>{tr('Eff. hours', 'ساعات')}</th>
              <th style={{ padding: 4 }}>{tr('Env', 'بيئة')}</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORY_DEFS.map((c) => {
              const cfg = categories[c.key] ?? {
                enabled: false,
                unit: c.suggest,
                value: 0,
              };
              const ek = c.envKey;
              const envVal = ek ? envSnapshot[ek] : undefined;
              return (
                <tr key={c.key} style={{ borderTop: '1px solid rgba(128,128,128,0.25)' }}>
                  <td style={{ padding: 4 }}>{tr(c.labelEn, c.labelAr)}</td>
                  <td style={{ textAlign: 'center', padding: 4 }}>
                    <input
                      type="checkbox"
                      checked={cfg.enabled}
                      onChange={(e) => setCategory(c.key, { enabled: e.target.checked })}
                    />
                  </td>
                  <td style={{ padding: 4 }}>
                    <input
                      type="number"
                      min={0}
                      className="admin-settings-input admin-settings-input--number"
                      style={{ width: 88 }}
                      value={cfg.value}
                      onChange={(e) => setCategory(c.key, { value: parseInt(e.target.value, 10) || 0 })}
                    />
                  </td>
                  <td style={{ padding: 4 }}>
                    <select
                      className="admin-settings-input"
                      value={cfg.unit}
                      onChange={(e) =>
                        setCategory(c.key, { unit: e.target.value as 'hours' | 'days' })
                      }
                    >
                      <option value="hours">hours</option>
                      <option value="days">days</option>
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', padding: 4 }}>
                    {effectiveHours[c.key] ?? '—'}
                  </td>
                  <td style={{ padding: 4, fontSize: 12 }}>{envVal !== undefined ? String(envVal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Alerts', 'تنبيهات')}</h3>
        <div className="admin-settings-row">
          <label className="admin-settings-label">{tr('Webhook URL', 'Webhook')}</label>
          <input
            className="admin-settings-input"
            value={stringFromUnknown(alerts.webhookUrl)}
            onChange={(e) => setAlertsField('webhookUrl', e.target.value)}
          />
        </div>
        <div className="admin-settings-row">
          <label className="admin-settings-label">{tr('Alert email', 'بريد')}</label>
          <input
            className="admin-settings-input"
            value={stringFromUnknown(alerts.alertEmail)}
            onChange={(e) => setAlertsField('alertEmail', e.target.value)}
          />
        </div>
        <button type="button" className="admin-btn" disabled={saving} onClick={() => void saveAlerts()}>
          {tr('Save alerts', 'حفظ')}
        </button>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Exports', 'تصدير')}</h3>
        <button
          type="button"
          className="admin-btn"
          onClick={() => {
            void (async () => {
              const text = await adminApiClient.fetchAdminText(
                accessToken,
                '/api/admin/retention/sweep-log/export?format=csv&limit=500',
                { refreshSession },
              );
              const blob = new Blob([text], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'retention-sweep-log.csv';
              a.click();
              URL.revokeObjectURL(a.href);
            })();
          }}
        >
          {tr('Sweep log CSV', 'سجل المسح CSV')}
        </button>{' '}
        <button
          type="button"
          className="admin-btn"
          onClick={() => {
            void (async () => {
              const text = await adminApiClient.fetchAdminText(
                accessToken,
                '/api/admin/moderation/log/export?format=csv&limit=500',
                { refreshSession },
              );
              const blob = new Blob([text], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = 'moderation-log.csv';
              a.click();
              URL.revokeObjectURL(a.href);
            })();
          }}
        >
          {tr('Moderation log CSV', 'سجل الإشراف CSV')}
        </button>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Recent sweeps', 'آخر المسح')}</h3>
        <ul className="admin-settings-desc">
          {recentLogs.slice(0, 8).map((log) => (
            <li key={String(log.id)}>
              {String(log.started_at)} — {log.dry_run ? 'dry' : 'live'}{' '}
              {log.error != null ? `(err: ${stringFromUnknown(log.error)})` : ''}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
