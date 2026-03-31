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
  const [devResetLink, setDevResetLink] = useState<string | null>(null);
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
      setStatusMessage(dictionary.forgotPassword.successMessage);
      if (response.devResetLink) {
        setDevResetLink(response.devResetLink);
        setStatusVariant('info');
      } else {
        setDevResetLink(null);
        setStatusVariant('success');
      }
    } catch (error) {
      setStatusVariant('error');
      setDevResetLink(null);
      if (isApiClientError(error)) {
        setStatusMessage(dictionary.errors.generic);
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
      {devResetLink ? (
        <p className="auth-form-dev-link">
          <strong>{locale === 'ar' ? 'وضع التطوير:' : 'Development:'}</strong>{' '}
          {locale === 'ar'
            ? 'لم يتم إرسال بريد فعلي. استخدم هذا الرابط لإعادة تعيين كلمة المرور:'
            : 'No email was sent. Use this link to reset your password:'}{' '}
          <a href={devResetLink} target="_blank" rel="noopener noreferrer">
            {locale === 'ar' ? 'إعادة تعيين كلمة المرور' : 'Reset password'}
          </a>
        </p>
      ) : null}

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
