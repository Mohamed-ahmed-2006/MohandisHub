'use client';

import { useState } from 'react';

import { EmailVerification } from '@/components/auth/email-verification';
import { useAuth } from '@/components/auth/auth-provider';
import { KycStep } from '@/components/onboarding/kyc-step';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { authApiClient, profilesApiClient } from '@/lib/auth/client';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type ExpertOnboardingClientProps = {
  locale: Locale;
  dictionary: Dictionary;
};

export const ExpertOnboardingClient = ({
  locale: _locale,
  dictionary,
}: ExpertOnboardingClientProps) => {
  const { accessToken } = useAuth();
  const d = dictionary.onboarding.expert;
  const steps = [d.steps.emailVerification, d.steps.kyc, d.steps.profileDetails, d.steps.documents];
  const [currentStep, setCurrentStep] = useState(0);

  // ── Profile form state ─────────────────────────────────────────────
  const [profileValues, setProfileValues] = useState({
    title: '',
    headline: '',
    bio: '',
    specializations: '',
    yearsOfExperience: '',
    hourlyRate: '',
    city: '',
    country: 'Egypt',
    employer: '',
    jobTitle: '',
    linkedinUrl: '',
    portfolioUrl: '',
    languages: '',
    educationSummary: '',
  });
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

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

  const [academicRecord, setAcademicRecord] = useState({
    recordType: 'degree' as string,
    title: '',
    institution: '',
    fieldOfStudy: '',
    graduationYear: '',
    grade: '',
    certificateImageUrl: '',
    transcriptImageUrl: '',
  });
  const [docsSaved, setDocsSaved] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);

  const handleEmailVerified = () => {
    setCurrentStep(1);
  };

  const handleKycComplete = () => {
    setCurrentStep(2);
  };

  const handleProfileSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) {
      setProfileError(dictionary.common.comingSoon);
      return;
    }
    setProfileError(null);
    try {
      const specializations = profileValues.specializations
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const languages = profileValues.languages
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Parameters<typeof profilesApiClient.updateExpertProfile>[1] = {};
      if (profileValues.title) body.title = profileValues.title;
      if (profileValues.headline) body.headline = profileValues.headline;
      if (profileValues.bio) body.bio = profileValues.bio;
      if (specializations.length > 0) body.specializations = specializations;
      if (profileValues.yearsOfExperience)
        body.yearsOfExperience = parseInt(profileValues.yearsOfExperience, 10);
      if (profileValues.hourlyRate) body.hourlyRate = parseFloat(profileValues.hourlyRate);
      if (profileValues.city) body.city = profileValues.city;
      if (profileValues.country) body.country = profileValues.country;
      if (profileValues.employer) body.employer = profileValues.employer;
      if (profileValues.jobTitle) body.jobTitle = profileValues.jobTitle;
      if (profileValues.linkedinUrl) body.linkedinUrl = profileValues.linkedinUrl;
      if (profileValues.portfolioUrl) body.portfolioUrl = profileValues.portfolioUrl;
      if (languages.length > 0) body.languages = languages;
      if (profileValues.educationSummary) body.educationSummary = profileValues.educationSummary;
      await profilesApiClient.updateExpertProfile(accessToken, body);
      setProfileSaved(true);
      setCurrentStep(3);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : dictionary.common.comingSoon);
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
      if (
        identityDoc.fullNameOnDoc &&
        identityDoc.documentType
      ) {
        const idBody: Parameters<typeof profilesApiClient.submitIdentityDocument>[1] = {
          documentType: identityDoc.documentType as 'national_id' | 'driving_license' | 'passport',
          fullNameOnDoc: identityDoc.fullNameOnDoc,
        };
        if (identityDoc.documentNumber) idBody.documentNumber = identityDoc.documentNumber;
        if (identityDoc.nationality) idBody.nationality = identityDoc.nationality;
        if (identityDoc.frontImageUrl) idBody.frontImageUrl = identityDoc.frontImageUrl;
        if (identityDoc.backImageUrl) idBody.backImageUrl = identityDoc.backImageUrl;
        if (identityDoc.selfieImageUrl) idBody.selfieImageUrl = identityDoc.selfieImageUrl;
        await profilesApiClient.submitIdentityDocument(accessToken, idBody);
      }
      if (
        academicRecord.title &&
        academicRecord.institution &&
        academicRecord.recordType
      ) {
        const acBody: Parameters<typeof profilesApiClient.submitAcademicRecord>[1] = {
          recordType: academicRecord.recordType as 'degree' | 'diploma' | 'certificate' | 'license',
          title: academicRecord.title,
          institution: academicRecord.institution,
        };
        if (academicRecord.fieldOfStudy) acBody.fieldOfStudy = academicRecord.fieldOfStudy;
        if (academicRecord.graduationYear)
          acBody.graduationYear = parseInt(academicRecord.graduationYear, 10);
        if (academicRecord.grade) acBody.grade = academicRecord.grade;
        if (academicRecord.certificateImageUrl)
          acBody.certificateImageUrl = academicRecord.certificateImageUrl;
        if (academicRecord.transcriptImageUrl)
          acBody.transcriptImageUrl = academicRecord.transcriptImageUrl;
        await profilesApiClient.submitAcademicRecord(accessToken, acBody);
      }
      await profilesApiClient.updateExpertProfile(accessToken, {
        profileCompletedAt: new Date().toISOString(),
      });
      setDocsSaved(true);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : dictionary.common.comingSoon);
    }
  };

  const pf = d.profileForm;
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

        {/* Step 2: Profile Details */}
        {currentStep === 2 ? (
          <div className="onboarding-form-shell">
            <h2 className="onboarding-form-title">{d.steps.profileDetails}</h2>
            {profileError ? (
              <div className="onboarding-form-error">{profileError}</div>
            ) : null}
            <form className="onboarding-form" onSubmit={(e) => void handleProfileSave(e)}>
              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.titleLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  placeholder={pf.titlePlaceholder}
                  value={profileValues.title}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, title: e.target.value }))
                  }
                />
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.headlineLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={profileValues.headline}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, headline: e.target.value }))
                  }
                />
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.bioLabel}</span>
                <textarea
                  className="onboarding-field-textarea"
                  rows={3}
                  value={profileValues.bio}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, bio: e.target.value }))
                  }
                />
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.specializationsLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={profileValues.specializations}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, specializations: e.target.value }))
                  }
                />
                <span className="onboarding-field-hint">{pf.specializationsHint}</span>
              </label>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.yearsOfExperienceLabel}</span>
                  <input
                    type="number"
                    className="onboarding-field-input"
                    value={profileValues.yearsOfExperience}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, yearsOfExperience: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.hourlyRateLabel}</span>
                  <input
                    type="number"
                    className="onboarding-field-input"
                    value={profileValues.hourlyRate}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, hourlyRate: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.cityLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={profileValues.city}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, city: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.countryLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={profileValues.country}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, country: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className="onboarding-field-row">
                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.employerLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={profileValues.employer}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, employer: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{pf.jobTitleLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={profileValues.jobTitle}
                    onChange={(e) =>
                      setProfileValues((v) => ({ ...v, jobTitle: e.target.value }))
                    }
                  />
                </label>
              </div>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.linkedinLabel}</span>
                <input
                  type="url"
                  className="onboarding-field-input"
                  value={profileValues.linkedinUrl}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, linkedinUrl: e.target.value }))
                  }
                />
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.portfolioLabel}</span>
                <input
                  type="url"
                  className="onboarding-field-input"
                  value={profileValues.portfolioUrl}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, portfolioUrl: e.target.value }))
                  }
                />
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.languagesLabel}</span>
                <input
                  type="text"
                  className="onboarding-field-input"
                  value={profileValues.languages}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, languages: e.target.value }))
                  }
                />
                <span className="onboarding-field-hint">{pf.languagesHint}</span>
              </label>

              <label className="onboarding-field-group">
                <span className="onboarding-field-label">{pf.educationSummaryLabel}</span>
                <textarea
                  className="onboarding-field-textarea"
                  rows={2}
                  value={profileValues.educationSummary}
                  onChange={(e) =>
                    setProfileValues((v) => ({ ...v, educationSummary: e.target.value }))
                  }
                />
              </label>

              <button type="submit" className="onboarding-form-submit-button">
                {profileSaved ? '✓' : dictionary.common.save}
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

              {/* Academic Record */}
              <fieldset className="onboarding-fieldset">
                <legend className="onboarding-fieldset-legend">{df.academicTitle}</legend>
                <p className="onboarding-fieldset-description">{df.academicDescription}</p>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.recordTypeLabel}</span>
                  <select
                    className="onboarding-field-select"
                    value={academicRecord.recordType}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({ ...v, recordType: e.target.value }))
                    }
                  >
                    <option value="degree">{vd.academicRecordTypes.degree}</option>
                    <option value="diploma">{vd.academicRecordTypes.diploma}</option>
                    <option value="certificate">{vd.academicRecordTypes.certificate}</option>
                    <option value="license">{vd.academicRecordTypes.license}</option>
                  </select>
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.titleLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={academicRecord.title}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({ ...v, title: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.institutionLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={academicRecord.institution}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({ ...v, institution: e.target.value }))
                    }
                  />
                </label>

                <div className="onboarding-field-row">
                  <label className="onboarding-field-group">
                    <span className="onboarding-field-label">{df.fieldOfStudyLabel}</span>
                    <input
                      type="text"
                      className="onboarding-field-input"
                      value={academicRecord.fieldOfStudy}
                      onChange={(e) =>
                        setAcademicRecord((v) => ({ ...v, fieldOfStudy: e.target.value }))
                      }
                    />
                  </label>

                  <label className="onboarding-field-group">
                    <span className="onboarding-field-label">{df.graduationYearLabel}</span>
                    <input
                      type="number"
                      className="onboarding-field-input"
                      value={academicRecord.graduationYear}
                      onChange={(e) =>
                        setAcademicRecord((v) => ({ ...v, graduationYear: e.target.value }))
                      }
                    />
                  </label>
                </div>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.gradeLabel}</span>
                  <input
                    type="text"
                    className="onboarding-field-input"
                    value={academicRecord.grade}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({ ...v, grade: e.target.value }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.certificateImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={academicRecord.certificateImageUrl}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({
                        ...v,
                        certificateImageUrl: e.target.value,
                      }))
                    }
                  />
                </label>

                <label className="onboarding-field-group">
                  <span className="onboarding-field-label">{df.transcriptImageLabel}</span>
                  <input
                    type="url"
                    className="onboarding-field-input"
                    value={academicRecord.transcriptImageUrl}
                    onChange={(e) =>
                      setAcademicRecord((v) => ({
                        ...v,
                        transcriptImageUrl: e.target.value,
                      }))
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
