'use client';

import type { IdentityDocumentType, UpdateBusinessProfileBody } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { SiteLogo } from '@/components/site-logo';
import { Container } from '@/components/ui/container';
import { CityCountrySelect } from '@/components/ui/city-country-select';
import { ImageUploadOrCapture } from '@/components/ui/image-upload-or-capture';
import { IndustrySelect } from '@/components/ui/industry-select';
import { LiveCapture } from '@/components/ui/live-capture';
import { getApiBaseUrl } from '@/lib/env';
import { INDUSTRIES } from '@/lib/data/industries';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { formatApiError } from '@/lib/utils/format-api-error';
import { uploadFile } from '@/lib/upload/client';
import { verificationApiClient } from '@/lib/verification/client';

type Props = { locale: Locale; dictionary: Dictionary };

type Step = 'company' | 'kyc' | 'documents' | 'complete';
const STEP_ORDER: Step[] = ['company', 'kyc', 'documents', 'complete'];

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

export const BusinessOnboardingScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [step, setStep] = useState<Step>('company');
  const [stepResolved, setStepResolved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [kycMode, setKycMode] = useState<'didit' | 'manual' | null>(null);
  const [manualFrontFile, setManualFrontFile] = useState<File | null>(null);
  const [manualBackFile, setManualBackFile] = useState<File | null>(null);
  const [manualSelfieFile, setManualSelfieFile] = useState<File | null>(null);
  const [businessDocsFrontFile, setBusinessDocsFrontFile] = useState<File | null>(null);
  const [businessDocsBackFile, setBusinessDocsBackFile] = useState<File | null>(null);
  const [businessDocsSelfieFile, setBusinessDocsSelfieFile] = useState<File | null>(null);

  const dict = dictionary.onboarding.business;
  const stepLabels = [dict.steps.companyDetails, dict.steps.kyc, dict.steps.documents];

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

  // When on complete step or pending KYC, refresh auth and status so verificationStatus updates after admin approval
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
          profilesApiClient.getBusinessProfile(accessToken),
          verificationApiClient.getStatus(accessToken).catch(() => ({ verificationStatus: 'unverified' as const })),
          profilesApiClient.getIdentityDocuments(accessToken).catch(() => []),
        ]);
        if (cancelled) return;
        setKycStatus(verification.verificationStatus);
        const companyComplete = Boolean(profile?.companyName?.trim());
        // Use profile/API status; authUser.verificationStatus reflects GET /me (profile) so include for consistency after refresh
        const effectiveVerified =
          verification.verificationStatus === 'verified' || authUser?.verificationStatus === 'verified';
        const identityDone =
          verification.verificationStatus === 'verified' ||
          verification.verificationStatus === 'pending' ||
          authUser?.verificationStatus === 'verified';
        const hasSubmittedDocs = Array.isArray(identityDocs) && identityDocs.length > 0;
        const fullyVerified = effectiveVerified;
        if (!companyComplete) {
          setStep('company');
        } else if (!identityDone) {
          setStep('kyc');
        } else if (!fullyVerified && !hasSubmittedDocs) {
          setStep('documents');
        } else {
          setStep('complete');
        }
      } catch {
        if (!cancelled) setStep('company');
      } finally {
        if (!cancelled) setStepResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken, authUser?.verificationStatus]);

  const handleSaveCompany = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);
    const numVal = (name: string) => {
      const n = parseInt((form.elements.namedItem(name) as HTMLInputElement)?.value || '', 10);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };

    const sizeVal = nonEmpty((form.elements.namedItem('companySize') as HTMLSelectElement)?.value);
    const industryVal = nonEmpty((form.elements.namedItem('industry') as HTMLSelectElement)?.value);
    const subIndustryVal = nonEmpty((form.elements.namedItem('subIndustry') as HTMLSelectElement)?.value);
    const industryDisplay =
      industryVal && subIndustryVal
        ? `${industryVal} — ${subIndustryVal}`
        : industryVal;
    const body = pickDefined({
      companyName: val('companyName'),
      tradeLicenseNumber: val('tradeLicenseNumber'),
      taxId: val('taxId'),
      commercialRegister: val('commercialRegister'),
      industry: industryDisplay,
      companySize: sizeVal as UpdateBusinessProfileBody['companySize'],
      website: val('website'),
      companyEmail: val('companyEmail'),
      companyPhone: val('companyPhone'),
      address: val('address'),
      city: val('city'),
      country: val('country'),
      description: val('description'),
      ownerFullName: val('ownerFullName'),
      ownerTitle: val('ownerTitle'),
      ownerEmail: val('ownerEmail'),
      ownerPhone: val('ownerPhone'),
      foundedYear: numVal('foundedYear'),
    });

    try {
      await profilesApiClient.updateBusinessProfile(accessToken, body as UpdateBusinessProfileBody);
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
    } catch {
      setError(dict.kycRejected);
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
      setError(
        'Please capture/upload all required images: document front, document back (if applicable), and a live selfie.',
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const base = (getApiBaseUrl() || '').replace(/\/$/, '');
      const toFullUrl = (url: string) =>
        url.startsWith('http') ? url : base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;

      const [frontRes, backRes, selfieRes] = await Promise.all([
        uploadFile(accessToken, manualFrontFile),
        manualBackFile ? uploadFile(accessToken, manualBackFile) : Promise.resolve(null),
        uploadFile(accessToken, manualSelfieFile),
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

  const handleSubmitBusinessDocs = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    const form = e.currentTarget;
    const docType = (form.elements.namedItem('documentType') as HTMLSelectElement)
      ?.value as IdentityDocumentType;
    const fullNameOnDoc =
      (form.elements.namedItem('fullNameOnDoc') as HTMLInputElement)?.value?.trim() || '';

    const needsBack = docType === 'national_id' || docType === 'driving_license';
    if (
      !businessDocsFrontFile ||
      !businessDocsSelfieFile ||
      (needsBack && !businessDocsBackFile)
    ) {
      setError(
        'Please capture/upload all required images: document front, document back (if applicable), and a live selfie.',
      );
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const base = (getApiBaseUrl() || '').replace(/\/$/, '');
      const toFullUrl = (url: string) =>
        url.startsWith('http') ? url : base ? `${base}${url.startsWith('/') ? '' : '/'}${url}` : url;

      const [frontRes, backRes, selfieRes] = await Promise.all([
        uploadFile(accessToken, businessDocsFrontFile),
        businessDocsBackFile ? uploadFile(accessToken, businessDocsBackFile) : Promise.resolve(null),
        uploadFile(accessToken, businessDocsSelfieFile),
      ]);

      await profilesApiClient.submitIdentityDocument(accessToken, {
        documentType: docType,
        fullNameOnDoc,
        frontImageUrl: toFullUrl(frontRes.url),
        selfieImageUrl: toFullUrl(selfieRes.url),
        ...(backRes && { backImageUrl: toFullUrl(backRes.url) }),
      });
      await updateAuthUser();
      setStep('complete');
      setBusinessDocsFrontFile(null);
      setBusinessDocsBackFile(null);
      setBusinessDocsSelfieFile(null);
    } catch (err) {
      setError(formatApiError(err, dictionary.profile.saveError));
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser || !stepResolved) {
    return (
      <main className="business-onboarding-page-main">
        <Container>
          <p className="onboarding-loading">{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const currentStepIndex = STEP_ORDER.indexOf(step);

  return (
    <main className="business-onboarding-page-main">
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

          {step === 'company' && (
            <form className="onboarding-form" onSubmit={(e) => void handleSaveCompany(e)}>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.companyForm.companyNameLabel}</label>
                <input type="text" name="companyName" className="onboarding-input" required />
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.industryLabel}</label>
                  <IndustrySelect locale={locale} name="industry" subName="subIndustry" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.companySizeLabel}</label>
                  <select name="companySize" className="onboarding-input">
                    <option value="" />
                    {Object.entries(dictionary.verification.companySizes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.websiteLabel}</label>
                  <input type="text" name="website" className="onboarding-input" placeholder="example.com or full URL" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.companyEmailLabel}</label>
                  <input type="email" name="companyEmail" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.companyForm.companyPhoneLabel}</label>
                <input type="tel" name="companyPhone" className="onboarding-input" maxLength={15} />
              </div>
              <CityCountrySelect
                name="city"
                countryName="country"
                locale={locale}
                cityLabel={dict.companyForm.cityLabel}
                countryLabel={dict.companyForm.countryLabel}
                className="onboarding-field"
                selectClassName="onboarding-input"
              />
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.foundedYearLabel}</label>
                  <input
                    type="number"
                    name="foundedYear"
                    className="onboarding-input"
                    min="1900"
                    max="2030"
                  />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.companyForm.addressLabel}</label>
                <textarea
                  name="address"
                  className="onboarding-input onboarding-textarea"
                  rows={2}
                  placeholder="Paste a Google Maps link or enter address"
                />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.companyForm.descriptionLabel}</label>
                <textarea
                  name="description"
                  className="onboarding-input onboarding-textarea"
                  rows={3}
                />
              </div>

              <h3 className="onboarding-subtitle">{dict.companyForm.ownerNameLabel}</h3>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.ownerNameLabel}</label>
                  <input type="text" name="ownerFullName" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.ownerTitleLabel}</label>
                  <input type="text" name="ownerTitle" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.ownerEmailLabel}</label>
                  <input type="email" name="ownerEmail" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.ownerPhoneLabel}</label>
                  <input type="tel" name="ownerPhone" className="onboarding-input" />
                </div>
              </div>

              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.tradeLicenseLabel}</label>
                  <input type="text" name="tradeLicenseNumber" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.taxIdLabel}</label>
                  <input type="text" name="taxId" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">
                  {dict.companyForm.commercialRegisterLabel}
                </label>
                <input type="text" name="commercialRegister" className="onboarding-input" />
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

              {kycStatus === 'verified' && (
                <div className="onboarding-success">{dict.kycVerified}</div>
              )}
              {kycStatus === 'pending' && <div className="onboarding-info">{dict.kycPending}</div>}
              {kycStatus === 'rejected' && (
                <div className="onboarding-error">{dict.kycRejected}</div>
              )}

              {(kycStatus === 'unverified' || kycStatus === 'rejected') && (
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
                    {dict.documentsForm.identityDescription} You must take a live photo of yourself and a photo of your ID. Upload or take live pictures.
                  </p>
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
                  onClick={() => setStep('company')}
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
              {kycStatus !== 'verified' && kycStatus !== 'pending' && (
                <p className="onboarding-hint">
                  Complete identity verification or submit for manual review before continuing.
                </p>
              )}
            </div>
          )}

          {step === 'documents' && (
            <div className="onboarding-docs-section">
              <h2 className="onboarding-subtitle">{dict.documentsForm.businessDocsTitle}</h2>
              <p className="onboarding-description">
                {dict.documentsForm.businessDocsDescription} You must take a live photo of yourself and a photo of your ID. Upload or take live pictures.
              </p>

              <form className="onboarding-form" onSubmit={(e) => void handleSubmitBusinessDocs(e)}>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.documentsForm.documentTypeLabel}</label>
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
                    onImage={(f) => setBusinessDocsFrontFile(f)}
                    onClear={() => setBusinessDocsFrontFile(null)}
                    onError={setError}
                    required
                    disabled={saving}
                  />
                </div>
                <div className="onboarding-field">
                  <ImageUploadOrCapture
                    label={dict.documentsForm.backImageLabel}
                    onImage={(f) => setBusinessDocsBackFile(f)}
                    onClear={() => setBusinessDocsBackFile(null)}
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
                    onCapture={(f) => setBusinessDocsSelfieFile(f)}
                    onClear={() => setBusinessDocsSelfieFile(null)}
                    onError={setError}
                    required
                    disabled={saving}
                  />
                  <p className="onboarding-description" style={{ marginTop: '0.25rem', fontSize: '0.8rem' }}>
                    You must take a live photo of yourself now. No uploads allowed for selfie.
                  </p>
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
              {kycStatus === 'pending' && <div className="onboarding-info">{dict.kycPending}</div>}
              <Link href={buildLocalePath(locale, '/app')} className="onboarding-cta-button">
                {dictionary.onboarding.customer.goToDashboard}
              </Link>
            </div>
          )}
        </section>
      </Container>
    </main>
  );
};
