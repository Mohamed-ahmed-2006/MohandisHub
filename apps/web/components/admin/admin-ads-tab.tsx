'use client';

import type { AdminPermission } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import {
  advertisementsApiClient,
  type AdminAdControls,
  type AdStatus,
  type Advertisement,
} from '@/lib/advertisements/client';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  adminPermissions: AdminPermission[];
};

const hasPermission = (permissions: string[], permission: string): boolean =>
  permissions.includes('super_admin') || permissions.includes(permission);

export const AdminAdsTab = ({ locale, dictionary, accessToken, adminPermissions }: Props) => {
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [controls, setControls] = useState<AdminAdControls>({
    acceptAds: false,
    pricePerDay: 0,
  });
  const [statusFilter, setStatusFilter] = useState<AdStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAr = locale === 'ar';
  const tr = useCallback((en: string, ar: string) => (isAr ? ar : en), [isAr]);
  const canManageAds = hasPermission(adminPermissions, 'manage_ads');
  const canManagePricing = hasPermission(adminPermissions, 'manage_ad_pricing');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [campaigns, settings] = await Promise.all([
        advertisementsApiClient.adminListAds(
          accessToken,
          statusFilter ? { status: statusFilter } : undefined,
        ),
        canManagePricing
          ? advertisementsApiClient.adminGetControls(accessToken)
          : Promise.resolve({ acceptAds: false, pricePerDay: 0 }),
      ]);
      setRows(campaigns.rows);
      setControls(settings);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : tr('Could not load campaigns.', 'تعذر تحميل الحملات.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, canManagePricing, statusFilter, tr]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (adId: string, decision: 'approve' | 'reject') => {
    const reason =
      decision === 'reject'
        ? window.prompt(tr('Enter the rejection reason:', 'أدخل سبب الرفض:'))?.trim()
        : undefined;
    if (decision === 'reject' && !reason) return;
    setError(null);
    try {
      await advertisementsApiClient.adminReview(accessToken, adId, {
        decision,
        ...(reason ? { reason } : {}),
      });
      await load();
    } catch (reviewError) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : tr('Could not review the campaign.', 'تعذر مراجعة الحملة.'),
      );
    }
  };

  const transition = async (adId: string, status: 'active' | 'paused_by_admin' | 'cancelled') => {
    if (
      status === 'cancelled' &&
      !window.confirm(
        tr(
          'Cancel this campaign and refund eligible unused time?',
          'إلغاء الحملة ورد قيمة الوقت غير المستخدم المستحق؟',
        ),
      )
    ) {
      return;
    }
    const reason =
      status === 'paused_by_admin'
        ? window.prompt(tr('Pause reason (optional):', 'سبب الإيقاف (اختياري):'))?.trim()
        : undefined;
    setError(null);
    try {
      await advertisementsApiClient.adminSetStatus(accessToken, adId, {
        status,
        ...(reason && reason.length >= 3 ? { reason } : {}),
      });
      await load();
    } catch (transitionError) {
      setError(
        transitionError instanceof Error
          ? transitionError.message
          : tr('Could not update campaign status.', 'تعذر تحديث حالة الحملة.'),
      );
    }
  };

  const saveControls = async () => {
    if (!Number.isFinite(controls.pricePerDay) || controls.pricePerDay < 0) return;
    setSaving(true);
    setError(null);
    try {
      await advertisementsApiClient.adminUpdateControls(accessToken, controls);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : tr('Could not save advertising controls.', 'تعذر حفظ إعدادات الإعلانات.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const labels: Record<AdStatus, string> = {
    pending_review: tr('Pending review', 'قيد المراجعة'),
    scheduled: tr('Scheduled', 'مجدول'),
    active: tr('Active', 'نشط'),
    paused_by_admin: tr('Paused', 'موقوف'),
    rejected: tr('Rejected', 'مرفوض'),
    expired: tr('Expired', 'منتهي'),
    cancelled: tr('Cancelled', 'ملغي'),
  };

  return (
    <section className="admin-tab-content" dir={isAr ? 'rtl' : 'ltr'}>
      <h2 className="admin-tab-title">
        {dictionary.admin?.tabs?.ads ?? tr('Advertisements', 'الإعلانات')}
      </h2>

      {canManagePricing ? (
        <div className="admin-settings-section">
          <h3 className="admin-settings-section-title">
            {tr('Advertising release controls', 'ضوابط تشغيل الإعلانات')}
          </h3>
          <p className="admin-section-desc">
            {tr(
              'One server-controlled daily price applies to every new campaign.',
              'يُطبق سعر يومي واحد يتحكم فيه الخادم على كل حملة جديدة.',
            )}
          </p>
          <label className="admin-settings-label-wrap">
            <span className="admin-settings-label">
              {tr('Daily price (EGP)', 'السعر اليومي (ج.م)')}
            </span>
            <input
              className="admin-settings-input admin-settings-input--number"
              type="number"
              min={0}
              step="0.01"
              value={controls.pricePerDay}
              onChange={(event) =>
                setControls((current) => ({
                  ...current,
                  pricePerDay: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="admin-settings-row">
            <input
              type="checkbox"
              checked={controls.acceptAds}
              onChange={(event) =>
                setControls((current) => ({ ...current, acceptAds: event.target.checked }))
              }
            />
            <span>{tr('Accept new campaigns', 'قبول حملات جديدة')}</span>
          </label>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            disabled={saving}
            onClick={() => void saveControls()}
          >
            {saving ? tr('Saving…', 'جارٍ الحفظ…') : tr('Save controls', 'حفظ الإعدادات')}
          </button>
        </div>
      ) : null}

      <div className="admin-toolbar">
        <label>
          <span className="admin-sr-only">{tr('Filter by status', 'تصفية حسب الحالة')}</span>
          <select
            className="admin-toolbar-select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as AdStatus | '')}
          >
            <option value="">{tr('All statuses', 'كل الحالات')}</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="admin-empty">{error}</p> : null}
      {loading ? (
        <p className="admin-empty">{tr('Loading…', 'جارٍ التحميل…')}</p>
      ) : rows.length === 0 ? (
        <p className="admin-empty">{tr('No campaigns found.', 'لا توجد حملات.')}</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr('Campaign', 'الحملة')}</th>
                <th>{tr('Advertiser', 'المعلن')}</th>
                <th>{tr('Status', 'الحالة')}</th>
                <th>{tr('Paid', 'المدفوع')}</th>
                <th>{tr('Metrics', 'المؤشرات')}</th>
                <th>{tr('Actions', 'الإجراءات')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ad) => (
                <tr key={ad.id}>
                  <td>
                    <strong>{isAr ? ad.title_ar || ad.title_en : ad.title_en}</strong>
                    {ad.rejection_reason ? <small>{ad.rejection_reason}</small> : null}
                  </td>
                  <td>{ad.advertiser_name ?? tr('Provider', 'مقدم خدمة')}</td>
                  <td>{labels[ad.status]}</td>
                  <td>{ad.amount_paid ? `${ad.amount_paid} EGP` : '—'}</td>
                  <td>
                    {ad.impressions} / {ad.clicks}
                  </td>
                  <td>
                    <div className="admin-actions-row">
                      {canManageAds && ad.status === 'pending_review' ? (
                        <>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => void review(ad.id, 'approve')}
                          >
                            {tr('Approve', 'موافقة')}
                          </button>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small admin-btn--danger"
                            onClick={() => void review(ad.id, 'reject')}
                          >
                            {tr('Reject', 'رفض')}
                          </button>
                        </>
                      ) : null}
                      {canManageAds && ['active', 'scheduled'].includes(ad.status) ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => void transition(ad.id, 'paused_by_admin')}
                        >
                          {tr('Pause', 'إيقاف')}
                        </button>
                      ) : null}
                      {canManageAds && ad.status === 'paused_by_admin' ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => void transition(ad.id, 'active')}
                        >
                          {tr('Resume', 'استئناف')}
                        </button>
                      ) : null}
                      {canManageAds &&
                      ['pending_review', 'scheduled', 'active', 'paused_by_admin'].includes(
                        ad.status,
                      ) ? (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => void transition(ad.id, 'cancelled')}
                        >
                          {tr('Cancel', 'إلغاء')}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
