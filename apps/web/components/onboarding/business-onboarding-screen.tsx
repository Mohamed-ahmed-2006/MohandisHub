'use client';

import type { IdentityDocumentType, UpdateBusinessProfileBody } from '@mohandishub/shared';
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kycStatus, setKycStatus] = useState<string>('unverified');
  const [kycMode, setKycMode] = useState<'didit' | 'manual' | null>(null);

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
    const body = pickDefined({
      companyName: val('companyName'),
      tradeLicenseNumber: val('tradeLicenseNumber'),
      taxId: val('taxId'),
      commercialRegister: val('commercialRegister'),
      industry: val('industry'),
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
      employeesCount: numVal('employeesCount'),
      foundedYear: numVal('foundedYear'),
    });

    try {
      await profilesApiClient.updateBusinessProfile(accessToken, body as UpdateBusinessProfileBody);
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

  const handleSubmitBusinessDocs = async (e: React.FormEvent<HTMLFormElement>) => {
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
                  <input type="text" name="industry" className="onboarding-input" />
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
                  <input type="url" name="website" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.companyEmailLabel}</label>
                  <input type="email" name="companyEmail" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.companyPhoneLabel}</label>
                  <input type="tel" name="companyPhone" className="onboarding-input" />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.cityLabel}</label>
                  <input type="text" name="city" className="onboarding-input" />
                </div>
              </div>
              <div className="onboarding-row">
                <div className="onboarding-field">
                  <label className="onboarding-label">{dict.companyForm.countryLabel}</label>
                  <input type="text" name="country" className="onboarding-input" />
                </div>
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
              <div className="onboarding-field">
                <label className="onboarding-label">{dict.companyForm.employeesCountLabel}</label>
                <input type="number" name="employeesCount" className="onboarding-input" min="1" />
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
                  onClick={() => setStep('company')}
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
              <h2 className="onboarding-subtitle">{dict.documentsForm.businessDocsTitle}</h2>
              <p className="onboarding-description">{dict.documentsForm.businessDocsDescription}</p>

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
