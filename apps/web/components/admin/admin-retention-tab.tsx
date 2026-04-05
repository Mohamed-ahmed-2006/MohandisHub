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
  helpEn: string;
  helpAr: string;
  suggest: 'hours' | 'days';
  envKey?: string;
}> = [
  {
    key: 'verificationCodesAfterExpiry',
    labelEn: 'OTP / verification codes',
    labelAr: 'رموز التحقق',
    helpEn:
      'Deletes old rows in verification_codes after they have expired, with a small cushion beyond expires_at. Turn off (unchecked or value 0) to keep all rows.',
    helpAr:
      'يحذف صفوف verification_codes القديمة بعد انتهاء صلاحيتها مع هامش زمني. أوقف التفعيل أو اضبط القيمة 0 للإبقاء على كل السجلات.',
    suggest: 'hours',
    envKey: 'RETENTION_VERIFICATION_CODES_AFTER_EXPIRY_HOURS',
  },
  {
    key: 'otpRateLimitWindows',
    labelEn: 'OTP rate-limit rows',
    labelAr: 'حدود إرسال OTP',
    helpEn:
      'Cleans stale rows in otp_rate_limits by window_start. Safe to enable if you want the DB table to stay small.',
    helpAr: 'ينظف صفوف otp_rate_limits القديمة حسب window_start. مفيد لتصغير الجدول.',
    suggest: 'hours',
    envKey: 'RETENTION_OTP_RATE_LIMIT_WINDOW_HOURS',
  },
  {
    key: 'refreshTokensAfterExpiry',
    labelEn: 'Expired refresh tokens',
    labelAr: 'رموز التحديث المنتهية',
    helpEn:
      'Removes refresh_tokens that are already past expires_at (plus cushion). Users stay logged in until access token expires; this only clears dead refresh rows.',
    helpAr:
      'يحذف refresh_tokens المنتهية (مع هامش). المستخدمون يبقون مسجلين حتى تنتهي الجلسة؛ هذا يمسح الرموز الميتة فقط.',
    suggest: 'days',
    envKey: 'RETENTION_REFRESH_TOKENS_AFTER_EXPIRY_DAYS',
  },
  {
    key: 'verificationRequestsTerminal',
    labelEn: 'Terminal verification requests',
    labelAr: 'طلبات تحقق منتهية',
    helpEn:
      'Deletes old verification_requests that are already in a final state. Legal/audit: keep off (0) until your policy allows.',
    helpAr:
      'يحذف طلبات تحقق قديمة بحالة نهائية. قد تتعارض مع الاحتفاظ القانوني — اتركها معطلة حتى تراجع السياسة.',
    suggest: 'days',
    envKey: 'RETENTION_VERIFICATION_REQUESTS_DAYS',
  },
  {
    key: 'dmMessages',
    labelEn: 'DM messages (1:1 chat)',
    labelAr: 'رسائل الدردشة',
    helpEn:
      'Deletes old rows in messages (direct chat), not bid-thread chat. Default env 0 means “keep forever” until you raise it.',
    helpAr:
      'يحذف رسائل الدردشة المباشرة (messages) وليس محادثات العروض. القيمة 0 في البيئة تعني عدم الحذف.',
    suggest: 'days',
    envKey: 'RETENTION_CHAT_MESSAGES_DAYS',
  },
  {
    key: 'needReferenceAfterCompleted',
    labelEn: 'Completed need reference media',
    labelAr: 'وسائط الطلبات المكتملة',
    helpEn:
      'For needs with status completed and old updated_at: removes files from public uploads and clears reference_url. Requires worker + env RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED > 0 as ceiling.',
    helpAr:
      'للطلبات المكتملة وقديمة التحديث: يحذف الملفات من التخزين ويمسح reference_url. يحتاج worker وقيمة البيئة كسقف.',
    suggest: 'days',
    envKey: 'RETENTION_NEED_REFERENCE_DAYS_AFTER_COMPLETED',
  },
  {
    key: 'bidMessageAttachments',
    labelEn: 'Bid message attachments',
    labelAr: 'مرفقات عروض الأسعار',
    helpEn:
      'Old bid_messages with attachment_url: deletes the public file and nulls the URL. Text of the message stays.',
    helpAr: 'للمرفقات القديمة في عروض الأسعار: يحذف الملف العام ويمسح الرابط ويبقى نص الرسالة.',
    suggest: 'days',
    envKey: 'RETENTION_BID_MESSAGE_ATTACHMENT_DAYS',
  },
  {
    key: 'verifiedPrivateUploads',
    labelEn: 'Verified private uploads (not implemented)',
    labelAr: 'رفع خاص (غير مفعّل)',
    helpEn:
      'Placeholder for future KYC/private bucket cleanup. Do not enable until implemented and legally approved.',
    helpAr: 'محجوز لمستقبل تنظيف ملفات KYC الخاصة. لا تفعّل حتى يُنفَّذ ويُوافَق قانونياً.',
    suggest: 'days',
  },
];

type CategoryCfg = { enabled: boolean; unit: 'hours' | 'days'; value: number };

/**
 * Suggested starting points when `app_settings.retention_policy.categories` has no row yet.
 * Safe/low-risk items on; legal/sensitive or unimplemented off (values kept as a starting point if you enable).
 */
const RECOMMENDED_CATEGORY_DEFAULTS: Record<string, CategoryCfg> = {
  verificationCodesAfterExpiry: { enabled: true, unit: 'hours', value: 24 },
  otpRateLimitWindows: { enabled: true, unit: 'hours', value: 24 },
  refreshTokensAfterExpiry: { enabled: true, unit: 'days', value: 7 },
  verificationRequestsTerminal: { enabled: false, unit: 'days', value: 365 },
  dmMessages: { enabled: false, unit: 'days', value: 365 },
  needReferenceAfterCompleted: { enabled: false, unit: 'days', value: 90 },
  bidMessageAttachments: { enabled: false, unit: 'days', value: 90 },
  verifiedPrivateUploads: { enabled: false, unit: 'days', value: 0 },
};

