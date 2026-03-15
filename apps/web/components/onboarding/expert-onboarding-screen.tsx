'use client';

import type { IdentityDocumentType, UpdateAccountBody, UpdateExpertProfileBody } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { SiteLogo } from '@/components/site-logo';
import { CityCountrySelect } from '@/components/ui/city-country-select';
import { Container } from '@/components/ui/container';
import { DegreeInstitutionSelect } from '@/components/ui/degree-institution-select';
import { ImageUploadOrCapture } from '@/components/ui/image-upload-or-capture';
import { LanguagesCheckboxes } from '@/components/ui/languages-checkboxes';
import { LiveCapture } from '@/components/ui/live-capture';
import { findCountryByName } from '@/lib/data/countries';
import { getApiBaseUrl } from '@/lib/env';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { uploadFile, uploadPrivateFile } from '@/lib/upload/client';
import { usersApiClient } from '@/lib/users/client';
import { formatApiError } from '@/lib/utils/format-api-error';
import { verificationApiClient } from '@/lib/verification/client';

type Props = { locale: Locale; dictionary: Dictionary };

type Step = 'profile' | 'kyc' | 'documents' | 'complete';
const STEP_ORDER: Step[] = ['profile', 'kyc', 'documents', 'complete'];

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

function toAbsoluteAssetUrl(url: string): string {
  if (url.startsWith('http')) return url;
  const base = (getApiBaseUrl() || '').replace(/\/$/, '');
  return base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;
}

function readFilePreview(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(new Error('Could not preview image.'));
    reader.readAsDataURL(file);
  });
}

