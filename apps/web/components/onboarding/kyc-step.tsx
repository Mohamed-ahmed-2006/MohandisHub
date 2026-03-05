'use client';

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { authApiClient } from '@/lib/auth/client';

type KycStepProps = {
  title: string;
  description: string;
  buttonLabel: string;
  pendingLabel: string;
  verifiedLabel: string;
  rejectedLabel: string;
  onComplete: () => void;
};

type KycState = 'idle' | 'initiating' | 'pending' | 'verified' | 'rejected';

export const KycStep = ({
  title,
  description,
  buttonLabel,
  pendingLabel,
  verifiedLabel,
  rejectedLabel,
  onComplete,
}: KycStepProps) => {
  const { accessToken, authUser, refreshSession } = useAuth();
  const [kycState, setKycState] = useState<KycState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check current verification status on mount
  const checkStatus = useCallback(async () => {
    if (!accessToken) return;

    try {
      const result = await authApiClient.getVerificationStatus(accessToken);

      switch (result.verificationStatus) {
        case 'verified':
          setKycState('verified');
          break;
        case 'pending':
        case 'under_review':
          setKycState('pending');
          break;
        case 'rejected':
          setKycState('rejected');
          break;
        default:
          setKycState('idle');
      }
    } catch {
      // If no verification exists yet, stay idle
      setKycState('idle');
    }
  }, [accessToken]);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  // Poll for status while pending
  useEffect(() => {
    if (kycState !== 'pending') return;

    const interval = setInterval(() => {
      void checkStatus();
    }, 10_000);

    return () => clearInterval(interval);
  }, [kycState, checkStatus]);

  const handleInitiate = async () => {
    if (!accessToken || !authUser) return;

    setKycState('initiating');
    setErrorMessage(null);

    try {
      const result = await authApiClient.initiateVerification(accessToken, {
        email: authUser.email,
        displayName: authUser.displayName,
      });

      if (result.redirectUrl) {
        // Open KYC in new tab
        window.open(result.redirectUrl, '_blank', 'noopener,noreferrer');
      }

      setKycState('pending');
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'message' in error) {
        const msg = (error as { message: string }).message;
        // If already pending, treat as pending
        if (msg.toLowerCase().includes('pending')) {
          setKycState('pending');
          return;
        }
        setErrorMessage(msg);
      }
      setKycState('idle');
    }
  };

  const handleContinue = async () => {
    await refreshSession();
    onComplete();
  };

  return (
    <div className="kyc-step-shell">
      <h2 className="kyc-step-title">{title}</h2>
      <p className="kyc-step-description">{description}</p>

      {errorMessage ? (
        <div className="kyc-step-error">{errorMessage}</div>
      ) : null}

      {kycState === 'idle' ? (
        <button
          type="button"
          className="kyc-step-button"
          onClick={() => void handleInitiate()}
        >
          {buttonLabel}
        </button>
      ) : null}

      {kycState === 'initiating' ? (
        <div className="kyc-step-status kyc-step-status-pending">
          <div className="kyc-step-spinner" />
          <span>...</span>
        </div>
      ) : null}

      {kycState === 'pending' ? (
        <div className="kyc-step-status kyc-step-status-pending">
          <div className="kyc-step-spinner" />
          <span>{pendingLabel}</span>
          <button
            type="button"
            className="kyc-step-refresh-button"
            onClick={() => void checkStatus()}
          >
            &#8635;
          </button>
        </div>
      ) : null}

      {kycState === 'verified' ? (
        <div className="kyc-step-status kyc-step-status-verified">
          <span className="kyc-step-check-icon">&#10003;</span>
          <span>{verifiedLabel}</span>
          <button
            type="button"
            className="kyc-step-continue-button"
            onClick={() => void handleContinue()}
          >
            &#8594;
          </button>
        </div>
      ) : null}

      {kycState === 'rejected' ? (
        <div className="kyc-step-status kyc-step-status-rejected">
          <span>{rejectedLabel}</span>
          <button
            type="button"
            className="kyc-step-button"
            onClick={() => void handleInitiate()}
          >
            {buttonLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
};
