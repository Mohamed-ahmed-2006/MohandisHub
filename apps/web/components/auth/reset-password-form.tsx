'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { authApiClient, isApiClientError } from '@/lib/auth/client';
import { isValidPassword } from '@/lib/auth/validation';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type ResetPasswordFormProps = {
  locale: Locale;
  dictionary: Dictionary['auth'];
  token: string | null;
};

const PasswordVisibilityIcon = ({ visible }: { visible: boolean }) => {
  if (visible) {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          d="M3 3l18 18M10.6 10.6a2 2 0 102.8 2.8M9.9 5.1A10.5 10.5 0 0112 5c5.5 0 9.5 5.5 9.5 7s-1.4 3.4-3.5 4.8M6.6 6.6C4.5 8 2.5 10.7 2.5 12 2.5 13.5 6.5 19 12 19a9.8 9.8 0 003.3-.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M2.5 12C2.5 10.5 6.5 5 12 5s9.5 5.5 9.5 7-4 7-9.5 7-9.5-5.5-9.5-7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const ResetPasswordForm = ({ locale, dictionary, token }: ResetPasswordFormProps) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<'error' | 'success' | 'info'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);

  const hasToken = useMemo(() => Boolean(token && token.trim().length > 0), [token]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!hasToken || !token) {
      setStatusVariant('error');
      setStatusMessage(dictionary.resetPassword.invalidToken);
      return;
    }

    let hasErrors = false;
    setPasswordError(null);
    setConfirmPasswordError(null);

    if (!password) {
      setPasswordError(dictionary.validation.required);
      hasErrors = true;
    } else if (!isValidPassword(password)) {
      setPasswordError(dictionary.validation.invalidPassword);
      hasErrors = true;
    }

    if (!confirmPassword) {
      setConfirmPasswordError(dictionary.validation.required);
      hasErrors = true;
    } else if (password !== confirmPassword) {
      setConfirmPasswordError(dictionary.resetPassword.passwordMismatch);
      hasErrors = true;
    }

    if (hasErrors) return;

    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const response = await authApiClient.resetPassword({ token, password });
      setStatusVariant('success');
      setStatusMessage(response.message || dictionary.resetPassword.successMessage);
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      setStatusVariant('error');
      if (isApiClientError(error)) {
        setStatusMessage(error.message);
      } else {
        setStatusMessage(dictionary.errors.networkError);
      }
    }

    setIsSubmitting(false);
  };

  return (
    <section className="auth-form-shell" aria-live="polite" suppressHydrationWarning>
      <header className="auth-form-header">
        <h1 className="auth-form-title">{dictionary.resetPassword.title}</h1>
        <p className="auth-form-subtitle">{dictionary.resetPassword.subtitle}</p>
      </header>

      {!hasToken ? (
        <AuthStatusBanner variant="error" message={dictionary.resetPassword.invalidToken} />
      ) : null}
      {statusMessage ? <AuthStatusBanner variant={statusVariant} message={statusMessage} /> : null}

      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="auth-form-field-group">
          <span className="auth-form-field-label">{dictionary.resetPassword.passwordLabel}</span>
          <div className="auth-password-input-wrap">
            <input
              type={isPasswordVisible ? 'text' : 'password'}
              className="auth-form-field-input auth-password-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setIsPasswordVisible((prev) => !prev)}
              aria-label={
                isPasswordVisible ? dictionary.common.hidePassword : dictionary.common.showPassword
              }
            >
              <PasswordVisibilityIcon visible={isPasswordVisible} />
            </button>
          </div>
          {passwordError ? <span className="auth-form-field-error">{passwordError}</span> : null}
        </label>

        <label className="auth-form-field-group">
          <span className="auth-form-field-label">
            {dictionary.resetPassword.confirmPasswordLabel}
          </span>
          <div className="auth-password-input-wrap">
            <input
              type={isConfirmPasswordVisible ? 'text' : 'password'}
              className="auth-form-field-input auth-password-input"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setIsConfirmPasswordVisible((prev) => !prev)}
              aria-label={
                isConfirmPasswordVisible
                  ? dictionary.common.hidePassword
                  : dictionary.common.showPassword
              }
            >
              <PasswordVisibilityIcon visible={isConfirmPasswordVisible} />
            </button>
          </div>
          {confirmPasswordError ? (
            <span className="auth-form-field-error">{confirmPasswordError}</span>
          ) : null}
        </label>

        <button
          type="submit"
          className="auth-form-submit-button"
          disabled={isSubmitting || !hasToken}
        >
          {isSubmitting ? dictionary.common.loading : dictionary.resetPassword.submitButton}
        </button>
      </form>

      <footer className="auth-form-footer">
        <Link href={buildLocalePath(locale, '/auth?mode=login')} className="auth-form-inline-link">
          {dictionary.resetPassword.backToLogin}
        </Link>
      </footer>
    </section>
  );
};
