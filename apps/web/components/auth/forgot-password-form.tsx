'use client';

import Link from 'next/link';
import { useState } from 'react';

import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { authApiClient, isApiClientError } from '@/lib/auth/client';
import { isValidEmail } from '@/lib/auth/validation';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type ForgotPasswordFormProps = {
  locale: Locale;
  dictionary: Dictionary['auth'];
};

export const ForgotPasswordForm = ({ locale, dictionary }: ForgotPasswordFormProps) => {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<'error' | 'success' | 'info'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setFieldError(dictionary.validation.required);
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setFieldError(dictionary.validation.invalidEmail);
      return;
    }

    setFieldError(null);
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const response = await authApiClient.forgotPassword({ email: trimmedEmail });
      setStatusVariant('success');
      setStatusMessage(response.message || dictionary.forgotPassword.successMessage);
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
        <h1 className="auth-form-title">{dictionary.forgotPassword.title}</h1>
        <p className="auth-form-subtitle">{dictionary.forgotPassword.subtitle}</p>
      </header>

      {statusMessage ? <AuthStatusBanner variant={statusVariant} message={statusMessage} /> : null}

      <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label className="auth-form-field-group">
          <span className="auth-form-field-label">{dictionary.forgotPassword.emailLabel}</span>
          <input
            type="email"
            className="auth-form-field-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          {fieldError ? <span className="auth-form-field-error">{fieldError}</span> : null}
        </label>

        <button type="submit" className="auth-form-submit-button" disabled={isSubmitting}>
          {isSubmitting ? dictionary.common.loading : dictionary.forgotPassword.submitButton}
        </button>
      </form>

      <footer className="auth-form-footer">
        <Link href={buildLocalePath(locale, '/auth?mode=login')} className="auth-form-inline-link">
          {dictionary.forgotPassword.backToLogin}
        </Link>
      </footer>
    </section>
  );
};
