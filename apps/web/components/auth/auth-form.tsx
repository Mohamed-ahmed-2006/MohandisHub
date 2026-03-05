'use client';

import type { UserRole } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AuthModeSwitch, type AuthMode } from '@/components/auth/auth-mode-switch';
import { isApiClientError, useAuth } from '@/components/auth/auth-provider';
import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type RegisterRole = Exclude<UserRole, 'admin'>;

type FieldName = 'email' | 'password' | 'displayName' | 'companyName' | 'dateOfBirth' | 'phone' | 'acceptedTermsAt';

type AuthFormProps = {
  locale: Locale;
  mode: AuthMode;
  role: RegisterRole;
  dictionary: Dictionary['auth'];
  registerSteps?: string[];
  stepLabel?: string;
  ofLabel?: string;
  backLabel?: string;
  onModeChange: (nextMode: AuthMode) => void;
  onRoleChange: (nextRole: RegisterRole) => void;
  onBackToRoleSelect?: () => void;
};

type RegisterFormValues = {
  companyName: string; // business only
  displayName: string;
  email: string;
  password: string;
  dateOfBirth: string;
  phone: string;
};

type LoginFormValues = {
  email: string;
  password: string;
};

const isValidEmail = (value: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const isValidPassword = (value: string): boolean => {
  if (value.length < 8 || value.length > 128) {
    return false;
  }

  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
};

const isValidDateFormat = (value: string): boolean => {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
};

const hasMinimumAge = (dateOfBirth: string, minimumAge: number): boolean => {
  const date = new Date(dateOfBirth);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  const years = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  const dayDiff = today.getDate() - date.getDate();

  const adjustedAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? years - 1 : years;

  return adjustedAge >= minimumAge;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object';
};

const extractFieldErrors = (details: unknown): Partial<Record<FieldName, string>> => {
  if (!isRecord(details)) {
    return {};
  }

  const fields: FieldName[] = ['email', 'password', 'displayName', 'companyName', 'dateOfBirth', 'phone', 'acceptedTermsAt'];
  const parsedErrors: Partial<Record<FieldName, string>> = {};

  fields.forEach((field) => {
    const raw = details[field];

    if (Array.isArray(raw) && raw.length > 0) {
      const firstText = raw.find((item) => typeof item === 'string');

      if (typeof firstText === 'string') {
        parsedErrors[field] = firstText;
      }
    }
  });

  return parsedErrors;
};

const getPostAuthPath = (locale: Locale, role: RegisterRole): string => {
  void role;
  return buildLocalePath(locale, '/app');
};

export const AuthForm = ({
  locale,
  mode,
  role,
  dictionary,
  registerSteps,
  stepLabel = 'Step',
  ofLabel = 'of',
  backLabel = 'Back',
  onModeChange,
  onRoleChange: _onRoleChange,
  onBackToRoleSelect,
}: AuthFormProps) => {
  const router = useRouter();
  const { login, register, isReady } = useAuth();

  const [loginValues, setLoginValues] = useState<LoginFormValues>({
    email: '',
    password: '',
  });

  const [registerValues, setRegisterValues] = useState<RegisterFormValues>({
    companyName: '',
    displayName: '',
    email: '',
    password: '',
    dateOfBirth: '',
    phone: '',
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<'error' | 'success' | 'info'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return dictionary.common.loading;
    }

    return mode === 'login' ? dictionary.login.title : dictionary.register.title;
  }, [dictionary, isSubmitting, mode]);

  const validateLogin = (): Partial<Record<FieldName, string>> => {
    const errors: Partial<Record<FieldName, string>> = {};

    if (!loginValues.email.trim()) {
      errors.email = dictionary.validation.required;
    } else if (!isValidEmail(loginValues.email.trim())) {
      errors.email = dictionary.validation.invalidEmail;
    }

    if (!loginValues.password) {
      errors.password = dictionary.validation.required;
    }

    return errors;
  };

  const validateRegister = (): Partial<Record<FieldName, string>> => {
    const errors: Partial<Record<FieldName, string>> = {};

    if (role === 'business') {
      if (!registerValues.companyName.trim()) {
        errors.companyName = dictionary.validation.required;
      } else if (registerValues.companyName.trim().length < 2 || registerValues.companyName.trim().length > 200) {
        errors.companyName = dictionary.validation.invalidCompanyName;
      }
    }

    if (!registerValues.displayName.trim()) {
      errors.displayName = dictionary.validation.required;
    } else if (
      registerValues.displayName.trim().length < 2 ||
      registerValues.displayName.trim().length > 100
    ) {
      errors.displayName = dictionary.validation.invalidDisplayName;
    }

    if (!registerValues.email.trim()) {
      errors.email = dictionary.validation.required;
    } else if (!isValidEmail(registerValues.email.trim())) {
      errors.email = dictionary.validation.invalidEmail;
    }

    if (!registerValues.password) {
      errors.password = dictionary.validation.required;
    } else if (!isValidPassword(registerValues.password)) {
      errors.password = dictionary.validation.invalidPassword;
    }

    if (!registerValues.dateOfBirth.trim()) {
      errors.dateOfBirth = dictionary.validation.required;
    } else if (!isValidDateFormat(registerValues.dateOfBirth)) {
      errors.dateOfBirth = dictionary.validation.invalidDateOfBirth;
    } else if (!hasMinimumAge(registerValues.dateOfBirth, 20)) {
      errors.dateOfBirth = dictionary.validation.minimumAge;
    }

    if (role === 'business') {
      if (!registerValues.phone.trim()) {
        errors.phone = dictionary.validation.phoneRequired;
      } else if (registerValues.phone.trim().length > 20) {
        errors.phone = dictionary.validation.invalidPhone;
      }
    } else if (registerValues.phone.length > 20) {
      errors.phone = dictionary.validation.invalidPhone;
    }

    if (!termsAccepted) {
      errors.acceptedTermsAt = dictionary.validation.acceptTermsRequired;
    }

    return errors;
  };

  const handleModeSwap = (): void => {
    const nextMode: AuthMode = mode === 'login' ? 'register' : 'login';
    onModeChange(nextMode);
    setFieldErrors({});
    setStatusMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (!isReady) {
      setStatusVariant('info');
      setStatusMessage(dictionary.common.sessionRestoring);
      return;
    }

    const validationErrors = mode === 'login' ? validateLogin() : validateRegister();

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      setStatusVariant('error');
      setStatusMessage(dictionary.errors.generic);
      return;
    }

    setFieldErrors({});
    setStatusMessage(null);
    setIsSubmitting(true);

    try {
      const registerPayload = {
        displayName: registerValues.displayName.trim(),
        email: registerValues.email.trim(),
        password: registerValues.password,
        role,
        dateOfBirth: registerValues.dateOfBirth,
        acceptedTermsAt: new Date().toISOString(),
        termsVersion: '2024-01',
        ...(role === 'business' && registerValues.companyName.trim().length > 0
          ? { companyName: registerValues.companyName.trim() }
          : {}),
        ...(registerValues.phone.trim().length > 0
          ? { phone: registerValues.phone.trim() }
          : {}),
      };

      const authenticatedUser =
        mode === 'login'
          ? await login({
              email: loginValues.email.trim(),
              password: loginValues.password,
            })
          : await register(registerPayload);

      setStatusVariant('success');
      setStatusMessage(null);

      const postAuthPath = getPostAuthPath(
        locale,
        authenticatedUser.role === 'admin' ? role : authenticatedUser.role,
      );
      router.push(postAuthPath);
    } catch (error: unknown) {
      if (isApiClientError(error)) {
        const backendFieldErrors = extractFieldErrors(error.details);
        setFieldErrors((current) => ({ ...current, ...backendFieldErrors }));
        setStatusVariant('error');
        setStatusMessage(error.message);
      } else {
        setStatusVariant('error');
        const isNetworkError =
          error instanceof TypeError ||
          (error instanceof Error && /fetch|network|connection|refused/i.test(error.message));
        setStatusMessage(
          isNetworkError ? dictionary.errors.networkError : dictionary.errors.generic,
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    void handleSubmit(event);
  };

  // ── Role-aware labels ──────────────────────────────────────────────
  const registerTitle = mode === 'register'
    ? { customer: dictionary.register.customerTitle, expert: dictionary.register.expertTitle, business: dictionary.register.businessTitle }[role]
    : dictionary.login.title;

  const registerSubtitle = mode === 'register'
    ? { customer: dictionary.register.customerSubtitle, expert: dictionary.register.expertSubtitle, business: dictionary.register.businessSubtitle }[role]
    : dictionary.login.subtitle;

  const displayNameLabel = {
    customer: dictionary.register.displayNameCustomerLabel,
    expert: dictionary.register.displayNameExpertLabel,
    business: dictionary.register.displayNameBusinessLabel,
  }[role];

  const dobLabel = {
    customer: dictionary.register.dateOfBirthLabel,
    expert: dictionary.register.dateOfBirthLabel,
    business: dictionary.register.dateOfBirthBusinessLabel,
  }[role];

  const dobHint = role === 'expert' ? dictionary.register.dateOfBirthExpertHint : null;

  const phoneLabel = role === 'business' ? dictionary.register.phoneBusinessLabel : dictionary.register.phoneLabel;
  const phoneHint = role === 'business' ? dictionary.register.phoneBusinessHint : dictionary.register.phoneHint;

  return (
    <section className="auth-form-shell" aria-live="polite" suppressHydrationWarning>
      <AuthModeSwitch
        mode={mode}
        loginLabel={dictionary.common.login}
        registerLabel={dictionary.common.register}
        onModeChange={onModeChange}
      />

      {mode === 'register' && registerSteps ? (
        <div className="auth-register-stepper">
          <OnboardingStepper
            steps={registerSteps}
            currentStep={1}
            stepLabel={stepLabel}
            ofLabel={ofLabel}
          />
        </div>
      ) : null}

      {mode === 'register' && onBackToRoleSelect ? (
        <div className="auth-form-role-bar">
          <button type="button" className="auth-form-back-button" onClick={onBackToRoleSelect}>
            &#8592; {backLabel}
          </button>
          <span className="auth-form-selected-role">{dictionary.roles[role]}</span>
        </div>
      ) : null}

      <header className="auth-form-header">
        <h1 className="auth-form-title">
          {mode === 'login' ? dictionary.login.title : registerTitle}
        </h1>
        <p className="auth-form-subtitle">
          {mode === 'login' ? dictionary.login.subtitle : registerSubtitle}
        </p>
      </header>

      {statusMessage ? <AuthStatusBanner variant={statusVariant} message={statusMessage} /> : null}

      <form className="auth-form" onSubmit={handleFormSubmit} noValidate>
        {/* Business only: Company name — first field */}
        {mode === 'register' && role === 'business' ? (
          <label className="auth-form-field-group">
            <span className="auth-form-field-label">{dictionary.register.companyNameLabel}</span>
            <input
              type="text"
              className="auth-form-field-input"
              placeholder={dictionary.register.companyNamePlaceholder}
              value={registerValues.companyName}
              onChange={(event) =>
                setRegisterValues((current) => ({
                  ...current,
                  companyName: event.target.value,
                }))
              }
              autoComplete="organization"
            />
            {fieldErrors.companyName ? (
              <span className="auth-form-field-error">{fieldErrors.companyName}</span>
            ) : null}
          </label>
        ) : null}

        {/* displayName — label differs per role */}
        {mode === 'register' ? (
          <label className="auth-form-field-group">
            <span className="auth-form-field-label">{displayNameLabel}</span>
            <input
              type="text"
              className="auth-form-field-input"
              value={registerValues.displayName}
              onChange={(event) =>
                setRegisterValues((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              autoComplete="name"
            />
            {role === 'business' ? (
              <span className="auth-form-field-hint">{dictionary.register.displayNameBusinessHint}</span>
            ) : null}
            {fieldErrors.displayName ? (
              <span className="auth-form-field-error">{fieldErrors.displayName}</span>
            ) : null}
          </label>
        ) : null}

        <label className="auth-form-field-group">
          <span className="auth-form-field-label">
            {mode === 'login' ? dictionary.login.emailLabel : dictionary.register.emailLabel}
          </span>
          <input
            type="email"
            className="auth-form-field-input"
            value={mode === 'login' ? loginValues.email : registerValues.email}
            onChange={(event) => {
              const nextValue = event.target.value;

              if (mode === 'login') {
                setLoginValues((current) => ({ ...current, email: nextValue }));
              } else {
                setRegisterValues((current) => ({ ...current, email: nextValue }));
              }
            }}
            autoComplete="email"
          />
          {fieldErrors.email ? (
            <span className="auth-form-field-error">{fieldErrors.email}</span>
          ) : null}
        </label>

        <label className="auth-form-field-group">
          <span className="auth-form-field-label">
            {mode === 'login' ? dictionary.login.passwordLabel : dictionary.register.passwordLabel}
          </span>
          <input
            type="password"
            className="auth-form-field-input"
            value={mode === 'login' ? loginValues.password : registerValues.password}
            onChange={(event) => {
              const nextValue = event.target.value;

              if (mode === 'login') {
                setLoginValues((current) => ({ ...current, password: nextValue }));
              } else {
                setRegisterValues((current) => ({ ...current, password: nextValue }));
              }
            }}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {fieldErrors.password ? (
            <span className="auth-form-field-error">{fieldErrors.password}</span>
          ) : null}
        </label>

        {mode === 'register' ? (
          <>
            <label className="auth-form-field-group">
              <span className="auth-form-field-label">{dobLabel}</span>
              <input
                type="date"
                className="auth-form-field-input"
                value={registerValues.dateOfBirth}
                onChange={(event) =>
                  setRegisterValues((current) => ({
                    ...current,
                    dateOfBirth: event.target.value,
                  }))
                }
              />
              {dobHint ? (
                <span className="auth-form-field-hint">{dobHint}</span>
              ) : null}
              {fieldErrors.dateOfBirth ? (
                <span className="auth-form-field-error">{fieldErrors.dateOfBirth}</span>
              ) : null}
            </label>

            <label className="auth-form-field-group">
              <span className="auth-form-field-label">{phoneLabel}</span>
              <input
                type="tel"
                className="auth-form-field-input"
                value={registerValues.phone}
                onChange={(event) =>
                  setRegisterValues((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                autoComplete="tel"
              />
              <span className="auth-form-field-hint">{phoneHint}</span>
              {fieldErrors.phone ? (
                <span className="auth-form-field-error">{fieldErrors.phone}</span>
              ) : null}
            </label>
          </>
        ) : null}

        {mode === 'register' ? (
          <label className="auth-form-field-group auth-form-terms-group">
            <input
              type="checkbox"
              className="auth-form-checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              aria-describedby={fieldErrors.acceptedTermsAt ? 'terms-error' : undefined}
            />
            <span className="auth-form-terms-text">
              {dictionary.register.acceptTermsPrefix}{' '}
              <Link href={buildLocalePath(locale, '/privacy')} className="auth-legal-link">
                {dictionary.register.privacyPolicy}
              </Link>{' '}
              {dictionary.register.acceptTermsConnector}{' '}
              <Link href={buildLocalePath(locale, '/terms')} className="auth-legal-link">
                {dictionary.register.termsAndConditions}
              </Link>
            </span>
            {fieldErrors.acceptedTermsAt ? (
              <span id="terms-error" className="auth-form-field-error">
                {fieldErrors.acceptedTermsAt}
              </span>
            ) : null}
          </label>
        ) : null}

        <button
          type="submit"
          className="auth-form-submit-button"
          disabled={isSubmitting || !isReady}
        >
          {submitLabel}
        </button>
      </form>

      <footer className="auth-form-footer">
        <p className="auth-form-footer-text">
          {mode === 'login' ? dictionary.common.noAccount : dictionary.common.haveAccount}
        </p>
        <button type="button" className="auth-form-footer-link-button" onClick={handleModeSwap}>
          {mode === 'login' ? dictionary.common.switchToRegister : dictionary.common.switchToLogin}
        </button>
      </footer>
    </section>
  );
};
