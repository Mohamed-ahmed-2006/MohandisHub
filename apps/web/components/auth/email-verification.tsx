'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { authApiClient } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';

type EmailVerificationProps = {
  dictionary: Dictionary['emailVerification'];
  onVerified: () => void;
};

const RESEND_COOLDOWN_SECONDS = 60;

export const EmailVerification = ({ dictionary, onVerified }: EmailVerificationProps) => {
  const { accessToken, authUser, refreshSession } = useAuth();

  const [code, setCode] = useState('');
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [hasSentInitial, setHasSentInitial] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if already verified
  useEffect(() => {
    if (authUser?.emailVerified) {
      setIsVerified(true);
    }
  }, [authUser]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  const sendCode = useCallback(async () => {
    if (!accessToken || isSending) return;

    setIsSending(true);
    setErrorMessage(null);

    try {
      const result = await authApiClient.sendOtp(accessToken, 'email');
      setMaskedEmail(result.destination);
      setCountdown(RESEND_COOLDOWN_SECONDS);
      setHasSentInitial(true);
    } catch {
      setErrorMessage(dictionary.sendError);
    } finally {
      setIsSending(false);
    }
  }, [accessToken, isSending, dictionary.sendError]);

  // Auto-send on mount
  useEffect(() => {
    if (!hasSentInitial && accessToken && !authUser?.emailVerified) {
      void sendCode();
    }
  }, [hasSentInitial, accessToken, authUser?.emailVerified, sendCode]);

  const handleVerify = async () => {
    if (!accessToken || isVerifying || code.length !== 6) return;

    setIsVerifying(true);
    setErrorMessage(null);

    try {
      const result = await authApiClient.verifyOtp(accessToken, 'email', code);

      if (result.verified) {
        setIsVerified(true);
        // Refresh session so authUser.emailVerified updates
        await refreshSession();
      }
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'message' in error) {
        setErrorMessage((error as { message: string }).message);
      } else {
        setErrorMessage(dictionary.invalidCode);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleFormSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void handleVerify();
  };

  const handleCodeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value.replace(/\D/g, '').slice(0, 6);
    setCode(value);
  };

  if (isVerified) {
    return (
      <div className="email-verification-shell" suppressHydrationWarning>
        <div className="email-verification-success">
          <div className="email-verification-success-icon">&#10003;</div>
          <h2 className="email-verification-success-title">{dictionary.verified}</h2>
          <p className="email-verification-success-message">{dictionary.verifiedMessage}</p>
          <button
            type="button"
            className="email-verification-continue-button"
            onClick={onVerified}
          >
            {dictionary.continueButton}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="email-verification-shell" suppressHydrationWarning>
      <h2 className="email-verification-title">{dictionary.title}</h2>
      <p className="email-verification-subtitle">{dictionary.subtitle}</p>

      {maskedEmail ? (
        <p className="email-verification-destination">
          {dictionary.codeSentTo} <strong>{maskedEmail}</strong>
        </p>
      ) : null}

      <p className="email-verification-dev-hint" role="status">
        {dictionary.devCodeHint}
      </p>

      {errorMessage ? (
        <div className="email-verification-error">{errorMessage}</div>
      ) : null}

      <form className="email-verification-form" onSubmit={handleFormSubmit}>
        <label className="email-verification-field-group">
          <span className="email-verification-field-label">{dictionary.codeLabel}</span>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="email-verification-code-input"
            placeholder={dictionary.codePlaceholder}
            value={code}
            onChange={handleCodeChange}
            autoComplete="one-time-code"
            autoFocus
          />
        </label>

        <button
          type="submit"
          className="email-verification-verify-button"
          disabled={isVerifying || code.length !== 6}
        >
          {isVerifying ? '...' : dictionary.verifyButton}
        </button>
      </form>

      <div className="email-verification-resend">
        {countdown > 0 ? (
          <span className="email-verification-countdown">
            {dictionary.resendCountdown} {countdown}s
          </span>
        ) : (
          <button
            type="button"
            className="email-verification-resend-button"
            onClick={() => void sendCode()}
            disabled={isSending}
          >
            {isSending ? '...' : dictionary.resendButton}
          </button>
        )}
      </div>
    </div>
  );
};
