'use client';

import { useState } from 'react';

import { isApiClientError } from '@/lib/auth/client';
import type { Dictionary } from '@/lib/i18n/types';
import { walletApiClient } from '@/lib/wallet/client';

type WalletDepositModalProps = {
  dictionary: Dictionary;
  accessToken: string | null;
  onClose: () => void;
  onDepositCreated?: () => void;
};

export const WalletDepositModal = ({
  dictionary,
  accessToken,
  onClose,
  onDepositCreated,
}: WalletDepositModalProps) => {
  const d = dictionary.wallet;
  const [step, setStep] = useState<'choose' | 'amount'>('choose');
  const [method, setMethod] = useState<'crypto' | 'card'>('crypto');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCryptoClick = () => {
    setMethod('crypto');
    setStep('amount');
    setError(null);
  };

  const handleCardClick = () => {
    setMethod('card');
    setStep('amount');
    setError(null);
  };

  const handleCryptoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    const num = parseFloat(amount.replace(/,/g, '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setError(d.depositError);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { paymentUrl } = await walletApiClient.createCryptoDeposit(accessToken, num, 'USDT');
      onDepositCreated?.();
      onClose();
      window.open(paymentUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setError(d.depositError);
    } finally {
      setLoading(false);
    }
  };

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken) return;
    const num = parseFloat(amount.replace(/,/g, '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setError(d.depositError);
      return;
    }
    if (num < 50) {
      setError(d.depositMinAmount ?? 'Minimum card deposit is 50 EGP.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const returnUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const { checkoutUrl } = await walletApiClient.createStripeCheckout(
        accessToken,
        num,
        'EGP',
        returnUrl,
      );
      onDepositCreated?.();
      onClose();
      window.location.href = checkoutUrl;
    } catch (err) {
      const msg =
        isApiClientError(err) && err.code === 'AMOUNT_TOO_LOW' ? err.message : d.depositError;
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setStep('choose');
    setAmount('');
    setError(null);
  };

  return (
    <div className="home-drawer-overlay" onClick={onClose}>
      <div className="deposit-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="deposit-modal-close" onClick={onClose}>
          ×
        </button>
        <h2 className="deposit-modal-title">{d.depositTitle}</h2>

        {step === 'choose' ? (
          <>
            <p className="deposit-modal-subtitle">{d.chooseMethod}</p>
            <div className="deposit-options">
              <button type="button" className="deposit-option-card" onClick={handleCryptoClick}>
                <span className="deposit-option-icon">₿</span>
                <span className="deposit-option-label">{d.crypto}</span>
                <span className="deposit-option-action">{d.depositPayWithCrypto}</span>
              </button>
              <button type="button" className="deposit-option-card" onClick={handleCardClick}>
                <span className="deposit-option-icon">💳</span>
                <span className="deposit-option-label">{d.creditCard}</span>
                <span className="deposit-option-action">{d.depositPayWithCard}</span>
              </button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (method === 'card' ? handleCardSubmit(e) : handleCryptoSubmit(e));
            }}
            className="deposit-form"
          >
            <label className="deposit-form-label">
              {method === 'card' ? d.depositAmountPlaceholderCard : d.depositAmountPlaceholder}
            </label>
            <input
              type="number"
              step="any"
              min="1"
              placeholder="0"
              className="deposit-form-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={loading}
            />
            {error && <p className="deposit-form-error">{error}</p>}
            <div className="deposit-form-actions">
              <button
                type="button"
                className="deposit-form-back"
                onClick={handleBack}
                disabled={loading}
              >
                {dictionary.common.back}
              </button>
              <button type="submit" className="deposit-form-submit" disabled={loading}>
                {loading
                  ? d.depositRedirecting
                  : method === 'card'
                    ? d.depositPayWithCard
                    : d.depositPayWithCrypto}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
