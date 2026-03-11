'use client';

import { useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
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
  const { status } = useAppStatus();
  const d = dictionary.wallet;

  const depositsPaused = status?.depositsPaused === true;
  const cryptoDisabled = status?.disableCryptoDeposits === true;
  const fiatEnabled = process.env.NEXT_PUBLIC_NOWPAYMENTS_FIAT_ENABLED === 'true';
  const cardDisabled = status?.disableCardDeposits === true || !fiatEnabled;
  const canDeposit = !depositsPaused && (cryptoDisabled === false || cardDisabled === false);

  const [step, setStep] = useState<'choose' | 'amount'>('choose');
  const [method, setMethod] = useState<'crypto' | 'card'>('crypto');
  const [amount, setAmount] = useState('');
  const [payCurrency, setPayCurrency] = useState('USDTTRC20');
  const [availableCurrencies, setAvailableCurrencies] = useState<string[]>(['USDTTRC20']);
  const [estimatedPayAmount, setEstimatedPayAmount] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void walletApiClient
      .getDepositCurrencies(accessToken)
      .then((currencies) => {
        if (currencies.length > 0) {
          setAvailableCurrencies(currencies);
          if (!currencies.includes(payCurrency)) {
            setPayCurrency(currencies[0]!);
          }
        }
      })
      .catch(() => {
        // keep fallback currency
      });
  }, [accessToken, payCurrency]);

  useEffect(() => {
    if (!accessToken || method !== 'crypto' || step !== 'amount') {
      setEstimatedPayAmount(null);
      return;
    }
    const numericAmount = parseFloat(amount.replace(/,/g, '.'));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setEstimatedPayAmount(null);
      return;
    }

    const timer = setTimeout(() => {
      setEstimating(true);
      void walletApiClient
        .getDepositEstimate(accessToken, numericAmount, 'USD', payCurrency)
        .then((result) => {
          setEstimatedPayAmount(result.estimatedAmount);
        })
        .catch(() => {
          setEstimatedPayAmount(null);
        })
        .finally(() => {
          setEstimating(false);
        });
    }, 350);

    return () => clearTimeout(timer);
  }, [accessToken, method, step, amount, payCurrency]);

  const handleMethodClick = (nextMethod: 'crypto' | 'card') => {
    setMethod(nextMethod);
    setStep('amount');
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
      const returnUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const result = await walletApiClient.createDepositCheckout(accessToken, {
        amount: num,
        currency: 'USD',
        method,
        ...(method === 'crypto' ? { payCurrency } : {}),
        ...(returnUrl ? { returnUrl } : {}),
      });
      onDepositCreated?.();
      onClose();
      window.location.href = result.checkoutUrl;
    } catch (err) {
      const msg =
        isApiClientError(err) && err.code === 'DEPOSITS_PAUSED'
          ? 'Deposits are temporarily paused.'
          : isApiClientError(err) && err.code === 'AMOUNT_TOO_LOW'
            ? err.message
            : isApiClientError(err) &&
                (err.code === 'CARD_DEPOSITS_DISABLED' || err.code === 'CRYPTO_DEPOSITS_DISABLED')
              ? err.message
              : d.depositError;
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
          x
        </button>
        <h2 className="deposit-modal-title">{d.depositTitle}</h2>

        {!canDeposit ? (
          <p className="deposit-modal-subtitle">
            {depositsPaused
              ? 'Deposits are temporarily paused. Please try again later.'
              : 'No deposit methods are currently available.'}
          </p>
        ) : step === 'choose' ? (
          <>
            <p className="deposit-modal-subtitle">{d.chooseMethod}</p>
            <div className="deposit-options">
              {!cryptoDisabled && (
                <button
                  type="button"
                  className="deposit-option-card"
                  onClick={() => handleMethodClick('crypto')}
                >
                  <span className="deposit-option-label">{d.crypto}</span>
                  <span className="deposit-option-action">{d.depositPayWithCrypto}</span>
                </button>
              )}
              {!cardDisabled && (
                <button
                  type="button"
                  className="deposit-option-card"
                  onClick={() => handleMethodClick('card')}
                >
                  <span className="deposit-option-label">{d.creditCard}</span>
                  <span className="deposit-option-action">{d.depositPayWithCard}</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="deposit-form">
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
            {method === 'crypto' && (
              <>
                <p className="deposit-modal-subtitle" style={{ marginTop: '0.4rem', marginBottom: '0.4rem' }}>
                  {estimating
                    ? 'Estimating conversion...'
                    : estimatedPayAmount != null
                      ? `Estimated to pay: ${estimatedPayAmount.toFixed(6)} ${payCurrency}`
                      : 'Enter amount in USD to see USDT estimate'}
                </p>
                <label className="deposit-form-label" style={{ marginTop: '0.75rem' }}>
                  Pay currency
                </label>
                <select
                  className="deposit-form-input"
                  value={payCurrency}
                  onChange={(e) => setPayCurrency(e.target.value)}
                  disabled={loading}
                >
                  {availableCurrencies.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </select>
              </>
            )}
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
