'use client';

import type {
  CraftsmanProfile,
  IdentityDocumentType,
  UpdateAccountBody,
  UpdateCraftsmanProfileBody,
} from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { SiteLogo } from '@/components/site-logo';
import { CityCountrySelect } from '@/components/ui/city-country-select';
import { Container } from '@/components/ui/container';
import { ImageUploadOrCapture } from '@/components/ui/image-upload-or-capture';
import { LiveCapture } from '@/components/ui/live-capture';
import { toAbsoluteAssetUrl } from '@/lib/asset-url';
import { getApiBaseUrl } from '@/lib/env';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { uploadFile, uploadPrivateFile } from '@/lib/upload/client';
import { usersApiClient } from '@/lib/users/client';
import { formatApiError } from '@/lib/utils/format-api-error';
import { verificationApiClient } from '@/lib/verification/client';

type Props = { locale: Locale; dictionary: Dictionary };

type Step = 'profile' | 'workshop' | 'kyc' | 'complete';
const STEP_ORDER: Step[] = ['profile', 'workshop', 'kyc', 'complete'];

function nonEmpty(val: string | null | undefined): string | undefined {
  return val && val.trim().length > 0 ? val.trim() : undefined;
}

function pickDefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function readFilePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not preview image.'));
    reader.readAsDataURL(file);
  });
}