function mergeRecommendedCategoriesIntoRow(row: Record<string, unknown>): Record<string, unknown> {
  const policy = (row.policy as Record<string, unknown>) ?? {};
  const rawCats = policy.categories;
  const cats: Record<string, CategoryCfg> =
    rawCats && typeof rawCats === 'object' && !Array.isArray(rawCats)
      ? { ...(rawCats as Record<string, CategoryCfg>) }
      : {};
  for (const def of CATEGORY_DEFS) {
    if (cats[def.key] !== undefined && cats[def.key] !== null) continue;
    const preset = RECOMMENDED_CATEGORY_DEFAULTS[def.key];
    if (preset) cats[def.key] = { ...preset };
  }
  return {
    ...row,
    policy: {
      ...policy,
      categories: cats,
    },
  };
}

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
      setData(mergeRecommendedCategoriesIntoRow(row));
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

      <details className="admin-retention-guide">
        <summary>{tr('How this page works (read me)', 'كيف تستخدم هذه الصفحة')}</summary>
        <ul className="admin-retention-guide-list">
          <li>
            {tr(
              'You need two processes in production: the HTTP API (npm start) and the worker (npm run worker). Scheduled sweeps run only in the worker.',
              'تحتاج عمليتين: الـ API والـ worker. المسح المجدول يعمل في الـ worker فقط.',
            )}
          </li>
          <li>
            {tr(
              'Server env vars (e.g. RETENTION_CHAT_MESSAGES_DAYS) are a hard ceiling. Effective retention = min(env, what you set here). If env is 0, that category never deletes.',
              'متغيرات السيرفر سقف أقصى. القيمة الفعلية = الأصغر بين البيئة وإعدادك هنا. إذا كانت القيمة في البيئة 0 فلا يُحذف في تلك الفئة.',
            )}
          </li>
          <li>
            {tr(
              'Per category: “On” and value greater than 0 means the step can run. Value 0 or Off = skip that step.',
              'لكل فئة: التشغيل + قيمة أكبر من 0 يعني يمكن للمسح تنفيذها. 0 أو إيقاف = تخطي.',
            )}
          </li>
          <li>
            {tr(
              '“Eff. hours” is the computed window used at sweep time (after merging with env). “Env” shows the raw env number for that row.',
              'عمود الساعات الفعّالة = النافذة المحسوبة. عمود البيئة = رقم الإعداد في السيرفر.',
            )}
          </li>
          <li>
            {tr(
              'Master switch off = sweeps do nothing (emergency stop). “Next scheduled … dry-run” makes only the next worker sweep log deletes without applying them.',
              'إيقاف المفتاح الرئيسي يوقف المسح. خيار المسح التجريبي للدورة القادمة يسجل فقط دون حذف فعلي.',
            )}
          </li>
          <li>
            {tr(
              '“Run dry sweep now” / “Run sweep now” trigger immediately from this browser (requires manage_retention).',
              'أزرار المسح الفوري تنفّذ من المتصفح (صلاحية manage_retention).',
            )}
          </li>
          <li>
            {tr(
              'Upload max size / MIME list live under App Settings; this page shows the server ceiling for max bytes.',
              'حدود الرفع وأنواع الملفات في تبويب إعدادات التطبيق؛ هنا يظهر سقف السيرفر للحجم.',
            )}
          </li>
          <li>
            {tr(
              'New categories show suggested On/Off and numbers here first. They are not stored until you click Save policy. The “Eff. hours” column follows the last saved server policy until then.',
              'الفئات الجديدة تظهر هنا بقيم مقترحة ولا تُحفظ حتى تضغط حفظ السياسة. عمود الساعات الفعّالة يعكس آخر حفظ على السيرفر.',
            )}
          </li>
        </ul>
      </details>

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
        <p className="admin-settings-desc admin-settings-desc--block admin-retention-section-hint">
          {tr(
            'Save policy after changing toggles. Dry-run sweeps still write a row to the sweep log so you can inspect counts in “Recent sweeps”.',
            'احفظ السياسة بعد التعديل. المسح التجريبي يسجّل نتيجة في “آخر المسح”.',
          )}
        </p>
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
        <p className="admin-settings-desc admin-settings-desc--block admin-retention-section-hint">
          {tr(
            'Each row is one database/storage cleanup job. Start with conservative values and one category at a time if unsure.',
            'كل صف يمثل نوع حذف. ابدأ بقيم حذرة وفعّل فئة واحدة إن لم تكن متأكداً.',
          )}
        </p>
        <table className="admin-retention-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
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
                  <td style={{ padding: 8, maxWidth: 340, verticalAlign: 'top' }}>
                    <div className="admin-retention-cat-title">{tr(c.labelEn, c.labelAr)}</div>
                    <p className="admin-retention-category-hint">{tr(c.helpEn, c.helpAr)}</p>
                  </td>
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
        <p className="admin-settings-desc admin-settings-desc--block admin-retention-section-hint">
          {tr(
            'Optional: webhook or email used by the API/worker when a sweep fails or delete counts look suspicious (if configured in policy). Save alerts separately from policy.',
            'اختياري: إشعار عند فشل المسح أو أرقام حذف غير عادية (حسب إعدادات السياسة في الـ API). احفظ التنبيهات بزرها الخاص.',
          )}
        </p>
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
