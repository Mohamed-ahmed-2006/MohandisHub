'use client';

import type { PlanUsageSummary, ServiceCategory } from '@mohandishub/shared';
import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useToast } from '@/components/app/toast';
import { useAppStatus } from '@/components/app-status-provider';
import { resolvePublicAssetUrl, toAbsoluteAssetUrl } from '@/lib/asset-url';
import { getApiBaseUrl } from '@/lib/env';
import { pickLocalized } from '@/lib/i18n/api';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import type { Bid, BidMessage, Need } from '@/lib/needs/client';
import { needsApiClient } from '@/lib/needs/client';
import { plansApiClient } from '@/lib/plans/client';
import { uploadFile } from '@/lib/upload/client';
import { walletApiClient } from '@/lib/wallet/client';

type Props = {
  locale: Locale;
  dictionary: Dictionary;
  accessToken: string;
  categories: ServiceCategory[];
  showEmptyState?: boolean;
  onNeedsCountChange?: (count: number) => void;
  cities?: string[];
  authReady?: boolean;
};

export const CustomerDashboard = ({
  locale,
  dictionary,
  accessToken,
  categories,
  showEmptyState = true,
  onNeedsCountChange,
  authReady = true,
  cities = [
    'Cairo',
    'Alexandria',
    'Giza',
    'Luxor',
    'Aswan',
    'Hurghada',
    'Sharm El Sheikh',
    '6th of October',
    'New Cairo',
    'Port Said',
    'Suez',
    'Mansoura',
    'Tanta',
    'Ismailia',
    'Fayyum',
    'Zagazig',
    'Damietta',
    'Minya',
    'Beni Suef',
    'Qena',
    'Sohag',
    'Online',
    'Remote',
  ],
}: Props) => {
  const [myNeeds, setMyNeeds] = useState<Need[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | null>(null);
  const [selectedNeed, setSelectedNeed] = useState<Need | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [loadingBids, setLoadingBids] = useState(false);
  const [chatBidId, setChatBidId] = useState<string | null>(null);
  const [messages, setMessages] = useState<BidMessage[]>([]);
  const [msgContent, setMsgContent] = useState('');
  const [bidChatAttachmentUrl, setBidChatAttachmentUrl] = useState<string | null>(null);
  const [bidChatUploading, setBidChatUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ url: string; displayName: string; isVideo: boolean }>
  >([]);
  const [uploading, setUploading] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; urls: string[] } | null>(null);
  const [markingCompleted, setMarkingCompleted] = useState<string | null>(null);
  const { addToast } = useToast();
  const { status } = useAppStatus();
  const needsFeatureEnabled = status?.featureNeedsEnabled !== false;
  const plansFeatureEnabled = status?.featurePlansEnabled !== false;
  const hourlyPricingEnabled = status?.featureHourlyPricingEnabled === true;
  const [planUsage, setPlanUsage] = useState<PlanUsageSummary | null>(null);

  const isVideoFile = (file: File) => file.type.startsWith('video/');
  const maxImages = 5;
  const maxVideos = 1;

  const d = (dictionary.needs ?? {}) as Record<string, string>;
  const planDict = (dictionary.plan ?? {}) as Record<string, string>;
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const needStatusLabels: Record<string, string> = {
    open: d.needStatusOpen ?? 'Open',
    awarded: d.needStatusAwarded ?? 'Awarded',
    in_progress: d.needStatusInProgress ?? 'In progress',
    completed: d.needStatusCompleted ?? 'Completed',
    cancelled: d.needStatusCancelled ?? 'Cancelled',
  };
  const categoryName = (cat: ServiceCategory) => (locale === 'ar' ? cat.nameAr : cat.nameEn);

  const getNeedMediaUrls = (referenceUrl: string | null | undefined): string[] => {
    if (!referenceUrl || !referenceUrl.trim()) return [];
    const t = referenceUrl.trim();
    if (t.startsWith('[')) {
      try {
        const arr = JSON.parse(t) as unknown;
        return Array.isArray(arr) ? arr.filter((u): u is string => typeof u === 'string') : [];
      } catch {
        return [t];
      }
    }
    return [t];
  };

  const fieldLabel: Record<string, string> = {
    title: d.titlePlaceholder ?? tr('Title', 'العنوان'),
    description: d.descPlaceholder ?? tr('Description', 'الوصف'),
    categoryId: d.anyCategory ?? tr('Category', 'الفئة'),
    budgetType: d.budgetType ?? tr('Budget type', 'نوع الميزانية'),
    budgetAmount: d.budgetPlaceholder ?? tr('Budget amount', 'مبلغ الميزانية'),
    timelineDays: d.timelinePlaceholder ?? tr('Timeline (days)', 'المدة (أيام)'),
    city: d.locationType ?? tr('Location', 'الموقع'),
    referenceUrl: d.linkOrScreenshotPlaceholder ?? tr('Link', 'الرابط'),
    referenceUrls: dictionary.common.upload ?? tr('Uploads', 'المرفقات'),
  };

  const loadNeeds = useCallback(async () => {
    if (!authReady || !accessToken) return;
    setLoading(true);
    try {
      const data = await needsApiClient.listMyNeeds(accessToken);
      setMyNeeds(data.rows);
      onNeedsCountChange?.(data.rows.length);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [accessToken, authReady, onNeedsCountChange]);

  const loadPlanUsage = useCallback(async () => {
    if (!authReady || !accessToken || !plansFeatureEnabled) {
      setPlanUsage(null);
      return;
    }
    try {
      const u = await plansApiClient.getMyUsage(accessToken);
      setPlanUsage(u);
    } catch {
      setPlanUsage(null);
    }
  }, [accessToken, authReady, plansFeatureEnabled]);

  const markNeedCompleted = useCallback(
    async (needId: string) => {
      if (!accessToken) return;
      setMarkingCompleted(needId);
      try {
        await needsApiClient.updateNeed(accessToken, needId, { status: 'completed' });
        await loadNeeds();
        void loadPlanUsage();
      } catch {
        /* ignore */
      } finally {
        setMarkingCompleted(null);
      }
    },
    [accessToken, loadNeeds, loadPlanUsage],
  );

  useEffect(() => {
    if (!authReady) return;
    void loadNeeds();
  }, [authReady, loadNeeds]);

  useEffect(() => {
    void loadPlanUsage();
  }, [loadPlanUsage]);

  useEffect(() => {
    const handler = () => {
      setShowForm(true);
    };
    window.addEventListener('customer-dashboard-post-need', handler);
    return () => window.removeEventListener('customer-dashboard-post-need', handler);
  }, []);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setFieldErrors(null);
    const form = e.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value.trim();
    const description = (
      form.elements.namedItem('description') as HTMLTextAreaElement
    ).value.trim();
    const budgetType = hourlyPricingEnabled
      ? ((form.elements.namedItem('budgetType') as HTMLSelectElement).value as 'fixed' | 'hourly')
      : 'fixed';
    const budgetAmountRaw = parseFloat(
      (form.elements.namedItem('budgetAmount') as HTMLInputElement).value,
    );
    const budgetAmount =
      Number.isFinite(budgetAmountRaw) && budgetAmountRaw >= 1 ? budgetAmountRaw : 0;
    const categoryIdVal = (form.elements.namedItem('categoryId') as HTMLSelectElement).value.trim();
    const locationVal = (form.elements.namedItem('location') as HTMLSelectElement).value.trim();
    const countryVal = (form.elements.namedItem('country') as HTMLInputElement).value.trim();
    const referenceUrlVal = (
      form.elements.namedItem('referenceUrl') as HTMLInputElement
    ).value.trim();
    const pastedLinkUrl =
      referenceUrlVal && /^https?:\/\//i.test(referenceUrlVal) ? referenceUrlVal : '';
    const timelineDaysValue = (
      form.elements.namedItem('timelineDays') as HTMLInputElement
    ).value.trim();
    const timelineDaysRaw = timelineDaysValue ? Number.parseInt(timelineDaysValue, 10) : NaN;
    const timelineDays =
      Number.isInteger(timelineDaysRaw) && timelineDaysRaw >= 1 && timelineDaysRaw <= 365
        ? timelineDaysRaw
        : undefined;

    if (title.length < 3) {
      setError(tr('Please enter a title with at least 3 characters.', 'يرجى إدخال عنوان لا يقل عن 3 أحرف.'));
      setSaving(false);
      return;
    }

    if (description.length < 10) {
      setError(
        tr('Please enter a description with at least 10 characters.', 'يرجى إدخال وصف لا يقل عن 10 أحرف.'),
      );
      setSaving(false);
      return;
    }

    if (budgetAmount < 1) {
      setError(
        d.budgetPlaceholder ??
          tr(
            'Please enter a valid budget amount (at least 1).',
            'يرجى إدخال مبلغ ميزانية صحيح (1 على الأقل).',
          ),
      );
      setSaving(false);
      return;
    }

    if (timelineDaysValue && timelineDays == null) {
      setError(tr('Please enter a timeline between 1 and 365 days.', 'يرجى إدخال مدة بين 1 و 365 يومًا.'));
      setSaving(false);
      return;
    }

    const data: Parameters<typeof needsApiClient.createNeed>[1] = {
      title,
      description,
      budgetType,
      budgetAmount,
      currency: 'EGP',
    };
    if (
      categoryIdVal &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryIdVal)
    ) {
      data.categoryId = categoryIdVal;
    }
    if (timelineDays != null) data.timelineDays = timelineDays;
    if (locationVal) data.city = locationVal;
    if (countryVal) data.country = countryVal;
    if (uploadedFiles.length > 0) {
      const refUrls = uploadedFiles
        .map((f) => toAbsoluteAssetUrl(f.url))
        .filter((u) => /^https?:\/\//i.test(u));
      if (refUrls.length > 0) data.referenceUrls = refUrls;
    } else if (pastedLinkUrl && /^https?:\/\//i.test(pastedLinkUrl)) {
      data.referenceUrl = pastedLinkUrl;
    }

    try {
      await needsApiClient.createNeed(accessToken, data);
      setShowForm(false);
      setUploadedFiles([]);
      setError(null);
      setFieldErrors(null);
      addToast(dictionary.common.success ?? 'Success', d.needCreated ?? 'Need created. Experts can now submit bids.');
      void loadNeeds();
      void loadPlanUsage();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed';
      const details =
        err && typeof err === 'object' && 'details' in err
          ? (err as { details: unknown }).details
          : null;
      setError(message);
      if (details && typeof details === 'object' && details !== null && !Array.isArray(details)) {
        const record = details as Record<string, unknown>;
        const entries: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(record)) {
          if (Array.isArray(value) && value.every((s) => typeof s === 'string'))
            entries[key] = [...value];
          else if (typeof value === 'string') entries[key] = [value];
        }
        setFieldErrors(Object.keys(entries).length ? entries : null);
      } else {
        setFieldErrors(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const viewBids = async (need: Need) => {
    setSelectedNeed(need);
    setChatBidId(null);
    setLoadingBids(true);
    try {
      const b = await needsApiClient.listBidsForNeed(accessToken, need.id);
      setBids(b);
    } catch {
      setBids([]);
    } finally {
      setLoadingBids(false);
    }
  };

  const openChat = async (bidId: string) => {
    setChatBidId(bidId);
    setBidChatAttachmentUrl(null);
    try {
      if (!selectedNeed) return;
      const msgs = await needsApiClient.listBidMessages(accessToken, selectedNeed.id, bidId);
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  };

  const sendMsg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNeed || !chatBidId) return;
    const text = msgContent.trim();
    const attach = bidChatAttachmentUrl?.trim() ?? '';
    if (!text && !attach) return;
    try {
      await needsApiClient.createBidMessage(accessToken, selectedNeed.id, chatBidId, {
        content: text,
        ...(attach ? { attachmentUrl: attach } : {}),
      });
      setMsgContent('');
      setBidChatAttachmentUrl(null);
      void openChat(chatBidId);
    } catch {
      // ignore
    }
  };

  const handleAward = async (bidId: string) => {
    if (!selectedNeed) return;
    try {
      await needsApiClient.awardBid(accessToken, selectedNeed.id, bidId);
      setSelectedNeed(null);
      void loadNeeds();
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to award bid');
    }
  };

  const handlePay = async (bidId: string, amountRaw: string) => {
    if (!selectedNeed) return;
    try {
      const amount = parseFloat(amountRaw);
      const wallet = await walletApiClient.getMyWallet(accessToken);
      if (wallet.balance < amount) {
        addToast('Insufficient balance', 'Please deposit funds first.');
        return;
      }
      await needsApiClient.payBid(accessToken, selectedNeed.id, bidId);
      setSelectedNeed(null);
      void loadNeeds();
      addToast('Success', 'Payment completed.');
    } catch (err: unknown) {
      addToast('Error', err instanceof Error ? err.message : 'Failed to pay bid');
    }
  };

  return (
    <section className="dashboard-section" ref={sectionRef}>
      <div className="dashboard-section-header">
        <h2 className="dashboard-section-title">{d.myNeeds ?? 'My Needs'}</h2>
        <button
          type="button"
          className="dashboard-primary-btn"
          onClick={() => setShowForm(true)}
          disabled={!needsFeatureEnabled}
          title={!needsFeatureEnabled ? 'Needs feature is disabled by admin' : undefined}
        >
          {d.postNeed ?? 'Post a Need'}
        </button>
      </div>
      {plansFeatureEnabled &&
        planUsage?.plansFeatureEnabled &&
        planUsage.customer &&
        (() => {
          const c = planUsage.customer;
          const line =
            c.maxNeeds != null && c.remainingNeeds != null
              ? (planDict.usageNeeds ?? '')
                  .replace('{used}', String(c.activeNeedsCount))
                  .replace('{max}', String(c.maxNeeds))
                  .replace('{remaining}', String(c.remainingNeeds))
              : (planDict.usageNeedsUnlimited ?? '').replace('{used}', String(c.activeNeedsCount));
          return (
            <div className="dashboard-plan-usage" role="status">
              <p>{planDict.usageTitle ?? 'Your plan usage'}</p>
              <p>{line}</p>
              <p>{planDict.usageConcurrentNote ?? ''}</p>
            </div>
          );
        })()}
      {!needsFeatureEnabled && (
        <p className="dashboard-empty" role="status">
          Needs are currently disabled by admin.
        </p>
      )}

      {showForm && needsFeatureEnabled && (
        <div className="plan-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="plan-modal plan-modal--post-need" onClick={(e) => e.stopPropagation()}>
            <div className="dashboard-need-modal-head">
              <h3 className="plan-modal-title">{d.postNeed ?? 'Post a Need'}</h3>
              <p className="dashboard-need-modal-subtitle">
                {tr(
                  'Share scope, budget, and references so experts can bid accurately.',
                  'شارك النطاق والميزانية والمراجع ليتمكن الخبراء من تقديم عروض دقيقة.',
                )}
              </p>
            </div>
            <form
              className="dashboard-form dashboard-form--modal dashboard-need-form"
              onSubmit={(e) => void handleCreate(e)}
            >
              {error && (
                <div className="dashboard-error-block" role="alert">
                  <p className="dashboard-error-title">{error}</p>
                  {fieldErrors && Object.keys(fieldErrors).length > 0 && (
                    <ul className="dashboard-error-list">
                      {Object.entries(fieldErrors).map(([field, messages]) => (
                        <li key={field}>
                          <strong>{fieldLabel[field] ?? field}:</strong> {messages[0] ?? ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="dashboard-need-main">
                <section className="dashboard-need-card">
                  <h4 className="dashboard-need-card-title">{tr('Need details', 'تفاصيل الحاجة')}</h4>
                  <div className="dashboard-form-grid">
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <label className="dashboard-form-label">
                          {d.titlePlaceholder ?? 'Title'}
                        </label>
                        <input
                          name="title"
                          className="dashboard-input"
                          placeholder={d.titlePlaceholder ?? 'Title'}
                          minLength={3}
                          required
                        />
                      </div>
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <label className="dashboard-form-label">
                          {d.descPlaceholder ?? 'Describe what you need...'}
                        </label>
                        <textarea
                          name="description"
                          className="dashboard-textarea dashboard-textarea--tall"
                          placeholder={d.descPlaceholder ?? 'Describe what you need...'}
                          minLength={10}
                          required
                        />
                      </div>
                      <div className="dashboard-form-field">
                        <label className="dashboard-form-label">
                          {d.anyCategory ?? 'Category'}
                        </label>
                        <select
                          name="categoryId"
                          className="dashboard-select dashboard-select--modal"
                        >
                          <option value="">{d.anyCategory ?? 'Category (optional)'}</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {categoryName(c)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="dashboard-form-field">
                        <label className="dashboard-form-label">
                          {d.locationType ?? tr('Location', 'الموقع')}
                        </label>
                        <select
                          name="location"
                          className="dashboard-select dashboard-select--modal"
                        >
                          <option value="">{d.chooseLocation ?? tr('Choose...', 'اختر...')}</option>
                          <option value="Online">{d.locationOnlineRemote ?? tr('Online / Remote', 'أونلاين / عن بعد')}</option>
                          {cities
                            .filter((c) => c !== 'Online' && c !== 'Remote')
                            .map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <label className="dashboard-form-label">{tr('Country', 'الدولة')}</label>
                        <input
                          name="country"
                          className="dashboard-input"
                          placeholder={tr('Country (optional)', 'الدولة (اختياري)')}
                          defaultValue=""
                        />
                      </div>
                      {hourlyPricingEnabled ? (
                        <div className="dashboard-form-field">
                          <label className="dashboard-form-label">
                            {d.budgetType ?? tr('Budget type', 'نوع الميزانية')}
                          </label>
                          <select
                            name="budgetType"
                            className="dashboard-select dashboard-select--modal"
                            required
                          >
                            <option value="fixed">{d.fixed ?? 'Fixed'}</option>
                            <option value="hourly">{d.hourly ?? 'Hourly'}</option>
                          </select>
                        </div>
                      ) : (
                        <input type="hidden" name="budgetType" value="fixed" />
                      )}
                      <div className="dashboard-form-field">
                        <label className="dashboard-form-label">
                          {d.budgetPlaceholder ?? 'Budget amount'}
                        </label>
                        <input
                          name="budgetAmount"
                          type="number"
                          min="1"
                          step="0.01"
                          className="dashboard-input"
                          placeholder={d.budgetPlaceholder ?? 'Budget amount'}
                          required
                        />
                      </div>
                      <div className="dashboard-form-field">
                        <label className="dashboard-form-label">
                          {d.timelinePlaceholder ?? 'Timeline (days)'}
                        </label>
                        <input
                          name="timelineDays"
                          type="number"
                          min="1"
                          max="365"
                          className="dashboard-input"
                          placeholder={d.timelinePlaceholder ?? 'Timeline (days)'}
                        />
                      </div>
                      <div className="dashboard-form-field dashboard-form-field--full">
                        <label className="dashboard-form-label">
                          {dictionary.common.upload} /{' '}
                          {d.linkOrScreenshotPlaceholder ?? 'Link (optional)'}
                        </label>
                        <p className="dashboard-form-hint dashboard-form-hint--spaced">
                          {tr(
                            'Up to 5 images or 1 video. You can remove any from the list below.',
                            'حتى 5 صور أو فيديو واحد. يمكنك إزالة أي ملف من القائمة أدناه.',
                          )}
                        </p>
                        <div className="dashboard-form-upload-row">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm"
                            className="dashboard-input dashboard-input--file"
                            onChange={(e) => {
                              void (async () => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const fileIsVideo = isVideoFile(file);
                              const hasVideo = uploadedFiles.some((f) => f.isVideo);
                              if (fileIsVideo && uploadedFiles.length > 0) {
                                setError(
                                  tr(
                                    'Remove existing files first. Only 1 video or up to 5 images allowed.',
                                    'احذف الملفات الحالية أولاً. مسموح فيديو واحد فقط أو حتى 5 صور.',
                                  ),
                                );
                                e.target.value = '';
                                return;
                              }
                              if (fileIsVideo && uploadedFiles.length >= maxVideos) {
                                setError(tr('Only 1 video allowed.', 'مسموح فيديو واحد فقط.'));
                                e.target.value = '';
                                return;
                              }
                              if (!fileIsVideo && hasVideo) {
                                setError(
                                  tr(
                                    'Only 1 video allowed. Remove the video to add images.',
                                    'مسموح فيديو واحد فقط. احذف الفيديو لإضافة صور.',
                                  ),
                                );
                                e.target.value = '';
                                return;
                              }
                              if (!fileIsVideo && uploadedFiles.length >= maxImages) {
                                setError(
                                  tr(`Maximum ${maxImages} images.`, `الحد الأقصى ${maxImages} صور.`),
                                );
                                e.target.value = '';
                                return;
                              }
                              setUploading(true);
                              setError(null);
                              try {
                                const { url, originalName } = await uploadFile(accessToken, file);
                                const base = (getApiBaseUrl() || '').replace(/\/$/, '');
                                const fullUrl = url.startsWith('http')
                                  ? url
                                  : base
                                    ? `${base}${url.startsWith('/') ? '' : '/'}${url}`
                                    : url;
                                const displayName =
                                  originalName || url.split('/').pop() || tr('File', 'ملف');
                                const item = { url: fullUrl, displayName, isVideo: fileIsVideo };
                                if (fileIsVideo) {
                                  setUploadedFiles([item]);
                                } else {
                                  setUploadedFiles((prev) => [...prev, item].slice(-maxImages));
                                }
                              } catch (err) {
                                setError(err instanceof Error ? err.message : tr('Upload failed', 'فشل رفع الملف'));
                              } finally {
                                setUploading(false);
                                e.target.value = '';
                              }
                              })();
                            }}
                            disabled={uploading}
                          />
                          <input
                            name="referenceUrl"
                            type="url"
                            className="dashboard-input"
                            placeholder={
                              d.linkOrScreenshotPlaceholder ?? tr('Or paste link (optional)', 'أو الصق رابطًا (اختياري)')
                            }
                            defaultValue=""
                          />
                        </div>
                        {uploadedFiles.length > 0 && (
                          <ul className="dashboard-upload-list">
                            {uploadedFiles.map((item) => (
                              <li key={item.url} className="dashboard-upload-item">
                                <span className="dashboard-upload-name" title={item.url}>
                                  {item.displayName}
                                </span>
                                <button
                                  type="button"
                                  className="dashboard-link-btn"
                                  onClick={() =>
                                    setUploadedFiles((prev) =>
                                      prev.filter((f) => f.url !== item.url),
                                    )
                                  }
                                >
                                  {d.remove ?? 'Remove'}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </section>
                <section className="dashboard-need-card dashboard-need-card--summary">
                  <h4 className="dashboard-need-card-title">
                    {d.beforePublishing ?? tr('Before publishing', 'قبل النشر')}
                  </h4>
                  <ul className="dashboard-need-checklist">
                    <li>{d.checklistItem1 ?? tr('State deliverables and constraints clearly.', 'حدد المخرجات والقيود بوضوح.')}</li>
                    <li>
                      {d.checklistItem2 ??
                        tr(
                          'Set realistic budget and timeline to attract better bids.',
                          'حدد ميزانية ووقتاً واقعيين لجذب عروض أفضل.',
                        )}
                    </li>
                    <li>
                      {d.checklistItem3 ??
                        tr(
                          'Attach screenshots or links for faster expert understanding.',
                          'أرفق لقطات شاشة أو روابط لتسريع فهم الخبير.',
                        )}
                    </li>
                  </ul>
                </section>
              </div>
              <div className="dashboard-form-actions dashboard-form-actions--sticky">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                    setFieldErrors(null);
                  }}
                >
                  {dictionary.common.back}
                </button>
                <button type="submit" className="dashboard-primary-btn" disabled={saving}>
                  {saving ? '...' : (d.submitNeed ?? 'Submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : myNeeds.length === 0 ? (
        showEmptyState ? (
          <div className="dashboard-empty-wrapper">
            <div className="dashboard-empty-icon" aria-hidden>
              <Image src="/favicon.ico" alt="" width={48} height={48} />
            </div>
            <p className="dashboard-empty">
              {d.noNeeds ?? 'No needs posted yet. Post your first need!'}
            </p>
            <button
              type="button"
              className="dashboard-primary-btn"
              onClick={() => setShowForm(true)}
              disabled={!needsFeatureEnabled}
              title={!needsFeatureEnabled ? 'Needs feature is disabled by admin' : undefined}
            >
              {d.postNeed ?? 'Post a Need'}
            </button>
          </div>
        ) : null
      ) : (
        <div className="dashboard-cards dashboard-cards--needs">
          {myNeeds.map((need) => {
            const mediaUrls = getNeedMediaUrls(need.reference_url);
            const toFull = (u: string) => resolvePublicAssetUrl(u) ?? u;
            const imageUrls = mediaUrls.filter(
              (u) => /\.(jpe?g|png|webp|gif)$/i.test(u) || u.includes('/uploads/'),
            );
            return (
              <div key={need.id} className="dashboard-card dashboard-card--need">
                <div className="dashboard-card--need__head">
                  <h3 className="dashboard-card-title">{need.title}</h3>
                  <div className="dashboard-card--need__top-right">
                    {(need.city || need.country) && (
                      <span
                        className="dashboard-card--need__meta-pill"
                        title={d.locationType ?? 'Location'}
                      >
                        Location: {[need.city, need.country].filter(Boolean).join(', ') || '-'}
                      </span>
                    )}
                    {need.timeline_days != null && need.timeline_days > 0 && (
                      <span
                        className="dashboard-card--need__meta-pill"
                        title={d.timelinePlaceholder ?? 'Timeline'}
                      >
                        Timeline: {need.timeline_days} days
                      </span>
                    )}
                    {need.status === 'awarded' && (
                      <span className="dashboard-badge dashboard-badge--awarded">
                        {d.awarded ?? 'Awarded'}
                      </span>
                    )}
                    {need.status === 'completed' && (
                      <span className="dashboard-badge dashboard-badge--completed">
                        {d.completed ?? 'Completed'}
                      </span>
                    )}
                  </div>
                </div>
                {need.description && (
                  <p className="dashboard-card-desc">
                    {need.description.length > 200
                      ? `${need.description.slice(0, 200)}...`
                      : need.description}
                  </p>
                )}
                <div className="dashboard-card-meta-row">
                  {(need.category_name_en || need.category_name_ar) && (
                    <span>
                      {pickLocalized(
                        need as { category_name_en?: string; category_name_ar?: string },
                        locale,
                        'category_name_en',
                        'category_name_ar',
                      )}
                    </span>
                  )}
                  <span>
                    <strong>
                      {hourlyPricingEnabled
                        ? need.budget_type === 'fixed'
                          ? (d.fixed ?? 'Fixed')
                          : (d.hourly ?? 'Hourly')
                        : tr('Budget', 'الميزانية')}
                      :
                    </strong>{' '}
                    {parseFloat(need.budget_amount).toFixed(2)} {need.currency}
                  </span>
                  <span>
                    {d.bidsCount ?? 'Bids'}: {need.bid_count ?? 0}
                  </span>
                  <span>{needStatusLabels[need.status] ?? need.status}</span>
                </div>
                {mediaUrls.length > 0 && (
                  <div className="dashboard-card--need__attachments">
                    <span className="dashboard-card--need__attachments-label">Attachments</span>
                    <div className="dashboard-card-media">
                      {mediaUrls.slice(0, 5).map((url, i) => {
                        const full = toFull(url);
                        const isImage =
                          /\.(jpe?g|png|webp|gif)$/i.test(url) || url.includes('/uploads/');
                        if (isImage) {
                          return (
                            <button
                              key={i}
                              type="button"
                              className="dashboard-card-media-thumb"
                              onClick={() =>
                                setPreviewImage({
                                  url: full,
                                  urls: imageUrls.map(toFull),
                                })
                              }
                              title="View image"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={full} alt="" />
                            </button>
                          );
                        }
                        return (
                          <a
                            key={i}
                            href={full}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="dashboard-card-media-link"
                            title={url}
                          >
                            {url.split('/').pop() ?? 'File'}
                          </a>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="dashboard-card-actions">
                  {need.status === 'open' && (
                    <button
                      type="button"
                      className="dashboard-link-btn"
                      onClick={() => void viewBids(need)}
                    >
                      {d.viewBids ?? 'View Bids'}
                    </button>
                  )}
                  {need.status === 'awarded' && (
                    <button
                      type="button"
                      className="dashboard-primary-btn dashboard-primary-btn--sm"
                      onClick={() => void markNeedCompleted(need.id)}
                      disabled={markingCompleted === need.id}
                    >
                      {markingCompleted === need.id
                        ? '...'
                        : (d.markCompleted ?? 'Mark as completed')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {previewImage && (
        <div
          className="media-preview-overlay"
          onClick={() => setPreviewImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <button
            type="button"
            className="media-preview-close"
            onClick={() => setPreviewImage(null)}
            aria-label="Close"
          >
            x
          </button>
          <div className="media-preview-content" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage.url} alt="" className="media-preview-img" />
            {previewImage.urls.length > 1 && (
              <>
                <button
                  type="button"
                  className="media-preview-nav media-preview-prev"
                  onClick={() => {
                    const idx = previewImage.urls.indexOf(previewImage.url);
                    const nextIdx = idx <= 0 ? previewImage.urls.length - 1 : idx - 1;
                    setPreviewImage({ ...previewImage, url: previewImage.urls[nextIdx]! });
                  }}
                  aria-label="Previous"
                >
                  {'<'}
                </button>
                <button
                  type="button"
                  className="media-preview-nav media-preview-next"
                  onClick={() => {
                    const idx = previewImage.urls.indexOf(previewImage.url);
                    const nextIdx = idx >= previewImage.urls.length - 1 ? 0 : idx + 1;
                    setPreviewImage({ ...previewImage, url: previewImage.urls[nextIdx]! });
                  }}
                  aria-label="Next"
                >
                  {'>'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {selectedNeed && (
        <div className="plan-modal-overlay" onClick={() => setSelectedNeed(null)}>
          <div
            className="plan-modal plan-modal--bids"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="plan-modal-title">
              {d.bidsFor ?? 'Bids for'}: {selectedNeed.title}
            </h3>
            {loadingBids ? (
              <p>{d.loading ?? dictionary.common.loading ?? 'Loading...'}</p>
            ) : bids.length === 0 ? (
              <p>{d.noBids ?? 'No bids yet.'}</p>
            ) : (
              <div className="dashboard-bids-list">
                {bids.map((bid) => (
                  <div key={bid.id} className="dashboard-bid-item">
                    <div>
                      <strong>{bid.expert_name}</strong>
                      <p className="dashboard-card-meta">{bid.message}</p>
                      <p className="dashboard-card-meta">
                        {parseFloat(bid.amount).toFixed(2)} {bid.currency}
                        {bid.delivery_days && ` - ${bid.delivery_days} days`}
                        {bid.estimated_hours && ` - ${bid.estimated_hours} hrs/week`}
                      </p>
                    </div>
                    {bid.status === 'pending' && (
                      <div className="dashboard-bid-actions">
                        {bid.has_unread && <span className="dashboard-badge dashboard-badge--unread">New Message</span>}
                        <button
                          type="button"
                          className="dashboard-primary-btn dashboard-primary-btn--sm"
                            onClick={() => void handleAward(bid.id)}
                        >
                          {d.award ?? 'Award'}
                        </button>
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--secondary dashboard-btn--small"
                          onClick={() => void openChat(bid.id)}
                        >
                          Chat
                        </button>
                      </div>
                    )}
                    {bid.status === 'accepted' && (
                      <div className="dashboard-bid-actions dashboard-bid-actions--accepted">
                        <span className="dashboard-badge dashboard-badge--awarded">Accepted</span>
                        <button
                          type="button"
                          className="dashboard-primary-btn dashboard-primary-btn--sm dashboard-bid-pay-btn"
                          onClick={() => void handlePay(bid.id, bid.amount)}
                        >
                          Pay Expert
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            {chatBidId && (
              <div className="dashboard-need-chat">
                <h4 className="dashboard-need-chat-title">Pre-Award Chat</h4>
                <div className="dashboard-need-chat-messages">
                  {messages.map((m) => (
                    <div key={m.id} className="dashboard-need-chat-message">
                      <strong>{m.sender_name}</strong>:{' '}
                      <span>{m.content}</span>
                      {m.attachment_url ? (
                        <button
                          type="button"
                          className="dashboard-link-btn dashboard-need-chat-attach-thumb-wrap"
                          onClick={() =>
                            setPreviewImage({
                              url: toAbsoluteAssetUrl(m.attachment_url!),
                              urls: [toAbsoluteAssetUrl(m.attachment_url!)],
                            })
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={toAbsoluteAssetUrl(m.attachment_url)}
                            alt=""
                            className="dashboard-need-chat-attach-thumb"
                          />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {messages.length === 0 && <p className="dashboard-empty">No messages yet.</p>}
                </div>
                <form onSubmit={(e) => { void sendMsg(e); }} className="dashboard-need-chat-form">
                  {bidChatAttachmentUrl ? (
                    <div className="dashboard-need-chat-pending">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={bidChatAttachmentUrl} alt="" className="dashboard-need-chat-attach-thumb" />
                      <button
                        type="button"
                        className="dashboard-link-btn"
                        onClick={() => setBidChatAttachmentUrl(null)}
                      >
                        {tr('Remove image', 'إزالة الصورة')}
                      </button>
                    </div>
                  ) : null}
                  <label className="dashboard-need-chat-file">
                    <span className="dashboard-need-chat-file-label">
                      {tr('Attach image', 'إرفاق صورة')}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={bidChatUploading || Boolean(bidChatAttachmentUrl)}
                      onChange={(ev) => {
                        const file = ev.target.files?.[0];
                        ev.target.value = '';
                        if (!file) return;
                        void (async () => {
                          setBidChatUploading(true);
                          try {
                            const { url } = await uploadFile(accessToken, file);
                            setBidChatAttachmentUrl(toAbsoluteAssetUrl(url));
                          } catch {
                            addToast('Error', tr('Upload failed', 'فشل الرفع'));
                          } finally {
                            setBidChatUploading(false);
                          }
                        })();
                      }}
                    />
                  </label>
                  <input
                    className="dashboard-input"
                    value={msgContent}
                    onChange={(e) => setMsgContent(e.target.value)}
                    placeholder={tr('Type a message…', 'اكتب رسالة…')}
                  />
                  <button
                    type="submit"
                    className="dashboard-primary-btn"
                    disabled={bidChatUploading || (!msgContent.trim() && !bidChatAttachmentUrl)}
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
            <button
              type="button"
              className="plan-modal-cancel plan-modal-cancel--top"
              onClick={() => setSelectedNeed(null)}
            >
              {dictionary.common.back}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
