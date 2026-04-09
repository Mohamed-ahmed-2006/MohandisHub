'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { SiteLogo } from '@/components/site-logo';
import {
  advertisementsApiClient,
  type AdStatus,
  type Advertisement,
  type AdvertisementPlan,
} from '@/lib/advertisements/client';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { uploadFile } from '@/lib/upload/client';

import '@/app/my-ads.css';

type MyAdsScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const STATUS_COLORS: Record<AdStatus, string> = {
  pending_payment: 'dashboard-badge--pending',
  active: 'dashboard-badge--accepted',
  expired: 'dashboard-badge--completed',
  cancelled: 'dashboard-badge--rejected',
  paused_by_admin: 'dashboard-badge--pending',
};

export const MyAdsScreen = ({ locale, dictionary }: MyAdsScreenProps) => {
  const { accessToken, authUser } = useAuth();
  const [plans, setPlans] = useState<AdvertisementPlan[]>([]);
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    adPlanId: '',
    startsAt: '',
    titleEn: '',
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    imageUrl: '',
    ctaTextEn: '',
    ctaTextAr: '',
    linkType: 'profile' as 'profile' | 'service' | 'need',
    linkTarget: '',
  });

  const d = dictionary.advertisements ?? {};
  const c = dictionary.common ?? {};
  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);

  const canUse =
    authUser?.role === 'expert' ||
    authUser?.role === 'business' ||
    authUser?.role === 'craftsman';

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [planData, myAds] = await Promise.all([
        advertisementsApiClient.getAdPlans(accessToken),
        advertisementsApiClient.getMyAds(accessToken, { limit: 50 }),
      ]);
      setPlans(planData);
      setRows(myAds.rows);
      if (planData.length > 0) {
        setForm((prev) => (prev.adPlanId ? prev : { ...prev, adPlanId: planData[0]!.id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ads.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === form.adPlanId),
    [plans, form.adPlanId],
  );

  const plannedStartAt = useMemo(() => {
    if (!form.startsAt) return new Date();
    const parsed = new Date(form.startsAt);
    if (Number.isNaN(parsed.getTime())) return new Date();
    return parsed;
  }, [form.startsAt]);

  const plannedEndAt = useMemo(() => {
    if (!selectedPlan) return null;
    return new Date(plannedStartAt.getTime() + selectedPlan.duration_days * 24 * 60 * 60 * 1000);
  }, [plannedStartAt, selectedPlan]);

  if (!canUse) {
    return (
      <main className="myads-main">
        <p className="home-empty">{d.notProvider ?? 'Only providers can create advertisements.'}</p>
      </main>
    );
  }

  const onUpload = async (file: File) => {
    if (!accessToken) return;
    setUploading(true);
    try {
      const uploaded = await uploadFile(accessToken, file);
      setForm((prev) => ({ ...prev, imageUrl: uploaded.url }));
    } catch {
      setError(tr('Failed to upload image', 'فشل رفع الصورة'));
    } finally {
      setUploading(false);
    }
  };

  const resetForm = () => {
    setForm((prev) => ({
      ...prev,
      startsAt: '',
      titleEn: '',
      titleAr: '',
      descriptionEn: '',
      descriptionAr: '',
      imageUrl: '',
      ctaTextEn: '',
      ctaTextAr: '',
      linkTarget: '',
    }));
    setShowForm(false);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const titleAr = form.titleAr.trim();
      const descriptionEn = form.descriptionEn.trim();
      const descriptionAr = form.descriptionAr.trim();
      const ctaTextEn = form.ctaTextEn.trim();
      const ctaTextAr = form.ctaTextAr.trim();
      const linkTarget = form.linkTarget.trim();
      await advertisementsApiClient.createAd(accessToken, {
        adPlanId: form.adPlanId,
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
        titleEn: form.titleEn,
        ...(titleAr ? { titleAr } : {}),
        ...(descriptionEn ? { descriptionEn } : {}),
        ...(descriptionAr ? { descriptionAr } : {}),
        imageUrl: form.imageUrl,
        ...(ctaTextEn ? { ctaTextEn } : {}),
        ...(ctaTextAr ? { ctaTextAr } : {}),
        linkType: form.linkType,
        ...(linkTarget ? { linkTarget } : {}),
      });
      resetForm();
      setSuccess(tr('Ad created! Pay to activate it.', 'تم إنشاء الإعلان! ادفع لتفعيله.'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ad.');
    } finally {
      setSubmitting(false);
    }
  };

  const onPay = async (adId: string) => {
    if (!accessToken) return;
    setError(null);
    setSuccess(null);
    setPayingId(adId);
    try {
      await advertisementsApiClient.payForAd(accessToken, adId);
      setSuccess(tr('Ad activated!', 'تم تفعيل الإعلان!'));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed.');
    } finally {
      setPayingId(null);
    }
  };

  const previewTitle = isAr
    ? form.titleAr || form.titleEn || tr('Your ad title', 'عنوان إعلانك')
    : form.titleEn || tr('Your ad title', 'عنوان إعلانك');
  const previewDesc = isAr
    ? form.descriptionAr || form.descriptionEn
    : form.descriptionEn;
  const previewCta = isAr
    ? form.ctaTextAr || form.ctaTextEn || tr('Open', 'افتح')
    : form.ctaTextEn || tr('Open', 'افتح');
  const resolvedImageUrl = form.imageUrl ? toAbsoluteAssetUrl(form.imageUrl) : null;

  const statusLabel = (s: AdStatus) => {
    const map: Record<string, string> = {
      pending_payment: tr('Pending Payment', 'بانتظار الدفع'),
      active: tr('Active', 'نشط'),
      expired: tr('Expired', 'منتهي'),
      cancelled: tr('Cancelled', 'ملغى'),
      paused_by_admin: tr('Paused', 'متوقف'),
    };
    return map[s] ?? s;
  };

  const linkTypeLabel = (l: string) => {
    const map: Record<string, string> = {
      profile: tr('My Profile', 'ملفي الشخصي'),
      service: tr('Service Page', 'صفحة الخدمة'),
      need: tr('Customer Need', 'حاجة العميل'),
    };
    return map[l] ?? l;
  };

  const activeAds = rows.filter((r) => r.status === 'active');
  const pendingAds = rows.filter((r) => r.status === 'pending_payment');
  const otherAds = rows.filter((r) => r.status !== 'active' && r.status !== 'pending_payment');

  return (
    <main className="myads-main">
      {/* Header */}
      <div className="myads-header">
        <div>
          <h1 className="myads-page-title">{d.myAds ?? 'My Advertisements'}</h1>
          <p className="myads-page-subtitle">
            {tr(
              'Promote your services with slideshow ads visible to customers.',
              'روّج لخدماتك بإعلانات عرض شرائح يراها العملاء.',
            )}
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary"
            onClick={() => setShowForm(true)}
          >
            + {d.createAd ?? tr('Create Ad', 'إنشاء إعلان')}
          </button>
        )}
      </div>

      {/* Messages */}
      {error && (
        <div className="myads-msg myads-msg--error">
          <span>{error}</span>
          <button type="button" className="myads-msg-dismiss" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {success && (
        <div className="myads-msg myads-msg--success">
          <span>{success}</span>
          <button type="button" className="myads-msg-dismiss" onClick={() => setSuccess(null)}>
            ×
          </button>
        </div>
      )}

      {/* Create Ad Form */}
      {showForm && (
        <section className="myads-create-section">
          <div className="myads-create-grid">
            {/* Form Column */}
            <form className="myads-form-card" onSubmit={(e) => void onCreate(e)}>
              <h2 className="myads-form-card-title">
                {d.createAd ?? tr('Create Advertisement', 'إنشاء إعلان')}
              </h2>

              {/* Plan selection */}
              <fieldset className="myads-fieldset">
                <legend className="myads-legend">
                  {tr('Choose a plan', 'اختر خطة')}
                </legend>
                <div className="myads-plan-grid">
                  {plans.map((p) => {
                    const active = form.adPlanId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`myads-plan-option ${active ? 'myads-plan-option--active' : ''}`}
                        onClick={() => setForm((prev) => ({ ...prev, adPlanId: p.id }))}
                      >
                        <span className="myads-plan-option-name">
                          {isAr ? p.name_ar || p.name_en : p.name_en}
                        </span>
                        <span className="myads-plan-option-price">
                          {p.price} {p.currency}
                        </span>
                        <span className="myads-plan-option-duration">
                          {p.duration_days} {tr('days', 'يوم')}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="myads-field">
                  <label className="myads-label">{tr('Start date & time', 'تاريخ ووقت البداية')}</label>
                  <input
                    type="datetime-local"
                    className="dashboard-input"
                    value={form.startsAt}
                    onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))}
                  />
                </div>
              </fieldset>

              {/* Content */}
              <fieldset className="myads-fieldset">
                <legend className="myads-legend">{tr('Ad Content', 'محتوى الإعلان')}</legend>
                <div className="myads-field">
                  <label className="myads-label">
                    {tr('Title (English)', 'العنوان (إنجليزي)')} *
                  </label>
                  <input
                    className="dashboard-input"
                    value={form.titleEn}
                    onChange={(e) => setForm((p) => ({ ...p, titleEn: e.target.value }))}
                    required
                    maxLength={180}
                  />
                </div>
                <div className="myads-field">
                  <label className="myads-label">
                    {tr('Title (Arabic)', 'العنوان (عربي)')}
                  </label>
                  <input
                    className="dashboard-input"
                    dir="rtl"
                    value={form.titleAr}
                    onChange={(e) => setForm((p) => ({ ...p, titleAr: e.target.value }))}
                    maxLength={180}
                  />
                </div>
                <div className="myads-field-row">
                  <div className="myads-field">
                    <label className="myads-label">
                      {tr('Description (EN)', 'الوصف (إنجليزي)')}
                    </label>
                    <textarea
                      className="dashboard-textarea"
                      rows={3}
                      value={form.descriptionEn}
                      onChange={(e) => setForm((p) => ({ ...p, descriptionEn: e.target.value }))}
                      maxLength={800}
                    />
                  </div>
                  <div className="myads-field">
                    <label className="myads-label">
                      {tr('Description (AR)', 'الوصف (عربي)')}
                    </label>
                    <textarea
                      className="dashboard-textarea"
                      rows={3}
                      dir="rtl"
                      value={form.descriptionAr}
                      onChange={(e) => setForm((p) => ({ ...p, descriptionAr: e.target.value }))}
                      maxLength={800}
                    />
                  </div>
                </div>
              </fieldset>

              {/* Image */}
              <fieldset className="myads-fieldset">
                <legend className="myads-legend">
                  {tr('Banner Image', 'صورة الإعلان')} *
                </legend>
                <div className="myads-upload-area">
                  {resolvedImageUrl ? (
                    <div className="myads-upload-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={resolvedImageUrl} alt="" />
                      <button
                        type="button"
                        className="myads-upload-remove"
                        onClick={() => setForm((p) => ({ ...p, imageUrl: '' }))}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="myads-upload-trigger">
                      <span className="myads-upload-icon">+</span>
                      <span>
                        {uploading
                          ? tr('Uploading...', 'جاري الرفع...')
                          : tr('Click to upload banner image', 'اضغط لرفع صورة الإعلان')}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploading}
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void onUpload(file);
                        }}
                      />
                    </label>
                  )}
                </div>
              </fieldset>

              {/* CTA + Link */}
              <fieldset className="myads-fieldset">
                <legend className="myads-legend">
                  {tr('Call to Action', 'زر الإجراء')}
                </legend>
                <div className="myads-field-row">
                  <div className="myads-field">
                    <label className="myads-label">{tr('Button text (EN)', 'نص الزر (إنجليزي)')}</label>
                    <input
                      className="dashboard-input"
                      placeholder={tr('e.g. Book now', 'مثلا: احجز الآن')}
                      value={form.ctaTextEn}
                      onChange={(e) => setForm((p) => ({ ...p, ctaTextEn: e.target.value }))}
                      maxLength={120}
                    />
                  </div>
                  <div className="myads-field">
                    <label className="myads-label">{tr('Button text (AR)', 'نص الزر (عربي)')}</label>
                    <input
                      className="dashboard-input"
                      dir="rtl"
                      placeholder={tr('e.g. احجز الآن', 'مثلا: احجز الآن')}
                      value={form.ctaTextAr}
                      onChange={(e) => setForm((p) => ({ ...p, ctaTextAr: e.target.value }))}
                      maxLength={120}
                    />
                  </div>
                </div>
                <div className="myads-field">
                  <label className="myads-label">{tr('Where does the ad link to?', 'إلى أين يوجه الإعلان؟')}</label>
                  <select
                    className="dashboard-select"
                    value={form.linkType}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        linkType: e.target.value as 'profile' | 'service' | 'need',
                      }))
                    }
                  >
                    <option value="profile">{linkTypeLabel('profile')}</option>
                    <option value="service">{linkTypeLabel('service')}</option>
                    <option value="need">{linkTypeLabel('need')}</option>
                  </select>
                </div>
                {form.linkType !== 'profile' && (
                  <div className="myads-field">
                    <label className="myads-label">
                      {tr('Target ID', 'المعرف المستهدف')}
                    </label>
                    <input
                      className="dashboard-input"
                      placeholder={tr('Service or need ID', 'معرف الخدمة أو الحاجة')}
                      value={form.linkTarget}
                      onChange={(e) => setForm((p) => ({ ...p, linkTarget: e.target.value }))}
                    />
                  </div>
                )}
              </fieldset>

              {/* Price summary */}
              {selectedPlan && (
                <div className="myads-price-summary">
                  <span className="myads-price-summary-label">
                    {tr('Total cost', 'التكلفة الإجمالية')}
                  </span>
                  <span className="myads-price-summary-value">
                    {selectedPlan.price} {selectedPlan.currency}
                  </span>
                  <span className="myads-price-summary-note">
                    {tr(
                      `Deducted from wallet on payment · runs for ${selectedPlan.duration_days} days`,
                      `تُخصم من المحفظة عند الدفع · تعمل لمدة ${selectedPlan.duration_days} يوم`,
                    )}
                  </span>
                  <span className="myads-price-summary-note">
                    {tr('Starts', 'يبدأ')}: {plannedStartAt.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                  </span>
                  {plannedEndAt ? (
                    <span className="myads-price-summary-note">
                      {tr('Ends', 'ينتهي')}: {plannedEndAt.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                    </span>
                  ) : null}
                </div>
              )}

              {/* Actions */}
              <div className="myads-form-actions">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => {
                    resetForm();
                    setShowForm(false);
                  }}
                >
                  {c.cancel ?? 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="dashboard-btn dashboard-btn--primary"
                  disabled={submitting || !form.imageUrl || !form.titleEn || !form.adPlanId}
                >
                  {submitting
                    ? c.loading ?? 'Loading...'
                    : tr('Create Ad', 'إنشاء الإعلان')}
                </button>
              </div>
            </form>

            {/* Live Preview Column */}
            <div className="myads-preview-card">
              <h3 className="myads-preview-card-title">
                {tr('Live Preview', 'معاينة مباشرة')}
              </h3>
              <p className="myads-preview-hint">
                {tr(
                  'This is how your ad will appear in the home screen slideshow.',
                  'هكذا سيظهر إعلانك في العرض على الشاشة الرئيسية.',
                )}
              </p>
              <div className="myads-preview-frame">
                <div
                  className="ad-slideshow-banner"
                  style={{
                    backgroundImage: resolvedImageUrl
                      ? `url(${resolvedImageUrl})`
                      : 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--border)))',
                  }}
                >
                  <div className="ad-slideshow-overlay">
                    <p className="ad-slideshow-badge">{d.adLabel ?? 'Sponsored'}</p>
                    <h2 className="ad-slideshow-title">{previewTitle}</h2>
                    {previewDesc && <p className="ad-slideshow-desc">{previewDesc}</p>}
                    <span className="ad-slideshow-cta">{previewCta}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Ads List */}
      {loading ? (
        <p className="home-empty">{c.loading ?? 'Loading...'}</p>
      ) : rows.length === 0 && !showForm ? (
        <div className="myads-empty">
          <div className="myads-empty-brand-wrap">
            <SiteLogo className="myads-empty-brand" />
          </div>
          <h3>{tr('No advertisements yet', 'لا توجد إعلانات بعد')}</h3>
          <p>
            {tr(
              'Create your first ad to promote your services to customers.',
              'أنشئ إعلانك الأول لترويج خدماتك للعملاء.',
            )}
          </p>
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary"
            onClick={() => setShowForm(true)}
          >
            + {d.createAd ?? tr('Create Ad', 'إنشاء إعلان')}
          </button>
        </div>
      ) : (
        <>
          {/* Pending payment */}
          {pendingAds.length > 0 && (
            <section className="myads-list-section">
              <h2 className="myads-list-title">
                {tr('Pending Payment', 'بانتظار الدفع')} ({pendingAds.length})
              </h2>
              <div className="myads-ad-grid">
                {pendingAds.map((ad) => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    locale={locale}
                    statusLabel={statusLabel}
                    onPay={() => void onPay(ad.id)}
                    paying={payingId === ad.id}
                    d={d}
                    tr={tr}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Active */}
          {activeAds.length > 0 && (
            <section className="myads-list-section">
              <h2 className="myads-list-title">
                {tr('Active Ads', 'الإعلانات النشطة')} ({activeAds.length})
              </h2>
              <div className="myads-ad-grid">
                {activeAds.map((ad) => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    locale={locale}
                    statusLabel={statusLabel}
                    d={d}
                    tr={tr}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Other */}
          {otherAds.length > 0 && (
            <section className="myads-list-section">
              <h2 className="myads-list-title">
                {tr('Past Ads', 'الإعلانات السابقة')} ({otherAds.length})
              </h2>
              <div className="myads-ad-grid">
                {otherAds.map((ad) => (
                  <AdCard
                    key={ad.id}
                    ad={ad}
                    locale={locale}
                    statusLabel={statusLabel}
                    d={d}
                    tr={tr}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
};

type AdCardProps = {
  ad: Advertisement;
  locale: Locale;
  statusLabel: (s: AdStatus) => string;
  onPay?: () => void;
  paying?: boolean;
  d: Record<string, unknown>;
  tr: (en: string, ar: string) => string;
};

const AdCard = ({ ad, locale, statusLabel, onPay, paying, d, tr }: AdCardProps) => {
  const isAr = locale === 'ar';
  const title = isAr ? ad.title_ar || ad.title_en : ad.title_en;
  const resolvedImg = toAbsoluteAssetUrl(ad.image_url);
  const starts = ad.starts_at
    ? new Date(ad.starts_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')
    : null;
  const expires = ad.expires_at
    ? new Date(ad.expires_at).toLocaleDateString(isAr ? 'ar-EG' : 'en-US')
    : null;

  return (
    <article className="myads-ad-card">
      <div
        className="myads-ad-card-banner"
        style={{ backgroundImage: `url(${resolvedImg})` }}
      />
      <div className="myads-ad-card-body">
        <div className="myads-ad-card-head">
          <h3 className="myads-ad-card-title">{title}</h3>
          <span className={`dashboard-badge ${STATUS_COLORS[ad.status]}`}>
            {statusLabel(ad.status)}
          </span>
        </div>
        <div className="myads-ad-card-stats">
          <div className="myads-stat">
            <span className="myads-stat-value">{ad.impressions}</span>
            <span className="myads-stat-label">{(d.impressions as string) ?? 'Impressions'}</span>
          </div>
          <div className="myads-stat">
            <span className="myads-stat-value">{ad.clicks}</span>
            <span className="myads-stat-label">{(d.clicks as string) ?? 'Clicks'}</span>
          </div>
          <div className="myads-stat">
            <span className="myads-stat-value">
              {ad.impressions > 0
                ? `${((ad.clicks / ad.impressions) * 100).toFixed(1)}%`
                : '—'}
            </span>
            <span className="myads-stat-label">CTR</span>
          </div>
          <div className="myads-stat">
            <span className="myads-stat-value">{ad.amount_paid ?? '—'}</span>
            <span className="myads-stat-label">{tr('Paid', 'المدفوع')}</span>
          </div>
        </div>
        {starts && (
          <p className="myads-ad-card-meta">
            {tr('Starts', 'يبدأ')}: {starts}
          </p>
        )}
        {expires && (
          <p className="myads-ad-card-meta">
            {tr('Expires', 'ينتهي')}: {expires}
          </p>
        )}
        {ad.status === 'pending_payment' && onPay && (
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary myads-pay-btn"
            disabled={paying}
            onClick={onPay}
          >
            {paying
              ? tr('Processing...', 'جاري المعالجة...')
              : (d.payNow as string) ?? tr('Pay & Activate', 'ادفع وفعّل')}
          </button>
        )}
      </div>
    </article>
  );
};
