'use client';

import type {
  AuthUser,
  BusinessProfile,
  ExpertProfile,
  UpdateBusinessProfileBody,
  UpdateExpertProfileBody,
} from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { LanguageToggle } from '@/components/language-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { SkeletonForm } from '@/components/ui/skeleton';
import { COUNTRIES } from '@/lib/data/countries';
import { LANGUAGES } from '@/lib/data/languages';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { usersApiClient } from '@/lib/users/client';

import './profile-screen.css';

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

type ProfileScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

type TabId = 'account' | 'profile' | 'documents' | 'preferences';

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '500+'] as const;

// ── Account Form (all roles) ─────────────────────────────────────────────

type AccountFormProps = {
  authUser: AuthUser;
  accessToken: string;
  locale: Locale;
  dictionary: Dictionary;
  onUserUpdated: () => Promise<void>;
};

const AccountForm = ({
  authUser,
  accessToken,
  locale,
  dictionary,
  onUserUpdated,
}: AccountFormProps) => {
  const countryNameKey = locale === 'ar' ? 'nameAr' : 'nameEn';
  const labels = dictionary.profile.account;
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Email change state
  const [emailChangeStep, setEmailChangeStep] = useState<'idle' | 'input' | 'verify'>('idle');
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailChangeBusy, setEmailChangeBusy] = useState(false);
  const [emailChangeMsg, setEmailChangeMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const handleSaveAccount = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const val = (name: string) =>
      nonEmpty((form.elements.namedItem(name) as HTMLInputElement)?.value);

    const body = pickDefined({
      displayName: val('displayName'),
      phone: (form.elements.namedItem('phone') as HTMLInputElement)?.value?.trim() || null,
      phoneCode: (form.elements.namedItem('phoneCode') as HTMLSelectElement)?.value || null,
      nationality: (form.elements.namedItem('nationality') as HTMLSelectElement)?.value || null,
      dateOfBirth: (form.elements.namedItem('dateOfBirth') as HTMLInputElement)?.value || null,
    });

    setSaving(true);
    setSaveMessage(null);
    try {
      await usersApiClient.updateAccount(
        accessToken,
        body as Parameters<typeof usersApiClient.updateAccount>[1],
      );
      await onUserUpdated();
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch {
      setSaveMessage({ type: 'error', text: dictionary.profile.saveError });
    } finally {
      setSaving(false);
    }
  };

  const handleRequestEmailChange = async () => {
    if (!newEmail.trim()) return;
    setEmailChangeBusy(true);
    setEmailChangeMsg(null);
    try {
      await usersApiClient.requestEmailChange(accessToken, newEmail.trim());
      setEmailChangeStep('verify');
      setEmailChangeMsg({ type: 'info', text: labels.emailChangePending });
    } catch (err) {
      const msg = err instanceof Error ? err.message : labels.emailChangeError;
      setEmailChangeMsg({ type: 'error', text: msg });
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const handleConfirmEmailChange = async () => {
    if (!emailCode.trim()) return;
    setEmailChangeBusy(true);
    setEmailChangeMsg(null);
    try {
      await usersApiClient.confirmEmailChange(accessToken, emailCode.trim());
      await onUserUpdated();
      setEmailChangeStep('idle');
      setNewEmail('');
      setEmailCode('');
      setEmailChangeMsg(null);
      setSaveMessage({ type: 'success', text: labels.emailChangeSuccess });
    } catch (err) {
      const msg = err instanceof Error ? err.message : labels.emailChangeError;
      setEmailChangeMsg({ type: 'error', text: msg });
    } finally {
      setEmailChangeBusy(false);
    }
  };

  const cancelEmailChange = () => {
    setEmailChangeStep('idle');
    setNewEmail('');
    setEmailCode('');
    setEmailChangeMsg(null);
  };

  return (
    <section className="profile-screen-card">
      <h2 className="profile-screen-sectionTitle">{labels.sectionTitle}</h2>
      <form onSubmit={(e) => void handleSaveAccount(e)} className="profile-screen-form">
        <div className="profile-screen-field">
          <label className="profile-screen-label">{labels.displayNameLabel}</label>
          <input
            name="displayName"
            className="profile-screen-input"
            defaultValue={authUser.displayName}
          />
        </div>

        {/* Email — read-only with change flow */}
        <div className="profile-screen-email-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.emailLabel}</label>
            <input className="profile-screen-input" value={authUser.email} readOnly disabled />
          </div>
          {emailChangeStep === 'idle' && (
            <button
              type="button"
              className="profile-screen-email-change-btn"
              onClick={() => setEmailChangeStep('input')}
            >
              {labels.emailChangeButton}
            </button>
          )}
        </div>

        {emailChangeStep === 'input' && (
          <div className="profile-screen-email-change-box">
            <p className="profile-screen-email-change-title">{labels.emailChangeTitle}</p>
            <p className="profile-screen-email-change-desc">{labels.emailChangeDescription}</p>
            <div className="profile-screen-field">
              <label className="profile-screen-label">{labels.newEmailLabel}</label>
              <input
                type="email"
                className="profile-screen-input"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={labels.newEmailPlaceholder}
              />
            </div>
            {emailChangeMsg && (
              <p
                className={
                  emailChangeMsg.type === 'error'
                    ? 'profile-screen-save-error'
                    : 'profile-screen-save-success'
                }
              >
                {emailChangeMsg.text}
              </p>
            )}
            <div className="profile-screen-email-change-actions">
              <button
                type="button"
                className="profile-screen-submit-button"
                disabled={emailChangeBusy || !newEmail.trim()}
                onClick={() => void handleRequestEmailChange()}
              >
                {labels.sendCodeButton}
              </button>
              <button
                type="button"
                className="profile-screen-cancel-btn"
                onClick={cancelEmailChange}
              >
                {labels.cancelButton}
              </button>
            </div>
          </div>
        )}

        {emailChangeStep === 'verify' && (
          <div className="profile-screen-email-change-box">
            <p className="profile-screen-email-change-pending">{labels.emailChangePending}</p>
            <div className="profile-screen-field">
              <label className="profile-screen-label">{labels.codeLabel}</label>
              <input
                className="profile-screen-input"
                value={emailCode}
                onChange={(e) => setEmailCode(e.target.value)}
                placeholder={labels.codePlaceholder}
                maxLength={6}
              />
            </div>
            {emailChangeMsg && emailChangeMsg.type === 'error' && (
              <p className="profile-screen-save-error">{emailChangeMsg.text}</p>
            )}
            <div className="profile-screen-email-change-actions">
              <button
                type="button"
                className="profile-screen-submit-button"
                disabled={emailChangeBusy || emailCode.trim().length !== 6}
                onClick={() => void handleConfirmEmailChange()}
              >
                {labels.confirmCodeButton}
              </button>
              <button
                type="button"
                className="profile-screen-cancel-btn"
                onClick={cancelEmailChange}
              >
                {labels.cancelButton}
              </button>
            </div>
          </div>
        )}

        <div className="profile-screen-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.phoneCodeLabel}</label>
            <select
              name="phoneCode"
              className="profile-screen-select"
              defaultValue={authUser.phoneCode ?? ''}
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.dialCode}>
                  {c.dialCode} {c[countryNameKey]}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.phoneLabel}</label>
            <input
              name="phone"
              className="profile-screen-input"
              defaultValue={authUser.phone ?? ''}
            />
          </div>
        </div>

        <div className="profile-screen-row">
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.nationalityLabel}</label>
            <select
              name="nationality"
              className="profile-screen-select"
              defaultValue={authUser.nationality ?? ''}
            >
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c[countryNameKey]}
                </option>
              ))}
            </select>
          </div>
          <div className="profile-screen-field">
            <label className="profile-screen-label">{labels.dateOfBirthLabel}</label>
            <input
              name="dateOfBirth"
              type="date"
              className="profile-screen-input"
              defaultValue={authUser.dateOfBirth ?? ''}
            />
          </div>
        </div>

        {saveMessage && (
          <p
            className={
              saveMessage.type === 'success'
                ? 'profile-screen-save-success'
                : 'profile-screen-save-error'
            }
          >
            {saveMessage.text}
          </p>
        )}
        <button type="submit" className="profile-screen-submit-button" disabled={saving}>
          {saving ? dictionary.common.continue : dictionary.common.save}
        </button>
      </form>
    </section>
  );
};

