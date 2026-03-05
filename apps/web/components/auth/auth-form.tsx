'use client';

import type { UserRole } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { AuthModeSwitch, type AuthMode } from '@/components/auth/auth-mode-switch';
import { isApiClientError, useAuth } from '@/components/auth/auth-provider';
import { AuthRoleSwitch } from '@/components/auth/auth-role-switch';
import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type RegisterRole = Exclude<UserRole, 'admin'>;

type FieldName = 'email' | 'password' | 'displayName' | 'dateOfBirth' | 'phone';

type AuthFormProps = {
  locale: Locale;
  mode: AuthMode;
  role: RegisterRole;
  dictionary: Dictionary['auth'];
  onModeChange: (nextMode: AuthMode) => void;
  onRoleChange: (nextRole: RegisterRole) => void;
};

type RegisterFormValues = {
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

  const fields: FieldName[] = ['email', 'password', 'displayName', 'dateOfBirth', 'phone'];
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
  if (role === 'expert') {
    return buildLocalePath(locale, '/onboarding/expert');
  }

  if (role === 'business') {
    return buildLocalePath(locale, '/onboarding/business');
  }

  return buildLocalePath(locale, '/onboarding/customer');
};

export const AuthForm = ({
  locale,
  mode,
  role,
  dictionary,
  onModeChange,
  onRoleChange,
}: AuthFormProps) => {
  const router = useRouter();
  const { login, register, isReady } = useAuth();

  const [loginValues, setLoginValues] = useState<LoginFormValues>({
    email: '',
    password: '',
  });

  const [registerValues, setRegisterValues] = useState<RegisterFormValues>({
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

    if (registerValues.phone.length > 20) {
      errors.phone = dictionary.validation.invalidPhone;
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
        ...(registerValues.phone.trim().length > 0
          ? {
              phone: registerValues.phone.trim(),
            }
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
        setStatusMessage(dictionary.errors.generic);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    void handleSubmit(event);
  };

  return (
    <section className="auth-form-shell" aria-live="polite">
      <AuthModeSwitch
        mode={mode}
        loginLabel={dictionary.common.login}
        registerLabel={dictionary.common.register}
        onModeChange={onModeChange}
      />

      {mode === 'register' ? (
        <AuthRoleSwitch
          role={role}
          labels={{
            customer: dictionary.roles.customer,
            expert: dictionary.roles.expert,
            business: dictionary.roles.business,
          }}
          onRoleChange={onRoleChange}
        />
      ) : null}

      <header className="auth-form-header">
        <h1 className="auth-form-title">
          {mode === 'login' ? dictionary.login.title : dictionary.register.title}
        </h1>
        <p className="auth-form-subtitle">
          {mode === 'login' ? dictionary.login.subtitle : dictionary.register.subtitle}
        </p>
      </header>

      {statusMessage ? <AuthStatusBanner variant={statusVariant} message={statusMessage} /> : null}

      <form className="auth-form" onSubmit={handleFormSubmit} noValidate>
        {mode === 'register' ? (
          <label className="auth-form-field-group">
            <span className="auth-form-field-label">{dictionary.register.displayNameLabel}</span>
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
              <span className="auth-form-field-label">{dictionary.register.dateOfBirthLabel}</span>
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
              {fieldErrors.dateOfBirth ? (
                <span className="auth-form-field-error">{fieldErrors.dateOfBirth}</span>
              ) : null}
            </label>

            <label className="auth-form-field-group">
              <span className="auth-form-field-label">{dictionary.register.phoneLabel}</span>
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
              <span className="auth-form-field-hint">{dictionary.register.phoneHint}</span>
              {fieldErrors.phone ? (
                <span className="auth-form-field-error">{fieldErrors.phone}</span>
              ) : null}
            </label>
          </>
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
