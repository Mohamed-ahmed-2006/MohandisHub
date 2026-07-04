'use client';

import {
  KNOWN_PAYMENT_METHOD_KEYS,
  MANAGED_SIDEBAR_HREFS,
  PAYMENT_METHOD_DEFINITIONS,
  type AppSettings,
  type UpdateAppSettingsBody,
  type WithdrawalLimitMethod,
  type WithdrawalMethodLimit,
} from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

/** Map sidebar href → `dictionary.nav` key for labels */
const SIDEBAR_HREF_TO_NAV_KEY: Record<string, string> = {
  '/app': 'home',
  '/app/bookings': 'bookings',
  '/app/services': 'myServices',
  '/app/calendar': 'calendar',
  '/app/settings': 'settings',
  '/app/chat': 'chat',
  '/app/history': 'history',
  '/app/support': 'support',
  '/app/negotiations': 'negotiations',
  '/app/advertisements': 'advertisements',
  '/app/plan': 'plan',
  '/app/admin': 'admin',
};

function sidebarLinkLabel(dictionary: Dictionary, href: string): string {
  const key = SIDEBAR_HREF_TO_NAV_KEY[href];
  if (key && dictionary.nav?.[key]) return dictionary.nav[key] as string;
  return href;
}

const getErrorMessage = (error: unknown, dictionary: Dictionary): string => {
  if (isApiClientError(error)) return error.message;
  return dictionary.admin.settingsMgmt.saveError;
};

