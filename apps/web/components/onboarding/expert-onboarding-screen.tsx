'use client';

import type { IdentityDocumentType, UpdateExpertProfileBody } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { SiteLogo } from '@/components/site-logo';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
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

export const ExpertOnboardingScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [step, setStep] = useState<Step>('profile');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [kycMode, setKycMode] = useState<'didit' | 'manual' | null>(null);

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

  useEffect(() => {
    void loadKycStatus();
  }, [loadKycStatus]);

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

    const body = pickDefined({
      title: val('title'),
      headline: val('headline'),
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
      languages: ((form.elements.namedItem('languages') as HTMLInputElement)?.value || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      educationSummary: val('educationSummary'),
    });

    try {
      await profilesApiClient.updateExpertProfile(accessToken, body as UpdateExpertProfileBody);
      setStep('kyc');
    } catch {
      setError(dictionary.profile.saveError);
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
      setKycMode('manual');
    } finally {
      setSaving(false);
    }
  };

  const handleManualKyc = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const docType = (form.elements.namedItem('documentType') as HTMLSelectElement)
      ?.value as IdentityDocumentType;
    const fullNameOnDoc =
      (form.elements.namedItem('fullNameOnDoc') as HTMLInputElement)?.value || '';

    try {
      await profilesApiClient.submitIdentityDocument(accessToken, {
        documentType: docType,
        fullNameOnDoc,
      });
      setKycStatus('pending');
      setKycMode(null);
    } catch {
      setError(dict.kycRejected);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitDocs = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    setSaving(true);
    setError(null);
    const form = e.currentTarget;
    const recordType =
      (form.elements.namedItem('recordType') as HTMLSelectElement)?.value || 'degree';
    const title = (form.elements.namedItem('recordTitle') as HTMLInputElement)?.value || '';
    const institution = (form.elements.namedItem('institution') as HTMLInputElement)?.value || '';

    try {
      await profilesApiClient.submitAcademicRecord(accessToken, {
        recordType: recordType as 'degree' | 'diploma' | 'certificate' | 'license',
        title,
        institution,
      });
      await updateAuthUser();
      setStep('complete');
    } catch {
      setError(dictionary.profile.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser) {
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
                />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.headlineLabel}</label>
                <input type="text" name="headline" className="onboarding-input" />
              </div>
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.profileForm.bioLabel}</label>
                <textarea name="bio" className="onboarding-input onboarding-textarea" rows={3} />
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
                  <label className="onboarding-label">{dict.profileForm.cityLabel}</label>
                  <input type="text" name="city" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.countryLabel}</label>
                  <input type="text" name="country" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.employerLabel}</label>
                  <input type="text" name="employer" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.jobTitleLabel}</label>
                  <input type="text" name="jobTitle" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.linkedinLabel}</label>
                  <input type="url" name="linkedinUrl" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.portfolioLabel}</label>
                  <input type="url" name="portfolioUrl" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.profileForm.languagesLabel}</label>
                  <input
                    type="text"
                    name="languages"
                    className="onboarding-input"
                    placeholder={dict.profileForm.languagesHint}
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

              {kycStatus === 'verified' && (
                <div className="onboarding-success">{dict.kycVerified}</div>
              )}

              {kycStatus === 'pending' && <div className="onboarding-info">{dict.kycPending}</div>}

              {kycStatus === 'rejected' && (
                <div className="onboarding-error">{dict.kycRejected}</div>
              )}

              {(kycStatus === 'unverified' || kycStatus === 'rejected') && !kycMode && (
                <button
                  type="button"
                  className="onboarding-cta-button"
                  onClick={() => void handleInitiateKyc()}
                  disabled={saving}
                >
                  {saving ? dictionary.auth.common.loading : dict.kycButton}
                </button>
              )}

              {kycMode === 'manual' && (
                <form className="onboarding-form" onSubmit={(e) => void handleManualKyc(e)}>
                  <p className="onboarding-description">{dict.documentsForm.identityDescription}</p>
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
                  <button type="submit" className="onboarding-cta-button" disabled={saving}>
                    {saving ? dictionary.auth.common.loading : dictionary.common.submit}
                  </button>
                </form>
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
                >
                  {dictionary.common.next}
                </button>
              </div>
            </div>
          )}

          {step === 'documents' && (
            <div className="onboarding-docs-section">
              <h2 className="onboarding-subtitle">{dict.documentsForm.academicTitle}</h2>
              <p className="onboarding-description">{dict.documentsForm.academicDescription}</p>

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
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.documentsForm.titleLabel}</label>
                  <input type="text" name="recordTitle" className="onboarding-input" required />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.documentsForm.institutionLabel}</label>
                  <input type="text" name="institution" className="onboarding-input" required />
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
