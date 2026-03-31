'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { SiteLogo } from '@/components/site-logo';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { profilesApiClient } from '@/lib/profiles/client';
import { usersApiClient } from '@/lib/users/client';
import { formatApiError } from '@/lib/utils/format-api-error';

type Props = { locale: Locale; dictionary: Dictionary };

export const CustomerOnboardingScreen = ({ locale, dictionary }: Props) => {
  const tr = (en: string, ar: string) => (locale === 'ar' ? ar : en);
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const [step, setStep] = useState<'welcome' | 'profile' | 'done'>('welcome');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleProfileSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!accessToken) return;
    const form = e.currentTarget;
    const displayName = (form.elements.namedItem('displayName') as HTMLInputElement)?.value?.trim();
    const phone = (form.elements.namedItem('phone') as HTMLInputElement)?.value?.trim() || null;
    const city = (form.elements.namedItem('city') as HTMLInputElement)?.value?.trim() || null;
    const contactPreference = (form.elements.namedItem('contactPreference') as HTMLSelectElement)?.value?.trim() || null;
    if (!displayName || displayName.length < 2) {
      setError(
        dictionary.onboarding.customer.profileDisplayNameRequired ??
          tr(
            'Display name is required (at least 2 characters).',
            'الاسم الظاهر مطلوب (على الأقل حرفان).',
          ),
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await Promise.all([
        usersApiClient.updateAccount(accessToken, { displayName, phone: phone ? phone : null }),
        profilesApiClient.updateCustomerProfile(accessToken, {
          city: city || null,
          contactPreference: contactPreference || null,
        }),
      ]);
      await updateAuthUser();
      setStep('done');
    } catch (err) {
      setError(formatApiError(err, dictionary.profile?.saveError ?? 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  if (!isReady || !authUser) {
    return (
      <main className="customer-onboarding-page-main">
        <Container>
          <p className="onboarding-loading">{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="customer-onboarding-page-main">
      <Container>
        <header className="onboarding-header">
          <Link href={buildLocalePath(locale, '/')} className="onboarding-brand">
            <SiteLogo />
          </Link>
        </header>

        <section className="onboarding-card">
          {step === 'welcome' && (
            <>
              <h1 className="onboarding-title">{dictionary.onboarding.customer.title}</h1>
              <p className="onboarding-description">{dictionary.onboarding.customer.welcomeMessage}</p>
              <button
                type="button"
                className="onboarding-cta-button"
                onClick={() => setStep('profile')}
              >
                {dictionary.onboarding.customer.setupProfile ?? 'Set up your profile'}
              </button>
            </>
          )}

          {step === 'profile' && (
            <>
              <h1 className="onboarding-title">
                {dictionary.onboarding.customer.profileTitle ?? tr('Profile setup', 'إعداد الملف الشخصي')}
              </h1>
              <p className="onboarding-description">
                {dictionary.onboarding.customer.profileDescription ?? 'Add a few details so providers can recognize you.'}
              </p>
              <form className="onboarding-form" onSubmit={(e) => void handleProfileSubmit(e)}>
                {error && <p className="onboarding-error" role="alert">{error}</p>}
                <div className="onboarding-field">
                  <label className="onboarding-label" htmlFor="customer-displayName">
                    {dictionary.onboarding.customer.profileDisplayName ?? 'Display name'}
                  </label>
                  <input
                    id="customer-displayName"
                    name="displayName"
                    type="text"
                    className="onboarding-input"
                    defaultValue={authUser.displayName ?? ''}
                    placeholder={dictionary.onboarding.customer.profileDisplayNamePlaceholder ?? 'How should we call you?'}
                    minLength={2}
                    maxLength={100}
                    required
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label" htmlFor="customer-phone">
                    {dictionary.onboarding.customer.profilePhone ?? 'Phone (optional)'}
                  </label>
                  <input
                    id="customer-phone"
                    name="phone"
                    type="tel"
                    className="onboarding-input"
                    defaultValue={authUser.phone ?? ''}
                    placeholder={tr('+1 234 567 8900', '+20 100 000 0000')}
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label" htmlFor="customer-city">
                    {dictionary.onboarding.customer.profileCity ?? 'City (optional)'}
                  </label>
                  <input
                    id="customer-city"
                    name="city"
                    type="text"
                    className="onboarding-input"
                    placeholder={dictionary.onboarding.customer.profileCityPlaceholder ?? 'e.g. Cairo, Dubai'}
                  />
                </div>
                <div className="onboarding-field">
                  <label className="onboarding-label" htmlFor="customer-contactPreference">
                    {dictionary.onboarding.customer.profileContactPref ?? 'Preferred contact'}
                  </label>
                  <select
                    id="customer-contactPreference"
                    name="contactPreference"
                    className="onboarding-input"
                  >
                    <option value="">{dictionary.onboarding.customer.profileContactPrefOptional ?? 'Any'}</option>
                    <option value="email">{tr('Email', 'البريد الإلكتروني')}</option>
                    <option value="phone">{tr('Phone', 'الهاتف')}</option>
                  </select>
                </div>
                <div className="onboarding-nav-row">
                  <button
                    type="button"
                    className="onboarding-back-button"
                    onClick={() => setStep('welcome')}
                  >
                    {dictionary.common.back}
                  </button>
                  <button type="submit" className="onboarding-cta-button" disabled={saving}>
                    {saving
                      ? dictionary.auth?.common?.loading ?? tr('Saving...', 'جارٍ الحفظ...')
                      : dictionary.common.continue}
                  </button>
                </div>
              </form>
            </>
          )}

          {step === 'done' && (
            <>
              <h1 className="onboarding-title">
                {dictionary.onboarding.customer.profileCompleteTitle ?? tr("You're all set", 'أنت جاهز الآن')}
              </h1>
              <p className="onboarding-description">
                {dictionary.onboarding.customer.profileCompleteDescription ?? 'Your profile is ready. Head to the dashboard to post needs or browse services.'}
              </p>
              <Link href={buildLocalePath(locale, '/app')} className="onboarding-cta-button">
                {dictionary.onboarding.customer.goToDashboard}
              </Link>
            </>
          )}
        </section>
      </Container>
    </main>
  );
};
