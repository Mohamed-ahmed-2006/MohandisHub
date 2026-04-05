'use client';

import type { UserRole } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AuthModeSwitch, type AuthMode } from '@/components/auth/auth-mode-switch';
import { isApiClientError, useAuth } from '@/components/auth/auth-provider';
import { AuthStatusBanner } from '@/components/auth/auth-status-banner';
import { OnboardingStepper } from '@/components/onboarding/onboarding-stepper';
import { COUNTRIES, DEFAULT_COUNTRY_CODE, getDialCodeForCountry } from '@/lib/data/countries';
import { detectCountryByIp } from '@/lib/geo/detect-country';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type RegisterRole = Exclude<UserRole, 'admin'>;

type FieldName =
  | 'email'
  | 'password'
  | 'displayName'
  | 'companyName'
  | 'dateOfBirth'
  | 'phone'
  | 'nationality'
  | 'acceptedTermsAt';

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
  companyName: string;
  displayName: string;
  email: string;
  password: string;
  dateOfBirth: string;
  phone: string;
  phoneCode: string;
  nationality: string;
};

type LoginFormValues = {
  email: string;
  password: string;
};

const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isValidPassword = (value: string): boolean => {
  if (value.length < 8 || value.length > 128) return false;
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /[0-9]/.test(value);
};

const isValidDateFormat = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

