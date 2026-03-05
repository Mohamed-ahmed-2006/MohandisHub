'use client';

import { useState } from 'react';

import { EmailVerification } from '@/components/auth/email-verification';
import { useAuth } from '@/components/auth/auth-provider';
import { KycStep } from '@/components/onboarding/kyc-step';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { profilesApiClient } from '@/lib/auth/client';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type BusinessOnboardingClientProps = {
  locale: Locale;
  dictionary: Dictionary;
};

export const BusinessOnboardingClient = ({
  locale: _locale,
  dictionary,
}: BusinessOnboardingClientProps) => {
  const { accessToken } = useAuth();
  const d = dictionary.onboarding.business;
  const steps = [d.steps.emailVerification, d.steps.kyc, d.steps.companyDetails, d.steps.documents];
  const [currentStep, setCurrentStep] = useState(0);

  // ── Company form state ─────────────────────────────────────────────
  const [companyValues, setCompanyValues] = useState({
    companyName: '',
    tradeLicense: '',
    taxId: '',
    commercialRegister: '',
    industry: '',
    companySize: '1-10',
    website: '',
    companyEmail: '',
    companyPhone: '',
    address: '',
    city: '',
    country: 'Egypt',
    description: '',
    ownerName: '',
    ownerTitle: '',
    ownerEmail: '',
    ownerPhone: '',
    foundedYear: '',
    employeesCount: '',
  });
  const [companySaved, setCompanySaved] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  // ── Documents form state ───────────────────────────────────────────
  const [identityDoc, setIdentityDoc] = useState({
    documentType: 'national_id' as string,
    fullNameOnDoc: '',
    documentNumber: '',
    nationality: '',
    frontImageUrl: '',
    backImageUrl: '',
    selfieImageUrl: '',
  });

  const [businessDocs, setBusinessDocs] = useState({
    tradeLicenseImageUrl: '',
    commercialRegisterImageUrl: '',
    taxIdImageUrl: '',
  });
  const [docsSaved, setDocsSaved] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const handleEmailVerified = () => {
    setCurrentStep(1);
  };

  const handleKycComplete = () => {
    setCurrentStep(2);
  };

  const handleCompanySave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) {
      setCompanyError(dictionary.common.comingSoon);
      return;
    }
    setCompanyError(null);
    try {
      const companySize = companyValues.companySize as
        | '1-10'
        | '11-50'
        | '51-200'
        | '201-500'
        | '500+';
      const body: Parameters<typeof profilesApiClient.updateBusinessProfile>[1] = {
        companySize,
      };
      if (companyValues.companyName) body.companyName = companyValues.companyName;
      if (companyValues.tradeLicense) body.tradeLicenseNumber = companyValues.tradeLicense;
      if (companyValues.taxId) body.taxId = companyValues.taxId;
      if (companyValues.commercialRegister) body.commercialRegister = companyValues.commercialRegister;
      if (companyValues.industry) body.industry = companyValues.industry;
      if (companyValues.website) body.website = companyValues.website;
      if (companyValues.companyEmail) body.companyEmail = companyValues.companyEmail;
      if (companyValues.companyPhone) body.companyPhone = companyValues.companyPhone;
      if (companyValues.address) body.address = companyValues.address;
      if (companyValues.city) body.city = companyValues.city;
      if (companyValues.country) body.country = companyValues.country;
      if (companyValues.description) body.description = companyValues.description;
      if (companyValues.ownerName) body.ownerFullName = companyValues.ownerName;
      if (companyValues.ownerTitle) body.ownerTitle = companyValues.ownerTitle;
      if (companyValues.ownerEmail) body.ownerEmail = companyValues.ownerEmail;
      if (companyValues.ownerPhone) body.ownerPhone = companyValues.ownerPhone;
      if (companyValues.foundedYear)
        body.foundedYear = parseInt(companyValues.foundedYear, 10);
      if (companyValues.employeesCount)
        body.employeesCount = parseInt(companyValues.employeesCount, 10);
      await profilesApiClient.updateBusinessProfile(accessToken, body);
      setCompanySaved(true);
      setCurrentStep(3);
    } catch (err) {
      setCompanyError(err instanceof Error ? err.message : dictionary.common.comingSoon);
    }
  };

  const handleDocsSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) {
      setDocsError(dictionary.common.comingSoon);
      return;
    }
    setDocsError(null);
    try {
      if (identityDoc.fullNameOnDoc && identityDoc.documentType) {
        const idBody: Parameters<typeof profilesApiClient.submitIdentityDocument>[1] = {
          documentType: identityDoc.documentType as
            | 'national_id'
            | 'driving_license'
            | 'passport',
          fullNameOnDoc: identityDoc.fullNameOnDoc,
        };
        if (identityDoc.documentNumber) idBody.documentNumber = identityDoc.documentNumber;
        if (identityDoc.nationality) idBody.nationality = identityDoc.nationality;
        if (identityDoc.frontImageUrl) idBody.frontImageUrl = identityDoc.frontImageUrl;
        if (identityDoc.backImageUrl) idBody.backImageUrl = identityDoc.backImageUrl;
        if (identityDoc.selfieImageUrl) idBody.selfieImageUrl = identityDoc.selfieImageUrl;
        await profilesApiClient.submitIdentityDocument(accessToken, idBody);
      }
      await profilesApiClient.updateBusinessProfile(accessToken, {
        profileCompletedAt: new Date().toISOString(),
      });
      setDocsSaved(true);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : dictionary.common.comingSoon);
    }
  };

  const cf = d.companyForm;
  const df = d.documentsForm;
  const vd = dictionary.verification;

  return (
    <div className="onboarding-flow-shell">
      <OnboardingStepper
        steps={steps}
        currentStep={currentStep}
        stepLabel={dictionary.common.step}
        ofLabel={dictionary.common.of}
      />

      <div className="onboarding-step-content">
        {/* Step 0: Email Verification */}
        {currentStep === 0 ? (
          <EmailVerification
            dictionary={dictionary.emailVerification}
            onVerified={handleEmailVerified}
          />
        ) : null}

        {/* Step 1: KYC */}
        {currentStep === 1 ? (
          <KycStep
            title={d.kycTitle}
            description={d.kycDescription}
            buttonLabel={d.kycButton}
            pendingLabel={d.kycPending}
            verifiedLabel={d.kycVerified}
            rejectedLabel={d.kycRejected}
            onComplete={handleKycComplete}
          />
        ) : null}

        {/* Step 2: Company Details */}
        {currentStep === 2 ? (
          <div className="onboarding-form-shell">
            <h2 className="onboarding-form-title">{d.steps.companyDetails}</h2>
            {companyError ? (
              <div className="onboarding-form-error">{companyError}</div>
            ) : null}
            <form className="onboarding-form" onSubmit={(e) => void handleCompanySave(e)}>
              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{cf.companyNameLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={companyValues.companyName}
                  onChange={(e) =>
                    setCompanyValues((v) => ({ ...v, companyName: e.target.value }))
                  }
                />
              </label>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.tradeLicenseLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.tradeLicense}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, tradeLicense: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.taxIdLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.taxId}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, taxId: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{cf.commercialRegisterLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={companyValues.commercialRegister}
                  onChange={(e) =>
                    setCompanyValues((v) => ({ ...v, commercialRegister: e.target.value }))
                  }
                />
              </label>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.industryLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.industry}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, industry: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.companySizeLabel}</span>
                  <select
                    className="onboarding-field-select"
                    value={companyValues.companySize}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, companySize: e.target.value }))
                    }
                  >
                    <option value="1-10">{vd.companySizes['1-10']}</option>
                    <option value="11-50">{vd.companySizes['11-50']}</option>
                    <option value="51-200">{vd.companySizes['51-200']}</option>
                    <option value="201-500">{vd.companySizes['201-500']}</option>
                    <option value="500+">{vd.companySizes['500+']}</option>
                  </select>
                </label>
              </div>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.websiteLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={companyValues.website}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, website: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.companyEmailLabel}</span>
                  <input
                    type="email"
                    className="onboarding-field-input"
                    value={companyValues.companyEmail}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, companyEmail: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.companyPhoneLabel}</span>
                  <input
                    type="tel"
                    className="onboarding-field-input"
                    value={companyValues.companyPhone}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, companyPhone: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.foundedYearLabel}</span>
                  <input
                    type="number"
                    className="onboarding-field-input"
                    value={companyValues.foundedYear}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, foundedYear: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{cf.addressLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={companyValues.address}
                  onChange={(e) =>
                    setCompanyValues((v) => ({ ...v, address: e.target.value }))
                  }
                />
              </label>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.cityLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.city}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, city: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.countryLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.country}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, country: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{cf.descriptionLabel}</span>
                <textarea
                  className="onboarding-field-textarea"
                  rows={3}
                  value={companyValues.description}
                  onChange={(e) =>
                    setCompanyValues((v) => ({ ...v, description: e.target.value }))
                  }
                />
              </label>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.ownerNameLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.ownerName}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, ownerName: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.ownerTitleLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={companyValues.ownerTitle}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, ownerTitle: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.ownerEmailLabel}</span>
                  <input
                    type="email"
                    className="onboarding-field-input"
                    value={companyValues.ownerEmail}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, ownerEmail: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{cf.ownerPhoneLabel}</span>
                  <input
                    type="tel"
                    className="onboarding-field-input"
                    value={companyValues.ownerPhone}
                    onChange={(e) =>
                      setCompanyValues((v) => ({ ...v, ownerPhone: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{cf.employeesCountLabel}</span>
                <input
                  type="number"
                  className="onboarding-field-input"
                  value={companyValues.employeesCount}
                  onChange={(e) =>
                    setCompanyValues((v) => ({ ...v, employeesCount: e.target.value }))
                  }
                />
              </label>

              <button type="submit" className="onboarding-form-submit-button">
                {companySaved ? '✓' : dictionary.common.save}
              </button>
            </form>
          </div>
        ) : null}

        {/* Step 3: Upload Documents */}
        {currentStep === 3 ? (
          <div className="onboarding-form-shell">
            <h2 className="onboarding-form-title">{d.steps.documents}</h2>
            {docsError ? (
              <div className="onboarding-form-error">{docsError}</div>
            ) : null}
            <form className="onboarding-form" onSubmit={(e) => void handleDocsSave(e)}>
              {/* Identity Document */}
              <fieldset className="onboarding-fieldset">
                <legend className="onboarding-fieldset-legend">{df.identityTitle}</legend>
                <p className="onboarding-fieldset-description">{df.identityDescription}</p>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.documentTypeLabel}</span>
                  <select
                    className="onboarding-field-select"
                    value={identityDoc.documentType}
                    onChange={(e) =>
                      setIdentityDoc((v) => ({ ...v, documentType: e.target.value }))
                    }
                  >
                    <option value="national_id">{vd.identityDocTypes.nationalId}</option>
                    <option value="driving_license">{vd.identityDocTypes.drivingLicense}</option>
                    <option value="passport">{vd.identityDocTypes.passport}</option>
                  </select>
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.fullNameOnDocLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={identityDoc.fullNameOnDoc}
                    onChange={(e) =>
                      setIdentityDoc((v) => ({ ...v, fullNameOnDoc: e.target.value }))
                    }
                  />
                </label>

                <div className="onboarding-field-row">
                  <label className="onboarding-field-group">
                    <span className="onboarding-field-label">{df.documentNumberLabel}</span>
                    <input
                      type="text"
                      className="onboarding-field-input"
                      value={identityDoc.documentNumber}
                      onChange={(e) =>
                        setIdentityDoc((v) => ({ ...v, documentNumber: e.target.value }))
                      }
                    />
                  </label>

                  <label className="onboarding-field-group">
                    <span className="onboarding-field-label">{df.nationalityLabel}</span>
                    <input
                      type="text"
                      className="onboarding-field-input"
                      value={identityDoc.nationality}
                      onChange={(e) =>
                        setIdentityDoc((v) => ({ ...v, nationality: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.frontImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={identityDoc.frontImageUrl}
                    onChange={(e) =>
                      setIdentityDoc((v) => ({ ...v, frontImageUrl: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.backImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={identityDoc.backImageUrl}
                    onChange={(e) =>
                      setIdentityDoc((v) => ({ ...v, backImageUrl: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.selfieImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={identityDoc.selfieImageUrl}
                    onChange={(e) =>
                      setIdentityDoc((v) => ({ ...v, selfieImageUrl: e.target.value }))
                    }
                  />
                </label>
              </fieldset>

              {/* Business Documents */}
              <fieldset className="onboarding-fieldset">
                <legend className="onboarding-fieldset-legend">{df.businessDocsTitle}</legend>
                <p className="onboarding-fieldset-description">{df.businessDocsDescription}</p>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.tradeLicenseImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={businessDocs.tradeLicenseImageUrl}
                    onChange={(e) =>
                      setBusinessDocs((v) => ({ ...v, tradeLicenseImageUrl: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.commercialRegisterImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={businessDocs.commercialRegisterImageUrl}
                    onChange={(e) =>
                      setBusinessDocs((v) => ({
                        ...v,
                        commercialRegisterImageUrl: e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.taxIdImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={businessDocs.taxIdImageUrl}
                    onChange={(e) =>
                      setBusinessDocs((v) => ({ ...v, taxIdImageUrl: e.target.value }))
                    }
                  />
                </label>
              </fieldset>

              <button type="submit" className="onboarding-form-submit-button">
                {docsSaved ? '✓' : dictionary.common.submit}
              </button>
            </form>

            {docsSaved ? (
              <div className="onboarding-complete-message">
                <p>{dictionary.common.comingSoon}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};