export const CraftsmanOnboardingScreen = ({ locale, dictionary }: Props) => {
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [craftsmanProfile, setCraftsmanProfile] = useState<CraftsmanProfile | null>(null);
  const [step, setStep] = useState<Step>('profile');
  const [stepResolved, setStepResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [kycMode, setKycMode] = useState<'didit' | 'manual' | null>(null);
  const [manualFrontFile, setManualFrontFile] = useState<File | null>(null);
  const [manualBackFile, setManualBackFile] = useState<File | null>(null);
  const [manualSelfieFile, setManualSelfieFile] = useState<File | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [withdrawableManualDocId, setWithdrawableManualDocId] = useState<string | null>(null);
  const [hasActiveIdentitySubmission, setHasActiveIdentitySubmission] = useState(false);

  const dict = dictionary.onboarding.craftsman;
  const stepLabels = [
    dict.steps.profileDetails,
    dict.steps.workshopDetails,
    dict.steps.identityVerification,
  ];

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

  const loadKycStatus = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await verificationApiClient.getStatus(accessToken);
      setKycStatus(data.verificationStatus);
    } catch {
      setKycStatus('unverified');
    }
  }, [accessToken]);

  useEffect(() => {
    void loadKycStatus();
  }, [loadKycStatus]);

  useEffect(() => {
    if (
      step !== 'kyc' ||
      kycStatus !== 'pending' ||
      !accessToken ||
      authUser?.verificationStatus === 'rejected'
    ) {
      setWithdrawableManualDocId(null);
      return;
    }
    let cancelled = false;
    void profilesApiClient
      .getIdentityDocuments(accessToken)
      .then((docs) => {
        if (cancelled) return;
        const active = docs.find((d) => d.status === 'pending' || d.status === 'under_review');
        setWithdrawableManualDocId(active?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setWithdrawableManualDocId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [step, kycStatus, accessToken, authUser?.verificationStatus]);

  const handleWithdrawManualSubmission = useCallback(async () => {
    if (!accessToken || !withdrawableManualDocId) return;
    setSaving(true);
    setError(null);
    try {
      await profilesApiClient.withdrawIdentityDocument(accessToken, withdrawableManualDocId);
      setWithdrawableManualDocId(null);
      setHasActiveIdentitySubmission(false);
      await loadKycStatus();
      await updateAuthUser();
    } catch (err) {
      setError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setSaving(false);
    }
  }, [accessToken, withdrawableManualDocId, loadKycStatus, updateAuthUser, dictionary.profile.saveError]);

  useEffect(() => {
    if ((step !== 'complete' && kycStatus !== 'pending') || !accessToken) return;
    void updateAuthUser();
    void loadKycStatus();
    const interval = setInterval(() => {
      void updateAuthUser();
      void loadKycStatus();
    }, 15000);
    return () => clearInterval(interval);
  }, [step, kycStatus, accessToken, updateAuthUser, loadKycStatus]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const [profile, verification, identityDocs] = await Promise.all([
          profilesApiClient.getCraftsmanProfile(accessToken),
          verificationApiClient
            .getStatus(accessToken)
            .catch(() => ({ verificationStatus: 'unverified' as const })),
          profilesApiClient.getIdentityDocuments(accessToken).catch(() => []),
        ]);
        if (cancelled) return;
        setCraftsmanProfile(profile);
        setKycStatus(verification.verificationStatus);

        const profileComplete = Boolean(
          profile?.trade?.trim() && profile?.title?.trim() && authUser?.avatarUrl,
        );
        const workshopComplete = Boolean(
          profile?.city?.trim() &&
            profile?.country?.trim() &&
            profile?.workshopName?.trim() &&
            profile?.workshopAddress?.trim(),
        );
        const hasPendingIdentitySubmission =
          Array.isArray(identityDocs) &&
          identityDocs.some((doc) => doc.status === 'pending' || doc.status === 'under_review');
        setHasActiveIdentitySubmission(hasPendingIdentitySubmission);
        const identityDone =
          verification.verificationStatus === 'verified' || hasPendingIdentitySubmission;

        if (authUser?.verificationStatus === 'rejected') {
          setStep('kyc');
        } else if (!profileComplete) {
          setStep('profile');
        } else if (!workshopComplete) {
          setStep('workshop');
        } else if (!identityDone) {
          setStep('kyc');
        } else {
          setStep('complete');
        }
      } catch {
        if (!cancelled) setStep('profile');
      } finally {
        if (!cancelled) setStepResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, authUser?.avatarUrl, authUser?.verificationStatus]);

  useEffect(() => {
    setAvatarPreviewUrl(authUser?.avatarUrl ?? null);
  }, [authUser?.avatarUrl]);

  useEffect(() => {
    if (step !== 'complete' || !accessToken) return;
    void profilesApiClient.completeCraftsmanOnboarding(accessToken).catch(() => undefined);
  }, [step, accessToken]);

  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement)?.value);
    const numVal = (name: string) => {
      const n = parseFloat((form.elements.namedItem(name) as HTMLInputElement)?.value || '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    const tradeVal = val('trade');
    const titleVal = val('title');
    if (!tradeVal || !titleVal) {
      setError(dictionary.auth.errors.generic);
      setSaving(false);
      return;
    }
    if (!avatarFile && !authUser?.avatarUrl) {
      setError(dict.profilePhotoRequiredError ?? dictionary.auth.errors.generic);
      setSaving(false);
      return;
    }

    const body = pickDefined({
      trade: tradeVal,
      title: titleVal,
      headline: titleVal,
      bio: val('bio'),
      specializations: (
        (form.elements.namedItem('specializations') as HTMLInputElement)?.value || ''
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      yearsOfExperience: numVal('yearsOfExperience'),
      hourlyRate: numVal('hourlyRate'),
    });

    try {
      let avatarUrl = authUser?.avatarUrl ?? null;
      if (avatarFile) {
        const uploaded = await uploadFile(accessToken, avatarFile);
        avatarUrl = toAbsoluteAssetUrl(uploaded.url);
      }
      if (avatarUrl) {
        await usersApiClient.updateAccount(accessToken, {
          avatarUrl,
        } satisfies UpdateAccountBody);
        await updateAuthUser();
      }
      const updated = await profilesApiClient.updateCraftsmanProfile(
        accessToken,
        body as UpdateCraftsmanProfileBody,
      );
      setCraftsmanProfile(updated);
      setStep('workshop');
    } catch (err) {
      setError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWorkshop = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement)?.value);

    const body = pickDefined({
      city: val('city'),
      country: val('country'),
      availabilityStatus: nonEmpty(
        (form.elements.namedItem('availabilityStatus') as HTMLSelectElement)?.value,
      ) as 'available' | 'busy' | 'offline' | undefined,
      workshopName: val('workshopName'),
      workshopAddress: val('workshopAddress'),
    });

    try {
      const updated = await profilesApiClient.updateCraftsmanProfile(
        accessToken,
        body as UpdateCraftsmanProfileBody,
      );
      setCraftsmanProfile(updated);
      setStep('kyc');
    } catch (err) {
      setError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleInitiateKyc = async () => {
    if (!accessToken || !authUser) return;
    setSaving(true);
    setError(null);
    try {
      const result = await verificationApiClient.initiate(accessToken, {
        email: authUser.email,
        displayName: authUser.displayName,
      });
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl;
      } else {
        setKycStatus('pending');
      }
    } catch (err) {
      setError(formatApiError(err, dict.kycRejected));
    } finally {
      setSaving(false);
    }
  };

  const handleManualKyc = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    const form = e.currentTarget;
    const docType = (form.elements.namedItem('documentType') as HTMLSelectElement)
      ?.value as IdentityDocumentType;
    const fullNameOnDoc =
      (form.elements.namedItem('fullNameOnDoc') as HTMLInputElement)?.value?.trim() || '';

    const needsBack = docType === 'national_id' || docType === 'driving_license';
    if (!manualFrontFile || !manualSelfieFile || (needsBack && !manualBackFile)) {
      setError(dict.manualKycMissingFilesError ?? dictionary.auth.errors.generic);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const base = (getApiBaseUrl() || '').replace(/\/$/, '');
      const toFullUrl = (url: string) =>
        url.startsWith('http') ? url : base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;

      const [frontRes, backRes, selfieRes] = await Promise.all([
        uploadPrivateFile(accessToken, manualFrontFile),
        manualBackFile ? uploadPrivateFile(accessToken, manualBackFile) : Promise.resolve(null),
        uploadPrivateFile(accessToken, manualSelfieFile),
      ]);

      await profilesApiClient.submitIdentityDocument(accessToken, {
        documentType: docType,
        fullNameOnDoc,
        frontImageUrl: toFullUrl(frontRes.url),
        selfieImageUrl: toFullUrl(selfieRes.url),
        ...(backRes && { backImageUrl: toFullUrl(backRes.url) }),
      });
      setKycStatus('pending');
      setHasActiveIdentitySubmission(true);
      setKycMode(null);
      setManualFrontFile(null);
      setManualBackFile(null);
      setManualSelfieFile(null);
      setStep('complete');
    } catch (err) {
      setError(formatApiError(err, dict.kycRejected));
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser || !stepResolved) {
    return (
      <main className="expert-onboarding-page-main">
        <Container>
          <p className="onboarding-loading">{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const currentStepIndex = STEP_ORDER.indexOf(step);

  return (
    <main className="expert-onboarding-page-main">
      <Container>
        <header className="onboarding-header">
          <Link href={buildLocalePath(locale, '/')} className="onboarding-brand">
            <SiteLogo />
          </Link>
        </header>

        <section className="onboarding-card">
          <h1 className="onboarding-title">{dict.title}</h1>
          {step !== 'complete' && (
            <OnboardingStepper
              steps={stepLabels}
              currentStep={Math.min(currentStepIndex, stepLabels.length - 1)}
              stepLabel={dictionary.common.step}
              ofLabel={dictionary.common.of}
            />
          )}

          {error && <div className="onboarding-error">{error}</div>}

          {step === 'profile' && (
            <form className="onboarding-form" onSubmit={(e) => void handleSaveProfile(e)}>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.tradeLabel}</label>
                  <input
                    type="text"
                    name="trade"
                    className="onboarding-input"
                    placeholder={dict.profileForm.tradePlaceholder}
                    defaultValue={craftsmanProfile?.trade ?? ''}
                    required
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.titleLabel}</label>
                  <input
                    type="text"
                    name="title"
                    className="onboarding-input"
                    placeholder={dict.profileForm.titlePlaceholder}
                    defaultValue={craftsmanProfile?.title ?? ''}
                    required
                  />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.bioLabel}</label>
                <textarea
                  name="bio"
                  className="onboarding-input onboarding-textarea"
                  rows={3}
                  defaultValue={craftsmanProfile?.bio ?? ''}
                />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">
                  {dict.profileForm.profilePhotoLabel ?? tr('Profile picture', 'الصورة الشخصية')}
                </label>
                <p className="onboarding-description">
                  {dict.profileForm.profilePhotoHint ??
                    tr(
                      'Required for craftsman verification and verified badge.',
                      'مطلوب للتحقق كحرفي والحصول على شارة التوثيق.',
                    )}
                </p>
                {avatarPreviewUrl && (
                  <div
                    style={{
                      maxWidth: '12rem',
                      borderRadius: '1rem',
                      overflow: 'hidden',
                      border: '1px solid hsl(var(--border))',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarPreviewUrl}
                      alt={dict.profileForm.profilePhotoLabel ?? tr('Profile picture', 'الصورة الشخصية')}
                      style={{ display: 'block', width: '100%', maxHeight: '12rem', objectFit: 'cover' }}
                    />
                  </div>
                )}
                <ImageUploadOrCapture
                  label={
                    dict.profileForm.uploadProfilePhoto ?? tr('Upload profile picture', 'رفع الصورة الشخصية')
                  }
                  onImage={(file) => {
                    void (async () => {
                      setAvatarFile(file);
                      setAvatarPreviewUrl(await readFilePreview(file));
                    })();
                  }}
                  onClear={() => {
                    setAvatarFile(null);
                    setAvatarPreviewUrl(authUser?.avatarUrl ?? null);
                  }}
                  onError={setError}
                  required={!authUser?.avatarUrl}
                  disabled={saving}
                />
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">
                    {dict.profileForm.specializationsLabel}
                  </label>
                  <input
                    type="text"
                    name="specializations"
                    className="onboarding-input"
                    placeholder={dict.profileForm.specializationsHint}
                    defaultValue={craftsmanProfile?.specializations?.join(', ') ?? ''}
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">
                    {dict.profileForm.yearsOfExperienceLabel}
                  </label>
                  <input
                    type="number"
                    name="yearsOfExperience"
                    className="onboarding-input"
                    min="0"
                    defaultValue={craftsmanProfile?.yearsOfExperience ?? ''}
                  />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.hourlyRateLabel}</label>
                <input
                  type="number"
                  name="hourlyRate"
                  className="onboarding-input"
                  min="0"
                  step="0.01"
                  defaultValue={craftsmanProfile?.hourlyRate ?? ''}
                />
              </div>
              <button type="submit" className="onboarding-cta-button" disabled={saving}>
                {saving ? dictionary.auth.common.loading : dictionary.common.next}
              </button>
            </form>
          )}

          {step === 'workshop' && (
            <form className="onboarding-form" onSubmit={(e) => void handleSaveWorkshop(e)}>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={dict.profileForm.cityLabel}
                countryLabel={dict.profileForm.countryLabel}
                className="onboarding-field"
                selectClassName="onboarding-input"
                defaultValue={craftsmanProfile?.city ?? ''}
                forceIpCountry
                required
              />
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.availabilityLabel}</label>
                <select
                  name="availabilityStatus"
                  className="onboarding-input"
                  defaultValue={craftsmanProfile?.availabilityStatus ?? 'available'}
                >
                  <option value="available">
                    {dict.availabilityOptions?.available ?? 'Available'}
                  </option>
                  <option value="busy">{dict.availabilityOptions?.busy ?? 'Busy'}</option>
                  <option value="offline">{dict.availabilityOptions?.offline ?? 'Offline'}</option>
                </select>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.workshopNameLabel}</label>
                <input
                  type="text"
                  name="workshopName"
                  className="onboarding-input"
                  defaultValue={craftsmanProfile?.workshopName ?? ''}
                  required
                />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.workshopAddressLabel}</label>
                <textarea
                  name="workshopAddress"
                  className="onboarding-input onboarding-textarea"
                  rows={3}
                  placeholder={dict.profileForm.workshopAddressHint}
                  defaultValue={craftsmanProfile?.workshopAddress ?? ''}
                  required
                />
              </div>
              <div className="onboarding-nav-row">
                <button
                  type="button"
                  className="onboarding-back-button"
                  onClick={() => setStep('profile')}
                >
                  {dictionary.common.back}
                </button>
                <button type="submit" className="onboarding-cta-button" disabled={saving}>
                  {saving ? dictionary.auth.common.loading : dictionary.common.next}
                </button>
              </div>
            </form>
          )}

          {step === 'kyc' && (
            <div className="onboarding-kyc-section">
              <h2 className="onboarding-subtitle">{dict.kycTitle}</h2>
              <p className="onboarding-description">{dict.kycDescription}</p>

              {authUser.verificationStatus === 'rejected' && (
                <div className="onboarding-error">{dict.identityRejectedResubmit}</div>
              )}
              {kycStatus === 'verified' && authUser.verificationStatus !== 'rejected' && (
                <div className="onboarding-success">{dict.kycVerified}</div>
              )}
              {kycStatus === 'pending' && authUser.verificationStatus !== 'rejected' && (
                <div className="onboarding-info">{dict.kycPending}</div>
              )}
              {kycStatus === 'pending' &&
                authUser.verificationStatus !== 'rejected' &&
                withdrawableManualDocId && (
                  <div className="onboarding-nav-row" style={{ marginTop: '0.75rem' }}>
                    <button
                      type="button"
                      className="onboarding-secondary-button"
                      onClick={() => void handleWithdrawManualSubmission()}
                      disabled={saving}
                    >
                    {dict.withdrawIdentitySubmission ??
                      tr('Remove submission and start over', 'حذف الطلب والبدء من جديد')}
                    </button>
                  </div>
                )}
              {kycStatus === 'rejected' && authUser.verificationStatus !== 'rejected' && (
                <div className="onboarding-error">{dict.kycRejected}</div>
              )}

              {(kycStatus === 'unverified' ||
                kycStatus === 'rejected' ||
                authUser.verificationStatus === 'rejected') && (
                <div className="onboarding-kyc-options">
                  {!kycMode ? (
                    <>
                      <button
                        type="button"
                        className="onboarding-cta-button"
                        onClick={() => void handleInitiateKyc()}
                        disabled={saving}
                      >
                        {saving ? dictionary.auth.common.loading : dict.kycButton}
                      </button>
                      <p className="onboarding-kyc-divider">
                        - {dict.kycDividerOr ?? tr('or', 'أو')} -
                      </p>
                      <button
                        type="button"
                        className="onboarding-secondary-button"
                        onClick={() => setKycMode('manual')}
                        disabled={saving}
                      >
                        {dict.kycManualButton}
                      </button>
                    </>
                  ) : (
                    <form className="onboarding-form" onSubmit={(e) => void handleManualKyc(e)}>
                      <p className="onboarding-description">
                        {dict.documentsForm.identityDescription}{' '}
                        {dict.documentsForm.identityDescriptionSuffix ??
                          tr(
                            'You must provide a live selfie and clear photos of your ID.',
                            'يجب تقديم سيلفي مباشر وصور واضحة لبطاقة الهوية.',
                          )}
                      </p>
                      {dictionary.verification?.verificationTimeNote && (
                        <p className="onboarding-description onboarding-verification-note">
                          {dictionary.verification.verificationTimeNote}
                        </p>
                      )}
                      <div className="onboarding-field">
                        <label className="onboarding-label">
                          {dict.documentsForm.documentTypeLabel}
                        </label>
                        <select name="documentType" className="onboarding-input">
                          <option value="national_id">
                            {dictionary.verification.identityDocTypes.nationalId}
                          </option>
                          <option value="passport">
                            {dictionary.verification.identityDocTypes.passport}
                          </option>
                          <option value="driving_license">
                            {dictionary.verification.identityDocTypes.drivingLicense}
                          </option>
                        </select>
                      </div>
                      <div className="onboarding-field">
                        <label className="onboarding-label">
                          {dict.documentsForm.fullNameOnDocLabel}
                        </label>
                        <input
                          type="text"
                          name="fullNameOnDoc"
                          className="onboarding-input"
                          required
                        />
                      </div>
                      <div className="onboarding-field">
                        <ImageUploadOrCapture
                          label={dict.documentsForm.frontImageLabel}
                          onImage={(file) => setManualFrontFile(file)}
                          onClear={() => setManualFrontFile(null)}
                          onError={setError}
                          required
                          disabled={saving}
                        />
                      </div>
                      <div className="onboarding-field">
                        <ImageUploadOrCapture
                          label={dict.documentsForm.backImageLabel}
                          onImage={(file) => setManualBackFile(file)}
                          onClear={() => setManualBackFile(null)}
                          onError={setError}
                          disabled={saving}
                        />
                        <p
                          className="onboarding-description"
                          style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}
                        >
                          {dict.documentsForm.backImageHint ??
                            tr(
                              'Required for National ID and Driving License. Skip for passport.',
                              'مطلوب للبطاقة القومية ورخصة القيادة. يمكن تجاوزه في حالة جواز السفر.',
                            )}
                        </p>
                      </div>
                      <div className="onboarding-field">
                        <LiveCapture
                          facingMode="user"
                          label={dict.documentsForm.selfieImageLabel}
                          onCapture={(file) => setManualSelfieFile(file)}
                          onClear={() => setManualSelfieFile(null)}
                          onError={setError}
                          required
                          disabled={saving}
                        />
                        <p
                          className="onboarding-description"
                          style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}
                        >
                          {dict.documentsForm.liveSelfieHint ??
                            tr(
                              'Take a live selfie now. Uploading a selfie file is not allowed.',
                              'التقط سيلفي مباشر الآن. لا يُسمح برفع ملف سيلفي.',
                            )}
                        </p>
                      </div>
                      <button type="submit" className="onboarding-cta-button" disabled={saving}>
                        {saving ? dictionary.auth.common.loading : dictionary.common.submit}
                      </button>
                      <button
                        type="button"
                        className="onboarding-back-button"
                        onClick={() => setKycMode(null)}
                      >
                        {dictionary.common.back}
                      </button>
                    </form>
                  )}
                </div>
              )}

              <div className="onboarding-nav-row">
                <button
                  type="button"
                  className="onboarding-back-button"
                  onClick={() => setStep('workshop')}
                >
                  {dictionary.common.back}
                </button>
                <button
                  type="button"
                  className="onboarding-cta-button"
                  onClick={() => setStep('complete')}
                  disabled={kycStatus !== 'verified' && !hasActiveIdentitySubmission}
                >
                  {dictionary.common.next}
                </button>
              </div>
              {kycStatus !== 'verified' && !hasActiveIdentitySubmission && (
                <p className="onboarding-hint">
                  {dict.kycRequirementsHint ??
                    tr(
                      'Complete identity verification or submit manual review before continuing.',
                      'أكمل التحقق من الهوية أو قدّم للمراجعة اليدوية قبل المتابعة.',
                    )}
                </p>
              )}
            </div>
          )}

          {step === 'complete' && (
            <div className="onboarding-complete">
              <p className="onboarding-description">{dict.description}</p>
              {kycStatus === 'pending' && <div className="onboarding-info">{dict.kycPending}</div>}
              {authUser.verificationStatus === 'verified' ? (
                <Link href={buildLocalePath(locale, '/app')} className="onboarding-cta-button">
                  {dict.goToDashboard ?? dictionary.onboarding.customer.goToDashboard}
                </Link>
              ) : (
                <p className="onboarding-info">{dict.pendingReviewMessage}</p>
              )}
            </div>
          )}
        </section>
      </Container>
    </main>
  );
};