// ── Main Profile Screen ──────────────────────────────────────────────────

export const ProfileScreen = ({ locale, dictionary }: ProfileScreenProps) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('account');
  const [expertProfile, setExpertProfile] = useState<ExpertProfile | null>(null);
  const [businessProfile, setBusinessProfile] = useState<BusinessProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const role = authUser?.role;
  const isExpert = role === 'expert';
  const isBusiness = role === 'business';
  const hasRoleProfile = isExpert || isBusiness;

  const loadProfile = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      if (isExpert) {
        const profile = await profilesApiClient.getExpertProfile(accessToken);
        setExpertProfile(profile);
      } else if (isBusiness) {
        const profile = await profilesApiClient.getBusinessProfile(accessToken);
        setBusinessProfile(profile);
      }
    } catch {
      setExpertProfile(null);
      setBusinessProfile(null);
    } finally {
      setLoading(false);
    }
  }, [accessToken, isExpert, isBusiness]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    void loadProfile();
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router, loadProfile]);

  const handleSaveExpert = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !expertProfile) return;
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
      availabilityStatus: nonEmpty(
        (form.elements.namedItem('availabilityStatus') as HTMLSelectElement)?.value,
      ) as 'available' | 'busy' | 'offline' | undefined,
      employer: val('employer'),
      jobTitle: val('jobTitle'),
      linkedinUrl: val('linkedinUrl'),
      portfolioUrl: val('portfolioUrl'),
      languages: Array.from(
        (form.elements.namedItem('languages') as HTMLSelectElement)?.selectedOptions ?? [],
      ).map((o) => o.value),
      educationSummary: val('educationSummary'),
    });
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await profilesApiClient.updateExpertProfile(
        accessToken,
        body as UpdateExpertProfileBody,
      );
      setExpertProfile(updated);
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch {
      setSaveMessage({ type: 'error', text: dictionary.profile.saveError });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken || !businessProfile) return;
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
    setSaving(true);
    setSaveMessage(null);
    try {
      const updated = await profilesApiClient.updateBusinessProfile(
        accessToken,
        body as UpdateBusinessProfileBody,
      );
      setBusinessProfile(updated);
      setSaveMessage({ type: 'success', text: dictionary.profile.saveSuccess });
    } catch {
      setSaveMessage({ type: 'error', text: dictionary.profile.saveError });
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser || !accessToken) {
    return (
      <main className="profile-screen-main">
        <Container className="profile-screen-container">
          <div className="skeleton-card" style={{ marginBottom: '1rem' }}>
            <SkeletonForm fields={6} />
          </div>
        </Container>
      </main>
    );
  }

  const pf = dictionary.onboarding.expert.profileForm;
  const cf = dictionary.onboarding.business.companyForm;
  const verLabels = dictionary.verification.statusLabels;

  const tabs: { id: TabId; label: string; show: boolean }[] = [
    { id: 'account', label: dictionary.profile.accountTab, show: true },
    {
      id: 'profile',
      label: isExpert ? dictionary.profile.expertTab : dictionary.profile.businessTab,
      show: hasRoleProfile,
    },
    { id: 'documents', label: dictionary.profile.documentsTab, show: hasRoleProfile },
    { id: 'preferences', label: dictionary.profile.preferencesTab ?? 'Preferences', show: true },
  ];

  return (
    <main className="profile-screen-main">
      <Container className="profile-screen-container">
        <h1 className="profile-screen-pageTitle">{dictionary.nav.settings}</h1>

        <div className="profile-screen-tabs">
          {tabs
            .filter((t) => t.show)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                className={
                  activeTab === t.id
                    ? 'profile-screen-tab profile-screen-tab-active'
                    : 'profile-screen-tab'
                }
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
        </div>

        {/* Account tab — all roles */}
        {activeTab === 'account' && (
          <AccountForm
            authUser={authUser}
            accessToken={accessToken}
            locale={locale}
            dictionary={dictionary}
            onUserUpdated={updateAuthUser}
          />
        )}

        {/* Role-specific profile tab */}
        {activeTab === 'profile' && loading && (
          <div className="profile-screen-skeleton">
            <SkeletonForm fields={5} />
          </div>
        )}

        {activeTab === 'profile' && !loading && isExpert && !expertProfile && (
          <section className="profile-screen-card">
            <p className="profile-screen-no-profile">
              Expert profile not found. Please complete onboarding first.
            </p>
          </section>
        )}

        {activeTab === 'profile' && !loading && isExpert && expertProfile && (
          <section className="profile-screen-card">
            <span
              className={`profile-screen-badge profile-screen-badge_${expertProfile.verificationStatus}`}
            >
              {verLabels[expertProfile.verificationStatus as keyof typeof verLabels] ??
                expertProfile.verificationStatus}
            </span>
            <form onSubmit={(e) => void handleSaveExpert(e)} className="profile-screen-form">
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.titleLabel}</label>
                <input
                  name="title"
                  className="profile-screen-input"
                  defaultValue={expertProfile.title ?? ''}
                  placeholder={pf.titlePlaceholder}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.headlineLabel}</label>
                <input
                  name="headline"
                  className="profile-screen-input"
                  defaultValue={expertProfile.headline ?? ''}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.bioLabel}</label>
                <textarea
                  name="bio"
                  className="profile-screen-textarea"
                  rows={4}
                  defaultValue={expertProfile.bio ?? ''}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.specializationsLabel}</label>
                <input
                  name="specializations"
                  className="profile-screen-input"
                  defaultValue={expertProfile.specializations?.join(', ') ?? ''}
                  placeholder={pf.specializationsHint}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.yearsOfExperienceLabel}</label>
                  <input
                    name="yearsOfExperience"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={expertProfile.yearsOfExperience ?? ''}
                    min={0}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.hourlyRateLabel}</label>
                  <input
                    name="hourlyRate"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={expertProfile.hourlyRate ?? ''}
                    min={0}
                    step="0.01"
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">
                  {(dictionary.admin?.settingsMgmt?.sections as Record<string, string>)?.availability ??
                    'Availability'}
                </label>
                <select
                  name="availabilityStatus"
                  className="profile-screen-select"
                  defaultValue={expertProfile.availabilityStatus ?? 'available'}
                >
                  <option value="available">Available</option>
                  <option value="busy">Busy</option>
                  <option value="offline">Offline</option>
                </select>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.cityLabel}</label>
                  <input
                    name="city"
                    className="profile-screen-input"
                    defaultValue={expertProfile.city ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.countryLabel}</label>
                  <select
                    name="country"
                    className="profile-screen-select"
                    defaultValue={expertProfile.country ?? ''}
                  >
                    <option value="">—</option>
                    {COUNTRIES.map((c) => (
                      <option key={c.code} value={locale === 'ar' ? c.nameAr : c.nameEn}>
                        {locale === 'ar' ? c.nameAr : c.nameEn}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.employerLabel}</label>
                  <input
                    name="employer"
                    className="profile-screen-input"
                    defaultValue={expertProfile.employer ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.jobTitleLabel}</label>
                  <input
                    name="jobTitle"
                    className="profile-screen-input"
                    defaultValue={expertProfile.jobTitle ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.linkedinLabel}</label>
                  <input
                    name="linkedinUrl"
                    type="url"
                    className="profile-screen-input"
                    defaultValue={expertProfile.linkedinUrl ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{pf.portfolioLabel}</label>
                  <input
                    name="portfolioUrl"
                    type="url"
                    className="profile-screen-input"
                    defaultValue={expertProfile.portfolioUrl ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.languagesLabel}</label>
                <select
                  name="languages"
                  className="profile-screen-select"
                  multiple
                  defaultValue={expertProfile.languages ?? []}
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={locale === 'ar' ? l.nameAr : l.nameEn}>
                      {locale === 'ar' ? l.nameAr : l.nameEn}
                    </option>
                  ))}
                </select>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{pf.educationSummaryLabel}</label>
                <textarea
                  name="educationSummary"
                  className="profile-screen-textarea"
                  rows={3}
                  defaultValue={expertProfile.educationSummary ?? ''}
                />
              </div>
              {saveMessage && (
                <p
                  className={
                    saveMessage.type === 'success'
                      ? 'profile-screen-save-success'
                      : 'profile-screen-save-error'
                  }
                >
                  {saveMessage.text}
                </p>
              )}
              <button type="submit" className="profile-screen-submit-button" disabled={saving}>
                {saving ? dictionary.common.continue : dictionary.common.save}
              </button>
            </form>
          </section>
        )}

        {activeTab === 'profile' && !loading && isBusiness && !businessProfile && (
          <section className="profile-screen-card">
            <p className="profile-screen-no-profile">
              Business profile not found. Please complete onboarding first.
            </p>
          </section>
        )}

        {activeTab === 'profile' && !loading && isBusiness && businessProfile && (
          <section className="profile-screen-card">
            <span
              className={`profile-screen-badge profile-screen-badge_${businessProfile.verificationStatus}`}
            >
              {verLabels[businessProfile.verificationStatus as keyof typeof verLabels] ??
                businessProfile.verificationStatus}
            </span>
            <form onSubmit={(e) => void handleSaveBusiness(e)} className="profile-screen-form">
              <div className="profile-screen-field">
                <label className="profile-screen-label">{cf.companyNameLabel}</label>
                <input
                  name="companyName"
                  className="profile-screen-input"
                  defaultValue={businessProfile.companyName}
                  required
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.tradeLicenseLabel}</label>
                  <input
                    name="tradeLicenseNumber"
                    className="profile-screen-input"
                    defaultValue={businessProfile.tradeLicenseNumber ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.taxIdLabel}</label>
                  <input
                    name="taxId"
                    className="profile-screen-input"
                    defaultValue={businessProfile.taxId ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{cf.commercialRegisterLabel}</label>
                <input
                  name="commercialRegister"
                  className="profile-screen-input"
                  defaultValue={businessProfile.commercialRegister ?? ''}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.industryLabel}</label>
                  <input
                    name="industry"
                    className="profile-screen-input"
                    defaultValue={businessProfile.industry ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.companySizeLabel}</label>
                  <select
                    name="companySize"
                    className="profile-screen-select"
                    defaultValue={businessProfile.companySize ?? ''}
                  >
                    <option value="">—</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {dictionary.verification.companySizes[s]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.websiteLabel}</label>
                  <input
                    name="website"
                    type="url"
                    className="profile-screen-input"
                    defaultValue={businessProfile.website ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.companyEmailLabel}</label>
                  <input
                    name="companyEmail"
                    type="email"
                    className="profile-screen-input"
                    defaultValue={businessProfile.companyEmail ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{cf.companyPhoneLabel}</label>
                <input
                  name="companyPhone"
                  className="profile-screen-input"
                  defaultValue={businessProfile.companyPhone ?? ''}
                />
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{cf.addressLabel}</label>
                <textarea
                  name="address"
                  className="profile-screen-textarea"
                  rows={2}
                  defaultValue={businessProfile.address ?? ''}
                />
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.cityLabel}</label>
                  <input
                    name="city"
                    className="profile-screen-input"
                    defaultValue={businessProfile.city ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.countryLabel}</label>
                  <input
                    name="country"
                    className="profile-screen-input"
                    defaultValue={businessProfile.country ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-field">
                <label className="profile-screen-label">{cf.descriptionLabel}</label>
                <textarea
                  name="description"
                  className="profile-screen-textarea"
                  rows={4}
                  defaultValue={businessProfile.description ?? ''}
                />
              </div>
              <h3 className="profile-screen-sectionTitle">Owner</h3>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.ownerNameLabel}</label>
                  <input
                    name="ownerFullName"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerFullName ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.ownerTitleLabel}</label>
                  <input
                    name="ownerTitle"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerTitle ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.ownerEmailLabel}</label>
                  <input
                    name="ownerEmail"
                    type="email"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerEmail ?? ''}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.ownerPhoneLabel}</label>
                  <input
                    name="ownerPhone"
                    className="profile-screen-input"
                    defaultValue={businessProfile.ownerPhone ?? ''}
                  />
                </div>
              </div>
              <div className="profile-screen-row">
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.foundedYearLabel}</label>
                  <input
                    name="foundedYear"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={businessProfile.foundedYear ?? ''}
                    min={1900}
                  />
                </div>
                <div className="profile-screen-field">
                  <label className="profile-screen-label">{cf.employeesCountLabel}</label>
                  <input
                    name="employeesCount"
                    type="number"
                    className="profile-screen-input"
                    defaultValue={businessProfile.employeesCount ?? ''}
                    min={0}
                  />
                </div>
              </div>
              {saveMessage && (
                <p
                  className={
                    saveMessage.type === 'success'
                      ? 'profile-screen-save-success'
                      : 'profile-screen-save-error'
                  }
                >
                  {saveMessage.text}
                </p>
              )}
              <button type="submit" className="profile-screen-submit-button" disabled={saving}>
                {saving ? dictionary.common.continue : dictionary.common.save}
              </button>
            </form>
          </section>
        )}

        {activeTab === 'documents' && hasRoleProfile && (
          <section className="profile-screen-card">
            <h2 className="profile-screen-sectionTitle">
              {dictionary.profile.documents.identityTitle}
            </h2>
            <p className="profile-screen-hint">
              {dictionary.profile.documents.identityDescription}
            </p>
            <h2 className="profile-screen-sectionTitle">
              {dictionary.profile.documents.academicTitle}
            </h2>
            <p className="profile-screen-hint">
              {dictionary.profile.documents.academicDescription}
            </p>
            <p className="profile-screen-noDocuments">{dictionary.profile.documents.noDocuments}</p>
          </section>
        )}

        {activeTab === 'preferences' && (
          <section className="profile-screen-card">
            <h2 className="profile-screen-sectionTitle">
              {dictionary.profile.preferencesTab ?? 'Preferences'}
            </h2>
            <div className="profile-screen-pref-row">
              <div className="profile-screen-pref-item">
                <span className="profile-screen-label">{dictionary.language.switchLabel}</span>
                <LanguageToggle
                  locale={locale}
                  targetLabel={dictionary.language.target}
                  ariaLabel={dictionary.language.switchLabel}
                />
              </div>
              <div className="profile-screen-pref-item">
                <span className="profile-screen-label">
                  {dictionary.theme.darkLabel} / {dictionary.theme.lightLabel}
                </span>
                <ThemeToggle
                  switchToLightLabel={dictionary.theme.switchToLight}
                  switchToDarkLabel={dictionary.theme.switchToDark}
                  darkLabel={dictionary.theme.darkLabel}
                  lightLabel={dictionary.theme.lightLabel}
                />
              </div>
            </div>
          </section>
        )}
      </Container>
    </main>
  );
};