const hasMinimumAge = (dateOfBirth: string, minimumAge: number): boolean => {
  const date = new Date(dateOfBirth);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date();
  const years = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  const dayDiff = today.getDate() - date.getDate();
  const adjustedAge = monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? years - 1 : years;
  return adjustedAge >= minimumAge;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const extractFieldErrors = (details: unknown): Partial<Record<FieldName, string>> => {
  if (!isRecord(details)) return {};

  const fields: FieldName[] = [
    'email',
    'password',
    'displayName',
    'companyName',
    'dateOfBirth',
    'phone',
    'nationality',
    'acceptedTermsAt',
  ];
  const parsedErrors: Partial<Record<FieldName, string>> = {};

  fields.forEach((field) => {
    const raw = details[field];
    if (Array.isArray(raw) && raw.length > 0) {
      const firstText = raw.find((item) => typeof item === 'string');
      if (typeof firstText === 'string') parsedErrors[field] = firstText;
    }
  });

  return parsedErrors;
};

const getPostAuthPath = (locale: Locale, emailVerified: boolean): string =>
  buildLocalePath(locale, emailVerified ? '/app' : '/verify-email');

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
  const geoDetectedRef = useRef(false);

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
    phoneCode: getDialCodeForCountry(DEFAULT_COUNTRY_CODE),
    nationality: DEFAULT_COUNTRY_CODE,
  });

  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusVariant, setStatusVariant] = useState<'error' | 'success' | 'info'>('info');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  useEffect(() => {
    if (geoDetectedRef.current) return;
    geoDetectedRef.current = true;

    void detectCountryByIp().then((code) => {
      setRegisterValues((prev) => ({
        ...prev,
        nationality: prev.nationality === DEFAULT_COUNTRY_CODE ? code : prev.nationality,
        phoneCode:
          prev.phoneCode === getDialCodeForCountry(DEFAULT_COUNTRY_CODE)
            ? getDialCodeForCountry(code)
            : prev.phoneCode,
      }));
    });
  }, []);

  const submitLabel = useMemo(() => {
    if (isSubmitting) return dictionary.common.loading;
    return mode === 'login' ? dictionary.login.title : dictionary.register.title;
  }, [dictionary, isSubmitting, mode]);

  const countryName = locale === 'ar' ? 'nameAr' : 'nameEn';

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
      } else if (
        registerValues.companyName.trim().length < 2 ||
        registerValues.companyName.trim().length > 200
      ) {
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

    if (!registerValues.nationality) {
      errors.nationality = dictionary.validation.required;
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
      const fullPhone =
        registerValues.phone.trim().length > 0
          ? `${registerValues.phoneCode}${registerValues.phone.trim()}`
          : undefined;

      const registerPayload: Parameters<typeof register>[0] = {
        displayName: registerValues.displayName.trim(),
        email: registerValues.email.trim(),
        password: registerValues.password,
        role,
        dateOfBirth: registerValues.dateOfBirth,
        acceptedTermsAt: new Date().toISOString(),
        termsVersion: '2024-01',
      };
      if (registerValues.nationality) registerPayload.nationality = registerValues.nationality;
      if (registerValues.phoneCode) registerPayload.phoneCode = registerValues.phoneCode;
      if (fullPhone) registerPayload.phone = fullPhone;
      if (role === 'business' && registerValues.companyName.trim().length > 0) {
        registerPayload.companyName = registerValues.companyName.trim();
      }

      const authenticatedUser =
        mode === 'login'
          ? await login({
              email: loginValues.email.trim(),
              password: loginValues.password,
            })
          : await register(registerPayload);

      setStatusVariant('success');
      setStatusMessage(null);

      const postAuthPath = getPostAuthPath(locale, authenticatedUser.emailVerified);
      router.push(postAuthPath);
      return;
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
    }
    setIsSubmitting(false);
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    void handleSubmit(event);
  };

  const handleNationalityChange = (nextCode: string): void => {
    setRegisterValues((prev) => ({
      ...prev,
      nationality: nextCode,
      phoneCode: getDialCodeForCountry(nextCode),
    }));
  };

  const registerTitle =
    mode === 'register'
      ? {
          customer: dictionary.register.customerTitle,
          expert: dictionary.register.expertTitle,
          business: dictionary.register.businessTitle,
          craftsman: dictionary.register.expertTitle,
        }[role]
      : dictionary.login.title;

  const registerSubtitle =
    mode === 'register'
      ? {
          customer: dictionary.register.customerSubtitle,
          expert: dictionary.register.expertSubtitle,
          business: dictionary.register.businessSubtitle,
          craftsman: dictionary.register.expertSubtitle,
        }[role]
      : dictionary.login.subtitle;

  const displayNameLabel = {
    customer: dictionary.register.displayNameCustomerLabel,
    expert: dictionary.register.displayNameExpertLabel,
    business: dictionary.register.displayNameBusinessLabel,
    craftsman: dictionary.register.displayNameExpertLabel,
  }[role];

  const dobLabel = {
    customer: dictionary.register.dateOfBirthLabel,
    expert: dictionary.register.dateOfBirthLabel,
    business: dictionary.register.dateOfBirthBusinessLabel,
    craftsman: dictionary.register.dateOfBirthLabel,
  }[role];

  const dobHint = role === 'expert' ? dictionary.register.dateOfBirthExpertHint : null;

  const phoneLabel =
    role === 'business' ? dictionary.register.phoneBusinessLabel : dictionary.register.phoneLabel;
  const phoneHint =
    role === 'business' ? dictionary.register.phoneBusinessHint : dictionary.register.phoneHint;

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
        {mode === 'register' && role === 'business' ? (
          <label className="auth-form-field-group">
            <span className="auth-form-field-label">{dictionary.register.companyNameLabel}</span>
            <input
              type="text"
              className="auth-form-field-input"
              placeholder={dictionary.register.companyNamePlaceholder}
              value={registerValues.companyName}
              onChange={(e) =>
                setRegisterValues((prev) => ({ ...prev, companyName: e.target.value }))
              }
              autoComplete="organization"
            />
            {fieldErrors.companyName ? (
              <span className="auth-form-field-error">{fieldErrors.companyName}</span>
            ) : null}
          </label>
        ) : null}

        {mode === 'register' ? (
          <label className="auth-form-field-group">
            <span className="auth-form-field-label">{displayNameLabel}</span>
            <input
              type="text"
              className="auth-form-field-input"
              value={registerValues.displayName}
              onChange={(e) =>
                setRegisterValues((prev) => ({ ...prev, displayName: e.target.value }))
              }
              autoComplete="name"
            />
            {role === 'business' ? (
              <span className="auth-form-field-hint">
                {dictionary.register.displayNameBusinessHint}
              </span>
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
            onChange={(e) => {
              const val = e.target.value;
              if (mode === 'login') {
                setLoginValues((prev) => ({ ...prev, email: val }));
              } else {
                setRegisterValues((prev) => ({ ...prev, email: val }));
              }
            }}
            autoComplete="email"
            suppressHydrationWarning
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
            suppressHydrationWarning
            onChange={(e) => {
              const val = e.target.value;
              if (mode === 'login') {
                setLoginValues((prev) => ({ ...prev, password: val }));
              } else {
                setRegisterValues((prev) => ({ ...prev, password: val }));
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
            {/* Nationality */}
            <label className="auth-form-field-group">
              <span className="auth-form-field-label">{dictionary.register.nationalityLabel}</span>
              <select
                className="auth-form-field-input auth-form-field-select"
                value={registerValues.nationality}
                onChange={(e) => handleNationalityChange(e.target.value)}
              >
                <option value="" disabled>
                  {dictionary.register.nationalityPlaceholder}
                </option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c[countryName]}
                  </option>
                ))}
              </select>
              {fieldErrors.nationality ? (
                <span className="auth-form-field-error">{fieldErrors.nationality}</span>
              ) : null}
            </label>

            {/* Date of birth */}
            <label className="auth-form-field-group">
              <span className="auth-form-field-label">{dobLabel}</span>
              <input
                type="date"
                className="auth-form-field-input"
                value={registerValues.dateOfBirth}
                onChange={(e) =>
                  setRegisterValues((prev) => ({ ...prev, dateOfBirth: e.target.value }))
                }
              />
              {dobHint ? <span className="auth-form-field-hint">{dobHint}</span> : null}
              {fieldErrors.dateOfBirth ? (
                <span className="auth-form-field-error">{fieldErrors.dateOfBirth}</span>
              ) : null}
            </label>

            {/* Phone with country code */}
            <div className="auth-form-field-group">
              <span className="auth-form-field-label">{phoneLabel}</span>
              <div className="auth-phone-input-row">
                <select
                  className="auth-form-field-input auth-phone-code-select"
                  value={registerValues.phoneCode}
                  onChange={(e) =>
                    setRegisterValues((prev) => ({ ...prev, phoneCode: e.target.value }))
                  }
                  aria-label={dictionary.register.phoneCodeLabel}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.dialCode}>
                      {c.dialCode} {c[countryName]}
                    </option>
                  ))}
                </select>
                <input
                  type="tel"
                  className="auth-form-field-input auth-phone-number-input"
                  value={registerValues.phone}
                  onChange={(e) =>
                    setRegisterValues((prev) => ({ ...prev, phone: e.target.value }))
                  }
                  autoComplete="tel-national"
                  dir="ltr"
                />
              </div>
              <span className="auth-form-field-hint">{phoneHint}</span>
              {fieldErrors.phone ? (
                <span className="auth-form-field-error">{fieldErrors.phone}</span>
              ) : null}
            </div>
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
          suppressHydrationWarning
        >
          {submitLabel}
        </button>
      </form>

      <footer className="auth-form-footer">
        <p className="auth-form-footer-text">
          {mode === 'login' ? dictionary.common.noAccount : dictionary.common.haveAccount}
        </p>
        <button
          type="button"
          className="auth-form-footer-link-button"
          onClick={handleModeSwap}
          suppressHydrationWarning
        >
          {mode === 'login' ? dictionary.common.switchToRegister : dictionary.common.switchToLogin}
        </button>
      </footer>
    </section>
  );
};
