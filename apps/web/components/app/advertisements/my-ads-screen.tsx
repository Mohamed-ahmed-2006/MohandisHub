'use client';

import type { Service } from '@mohandishub/shared';
import Image from 'next/image';
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
import { servicesApiClient } from '@/lib/services/client';
import { uploadFile } from '@/lib/upload/client';

import '@/app/my-ads.css';

type Props = { locale: Locale; dictionary: Dictionary };

const STATUS_COLORS: Record<AdStatus, string> = {
  pending_review: 'dashboard-badge--pending',
  scheduled: 'dashboard-badge--pending',
  active: 'dashboard-badge--accepted',
  paused_by_admin: 'dashboard-badge--pending',
  rejected: 'dashboard-badge--rejected',
  expired: 'dashboard-badge--completed',
  cancelled: 'dashboard-badge--rejected',
};

const EMPTY_FORM = {
  durationDays: '7',
  startsAt: '',
  titleEn: '',
  titleAr: '',
  descriptionEn: '',
  descriptionAr: '',
  imageUrl: '',
  bannerUploadId: '',
  ctaTextEn: '',
  ctaTextAr: '',
  linkType: 'profile' as 'profile' | 'service',
  linkTarget: '',
};

export const MyAdsScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { accessToken, authUser, isAuthenticated, isReady, authGuard } = useAuth();
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [controls, setControls] = useState<AdminAdControls>({
    acceptAds: false,
    pricePerDay: 0,
  });
  const [quote, setQuote] = useState<{ totalEgp: number; dailyPriceEgp: number } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const isAr = locale === 'ar';
  const tr = useCallback((en: string, ar: string) => (isAr ? ar : en), [isAr]);
  const d = dictionary.advertisements ?? {};
  const canUse = ['expert', 'business', 'craftsman'].includes(authUser?.role ?? '');

  const durationDays = useMemo(() => {
    if (!/^[1-9]\d*$/.test(form.durationDays)) return 1;
    return Math.min(365, Number(form.durationDays));
  }, [form.durationDays]);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [ads, adControls, ownedServices] = await Promise.all([
        advertisementsApiClient.getMyAds(accessToken, { limit: 50 }),
        advertisementsApiClient.getAdControls(accessToken),
        servicesApiClient.listMyServices(accessToken, 1, 100),
      ]);
      setRows(ads.rows);
      setControls(adControls);
      setServices(ownedServices.items.filter((service) => service.status === 'active'));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : tr('Could not load advertisements.', 'تعذر تحميل الإعلانات.'),
      );
    } finally {
      setLoading(false);
    }
  }, [accessToken, tr]);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
    } else if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [authGuard.emailVerified, authUser, isAuthenticated, isReady, locale, router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!accessToken || !controls.acceptAds) {
      setQuote(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void advertisementsApiClient
        .getQuote(accessToken, durationDays)
        .then((value) => {
          if (active) setQuote(value);
        })
        .catch((quoteError: unknown) => {
          if (active) {
            setQuote(null);
            setError(
              quoteError instanceof Error
                ? quoteError.message
                : tr('Could not calculate the quote.', 'تعذر حساب عرض السعر.'),
            );
          }
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [accessToken, controls.acceptAds, durationDays, tr]);

  if (!isReady || !isAuthenticated || !authUser || !authGuard.emailVerified) {
    return <main className="myads-main" />;
  }
  if (!canUse) {
    return (
      <main className="myads-main">
        <p className="home-empty">
          {d.notProvider ??
            tr(
              'Only providers can create advertisements.',
              'يمكن لمقدمي الخدمات فقط إنشاء إعلانات.',
            )}
        </p>
      </main>
    );
  }

  const uploadBanner = async (file: File) => {
    if (!accessToken) return;
    setUploading(true);
    setError(null);
    try {
      const uploaded = await uploadFile(accessToken, file);
      setForm((current) => ({
        ...current,
        imageUrl: uploaded.url,
        bannerUploadId: uploaded.uploadId,
      }));
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : tr('Failed to upload the banner.', 'فشل رفع صورة الإعلان.'),
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !quote) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await advertisementsApiClient.createAd(accessToken, {
        durationDays,
        ...(form.startsAt ? { startsAt: new Date(form.startsAt).toISOString() } : {}),
        titleEn: form.titleEn.trim(),
        ...(form.titleAr.trim() ? { titleAr: form.titleAr.trim() } : {}),
        ...(form.descriptionEn.trim() ? { descriptionEn: form.descriptionEn.trim() } : {}),
        ...(form.descriptionAr.trim() ? { descriptionAr: form.descriptionAr.trim() } : {}),
        imageUrl: form.imageUrl,
        bannerUploadId: form.bannerUploadId,
        ...(form.ctaTextEn.trim() ? { ctaTextEn: form.ctaTextEn.trim() } : {}),
        ...(form.ctaTextAr.trim() ? { ctaTextAr: form.ctaTextAr.trim() } : {}),
        linkType: form.linkType,
        ...(form.linkType === 'service' ? { linkTarget: form.linkTarget } : {}),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      setSuccess(
        tr(
          'Campaign submitted for review. Its wallet amount is on hold until approval.',
          'تم إرسال الحملة للمراجعة، والمبلغ محجوز في المحفظة حتى الموافقة.',
        ),
      );
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : tr('Could not submit the campaign.', 'تعذر إرسال الحملة.'),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (ad: Advertisement) => {
    if (
      !accessToken ||
      !window.confirm(
        tr(
          'Cancel this campaign? Any eligible unused time will be refunded.',
          'هل تريد إلغاء هذه الحملة؟ سيُرد مبلغ الوقت غير المستخدم المستحق.',
        ),
      )
    ) {
      return;
    }
    setError(null);
    try {
      const result = await advertisementsApiClient.cancelAd(accessToken, ad.id);
      setSuccess(
        tr(
          `Campaign cancelled. Refund: ${result.refundAmount.toFixed(2)} EGP.`,
          `تم إلغاء الحملة. المبلغ المسترد: ${result.refundAmount.toFixed(2)} ج.م.`,
        ),
      );
      await load();
    } catch (cancelError) {
      setError(
        cancelError instanceof Error
          ? cancelError.message
          : tr('Could not cancel the campaign.', 'تعذر إلغاء الحملة.'),
      );
    }
  };

  const statusLabel = (status: AdStatus) =>
    ({
      pending_review: tr('Pending review', 'قيد المراجعة'),
      scheduled: tr('Scheduled', 'مجدول'),
      active: tr('Active', 'نشط'),
      paused_by_admin: tr('Paused by admin', 'موقوف من الإدارة'),
      rejected: tr('Rejected', 'مرفوض'),
      expired: tr('Expired', 'منتهي'),
      cancelled: tr('Cancelled', 'ملغي'),
    })[status];

  const image = form.imageUrl ? toAbsoluteAssetUrl(form.imageUrl) : null;
  const previewTitle = isAr
    ? form.titleAr || form.titleEn || 'عنوان إعلانك'
    : form.titleEn || 'Your advertisement title';

  return (
    <main className="myads-main" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="myads-header">
        <div>
          <h1 className="myads-page-title">{d.myAds ?? tr('My Advertisements', 'إعلاناتي')}</h1>
          <p className="myads-page-subtitle">
            {tr(
              'Promote your provider profile or one of your active services.',
              'روّج لملف مقدم الخدمة أو لإحدى خدماتك النشطة.',
            )}
          </p>
        </div>
        {!showForm && controls.acceptAds ? (
          <button
            type="button"
            className="dashboard-btn dashboard-btn--primary"
            onClick={() => setShowForm(true)}
          >
            {tr('Create campaign', 'إنشاء حملة')}
          </button>
        ) : null}
      </div>

      {error ? <div className="myads-msg myads-msg--error">{error}</div> : null}
      {success ? <div className="myads-msg myads-msg--success">{success}</div> : null}
      {!controls.acceptAds ? (
        <div className="myads-msg myads-msg--error">
          {tr(
            'New advertising campaigns are currently disabled.',
            'إنشاء حملات إعلانية جديدة متوقف حاليًا.',
          )}
        </div>
      ) : null}

      {showForm ? (
        <section className="myads-create-section">
          <div className="myads-create-grid">
            <form className="myads-form-card" onSubmit={(event) => void submit(event)}>
              <h2 className="myads-form-card-title">{tr('New campaign', 'حملة جديدة')}</h2>
              <label className="myads-label">
                {tr('Duration (days)', 'المدة بالأيام')}
                <input
                  className="dashboard-input"
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={form.durationDays}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, durationDays: event.target.value }))
                  }
                />
              </label>
              <label className="myads-label">
                {tr('Start date and time', 'تاريخ ووقت البدء')}
                <input
                  className="dashboard-input"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, startsAt: event.target.value }))
                  }
                />
              </label>
              <label className="myads-label">
                {tr('English title', 'العنوان بالإنجليزية')}
                <input
                  className="dashboard-input"
                  required
                  minLength={3}
                  maxLength={180}
                  value={form.titleEn}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, titleEn: event.target.value }))
                  }
                />
              </label>
              <label className="myads-label">
                {tr('Arabic title', 'العنوان بالعربية')}
                <input
                  className="dashboard-input"
                  dir="rtl"
                  maxLength={180}
                  value={form.titleAr}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, titleAr: event.target.value }))
                  }
                />
              </label>
              <div className="myads-field-row">
                <label className="myads-label">
                  {tr('English description', 'الوصف بالإنجليزية')}
                  <textarea
                    className="dashboard-textarea"
                    maxLength={800}
                    value={form.descriptionEn}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, descriptionEn: event.target.value }))
                    }
                  />
                </label>
                <label className="myads-label">
                  {tr('Arabic description', 'الوصف بالعربية')}
                  <textarea
                    className="dashboard-textarea"
                    dir="rtl"
                    maxLength={800}
                    value={form.descriptionAr}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, descriptionAr: event.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="myads-label">
                {tr('Destination', 'الوجهة')}
                <select
                  className="dashboard-select"
                  value={form.linkType}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      linkType: event.target.value as 'profile' | 'service',
                      linkTarget: '',
                    }))
                  }
                >
                  <option value="profile">{tr('My provider profile', 'ملف مقدم الخدمة')}</option>
                  <option value="service">
                    {tr('One of my active services', 'إحدى خدماتي النشطة')}
                  </option>
                </select>
              </label>
              {form.linkType === 'service' ? (
                <label className="myads-label">
                  {tr('Active service', 'الخدمة النشطة')}
                  <select
                    className="dashboard-select"
                    required
                    value={form.linkTarget}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, linkTarget: event.target.value }))
                    }
                  >
                    <option value="">{tr('Choose a service', 'اختر خدمة')}</option>
                    {services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="myads-label">
                {tr('Banner image (JPEG, PNG, or WebP)', 'صورة الإعلان (JPEG أو PNG أو WebP)')}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  required={!form.bannerUploadId}
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void uploadBanner(file);
                  }}
                />
              </label>
              {image ? (
                <Image
                  className="myads-upload-preview"
                  src={image}
                  alt={tr('Banner preview', 'معاينة الإعلان')}
                  width={1200}
                  height={400}
                  unoptimized
                />
              ) : null}
              <div className="myads-price-summary">
                <strong>{tr('Server quote', 'عرض السعر من الخادم')}</strong>
                <span>
                  {quote
                    ? `${quote.totalEgp.toFixed(2)} EGP (${quote.dailyPriceEgp.toFixed(2)} × ${durationDays})`
                    : tr('Calculating…', 'جارٍ الحساب…')}
                </span>
                <small>
                  {tr(
                    'The amount is held on submission and captured only after approval.',
                    'يُحجز المبلغ عند الإرسال ولا يُحصّل إلا بعد الموافقة.',
                  )}
                </small>
              </div>
              <div className="myads-form-actions">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => setShowForm(false)}
                >
                  {tr('Cancel', 'إلغاء')}
                </button>
                <button
                  type="submit"
                  className="dashboard-btn dashboard-btn--primary"
                  disabled={
                    submitting ||
                    uploading ||
                    !quote ||
                    !form.bannerUploadId ||
                    (form.linkType === 'service' && !form.linkTarget)
                  }
                >
                  {submitting
                    ? tr('Submitting…', 'جارٍ الإرسال…')
                    : tr('Submit for review', 'إرسال للمراجعة')}
                </button>
              </div>
            </form>
            <aside className="myads-preview-card">
              <h3>{tr('Preview', 'المعاينة')}</h3>
              <div
                className="ad-slideshow-banner"
                style={{
                  backgroundImage: image
                    ? `url(${image})`
                    : 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--border)))',
                }}
              >
                <div className="ad-slideshow-overlay">
                  <p className="ad-slideshow-badge">{tr('Sponsored', 'إعلان ممول')}</p>
                  <h2 className="ad-slideshow-title">{previewTitle}</h2>
                </div>
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      {loading ? <p className="home-empty">{tr('Loading…', 'جارٍ التحميل…')}</p> : null}
      {!loading && rows.length === 0 ? (
        <div className="myads-empty">
          <SiteLogo className="myads-empty-brand" />
          <h2>{tr('No campaigns yet', 'لا توجد حملات بعد')}</h2>
        </div>
      ) : null}
      <div className="myads-ad-grid">
        {rows.map((ad) => {
          const title = isAr ? ad.title_ar || ad.title_en : ad.title_en;
          const cancellable = ['pending_review', 'scheduled', 'active', 'paused_by_admin'].includes(
            ad.status,
          );
          return (
            <article className="myads-ad-card" key={ad.id}>
              <div
                className="myads-ad-card-banner"
                style={{ backgroundImage: `url(${toAbsoluteAssetUrl(ad.image_url)})` }}
              />
              <div className="myads-ad-card-body">
                <div className="myads-ad-card-head">
                  <h3>{title}</h3>
                  <span className={`dashboard-badge ${STATUS_COLORS[ad.status]}`}>
                    {statusLabel(ad.status)}
                  </span>
                </div>
                <p>
                  {tr('Impressions', 'مرات الظهور')}: {ad.impressions} · {tr('Clicks', 'النقرات')}:{' '}
                  {ad.clicks}
                </p>
                {ad.rejection_reason ? (
                  <p className="myads-msg myads-msg--error">
                    {tr('Reason', 'السبب')}: {ad.rejection_reason}
                  </p>
                ) : null}
                {cancellable ? (
                  <button
                    type="button"
                    className="plan-modal-cancel"
                    onClick={() => void cancel(ad)}
                  >
                    {tr('Cancel campaign', 'إلغاء الحملة')}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
};
