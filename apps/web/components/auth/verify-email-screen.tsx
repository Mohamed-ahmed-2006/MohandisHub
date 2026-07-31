'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getSafeNextPath } from '@/components/auth/auth-form';
import { isApiClientError, useAuth } from '@/components/auth/auth-provider';
import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { LanguageToggle } from '@/components/language-toggle';
import { SiteLogo } from '@/components/site-logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Container } from '@/components/ui/container';
import { authApiClient } from '@/lib/auth/client';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './verify-email.css';

type VerifyEmailScreenProps = {
  locale: Locale;
  dictionary: Dictionary;
};

const RESEND_COOLDOWN_SECONDS = 60;

export const VerifyEmailScreen = ({ locale, dictionary }: VerifyEmailScreenProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, refreshSession } = useAuth();
  const dict = dictionary.emailVerification;

  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<'error' | 'success' | 'info'>('info');
  const [resendCountdown, setResendCountdown] = useState(0);

  const hasSentInitialOtp = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendCountdown = useCallback(() => {
    setResendCountdown(RESEND_COOLDOWN_SECONDS);

    if (countdownRef.current) clearInterval(countdownRef.current);

    countdownRef.current = setInterval(() => {
      setResendCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isReady) return;

    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }

    if (authGuard.emailVerified) {
      const safeNext = getSafeNextPath(locale, searchParams.get('next'));
      if (safeNext) {
        router.replace(safeNext);
        return;
      }
      const role = authUser.role;
      const onboardingPath = authUser.isAdmin ? '/app' : `/onboarding/${role}`;
      router.replace(buildLocalePath(locale, onboardingPath));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router, searchParams]);

  const sendOtp = useCallback(async () => {
    if (!accessToken || isSending) return;

    setIsSending(true);
    setStatusMessage(null);

    try {
      const result = await authApiClient.sendOtp(accessToken, 'email');
      setMaskedEmail(result.destination);
      startResendCountdown();
    } catch (error: unknown) {
      if (isApiClientError(error) && error.code === 'RATE_LIMITED') {
        setStatusVariant('error');
        setStatusMessage(dict.rateLimited);
      } else {
        setStatusVariant('error');
        setStatusMessage(dict.sendError);
      }
    } finally {
      setIsSending(false);
    }
  }, [accessToken, isSending, startResendCountdown, dict]);

  useEffect(() => {
    if (!isReady || !isAuthenticated || !accessToken || authGuard.emailVerified) return;
    if (hasSentInitialOtp.current) return;

    hasSentInitialOtp.current = true;
    void sendOtp();
  }, [isReady, isAuthenticated, accessToken, authGuard.emailVerified, sendOtp]);

  const handleVerify = async (): Promise<void> => {
    if (!accessToken || isVerifying || code.trim().length === 0) return;

    setIsVerifying(true);
    setStatusMessage(null);

    try {
      const result = await authApiClient.verifyOtp(accessToken, 'email', code.trim());

      if (result.verified) {
        setIsVerified(true);
        setStatusVariant('success');
        setStatusMessage(dict.verifiedMessage);
        // Refresh tokens so the new access token includes emailVerified: true;
        // otherwise API calls (e.g. business onboarding) still see the old JWT and return 403.
        await refreshSession();
      }
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        if (error.code === 'OTP_EXPIRED' || error.code === 'CODE_EXPIRED') {
          setStatusVariant('error');
          setStatusMessage(dict.codeExpired);
        } else if (error.code === 'RATE_LIMITED') {
          setStatusVariant('error');
          setStatusMessage(dict.rateLimited);
        } else {
          setStatusVariant('error');
          setStatusMessage(dict.invalidCode);
        }
      } else {
        setStatusVariant('error');
        setStatusMessage(dict.invalidCode);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleContinue = (): void => {
    const safeNext = getSafeNextPath(locale, searchParams.get('next'));
    if (safeNext) {
      router.replace(safeNext);
      return;
    }
    const role = authUser?.role ?? 'customer';
    const onboardingPath = role === 'admin' ? '/app' : `/onboarding/${role}`;
    router.replace(buildLocalePath(locale, onboardingPath));
  };

  if (!isReady || !authUser) {
    return (
      <main className="auth-page-main">
        <Container className="auth-page-container">
          <p className="verify-email-loading">{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="auth-page-main" suppressHydrationWarning>
      <Container className="auth-page-container">
        <header className="auth-page-header">
          <Link href={buildLocalePath(locale, '/')} className="auth-page-brand-link">
            <SiteLogo />
          </Link>
          <div className="auth-page-header-actions">
            <LanguageToggle
              locale={locale}
              targetLabel={dictionary.language.target}
              ariaLabel={dictionary.language.switchLabel}
            />
            <ThemeToggle
              switchToLightLabel={dictionary.theme.switchToLight}
              switchToDarkLabel={dictionary.theme.switchToDark}
              darkLabel={dictionary.theme.darkLabel}
              lightLabel={dictionary.theme.lightLabel}
            />
          </div>
        </header>

        <section className="auth-form-shell verify-email-shell" aria-live="polite">
          <header className="auth-form-header">
            <h1 className="auth-form-title">{isVerified ? dict.verified : dict.title}</h1>
            <p className="auth-form-subtitle">
              {isVerified ? dict.verifiedMessage : dict.subtitle}
            </p>
          </header>

          {maskedEmail && !isVerified ? (
            <p className="verify-email-destination">
              {dict.codeSentTo} <strong>{maskedEmail}</strong>
            </p>
          ) : null}

          {statusMessage ? (
            <AuthStatusBanner variant={statusVariant} message={statusMessage} />
          ) : null}

          {isVerified ? (
            <button
              type="button"
              className="auth-form-submit-button verify-email-continue"
              onClick={handleContinue}
            >
              {dict.continueButton}
            </button>
          ) : (
            <div className="verify-email-form">
              <label className="auth-form-field-group">
                <span className="auth-form-field-label">{dict.codeLabel}</span>
                <input
                  type="text"
                  className="auth-form-field-input verify-email-code-input"
                  placeholder={dict.codePlaceholder}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  dir="ltr"
                />
              </label>

              <button
                type="button"
                className="auth-form-submit-button"
                disabled={isVerifying || code.trim().length === 0}
                onClick={() => void handleVerify()}
              >
                {isVerifying ? dictionary.auth.common.loading : dict.verifyButton}
              </button>

              <div className="verify-email-resend-row">
                {resendCountdown > 0 ? (
                  <span className="verify-email-resend-countdown">
                    {dict.resendCountdown} {resendCountdown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    className="verify-email-resend-button"
                    disabled={isSending}
                    onClick={() => void sendOtp()}
                  >
                    {dict.resendButton}
                  </button>
                )}
              </div>

              {process.env.NODE_ENV === 'development' ? (
                <p className="verify-email-dev-hint">{dict.devCodeHint}</p>
              ) : null}
            </div>
          )}
        </section>
      </Container>
    </main>
  );
};
