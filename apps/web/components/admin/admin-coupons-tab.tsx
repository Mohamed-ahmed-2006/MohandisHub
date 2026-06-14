'use client';

import type { Coupon, ProviderCouponCampaignRequest } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession: () => Promise<string | null>;
};

type CouponFormState = {
  code: string;
  type: 'fixed' | 'percent';
  value: string;
  targetSurface: 'plan' | 'service' | 'ad' | 'platform_fee' | 'all';
  discountTarget: 'service_price' | 'platform_commission' | 'both';
  fundingSource: 'platform' | 'provider' | 'split';
  providerSharePercent: string;
  platformSharePercent: string;
  maxUses: string;
  maxUsesPerUser: string;
  active: boolean;
};

const emptyForm: CouponFormState = {
  code: '',
  type: 'percent',
  value: '',
  targetSurface: 'service',
  discountTarget: 'service_price',
  fundingSource: 'platform',
  providerSharePercent: '0',
  platformSharePercent: '100',
  maxUses: '',
  maxUsesPerUser: '',
  active: false,
};

const numberOrNull = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
};

const displayConfigCode = (config: Record<string, unknown>) => {
  const code = config.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : '-';
};

export const AdminCouponsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [campaigns, setCampaigns] = useState<ProviderCouponCampaignRequest[]>([]);
  const [form, setForm] = useState<CouponFormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [couponRows, campaignRows] = await Promise.all([
        adminApiClient.listCoupons(accessToken, { refreshSession }),
        adminApiClient.listCouponCampaigns(accessToken, { status: 'pending' }, { refreshSession }),
      ]);
      setCoupons(couponRows);
      setCampaigns(campaignRows);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Failed to load coupons.', 'تعذر تحميل الكوبونات.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const providerShare = numberOrNull(form.providerSharePercent);
      const platformShare = numberOrNull(form.platformSharePercent);
      await adminApiClient.createCoupon(
        accessToken,
        {
          code: form.code.trim(),
          type: form.type,
          value: Number(form.value),
          currency: 'EGP',
          targetSurface: form.targetSurface,
          discountTarget: form.discountTarget,
          fundingSource: form.fundingSource,
          providerSharePercent: form.fundingSource === 'split' ? providerShare : null,
          platformSharePercent: form.fundingSource === 'split' ? platformShare : null,
          maxUses: numberOrNull(form.maxUses),
          maxUsesPerUser: numberOrNull(form.maxUsesPerUser),
          active: form.active,
          allowedRoles: ['customer'],
        },
        { refreshSession },
      );
      setForm(emptyForm);
      setMessage(tr('Coupon created.', 'تم إنشاء الكوبون.'));
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : tr('Failed to create coupon.', 'تعذر إنشاء الكوبون.'),
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleCoupon = async (coupon: Coupon) => {
    setSaving(true);
    setError(null);
    try {
      await adminApiClient.updateCoupon(
        accessToken,
        coupon.id,
        { active: !coupon.active },
        { refreshSession },
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : tr('Action failed.', 'تعذر تنفيذ الإجراء.'));
    } finally {
      setSaving(false);
    }
  };

  const decideCampaign = async (
    campaign: ProviderCouponCampaignRequest,
    decision: 'approve' | 'reject',
  ) => {
    const reason = window.prompt(
      decision === 'approve'
        ? tr('Approval reason', 'سبب الموافقة')
        : tr('Rejection reason', 'سبب الرفض'),
    );
    if (!reason || reason.trim().length < 5) return;
    setSaving(true);
    setError(null);
    try {
      if (decision === 'approve') {
        await adminApiClient.approveCouponCampaign(
          accessToken,
          campaign.id,
          { reason: reason.trim() },
          { refreshSession },
        );
      } else {
        await adminApiClient.rejectCouponCampaign(
          accessToken,
          campaign.id,
          { reason: reason.trim() },
          { refreshSession },
        );
      }
      await load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : tr('Campaign action failed.', 'تعذر تنفيذ إجراء الحملة.'),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="admin-empty">{dictionary.admin.loading}</p>;

  return (
    <section className="admin-settings-tab">
      <h2 className="admin-settings-title">{tr('Coupons', 'الكوبونات')}</h2>
      {error && <p className="admin-settings-error">{error}</p>}
      {message && <p className="admin-settings-success">{message}</p>}

      <form className="admin-settings-section" onSubmit={(event) => void submit(event)}>
        <h3 className="admin-settings-section-title">{tr('Create coupon', 'إنشاء كوبون')}</h3>
        <div className="admin-toolbar">
          <input
            className="admin-toolbar-input"
            placeholder={tr('Code', 'الكود')}
            value={form.code}
            onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
            required
          />
          <select
            className="admin-toolbar-select"
            value={form.type}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, type: e.target.value as CouponFormState['type'] }))
            }
          >
            <option value="percent">{tr('Percent', 'نسبة')}</option>
            <option value="fixed">{tr('Fixed', 'مبلغ ثابت')}</option>
          </select>
          <input
            className="admin-toolbar-input"
            type="number"
            min={0}
            step={0.01}
            placeholder={tr('Value', 'القيمة')}
            value={form.value}
            onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
            required
          />
          <select
            className="admin-toolbar-select"
            value={form.targetSurface}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                targetSurface: e.target.value as CouponFormState['targetSurface'],
              }))
            }
          >
            <option value="service">{tr('Service', 'خدمة')}</option>
            <option value="plan">{tr('Plan', 'خطة')}</option>
            <option value="ad">{tr('Ad', 'إعلان')}</option>
            <option value="platform_fee">{tr('Platform fee', 'رسوم المنصة')}</option>
            <option value="all">{tr('All', 'الكل')}</option>
          </select>
          <select
            className="admin-toolbar-select"
            value={form.discountTarget}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                discountTarget: e.target.value as CouponFormState['discountTarget'],
              }))
            }
          >
            <option value="service_price">{tr('Service price', 'سعر الخدمة')}</option>
            <option value="platform_commission">{tr('Commission', 'العمولة')}</option>
            <option value="both">{tr('Both', 'كلاهما')}</option>
          </select>
          <select
            className="admin-toolbar-select"
            value={form.fundingSource}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                fundingSource: e.target.value as CouponFormState['fundingSource'],
              }))
            }
          >
            <option value="platform">{tr('Platform funded', 'منصة')}</option>
            <option value="provider">{tr('Provider funded', 'مقدم الخدمة')}</option>
            <option value="split">{tr('Split funded', 'مشترك')}</option>
          </select>
          {form.fundingSource === 'split' && (
            <>
              <input
                className="admin-toolbar-input"
                type="number"
                min={0}
                max={100}
                value={form.providerSharePercent}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, providerSharePercent: e.target.value }))
                }
                placeholder={tr('Provider %', 'نسبة مقدم الخدمة')}
              />
              <input
                className="admin-toolbar-input"
                type="number"
                min={0}
                max={100}
                value={form.platformSharePercent}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, platformSharePercent: e.target.value }))
                }
                placeholder={tr('Platform %', 'نسبة المنصة')}
              />
            </>
          )}
          <input
            className="admin-toolbar-input"
            type="number"
            min={1}
            value={form.maxUses}
            onChange={(e) => setForm((prev) => ({ ...prev, maxUses: e.target.value }))}
            placeholder={tr('Max uses', 'حد الاستخدام')}
          />
          <label className="admin-btn">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
            />
            {tr('Active', 'مفعل')}
          </label>
          <button className="admin-btn admin-btn--primary" type="submit" disabled={saving}>
            {tr('Create', 'إنشاء')}
          </button>
        </div>
      </form>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">
          {tr('Provider campaign requests', 'طلبات حملات مقدمي الخدمة')}
        </h3>
        {campaigns.length === 0 ? (
          <p className="admin-empty">
            {tr('No pending campaign requests.', 'لا توجد طلبات حملات معلقة.')}
          </p>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{tr('Provider', 'مقدم الخدمة')}</th>
                  <th>{tr('Quantity', 'العدد')}</th>
                  <th>{tr('Fee', 'الرسوم')}</th>
                  <th>{tr('Code', 'الكود')}</th>
                  <th>{tr('Actions', 'إجراءات')}</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td>{campaign.providerId.slice(0, 8)}</td>
                    <td>{campaign.requestedQuantity}</td>
                    <td>{campaign.totalFeeEgp.toFixed(2)} EGP</td>
                    <td>{displayConfigCode(campaign.couponConfig)}</td>
                    <td>
                      <button
                        className="admin-btn admin-btn--success admin-btn--small"
                        onClick={() => void decideCampaign(campaign, 'approve')}
                        disabled={saving}
                      >
                        {tr('Approve', 'موافقة')}
                      </button>
                      <button
                        className="admin-btn admin-btn--danger admin-btn--small"
                        onClick={() => void decideCampaign(campaign, 'reject')}
                        disabled={saving}
                      >
                        {tr('Reject', 'رفض')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-settings-section">
        <h3 className="admin-settings-section-title">{tr('All coupons', 'كل الكوبونات')}</h3>
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr('Code', 'الكود')}</th>
                <th>{tr('Discount', 'الخصم')}</th>
                <th>{tr('Target', 'الهدف')}</th>
                <th>{tr('Funding', 'التمويل')}</th>
                <th>{tr('Uses', 'الاستخدام')}</th>
                <th>{tr('Status', 'الحالة')}</th>
                <th>{tr('Actions', 'إجراءات')}</th>
              </tr>
            </thead>
            <tbody>
              {coupons.map((coupon) => (
                <tr key={coupon.id}>
                  <td>{coupon.code}</td>
                  <td>
                    {coupon.type === 'percent'
                      ? `${coupon.value}%`
                      : `${coupon.value} ${coupon.currency}`}
                  </td>
                  <td>{coupon.discountTarget}</td>
                  <td>{coupon.fundingSource ?? '-'}</td>
                  <td>
                    {coupon.useCount}
                    {coupon.maxUses ? ` / ${coupon.maxUses}` : ''}
                  </td>
                  <td>{coupon.active ? tr('Active', 'مفعل') : tr('Inactive', 'غير مفعل')}</td>
                  <td>
                    <button
                      className="admin-btn admin-btn--small"
                      onClick={() => void toggleCoupon(coupon)}
                      disabled={saving}
                    >
                      {coupon.active ? tr('Disable', 'تعطيل') : tr('Enable', 'تفعيل')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
};
