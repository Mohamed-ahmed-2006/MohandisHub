'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { SiteLogo } from '@/components/site-logo';
import {
  advertisementsApiClient,
  type AdminAdControls,
  type AdStatus,
  type Advertisement,
} from '@/lib/advertisements/client';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { formatMhc } from '@/lib/mhc/presentation';
import { uploadFile } from '@/lib/upload/client';

import '@/app/my-ads.css';

type MyAdsScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const STATUS_COLORS: Record<AdStatus, string> = {
  pending_review: 'dashboard-badge--pending',
  scheduled: 'dashboard-badge--pending',
  active: 'dashboard-badge--accepted',
  expired: 'dashboard-badge--completed',
  rejected: 'dashboard-badge--rejected',
  cancelled: 'dashboard-badge--rejected',
  paused_by_admin: 'dashboard-badge--pending',
};

export const MyAdsScreen = ({ locale, dictionary }: MyAdsScreenProps) => {
  const router = useRouter();
  const { accessToken, authUser, isAuthenticated, isReady, authGuard } = useAuth();
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busyAdId, setBusyAdId] = useState<string | null>(null);
  const [adControls, setAdControls] = useState<AdminAdControls>({
    acceptAds: true,
    mhcPrice: 0,
  });

  const [form, setForm] = useState({
    startsAt: '',
    titleEn: '',
    titleAr: '',
    descriptionEn: '',
    descriptionAr: '',
    imageUrl: '',
    ctaTextEn: '',
    ctaTextAr: '',
    linkType: 'profile' as 'profile' | 'service',
    linkTarget: '',
  });

  const d = dictionary.advertisements ?? {};
  const c = dictionary.common ?? {};
  const isAr = locale === 'ar';
  const tr = (en: string, ar: string) => (isAr ? ar : en);
  const creditsHref = buildLocalePath(locale, '/app/credits');

  const canUse =
    authUser?.role === 'expert' || authUser?.role === 'business' || authUser?.role === 'craftsman';

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const [myAds, controls] = await Promise.all([
        advertisementsApiClient.getMyAds(accessToken, { limit: 50 }),
        advertisementsApiClient.getAdControls(accessToken),
      ]);
      setRows(myAds.rows);
      setAdControls(controls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ads.');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const plannedStartAt = useMemo(() => {
    if (!form.startsAt) return null;
    const parsed = new Date(form.startsAt);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [form.startsAt]);

  /**
   * One advertisement week costs one weekly price. There is no duration to
   * multiply by: the period length is fixed at seven days server-side.
   */
  const weeklyPrice = useMemo(() => Math.max(0, adControls.mhcPrice), [adControls.mhcPrice]);

  // Do not render app content to unauthenticated/unverified users; the effect
  // above redirects them. Show nothing until auth state is settled.
  if (!isReady || !isAuthenticated || !authUser || !authGuard.emailVerified) {
    return <main className="myads-main" />;
  }

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

  /** 402 from the credit primitive is the one failure with a specific remedy. */
  const reportError = (err: unknown, fallback: string) => {
    const code = (err as { code?: string } | null)?.code;
    setNeedsCredits(code === 'MHC_INSUFFICIENT_CREDITS');
    setError(err instanceof Error ? err.message : fallback);
  };

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    setSubmitting(true);
    setError(null);
    setNeedsCredits(false);
    setSuccess(null);
    try {
      const titleAr = form.titleAr.trim();
      const descriptionEn = form.descriptionEn.trim();
      const descriptionAr = form.descriptionAr.trim();
      const ctaTextEn = form.ctaTextEn.trim();
      const ctaTextAr = form.ctaTextAr.trim();
      const linkTarget = form.linkTarget.trim();
      // One key per submit attempt. A retry of this same submit reaches the same
      // campaign instead of creating a second one for an admin to review.
      await advertisementsApiClient.createAd(
        accessToken,
        {
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
        },
        crypto.randomUUID(),
      );
      resetForm();
      setSuccess(
        tr(
          'Ad submitted for review. Nothing has been charged yet.',
          'تم إرسال الإعلان للمراجعة. لم يتم خصم أي رصيد بعد.',
        ),
      );
      await load();
    } catch (err) {
      reportError(err, 'Failed to submit ad.');
    } finally {
      setSubmitting(false);
    }
  };

  /** Buy one more seven-day week. */
  const onRenew = async (adId: string) => {
    if (!accessToken) return;
    setBusyAdId(adId);
    setError(null);
    setNeedsCredits(false);
    setSuccess(null);
    try {
      await advertisementsApiClient.renewAd(accessToken, adId, crypto.randomUUID());
      setSuccess(
        tr('Renewed for another 7 days.', 'تم التجديد لمدة 7 أيام أخرى.'),
      );
      await load();
    } catch (err) {
      reportError(err, 'Failed to renew ad.');
    } finally {
      setBusyAdId(null);
    }
  };

  /** Start an approved campaign that could not be paid for earlier. */
  const onActivate = async (adId: string) => {
    if (!accessToken) return;
    setBusyAdId(adId);
    setError(null);
    setNeedsCredits(false);
    setSuccess(null);
    try {
      await advertisementsApiClient.activateAd(accessToken, adId, crypto.randomUUID());
      setSuccess(tr('Ad is live for 7 days.', 'الإعلان يعمل لمدة 7 أيام.'));
      await load();
    } catch (err) {
      reportError(err, 'Failed to activate ad.');
    } finally {
      setBusyAdId(null);
    }
  };

  const onCancel = async (adId: string) => {
    if (!accessToken) return;
    setBusyAdId(adId);
    setError(null);
    setNeedsCredits(false);
    setSuccess(null);
    try {
      await advertisementsApiClient.cancelAd(accessToken, adId);
      setSuccess(
        tr(
          'Ad cancelled and hidden. The current week is not refunded.',
          'تم إلغاء الإعلان وإخفاؤه. لا يتم رد رصيد الأسبوع الحالي.',
        ),
      );
      await load();
    } catch (err) {
      reportError(err, 'Failed to cancel ad.');
    } finally {
      setBusyAdId(null);
    }
  };

  const previewTitle = isAr
    ? form.titleAr || form.titleEn || tr('Your ad title', 'عنوان إعلانك')
    : form.titleEn || tr('Your ad title', 'عنوان إعلانك');
  const previewDesc = isAr ? form.descriptionAr || form.descriptionEn : form.descriptionEn;
  const previewCta = isAr
    ? form.ctaTextAr || form.ctaTextEn || tr('Open', 'افتح')
    : form.ctaTextEn || tr('Open', 'افتح');
  const resolvedImageUrl = form.imageUrl ? toAbsoluteAssetUrl(form.imageUrl) : null;

  const statusLabel = (s: AdStatus) => {
    const map: Record<AdStatus, string> = {
      pending_review: tr('Pending review', 'قيد المراجعة'),
      scheduled: tr('Approved', 'تمت الموافقة'),
      active: tr('Active', 'نشط'),
      expired: tr('Ended', 'انتهى'),
      rejected: tr('Rejected', 'مرفوض'),
      cancelled: tr('Cancelled', 'ملغى'),
      paused_by_admin: tr('Paused', 'متوقف'),
    };
    return map[s] ?? s;
  };

  const linkTypeLabel = (l: string) => {
    const map: Record<string, string> = {
      profile: tr('My Profile', 'ملفي الشخصي'),
      service: tr('Service Page', 'صفحة الخدمة'),
    };
    return map[l] ?? l;
  };

  const activeAds = rows.filter((r) => r.status === 'active');
  const reviewAds = rows.filter((r) => r.status === 'pending_review' || r.status === 'scheduled');
  const otherAds = rows.filter(
    (r) => r.status !== 'active' && r.status !== 'pending_review' && r.status !== 'scheduled',
  );

  const cardProps = {
    locale,
    statusLabel,
    d,
    tr,
    creditsHref,
    weeklyPrice,
    busyAdId,
    onRenew,
    onActivate,
    onCancel,
  };

  return (
    <main className="myads-main">
      {/* Header */}
      <div className="myads-header">
        <div>
          <h1 className="myads-page-title">{d.myAds ?? 'My Advertisements'}</h1>
          <p className="myads-page-subtitle">
            {tr(
              'Promote your services with slideshow ads visible to customers. Ads are reviewed before they run.',
              'روّج لخدماتك بإعلانات عرض شرائح يراها العملاء. تتم مراجعة الإعلانات قبل نشرها.',
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
          <span>
            {error}
            {needsCredits ? (
              <>
                {' '}
                <Link href={creditsHref} className="myads-credits-link">
                  {tr('Add credits', 'أضف رصيدا')}
                </Link>
              </>
            ) : null}
          </span>
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
      {!adControls.acceptAds && (
        <div className="myads-msg myads-msg--error">
          <span>
            {tr('Ads are currently disabled by admin.', 'الإعلانات متوقفة حاليا من الإدارة.')}
          </span>
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

              <fieldset className="myads-fieldset">
                <legend className="myads-legend">{tr('Campaign timing', 'مدة الحملة')}</legend>
                <p className="myads-price-summary-note">
                  {tr(
                    'Ads run in 7-day weeks. Leave the start empty to begin as soon as an admin approves.',
                    'تعمل الإعلانات بأسابيع من 7 أيام. اترك تاريخ البداية فارغا ليبدأ بعد موافقة الإدارة.',
                  )}
                </p>
                <div className="myads-field">
                  <label className="myads-label">
                    {tr('Start date & time (optional)', 'تاريخ ووقت البداية (اختياري)')}
                  </label>
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
                  <label className="myads-label">{tr('Title (Arabic)', 'العنوان (عربي)')}</label>
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
                    <label className="myads-label">{tr('Description (AR)', 'الوصف (عربي)')}</label>
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
                <legend className="myads-legend">{tr('Banner Image', 'صورة الإعلان')} *</legend>
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
                <legend className="myads-legend">{tr('Call to Action', 'زر الإجراء')}</legend>
                <div className="myads-field-row">
                  <div className="myads-field">
                    <label className="myads-label">
                      {tr('Button text (EN)', 'نص الزر (إنجليزي)')}
                    </label>
                    <input
                      className="dashboard-input"
                      placeholder={tr('e.g. Book now', 'مثلا: احجز الآن')}
                      value={form.ctaTextEn}
                      onChange={(e) => setForm((p) => ({ ...p, ctaTextEn: e.target.value }))}
                      maxLength={120}
                    />
                  </div>
                  <div className="myads-field">
                    <label className="myads-label">
                      {tr('Button text (AR)', 'نص الزر (عربي)')}
                    </label>
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
                  <label className="myads-label">
                    {tr('Where does the ad link to?', 'إلى أين يوجه الإعلان؟')}
                  </label>
                  <select
                    className="dashboard-select"
                    value={form.linkType}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        linkType: e.target.value as 'profile' | 'service',
                      }))
                    }
                  >
                    <option value="profile">{linkTypeLabel('profile')}</option>
                    <option value="service">{linkTypeLabel('service')}</option>
                  </select>
                </div>
                {form.linkType === 'service' && (
                  <div className="myads-field">
                    <label className="myads-label">{tr('Service ID', 'معرف الخدمة')} *</label>
                    <input
                      className="dashboard-input"
                      placeholder={tr('One of your active services', 'إحدى خدماتك النشطة')}
                      value={form.linkTarget}
                      onChange={(e) => setForm((p) => ({ ...p, linkTarget: e.target.value }))}
                      required
                    />
                  </div>
                )}
              </fieldset>

              {/* Price summary — MHC credits per week, never a currency figure. */}
              <div className="myads-price-summary">
                <span className="myads-price-summary-label">
                  {tr('Credits & timeline', 'الرصيد والجدول')}
                </span>
                <span className="myads-price-summary-value">
                  {weeklyPrice > 0 ? formatMhc(weeklyPrice, locale) : tr('Free', 'مجاني')}
                </span>
                <span className="myads-price-summary-note">
                  {tr('MHC per advertisement week', 'نقاط لكل أسبوع إعلاني')}
                </span>
                <span className="myads-price-summary-note">
                  {weeklyPrice > 0
                    ? tr(
                        'Charged from your credits when an admin approves the ad, then again each time you renew',
                        'تُخصم من رصيدك عند موافقة الإدارة على الإعلان، ثم مع كل تجديد',
                      )
                    : tr(
                        'No credits are charged for this advertisement week',
                        'لا يتم خصم أي رصيد لهذا الأسبوع الإعلاني',
                      )}
                </span>
                <span className="myads-price-summary-note">
                  {tr('Submitting is free — nothing is charged for review.', 'الإرسال مجاني — لا يتم خصم أي رصيد للمراجعة.')}
                </span>
                {plannedStartAt ? (
                  <span className="myads-price-summary-note">
                    {tr('Requested start', 'البداية المطلوبة')}:{' '}
                    {plannedStartAt.toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                  </span>
                ) : null}
                {/* Automatic renewal has no implementation yet. The control is
                    present but disabled so the roadmap is visible without
                    promising behaviour that does not exist. */}
                <label className="myads-price-summary-note myads-autorenew">
                  <input type="checkbox" disabled checked={false} readOnly />
                  <span>
                    {tr('Renew automatically every week', 'التجديد التلقائي كل أسبوع')} —{' '}
                    {tr('Coming soon', 'قريبا')}
                  </span>
                </label>
              </div>

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
                  disabled={submitting || !form.imageUrl || !form.titleEn || !adControls.acceptAds}
                >
                  {submitting
                    ? (c.loading ?? 'Loading...')
                    : tr('Submit for review', 'إرسال للمراجعة')}
                </button>
              </div>
            </form>

            {/* Live Preview Column */}
            <div className="myads-preview-card">
              <h3 className="myads-preview-card-title">{tr('Live Preview', 'معاينة مباشرة')}</h3>
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
          {/* Active */}
          {activeAds.length > 0 && (
            <section className="myads-list-section">
              <h2 className="myads-list-title">
                {tr('Active Ads', 'الإعلانات النشطة')} ({activeAds.length})
              </h2>
              <div className="myads-ad-grid">
                {activeAds.map((ad) => (
                  <AdCard key={ad.id} ad={ad} {...cardProps} />
                ))}
              </div>
            </section>
          )}

          {/* Awaiting review or approval */}
          {reviewAds.length > 0 && (
            <section className="myads-list-section">
              <h2 className="myads-list-title">
                {tr('In review & approved', 'قيد المراجعة والموافقة')} ({reviewAds.length})
              </h2>
              <div className="myads-ad-grid">
                {reviewAds.map((ad) => (
                  <AdCard key={ad.id} ad={ad} {...cardProps} />
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
                  <AdCard key={ad.id} ad={ad} {...cardProps} />
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
  d: Record<string, unknown>;
  tr: (en: string, ar: string) => string;
  creditsHref: string;
  weeklyPrice: number;
  busyAdId: string | null;
  onRenew: (adId: string) => Promise<void>;
  onActivate: (adId: string) => Promise<void>;
  onCancel: (adId: string) => Promise<void>;
};

const AdCard = ({
  ad,
  locale,
  statusLabel,
  d,
  tr,
  creditsHref,
  weeklyPrice,
  busyAdId,
  onRenew,
  onActivate,
  onCancel,
}: AdCardProps) => {
  const isAr = locale === 'ar';
  const title = isAr ? ad.title_ar || ad.title_en : ad.title_en;
  const resolvedImg = toAbsoluteAssetUrl(ad.image_url);
  const fmt = (value: string | null) =>
    value ? new Date(value).toLocaleString(isAr ? 'ar-EG' : 'en-US') : null;
  const periodStart = fmt(ad.current_period_starts_at);
  const periodEnd = fmt(ad.current_period_ends_at);
  const busy = busyAdId === ad.id;

  const isWeekly = ad.billing_model === 'weekly';
  const needsRenewal = isWeekly && ad.billing_status === 'renewal_required';
  const awaitingCredits = isWeekly && ad.billing_status === 'awaiting_credits';
  const awaitingStart = isWeekly && ad.billing_status === 'awaiting_start';
  const canCancel = isWeekly && ad.status !== 'cancelled' && ad.status !== 'rejected';

  /** One line that says exactly where the money and the campaign stand. */
  const billingLine = (): string | null => {
    if (!isWeekly) return null;
    switch (ad.billing_status) {
      case 'pending_review':
        return tr(
          'Waiting for admin review. Nothing has been charged.',
          'في انتظار مراجعة الإدارة. لم يتم خصم أي رصيد.',
        );
      case 'awaiting_start':
        return tr(
          'Approved. Your first week is charged when it starts.',
          'تمت الموافقة. يُخصم رصيد أسبوعك الأول عند بدايته.',
        );
      case 'awaiting_credits':
        return tr(
          'Approved, but you did not have enough credits. Add credits and start it.',
          'تمت الموافقة، لكن رصيدك غير كافٍ. أضف رصيدا ثم ابدأ الإعلان.',
        );
      case 'active':
        return tr('Running this week.', 'يعمل هذا الأسبوع.');
      case 'renewal_required':
        return tr(
          'The paid week ended. Renew to run for another 7 days.',
          'انتهى الأسبوع المدفوع. جدّد ليعمل 7 أيام أخرى.',
        );
      case 'rejected':
        return tr('Rejected by an admin. Nothing was charged.', 'مرفوض من الإدارة. لم يتم خصم أي رصيد.');
      case 'cancelled':
        return tr(
          'Cancelled. The last paid week is not refunded.',
          'ملغى. لا يتم رد رصيد الأسبوع المدفوع الأخير.',
        );
      default:
        return null;
    }
  };

  return (
    <article className="myads-ad-card">
      <div className="myads-ad-card-banner" style={{ backgroundImage: `url(${resolvedImg})` }} />
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
              {ad.impressions > 0 ? `${((ad.clicks / ad.impressions) * 100).toFixed(1)}%` : '—'}
            </span>
            <span className="myads-stat-label">CTR</span>
          </div>
          {isWeekly ? (
            <div className="myads-stat">
              <span className="myads-stat-value">{ad.renewal_count}</span>
              <span className="myads-stat-label">{tr('Renewals', 'التجديدات')}</span>
            </div>
          ) : null}
          {/* `amount_paid` is the legacy EGP figure and is 0 for every weekly
              campaign, so it is shown only where it is real history. */}
          {Number.parseFloat(ad.amount_paid ?? '0') > 0 ? (
            <div className="myads-stat">
              <span className="myads-stat-value">{ad.amount_paid}</span>
              <span className="myads-stat-label">{tr('Paid (legacy)', 'المدفوع (سابقًا)')}</span>
            </div>
          ) : null}
        </div>

        {billingLine() ? <p className="myads-ad-card-meta">{billingLine()}</p> : null}

        {ad.status === 'rejected' && ad.rejection_reason ? (
          <p className="myads-ad-card-meta">
            {tr('Reason', 'السبب')}: {ad.rejection_reason}
          </p>
        ) : null}

        {periodStart && periodEnd ? (
          <>
            <p className="myads-ad-card-meta">
              {tr('This week started', 'بدأ هذا الأسبوع')}: {periodStart}
            </p>
            <p className="myads-ad-card-meta">
              {tr('This week ends', 'ينتهي هذا الأسبوع')}: {periodEnd}
            </p>
          </>
        ) : null}

        {awaitingStart && ad.starts_at ? (
          <p className="myads-ad-card-meta">
            {tr('Scheduled to start', 'موعد البداية')}:{' '}
            {new Date(ad.starts_at).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
          </p>
        ) : null}

        {isWeekly && (needsRenewal || awaitingCredits) ? (
          <p className="myads-ad-card-meta">
            {tr('Cost', 'التكلفة')}:{' '}
            {weeklyPrice > 0 ? formatMhc(weeklyPrice, locale) : tr('Free', 'مجاني')}{' '}
            {tr('per advertisement week', 'لكل أسبوع إعلاني')}
          </p>
        ) : null}

        {awaitingCredits ? (
          <p className="myads-ad-card-meta">
            <Link href={creditsHref} className="myads-credits-link">
              {tr('Add credits', 'أضف رصيدا')}
            </Link>
          </p>
        ) : null}

        {(needsRenewal || awaitingCredits || canCancel) && (
          <div className="myads-form-actions">
            {needsRenewal ? (
              <button
                type="button"
                className="dashboard-btn dashboard-btn--primary"
                disabled={busy}
                onClick={() => void onRenew(ad.id)}
              >
                {tr('Renew 7 days', 'تجديد 7 أيام')}
              </button>
            ) : null}
            {awaitingCredits ? (
              <button
                type="button"
                className="dashboard-btn dashboard-btn--primary"
                disabled={busy}
                onClick={() => void onActivate(ad.id)}
              >
                {tr('Start now', 'ابدأ الآن')}
              </button>
            ) : null}
            {canCancel ? (
              <button
                type="button"
                className="plan-modal-cancel"
                disabled={busy}
                onClick={() => void onCancel(ad.id)}
              >
                {tr('Cancel ad', 'إلغاء الإعلان')}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
};