function Toggle({
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="admin-settings-row">
      <div className="admin-settings-label-wrap">
        <label className="admin-settings-label">{label}</label>
        <span className="admin-settings-desc">{desc}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`admin-settings-toggle ${checked ? 'admin-settings-toggle--on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="admin-settings-toggle-thumb" />
      </button>
    </div>
  );
}

const FACTORY_RESET_CONFIRM_PHRASE = 'FACTORY RESET';
const WITHDRAWAL_LIMIT_METHODS: WithdrawalLimitMethod[] = ['instapay', 'crypto', 'paymob'];

export const AdminSettingsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [factoryResetModalOpen, setFactoryResetModalOpen] = useState(false);
  const [factoryResetConfirmPhrase, setFactoryResetConfirmPhrase] = useState('');
  const [factoryResetLoading, setFactoryResetLoading] = useState(false);
  const [factoryResetError, setFactoryResetError] = useState<string | null>(null);

  const d = dictionary.admin.settingsMgmt;
  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminApiClient.getSettings(accessToken, { refreshSession });
      setSettings(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, dictionary));
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, dictionary, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(
    async (partial: UpdateAppSettingsBody) => {
      if (!settings) return;
      setSaving(true);
      setError(null);
      setSuccess(false);
      try {
        const updated = await adminApiClient.updateSettings(accessToken, partial, {
          refreshSession,
        });
        setSettings(updated);
        setSuccessMessage(d.saveSuccess);
        setSuccess(true);
        setToastMessage(d.saveSuccess);
        window.dispatchEvent(new CustomEvent('app-status-updated'));
        setTimeout(() => {
          setSuccess(false);
          setSuccessMessage(null);
        }, 2000);
        setTimeout(() => setToastMessage(null), 2200);
      } catch (err: unknown) {
        setError(getErrorMessage(err, dictionary));
      } finally {
        setSaving(false);
      }
    },
    [accessToken, dictionary, refreshSession, settings],
  );

  const handleToggle = useCallback(
    (key: keyof UpdateAppSettingsBody, value: boolean) => {
      void update({ [key]: value });
    },
    [update],
  );

  const handleTextChange = useCallback(
    (key: keyof UpdateAppSettingsBody, value: string | null) => {
      void update({ [key]: value || null });
    },
    [update],
  );

  const handleNumberChange = useCallback(
    (key: keyof UpdateAppSettingsBody, value: number | null) => {
      void update({ [key]: value });
    },
    [update],
  );

  const handlePaymentMethodToggle = useCallback(
    (key: string, enabled: boolean) => {
      if (!settings) return;
      void update({
        paymentMethodsEnabled: { ...settings.paymentMethodsEnabled, [key]: enabled },
      });
    },
    [settings, update],
  );

  const handleWithdrawalLimitChange = useCallback(
    (method: WithdrawalLimitMethod, field: keyof WithdrawalMethodLimit, value: number | null) => {
      if (!settings) return;
      void update({
        withdrawalLimits: {
          ...settings.withdrawalLimits,
          [method]: {
            ...settings.withdrawalLimits[method],
            [field]: value,
          },
        },
      });
    },
    [settings, update],
  );

  const paymentMethodsForUi = (() => {
    if (!settings) return [];
    const known = new Set<string>(KNOWN_PAYMENT_METHOD_KEYS);
    const builtIn = PAYMENT_METHOD_DEFINITIONS.map((method) => ({
      key: method.key,
      flow: method.flow,
      provider: method.provider,
      launchRecommended: method.launchRecommended,
      builtIn: true,
    }));
    const extra = Object.keys(settings.paymentMethodsEnabled)
      .filter((key) => !known.has(key))
      .sort()
      .map((key) => ({
        // Future/custom method key: preserve unknown provider toggles for later payment upgrades.
        key,
        flow: key.startsWith('withdrawal_') ? ('withdrawal' as const) : ('deposit' as const),
        provider: 'future',
        launchRecommended: false,
        builtIn: false,
      }));
    return [...builtIn, ...extra];
  })();

  const setSidebarHrefHidden = useCallback(
    (href: string, hidden: boolean) => {
      if (!settings) return;
      const next = new Set(settings.sidebarHiddenHrefs ?? []);
      if (hidden) next.add(href);
      else next.delete(href);
      void update({ sidebarHiddenHrefs: [...next] });
    },
    [settings, update],
  );

  const handleInstapayJsonBlur = useCallback(
    (raw: string) => {
      setError(null);
      try {
        const trimmed = raw.trim();
        if (trimmed === '') {
          void update({ platformInstapayDisplay: null });
          return;
        }
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setError(
            tr(
              'Platform InstaPay must be a JSON object.',
              'يجب أن تكون بيانات إنستاباي كائن JSON.',
            ),
          );
          return;
        }
        void update({ platformInstapayDisplay: parsed as Record<string, unknown> });
      } catch {
        setError(
          tr('Invalid JSON for platform InstaPay.', 'صيغة JSON غير صحيحة لبيانات إنستاباي.'),
        );
      }
    },
    [update],
  );

  if (loading || !settings) {
    return <p className="admin-empty">{dictionary.admin.loading}</p>;
  }

  return (
    <div className="admin-settings-tab">
      <h2 className="admin-settings-title">{d.title}</h2>

      {error && <p className="admin-settings-error">{error}</p>}
      {success && successMessage && <p className="admin-settings-success">{successMessage}</p>}
      {toastMessage && (
        <div className="admin-settings-toast" role="status" aria-live="polite">
          {toastMessage}
        </div>
      )}

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.availability}</h3>
        <Toggle
          label={d.maintenanceMode}
          desc={d.maintenanceModeDesc}
          checked={settings.maintenanceMode}
          onChange={(v) => handleToggle('maintenanceMode', v)}
          disabled={saving}
        />
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.maintenanceMessage}</label>
          <input
            type="text"
            className="admin-settings-input"
            placeholder={d.maintenanceMessagePlaceholder}
            defaultValue={settings.maintenanceMessage ?? ''}
            onBlur={(e) => handleTextChange('maintenanceMessage', e.target.value || null)}
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.signups}</h3>
        <Toggle
          label={d.signupsLocked}
          desc={d.signupsLockedDesc}
          checked={settings.signupsLocked}
          onChange={(v) => handleToggle('signupsLocked', v)}
          disabled={saving}
        />
        <Toggle
          label={d.lockLogins}
          desc={d.lockLoginsDesc}
          checked={settings.lockLogins}
          onChange={(v) => handleToggle('lockLogins', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.wallet}</h3>
        <Toggle
          label={d.depositsPaused}
          desc={d.depositsPausedDesc}
          checked={settings.depositsPaused}
          onChange={(v) => handleToggle('depositsPaused', v)}
          disabled={saving}
        />
        <Toggle
          label={d.moneyMovementsPaused}
          desc={d.moneyMovementsPausedDesc}
          checked={settings.moneyMovementsPaused}
          onChange={(v) => handleToggle('moneyMovementsPaused', v)}
          disabled={saving}
        />
        <p className="admin-settings-label" style={{ marginTop: '0.75rem' }}>
          {d.paymentMethodsSection}
        </p>
        <p className="admin-settings-desc" style={{ marginBottom: '0.75rem' }}>
          {d.paymentMethodsSectionDesc}
        </p>
        {(['deposit', 'withdrawal'] as const).map((flow) => {
          const methods = paymentMethodsForUi.filter((method) => method.flow === flow);
          if (methods.length === 0) return null;
          return (
            <div key={flow} className="admin-settings-method-group">
              <p className="admin-settings-method-group-title">
                {flow === 'deposit'
                  ? tr('Deposit methods', 'طرق الإيداع')
                  : tr('Withdrawal methods', 'طرق السحب')}
              </p>
              {methods.map((method) => {
                const key = method.key;
                const label =
                  (d.paymentMethodLabels as Record<string, string> | undefined)?.[key] ?? key;
                const enabled = settings.paymentMethodsEnabled[key] !== false;
                return (
                  <Toggle
                    key={key}
                    label={label}
                    desc={tr(
                      'Visible to users in the wallet; API rejects hidden methods.',
                      'يظهر للمستخدمين في المحفظة؛ الـ API يرفض الطرق المخفية.',
                    )}
                    checked={enabled}
                    onChange={(v) => handlePaymentMethodToggle(key, v)}
                    disabled={saving}
                  />
                );
              })}
            </div>
          );
        })}
        <p className="admin-settings-label" style={{ marginTop: '0.75rem' }}>
          {tr('Withdrawal limits', 'حدود السحب')}
        </p>
        <p className="admin-settings-desc" style={{ marginBottom: '0.75rem' }}>
          {tr(
            'Set the minimum, per-request maximum, and daily user maximum for each withdrawal method.',
            'حدد الحد الأدنى والحد الأقصى لكل طلب والحد اليومي لكل مستخدم لكل طريقة سحب.',
          )}
        </p>
        {WITHDRAWAL_LIMIT_METHODS.map((method) => {
          const limits = settings.withdrawalLimits[method];
          const label =
            (d.paymentMethodLabels as Record<string, string> | undefined)?.[
              `withdrawal_${method}`
            ] ?? method;
          return (
            <div key={method} className="admin-settings-method-group">
              <p className="admin-settings-method-group-title">{label}</p>
              {(
                [
                  ['minAmountEgp', tr('Minimum (EGP)', 'الحد الأدنى (ج.م)')],
                  ['maxAmountEgp', tr('Maximum per request (EGP)', 'الحد الأقصى للطلب (ج.م)')],
                  [
                    'dailyMaxAmountEgp',
                    tr('Daily user maximum (EGP)', 'الحد اليومي للمستخدم (ج.م)'),
                  ],
                ] as const
              ).map(([field, fieldLabel]) => (
                <div className="admin-settings-row" key={`${method}-${field}`}>
                  <label className="admin-settings-label">{fieldLabel}</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    className="admin-settings-input admin-settings-input--number"
                    defaultValue={limits[field] ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      const value = raw === '' ? null : parseFloat(raw);
                      if (value != null && (!Number.isFinite(value) || value < 0)) {
                        setError(
                          tr(
                            'Withdrawal limit must be a positive number or empty.',
                            'يجب أن يكون حد السحب رقما موجبا أو فارغا.',
                          ),
                        );
                        return;
                      }
                      handleWithdrawalLimitChange(method, field, value);
                    }}
                    disabled={saving}
                  />
                </div>
              ))}
            </div>
          );
        })}
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.minDepositAmount}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.minDepositAmount ?? ''}
            onBlur={(e) =>
              handleNumberChange(
                'minDepositAmount',
                e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.maxDepositAmount}</label>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.maxDepositAmount ?? ''}
            onBlur={(e) =>
              handleNumberChange(
                'maxDepositAmount',
                e.target.value === '' ? null : parseFloat(e.target.value) || 0,
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.walletEgpPerUsdtDeposit}</label>
            <span className="admin-settings-desc">{d.walletEgpPerUsdtDepositDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.walletEgpPerUsdtDeposit ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                void update({ walletEgpPerUsdtDeposit: null });
                return;
              }
              const n = parseFloat(raw);
              if (!Number.isFinite(n) || n <= 0) {
                setError(
                  tr(
                    'Deposit FX rate must be a positive number or empty.',
                    'سعر تحويل الإيداع يجب أن يكون رقمًا موجبًا أو فارغًا.',
                  ),
                );
                return;
              }
              void update({ walletEgpPerUsdtDeposit: n });
            }}
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.walletEgpPerUsdtWithdrawal}</label>
            <span className="admin-settings-desc">{d.walletEgpPerUsdtWithdrawalDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.walletEgpPerUsdtWithdrawal ?? ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === '') {
                void update({ walletEgpPerUsdtWithdrawal: null });
                return;
              }
              const n = parseFloat(raw);
              if (!Number.isFinite(n) || n <= 0) {
                setError(
                  tr(
                    'Withdrawal FX rate must be a positive number or empty.',
                    'سعر تحويل السحب يجب أن يكون رقمًا موجبًا أو فارغًا.',
                  ),
                );
                return;
              }
              void update({ walletEgpPerUsdtWithdrawal: n });
            }}
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.platformInstapayDisplayJson}</label>
            <span className="admin-settings-desc">{d.platformInstapayDisplayDesc}</span>
          </div>
          <textarea
            key={`instapay-json-${settings.updatedAt}`}
            className="admin-form-textarea"
            rows={6}
            defaultValue={JSON.stringify(settings.platformInstapayDisplay ?? {}, null, 2)}
            onBlur={(e) => handleInstapayJsonBlur(e.target.value)}
            disabled={saving}
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.walletMigrationRateLabel}</label>
            <span className="admin-settings-desc">
              {settings.walletUsdToEgpMigrationRate != null
                ? String(settings.walletUsdToEgpMigrationRate)
                : '—'}
            </span>
          </div>
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.walletMigrationAppliedLabel}</label>
            <span className="admin-settings-desc">
              {settings.walletMigrationUsdToEgpApplied
                ? dictionary.admin.users.userDetail.yes
                : dictionary.admin.users.userDetail.no}
            </span>
          </div>
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.commission}</h3>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.commissionPercent}</label>
            <span className="admin-settings-desc">{d.commissionPercentDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.commissionPercent}
            onBlur={(e) =>
              handleNumberChange(
                'commissionPercent',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.commissionMinEgp}</label>
            <span className="admin-settings-desc">{d.commissionMinEgpDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.commissionMinEgp}
            onBlur={(e) =>
              handleNumberChange(
                'commissionMinEgp',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.minTransactionEgp}</label>
            <span className="admin-settings-desc">{d.minTransactionEgpDesc}</span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.minTransactionEgp}
            onBlur={(e) =>
              handleNumberChange(
                'minTransactionEgp',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">Commission receiver user ID</label>
            <span className="admin-settings-desc">
              {tr(
                'Optional user ID that receives platform commission.',
                'معرّف مستخدم اختياري يستلم عمولة المنصة.',
              )}
            </span>
          </div>
          <input
            type="text"
            className="admin-settings-input"
            defaultValue={settings.commissionReceiverId ?? ''}
            onBlur={(e) => handleTextChange('commissionReceiverId', e.target.value.trim() || null)}
            disabled={saving}
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('Reservations', 'الحجوزات')}</h3>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Acceptance fee (EGP)', 'رسوم القبول (ج.م)')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Included in the customer upfront hold together with the provider price.',
                'تُخصم من العميل عند قبول مقدم الخدمة للحجز.',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.reservationAcceptanceFee}
            onBlur={(e) =>
              handleNumberChange(
                'reservationAcceptanceFee',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Voice minute fee (EGP)', 'رسوم الدقيقة الصوتية (ج.م)')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Global online voice minute fee (split equally customer/provider).',
                'رسوم دقيقة صوتية عامة أونلاين (تقسيم متساوٍ بين العميل ومقدم الخدمة).',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.reservationVoiceMinuteRate}
            onBlur={(e) =>
              handleNumberChange(
                'reservationVoiceMinuteRate',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Video minute fee (EGP)', 'رسوم الدقيقة المرئية (ج.م)')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Global online video minute fee (split equally customer/provider).',
                'رسوم دقيقة مرئية عامة أونلاين (تقسيم متساوٍ بين العميل ومقدم الخدمة).',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.reservationVideoMinuteRate}
            onBlur={(e) =>
              handleNumberChange(
                'reservationVideoMinuteRate',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Minimum prejoin minutes', 'الحد الأدنى لدقائق ما قبل الانضمام')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Required wallet coverage before users can join online sessions.',
                'الحد الأدنى لتغطية المحفظة قبل السماح بالانضمام للجلسات الأونلاين.',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={1}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.reservationMinPrejoinMinutes}
            onBlur={(e) =>
              handleNumberChange(
                'reservationMinPrejoinMinutes',
                e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0,
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Job interview fee (EGP)', 'رسوم مقابلة الوظيفة (ج.م)')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Global fee charged to experts when they reserve an interview slot with a business.',
                'رسوم عامة تُفرض على الخبراء عند حجز موعد مقابلة مع شركة.',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.jobInterviewFeeAmount}
            onBlur={(e) =>
              handleNumberChange(
                'jobInterviewFeeAmount',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
        <div className="admin-settings-row">
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">
              {tr('Coupon generation fee (EGP)', 'رسوم إنشاء الكوبون (ج.م)')}
            </label>
            <span className="admin-settings-desc">
              {tr(
                'Amount charged from provider wallet for each generated provider-campaign coupon.',
                'المبلغ الذي يخصم من محفظة مقدم الخدمة لكل كوبون يتم إنشاؤه في حملة كوبونات.',
              )}
            </span>
          </div>
          <input
            type="number"
            min={0}
            step={0.01}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.couponGenerationFeeEgp}
            onBlur={(e) =>
              handleNumberChange(
                'couponGenerationFeeEgp',
                e.target.value === '' ? 0 : (parseFloat(e.target.value) ?? 0),
              )
            }
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.plans}</h3>
        <Toggle
          label={d.pausePlanSubscriptions}
          desc={d.pausePlanSubscriptionsDesc}
          checked={settings.pausePlanSubscriptions}
          onChange={(v) => handleToggle('pausePlanSubscriptions', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.needs}</h3>
        <Toggle
          label={d.pauseNeeds}
          desc=""
          checked={settings.pauseNeeds}
          onChange={(v) => handleToggle('pauseNeeds', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseBids}
          desc=""
          checked={settings.pauseBids}
          onChange={(v) => handleToggle('pauseBids', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseAwardBids}
          desc=""
          checked={settings.pauseAwardBids}
          onChange={(v) => handleToggle('pauseAwardBids', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.content}</h3>
        <Toggle
          label={d.pauseUploads}
          desc={d.pauseUploadsDesc ?? ''}
          checked={settings.pauseUploads}
          onChange={(v) => handleToggle('pauseUploads', v)}
          disabled={saving}
        />
        <h4
          className="admin-settings-section-title"
          style={{ marginTop: '1rem', fontSize: '1rem' }}
        >
          {d.uploadPolicySection ?? 'Upload policy'}
        </h4>
        <div className="admin-settings-row" key={`up-max-${settings.updatedAt}`}>
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.maxPublicUploadBytes}</label>
            <span className="admin-settings-desc">{d.maxPublicUploadBytesDesc}</span>
          </div>
          <input
            type="number"
            min={1}
            className="admin-settings-input admin-settings-input--number"
            defaultValue={settings.maxPublicUploadBytes ?? ''}
            placeholder={tr('Default (~50MB)', 'افتراضي')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              void handleNumberChange('maxPublicUploadBytes', v === '' ? null : parseInt(v, 10));
            }}
            disabled={saving}
          />
        </div>
        <div className="admin-settings-row" key={`up-mime-${settings.updatedAt}`}>
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.publicUploadMimes}</label>
            <span className="admin-settings-desc">{d.publicUploadMimesDesc}</span>
          </div>
          <input
            type="text"
            className="admin-settings-input"
            defaultValue={(settings.publicUploadAllowedMimes ?? []).join(', ')}
            placeholder="image/jpeg, image/png, …"
            onBlur={(e) => {
              const parts = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              void update({ publicUploadAllowedMimes: parts.length > 0 ? parts : null });
            }}
            disabled={saving}
          />
        </div>
        <div className="admin-settings-row" key={`up-dash-${settings.updatedAt}`}>
          <div className="admin-settings-label-wrap">
            <label className="admin-settings-label">{d.supabaseStorageDashboardUrl}</label>
          </div>
          <input
            type="url"
            className="admin-settings-input"
            defaultValue={settings.supabaseStorageDashboardUrl ?? ''}
            onBlur={(e) => {
              const v = e.target.value.trim();
              void handleTextChange('supabaseStorageDashboardUrl', v || null);
            }}
            disabled={saving}
          />
        </div>
        <Toggle
          label={d.pauseVerificationSubmissions}
          desc=""
          checked={settings.pauseVerificationSubmissions}
          onChange={(v) => handleToggle('pauseVerificationSubmissions', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.communication}</h3>
        <Toggle
          label={d.pauseChat}
          desc=""
          checked={settings.pauseChat}
          onChange={(v) => handleToggle('pauseChat', v)}
          disabled={saving}
        />
        <Toggle
          label={d.pauseOtpEmails}
          desc=""
          checked={settings.pauseOtpEmails}
          onChange={(v) => handleToggle('pauseOtpEmails', v)}
          disabled={saving}
        />
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.features}</h3>
        <Toggle
          label={d.featureNeedsEnabled}
          desc=""
          checked={settings.featureNeedsEnabled}
          onChange={(v) => handleToggle('featureNeedsEnabled', v)}
          disabled={saving}
        />
        <Toggle
          label={d.featurePlansEnabled}
          desc=""
          checked={settings.featurePlansEnabled}
          onChange={(v) => handleToggle('featurePlansEnabled', v)}
          disabled={saving}
        />
        <Toggle
          label={d.featureWalletEnabled}
          desc=""
          checked={settings.featureWalletEnabled}
          onChange={(v) => handleToggle('featureWalletEnabled', v)}
          disabled={saving}
        />
        <Toggle
          label={d.featureHourlyPricingEnabled}
          desc={d.featureHourlyPricingEnabledDesc}
          checked={settings.featureHourlyPricingEnabled}
          onChange={(v) => handleToggle('featureHourlyPricingEnabled', v)}
          disabled={saving}
        />
        <div className="admin-settings-row">
          <label className="admin-settings-label">{d.globalAnnouncement}</label>
          <input
            type="text"
            className="admin-settings-input"
            placeholder={d.globalAnnouncementPlaceholder}
            defaultValue={settings.globalAnnouncement ?? ''}
            onBlur={(e) => handleTextChange('globalAnnouncement', e.target.value || null)}
          />
        </div>
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{d.sections.sidebarNav}</h3>
        <p className="admin-settings-desc admin-settings-desc--block">{d.sidebarNavDesc}</p>
        {MANAGED_SIDEBAR_HREFS.map((href) => {
          const hidden = (settings.sidebarHiddenHrefs ?? []).includes(href);
          return (
            <Toggle
              key={href}
              label={sidebarLinkLabel(dictionary, href)}
              desc=""
              checked={!hidden}
              onChange={(visible) => setSidebarHrefHidden(href, !visible)}
              disabled={saving}
            />
          );
        })}
      </section>

      <section className="admin-settings-section admin-settings-section--danger">
        <h3 className="admin-settings-section-title">{d.dangerZone ?? 'Danger zone'}</h3>
        <p className="admin-settings-desc admin-settings-desc--block">
          {d.factoryResetWarning ??
            'Factory reset permanently removes all user accounts and their data except the platform and your admin account. This cannot be undone.'}
        </p>
        <div className="admin-settings-row">
          <button
            type="button"
            className="admin-btn admin-btn--danger"
            onClick={() => {
              setFactoryResetModalOpen(true);
              setFactoryResetConfirmPhrase('');
              setFactoryResetError(null);
            }}
            disabled={saving}
          >
            {d.factoryReset ?? 'Factory reset'}
          </button>
        </div>
      </section>

      {factoryResetModalOpen && (
        <div
          className="admin-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget && !factoryResetLoading)
              setFactoryResetModalOpen(false);
          }}
          role="presentation"
        >
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">{d.factoryReset ?? 'Factory reset'}</h3>
            <p className="admin-settings-desc admin-settings-desc--block">
              {d.factoryResetWarning ??
                'This will permanently remove all user accounts and data except the platform and your admin account. Type the confirmation phrase below to proceed.'}
            </p>
            <div className="admin-settings-row">
              <label className="admin-settings-label" htmlFor="factory-reset-confirm">
                {d.factoryResetConfirmPhraseLabel ??
                  `Type "${FACTORY_RESET_CONFIRM_PHRASE}" to confirm`}
              </label>
              <input
                id="factory-reset-confirm"
                type="text"
                className="admin-settings-input"
                placeholder={FACTORY_RESET_CONFIRM_PHRASE}
                value={factoryResetConfirmPhrase}
                onChange={(e) => setFactoryResetConfirmPhrase(e.target.value)}
                disabled={factoryResetLoading}
                autoComplete="off"
              />
            </div>
            {factoryResetError && (
              <p className="admin-settings-error" role="alert">
                {factoryResetError}
              </p>
            )}
            <div className="admin-modal-actions" style={{ marginTop: '1rem', gap: '0.5rem' }}>
              <button
                type="button"
                className="admin-btn"
                onClick={() => {
                  if (!factoryResetLoading) setFactoryResetModalOpen(false);
                }}
                disabled={factoryResetLoading}
              >
                {dictionary.common.cancel}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                disabled={
                  factoryResetLoading ||
                  factoryResetConfirmPhrase.trim().toUpperCase() !== FACTORY_RESET_CONFIRM_PHRASE
                }
                onClick={() => {
                  void (async () => {
                    setFactoryResetError(null);
                    setFactoryResetLoading(true);
                    try {
                      await adminApiClient.factoryReset(accessToken, {
                        refreshSession,
                      });
                      setFactoryResetModalOpen(false);
                      setSuccessMessage(d.factoryResetSuccess);
                      setSuccess(true);
                      setTimeout(() => {
                        setSuccess(false);
                        setSuccessMessage(null);
                      }, 5000);
                      if (refreshSession) await refreshSession();
                      setFactoryResetLoading(false);
                    } catch (err: unknown) {
                      setFactoryResetError(getErrorMessage(err, dictionary));
                      setFactoryResetLoading(false);
                    }
                  })();
                }}
              >
                {factoryResetLoading
                  ? dictionary.common.loading
                  : (d.factoryResetConfirm ?? 'Confirm factory reset')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