export const ExpertOnboardingScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [step, setStep] = useState<Step>('profile');
  const [stepResolved, setStepResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [kycMode, setKycMode] = useState<'didit' | 'manual' | null>(null);
  const [manualFrontFile, setManualFrontFile] = useState<File | null>(null);
  const [manualBackFile, setManualBackFile] = useState<File | null>(null);
  const [manualSelfieFile, setManualSelfieFile] = useState<File | null>(null);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [profileCountry, setProfileCountry] = useState<string>('');
  const [documentRejectedResubmit, setDocumentRejectedResubmit] = useState(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);

  const dict = dictionary.onboarding.expert;
  const stepLabels = [dict.steps.profileDetails, dict.steps.kyc, dict.steps.documents];

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

  // When on complete step, refresh auth user so verificationStatus updates after admin approval
  useEffect(() => {
    if (step !== 'complete' || !accessToken) return;
    void updateAuthUser();
    const interval = setInterval(() => {
      void updateAuthUser();
    }, 15000);
    return () => clearInterval(interval);
  }, [step, accessToken, updateAuthUser]);

  useEffect(() => {
    void loadKycStatus();
  }, [loadKycStatus]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const [profile, verification, academicRecords] = await Promise.all([
          profilesApiClient.getExpertProfile(accessToken),
          verificationApiClient.getStatus(accessToken).catch(() => ({ verificationStatus: 'unverified' as const })),
          profilesApiClient.getAcademicRecords(accessToken).catch(() => []),
        ]);
        if (cancelled) return;
        setKycStatus(verification.verificationStatus);
        if (profile?.country) {
          const c = findCountryByName(profile.country);
          setProfileCountry(c?.code ?? '');
        }
        const profileComplete = Boolean(
          profile?.title?.trim() && profile?.languages?.length && authUser?.avatarUrl,
        );
        const identityDone = verification.verificationStatus === 'verified' || verification.verificationStatus === 'pending';
        const hasApprovedAcademicRecord = Array.isArray(academicRecords) && academicRecords.some((r) => r.status === 'approved');
        const hasRejectedAcademic = Array.isArray(academicRecords) && academicRecords.some((r) => r.status === 'rejected');
        setDocumentRejectedResubmit(Boolean(hasRejectedAcademic && !hasApprovedAcademicRecord));
        // Rejected identity (from admin review): show KYC step to resubmit
        if (authUser?.verificationStatus === 'rejected') {
          setStep('kyc');
        } else if (!profileComplete) {
          setStep('profile');
        } else if (!identityDone) {
          setStep('kyc');
        } else if (!hasApprovedAcademicRecord) {
          setStep('documents');
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
  }, [accessToken, authUser?.verificationStatus]);

  useEffect(() => {
    setAvatarPreviewUrl(authUser?.avatarUrl ?? null);
  }, [authUser?.avatarUrl]);

  const handleSaveProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);
    const numVal = (name: string) => {
      const n = parseFloat((form.elements.namedItem(name) as HTMLInputElement)?.value || '');
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    const titleVal = val('title');
    const languages = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="languages"]:checked'),
    ).map((el) => el.value);
    if (languages.length === 0) {
      setError(dict.profileForm.languagesHint || 'Please select at least one language.');
      setSaving(false);
      return;
    }
    if (!avatarFile && !authUser?.avatarUrl) {
      setError(
        (dict.profileForm as { avatarHint?: string }).avatarHint ??
          'Upload a profile picture before continuing to verification.',
      );
      setSaving(false);
      return;
    }
    const body = pickDefined({
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
      city: val('city'),
      country: val('country'),
      employer: val('employer'),
      jobTitle: val('jobTitle'),
      linkedinUrl: val('linkedinUrl'),
      portfolioUrl: val('portfolioUrl'),
      languages,
      educationSummary: val('educationSummary'),
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
      await profilesApiClient.updateExpertProfile(accessToken, body as UpdateExpertProfileBody);
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
      setError('Please capture/upload all required images: document front, document back (if applicable), and a live selfie.');
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
      setKycMode(null);
      setManualFrontFile(null);
      setManualBackFile(null);
      setManualSelfieFile(null);
    } catch (err) {
      setError(formatApiError(err, dict.kycRejected));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDocs = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    if (!certificateFile) {
      setError(dict.documentsForm.certificateImageLabel
        ? `${dict.documentsForm.certificateImageLabel} is required.`
        : 'Please upload your certificate or degree document.');
      return;
    }
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const recordType =
      (form.elements.namedItem('recordType') as HTMLSelectElement)?.value || 'degree';
    const title = (form.elements.namedItem('recordTitle') as HTMLInputElement)?.value || '';
    const institution = (form.elements.namedItem('institution') as HTMLInputElement)?.value?.trim() || '';

    if (!title || !institution) {
      setError(dictionary.profile.saveError || 'Please select degree and institution.');
      setSaving(false);
      return;
    }

    try {
      const base = (getApiBaseUrl() || '').replace(/\/$/, '');
      const toFullUrl = (url: string) =>
        url.startsWith('http') ? url : base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;

      const [certRes, transcriptRes] = await Promise.all([
        uploadPrivateFile(accessToken, certificateFile),
        transcriptFile ? uploadPrivateFile(accessToken, transcriptFile) : Promise.resolve(null),
      ]);

      await profilesApiClient.submitAcademicRecord(accessToken, {
        recordType: recordType as 'degree' | 'diploma' | 'certificate' | 'license',
        title,
        institution,
        certificateImageUrl: toFullUrl(certRes.url),
        ...(transcriptRes && { transcriptImageUrl: toFullUrl(transcriptRes.url) }),
      });
      setCertificateFile(null);
      setTranscriptFile(null);
      await updateAuthUser();
      setStep('complete');
    } catch (err) {
      setError(formatApiError(err, dictionary.profile.saveError));
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
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.titleLabel}</label>
                <input
                  type="text"
                  name="title"
                  className="onboarding-input"
                  placeholder={dict.profileForm.titlePlaceholder}
                  required
                />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.bioLabel}</label>
                <textarea name="bio" className="onboarding-input onboarding-textarea" rows={3} />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">
                  {(dict.profileForm as { avatarLabel?: string }).avatarLabel ?? 'Profile picture'}
                </label>
                <p className="onboarding-description">
                  {(dict.profileForm as { avatarHint?: string }).avatarHint ??
                    'Required for expert verification and the platform verified badge.'}
                </p>
                {avatarPreviewUrl && (
                  <div style={{ maxWidth: '12rem', borderRadius: '1rem', overflow: 'hidden', border: '1px solid hsl(var(--border))' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarPreviewUrl}
                      alt={(dict.profileForm as { avatarLabel?: string }).avatarLabel ?? 'Profile picture'}
                      style={{ display: 'block', width: '100%', maxHeight: '12rem', objectFit: 'cover' }}
                    />
                  </div>
                )}
                <ImageUploadOrCapture
                  label={(dict.profileForm as { avatarUploadLabel?: string }).avatarUploadLabel ?? 'Upload profile picture'}
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
                  />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.hourlyRateLabel}</label>
                  <input
                    type="number"
                    name="hourlyRate"
                    className="onboarding-input"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.employerLabel}</label>
                  <input type="text" name="employer" className="onboarding-input" />
                </div>
              </div>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={dict.profileForm.cityLabel}
                countryLabel={dict.profileForm.countryLabel}
                className="onboarding-field"
                selectClassName="onboarding-input"
                required
              />
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.jobTitleLabel}</label>
                  <input type="text" name="jobTitle" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.linkedinLabel}</label>
                  <input type="text" name="linkedinUrl" className="onboarding-input" placeholder="linkedin.com/in/username" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.portfolioLabel}</label>
                  <input type="text" name="portfolioUrl" className="onboarding-input" placeholder="example.com or full URL" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.languagesLabel}</label>
                  <LanguagesCheckboxes
                    name="languages"
                    locale={locale}
                    required
                    className="onboarding-languages"
                  />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.educationSummaryLabel}</label>
                <textarea
                  name="educationSummary"
                  className="onboarding-input onboarding-textarea"
                  rows={2}
                />
              </div>
              <button type="submit" className="onboarding-cta-button" disabled={saving}>
                {saving ? dictionary.auth.common.loading : dictionary.common.next}
              </button>
            </form>
          )}

          {step === 'kyc' && (
            <div className="onboarding-kyc-section">
              <h2 className="onboarding-subtitle">{dict.kycTitle}</h2>
              <p className="onboarding-description">{dict.kycDescription}</p>

              {authUser?.verificationStatus === 'rejected' && (
                <div className="onboarding-error">{dict.identityRejectedResubmit}</div>
              )}

              {kycStatus === 'verified' && authUser?.verificationStatus !== 'rejected' && (
                <div className="onboarding-success">{dict.kycVerified}</div>
              )}

              {kycStatus === 'pending' && authUser?.verificationStatus !== 'rejected' && (
                <div className="onboarding-info">{dict.kycPending}</div>
              )}

              {kycStatus === 'rejected' && authUser?.verificationStatus !== 'rejected' && (
                <div className="onboarding-error">{dict.kycRejected}</div>
              )}

              {(kycStatus === 'unverified' || kycStatus === 'rejected' || authUser?.verificationStatus === 'rejected') && (
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
                      <p className="onboarding-kyc-divider">— or —</p>
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
                    {dict.documentsForm.identityDescription} You must take a live photo of yourself and a photo of your ID (National ID, passport, or driving license). Upload or take live pictures.
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
                    <input type="text" name="fullNameOnDoc" className="onboarding-input" required />
                  </div>
                  <div className="onboarding-field">
                    <ImageUploadOrCapture
                      label={dict.documentsForm.frontImageLabel}
                      onImage={(f) => setManualFrontFile(f)}
                      onClear={() => setManualFrontFile(null)}
                      onError={setError}
                      required
                      disabled={saving}
                    />
                  </div>
                  <div className="onboarding-field">
                    <ImageUploadOrCapture
                      label={dict.documentsForm.backImageLabel}
                      onImage={(f) => setManualBackFile(f)}
                      onClear={() => setManualBackFile(null)}
                      onError={setError}
                      required={false}
                      disabled={saving}
                    />
                    <p className="onboarding-description" style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                      Required for National ID and Driving License. Skip for passport.
                    </p>
                  </div>
                  <div className="onboarding-field">
                    <LiveCapture
                      facingMode="user"
                      label={dict.documentsForm.selfieImageLabel}
                      onCapture={(f) => setManualSelfieFile(f)}
                      onClear={() => setManualSelfieFile(null)}
                      onError={setError}
                      required
                      disabled={saving}
                    />
                    <p className="onboarding-description" style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                      You must take a live photo of yourself now. No uploads allowed for selfie.
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
                  onClick={() => setStep('profile')}
                >
                  {dictionary.common.back}
                </button>
                <button
                  type="button"
                  className="onboarding-cta-button"
                  onClick={() => setStep('documents')}
                  disabled={kycStatus !== 'verified' && kycStatus !== 'pending'}
                >
                  {dictionary.common.next}
                </button>
              </div>
              {kycStatus !== 'verified' && kycStatus !== 'pending' && authUser?.verificationStatus !== 'rejected' && (
                <p className="onboarding-hint">
                  Complete identity verification or submit for manual review before continuing.
                </p>
              )}
            </div>
          )}

          {step === 'documents' && (
            <div className="onboarding-docs-section">
              <h2 className="onboarding-subtitle">{dict.documentsForm.academicTitle}</h2>
              <p className="onboarding-description">{dict.documentsForm.academicDescription}</p>

              {documentRejectedResubmit && (
                <div className="onboarding-error">{dict.documentRejectedResubmit}</div>
              )}

              <form className="onboarding-form" onSubmit={(e) => void handleSubmitDocs(e)}>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.documentsForm.recordTypeLabel}</label>
                  <select name="recordType" className="onboarding-input">
                    <option value="degree">
                      {dictionary.verification.academicRecordTypes.degree}
                    </option>
                    <option value="diploma">
                      {dictionary.verification.academicRecordTypes.diploma}
                    </option>
                    <option value="certificate">
                      {dictionary.verification.academicRecordTypes.certificate}
                    </option>
                    <option value="license">
                      {dictionary.verification.academicRecordTypes.license}
                    </option>
                  </select>
                </div>
                <DegreeInstitutionSelect
                  locale={locale}
                  degreeLabel={dict.documentsForm.titleLabel}
                  institutionLabel={dict.documentsForm.institutionLabel}
                  otherLabel={dict.documentsForm.otherInstitutionLabel}
                  degreeName="recordTitle"
                  institutionName="institution"
                  selectClassName="onboarding-input"
                  defaultCountry={profileCountry}
                  required
                />
                <div className="onboarding-field">
                  <ImageUploadOrCapture
                    label={dict.documentsForm.certificateImageLabel}
                    onImage={setCertificateFile}
                    onClear={() => setCertificateFile(null)}
                    onError={setError}
                    required
                    disabled={saving}
                  />
                </div>
                <div className="onboarding-field">
                  <ImageUploadOrCapture
                    label={dict.documentsForm.transcriptImageLabel}
                    onImage={setTranscriptFile}
                    onClear={() => setTranscriptFile(null)}
                    onError={setError}
                    disabled={saving}
                  />
                </div>
                <div className="onboarding-nav-row">
                  <button
                    type="button"
                    className="onboarding-back-button"
                    onClick={() => setStep('kyc')}
                  >
                    {dictionary.common.back}
                  </button>
                  <button type="submit" className="onboarding-cta-button" disabled={saving}>
                    {saving ? dictionary.auth.common.loading : dictionary.common.submit}
                  </button>
                </div>
              </form>
            </div>
          )}

          {step === 'complete' && (
            <div className="onboarding-complete">
              <p className="onboarding-description">{dict.description}</p>
              {authUser.verificationStatus === 'verified' ? (
                <Link href={buildLocalePath(locale, '/app')} className="onboarding-cta-button">
                  {dictionary.onboarding.customer.goToDashboard}
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
