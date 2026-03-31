'use client';

import type { Wallet, WithdrawalRequest } from '@mohandishub/shared';
import { canRequestWithdrawal } from '@mohandishub/shared';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { WalletDepositModal } from './wallet-deposit-modal';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { isApiClientError } from '@/lib/auth/client';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { walletApiClient } from '@/lib/wallet/client';

import './wallet-settings-screen.css';

type WalletSettingsScreenProps = Record<string, never>;

const MIN_WITHDRAWAL_AMOUNT = 20;

const formatStatus = (status: WithdrawalRequest['status']): string => {
  switch (status) {
    case 'pending_verification':
      return 'Pending verification';
    case 'processing':
      return 'Processing';
    case 'awaiting_transfer':
      return 'Awaiting transfer';
    case 'finished':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'rejected':
      return 'Rejected';
    case 'cancelled':
      return 'Cancelled';
    case 'blocked':
      return 'Blocked';
    default:
      return status;
  }
};

export const WalletSettingsScreen = (_props: WalletSettingsScreenProps) => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [showDeposit, setShowDeposit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawCurrency, setWithdrawCurrency] = useState('USDTTRC20');
  const [withdrawCurrencies, setWithdrawCurrencies] = useState<string[]>(['USDTTRC20']);
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawExtraId, setWithdrawExtraId] = useState('');
  const [withdrawSaveAddress, setWithdrawSaveAddress] = useState(true);
  const [withdrawMethod, setWithdrawMethod] = useState<'crypto' | 'instapay'>('crypto');
  const [instapayRecipient, setInstapayRecipient] = useState('');
  const [withdrawSaveInstapay, setWithdrawSaveInstapay] = useState(true);
  const [cryptoQuote, setCryptoQuote] = useState<{ crypto: number; currency: string } | null>(null);
  const [withdrawCode, setWithdrawCode] = useState('');
  const [activeWithdrawalId, setActiveWithdrawalId] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);

  const canWithdraw = authUser?.role ? canRequestWithdrawal(authUser.role) : false;

  const depositResult = useMemo(() => {
    const value = searchParams.get('deposit');
    return value === 'success' || value === 'cancelled' ? value : null;
  }, [searchParams]);

  const loadData = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setLoadingError(null);
    try {
      const nextWallet = await walletApiClient.getMyWallet(accessToken);
      setWallet(nextWallet);

      if (canWithdraw) {
        const rows = await walletApiClient.listWithdrawals(accessToken);
        setWithdrawals(rows);
        const pending = rows.find(
          (item) =>
            item.method === 'crypto' &&
            item.verificationRequired &&
            item.status === 'pending_verification',
        );
        setActiveWithdrawalId(pending?.id ?? null);
      } else {
        setWithdrawals([]);
      }
    } catch (error) {
      setLoadingError(isApiClientError(error) ? error.message : 'Failed to load wallet data.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, canWithdraw]);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
      return;
    }
    void loadData();
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router, loadData]);

  useEffect(() => {
    if (!accessToken) return;
    const handler = () => {
      void loadData();
    };
    window.addEventListener('wallet-updated', handler);
    return () => window.removeEventListener('wallet-updated', handler);
  }, [accessToken, loadData]);

  useEffect(() => {
    if (!accessToken) return;
    void walletApiClient
      .getDepositCurrencies(accessToken)
      .then((currencies) => {
        if (currencies.length > 0) {
          setWithdrawCurrencies(currencies);
          if (!currencies.includes(withdrawCurrency)) {
            setWithdrawCurrency(currencies[0]!);
          }
        }
      })
      .catch(() => {
        // Keep fallback currency if the list cannot be loaded.
      });
  }, [accessToken, withdrawCurrency]);

  const handleCreateWithdrawal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken) return;

    const amount = Number.parseFloat(withdrawAmount);
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAWAL_AMOUNT) {
      setWithdrawError(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT}.`);
      return;
    }
    if (withdrawMethod === 'crypto' && !withdrawAddress.trim()) {
      setWithdrawError('Withdrawal address is required.');
      return;
    }
    if (withdrawMethod === 'instapay' && !instapayRecipient.trim()) {
      setWithdrawError('InstaPay recipient phone or account is required.');
      return;
    }

    setWithdrawBusy(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const created = await walletApiClient.createWithdrawal(accessToken, {
        method: withdrawMethod,
        amountEgp: amount,
        ...(withdrawMethod === 'crypto'
          ? {
              currency: withdrawCurrency.trim().toUpperCase(),
              address: withdrawAddress.trim(),
              ...(withdrawExtraId.trim() ? { extraId: withdrawExtraId.trim() } : {}),
              saveAddress: withdrawSaveAddress,
            }
          : {
              instapayRecipient: instapayRecipient.trim(),
              saveInstapayRecipient: withdrawSaveInstapay,
            }),
      });
      setActiveWithdrawalId(created.id);
      setWithdrawCode('');
      setWithdrawSuccess('Withdrawal request submitted.');
      await loadData();
    } catch (error) {
      setWithdrawError(
        isApiClientError(error) ? error.message : 'Failed to create withdrawal request.',
      );
    } finally {
      setWithdrawBusy(false);
    }
  };

  const handleVerifyWithdrawal = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accessToken || !activeWithdrawalId) return;
    if (!withdrawCode.trim()) {
      setWithdrawError('Verification code is required.');
      return;
    }

    setWithdrawBusy(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      await walletApiClient.verifyWithdrawal(accessToken, activeWithdrawalId, withdrawCode.trim());
      setWithdrawCode('');
      setWithdrawSuccess('Verification submitted successfully.');
      await loadData();
    } catch (error) {
      setWithdrawError(
        isApiClientError(error) ? error.message : 'Failed to verify withdrawal request.',
      );
    } finally {
      setWithdrawBusy(false);
    }
  };

  if (!isReady || !authUser) {
    return (
      <main className="wallet-settings-main">
        <Container className="wallet-settings-container">
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="wallet-settings-main">
      <Container className="wallet-settings-container">
        <div className="app-page-header">
          <div>
            <h1 className="app-page-title">{dictionary.wallet.balance}</h1>
          </div>
          <div className="app-page-header-actions">
            <Link href={buildLocalePath(locale, '/app/settings')} className="wallet-settings-back">
              {dictionary.nav.settings}
            </Link>
          </div>
        </div>

        {depositResult && (
          <p
            className={
              depositResult === 'success'
                ? 'wallet-settings-message wallet-settings-message-success'
                : 'wallet-settings-message wallet-settings-message-error'
            }
          >
            {depositResult === 'success'
              ? (dictionary.wallet.depositSuccess ?? 'Deposit completed successfully.')
              : (dictionary.wallet.depositCancelled ?? 'Deposit was cancelled.')}
          </p>
        )}

        <section className="wallet-settings-card">
          <p className="wallet-settings-label">{dictionary.wallet.balance}</p>
          <p className="wallet-settings-balance">
            {wallet ? `${wallet.balance.toFixed(2)} ${wallet.currency}` : '-'}
          </p>
          <button
            type="button"
            className="wallet-settings-primary"
            onClick={() => setShowDeposit(true)}
            disabled={loading}
          >
            {dictionary.wallet.deposit}
          </button>
          {loadingError && <p className="wallet-settings-message wallet-settings-message-error">{loadingError}</p>}
        </section>

        {canWithdraw && (
          <section className="wallet-settings-card">
            <h2 className="wallet-settings-section-title">Withdraw</h2>
            <p className="wallet-settings-hint">
              Withdraw from your wallet in EGP. Minimum {MIN_WITHDRAWAL_AMOUNT} EGP. Crypto withdrawals are
              sent to your wallet address in the selected payout currency. InstaPay withdrawals are reviewed
              manually and usually take 1-5 business days to complete.
            </p>

            <div className="wallet-settings-form" style={{ marginBottom: 12 }}>
              <label className="wallet-settings-form-label">
                Method
                <select
                  className="wallet-settings-input"
                  value={withdrawMethod}
                  onChange={(e) => {
                    setWithdrawMethod(e.target.value as 'crypto' | 'instapay');
                    setCryptoQuote(null);
                    setWithdrawError(null);
                  }}
                >
                  <option value="crypto">Crypto (NOWPayments)</option>
                  <option value="instapay">InstaPay (manual, 1-5 business days)</option>
                </select>
              </label>
            </div>

            <form className="wallet-settings-form" onSubmit={(event) => void handleCreateWithdrawal(event)}>
              <label className="wallet-settings-form-label">
                Amount (EGP)
                <input
                  type="number"
                  min={MIN_WITHDRAWAL_AMOUNT}
                  step="0.01"
                  className="wallet-settings-input"
                  value={withdrawAmount}
                  onChange={(event) => {
                    setWithdrawAmount(event.target.value);
                    setCryptoQuote(null);
                  }}
                  required
                />
              </label>

              {withdrawMethod === 'crypto' && (
                <>
                  <label className="wallet-settings-form-label">
                    Payout currency
                    <select
                      className="wallet-settings-input"
                      value={withdrawCurrency}
                      onChange={(event) => {
                        setWithdrawCurrency(event.target.value);
                        setCryptoQuote(null);
                      }}
                      required
                    >
                      {withdrawCurrencies.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="wallet-settings-form-label">
                    Wallet address
                    <input
                      type="text"
                      className="wallet-settings-input"
                      value={withdrawAddress}
                      onChange={(event) => setWithdrawAddress(event.target.value)}
                      required
                    />
                  </label>

                  <label className="wallet-settings-form-label">
                    Extra ID / memo (optional)
                    <input
                      type="text"
                      className="wallet-settings-input"
                      value={withdrawExtraId}
                      onChange={(event) => setWithdrawExtraId(event.target.value)}
                    />
                  </label>

                  <label className="wallet-settings-checkbox">
                    <input
                      type="checkbox"
                      checked={withdrawSaveAddress}
                      onChange={(event) => setWithdrawSaveAddress(event.target.checked)}
                    />
                    Save payout details
                  </label>

                  <button
                    type="button"
                    className="wallet-settings-secondary"
                    disabled={withdrawBusy || !accessToken}
                    onClick={() => {
                      void (async () => {
                        if (!accessToken) return;
                        const amt = Number.parseFloat(withdrawAmount);
                        if (!Number.isFinite(amt) || amt < MIN_WITHDRAWAL_AMOUNT) {
                          setWithdrawError(`Enter at least ${MIN_WITHDRAWAL_AMOUNT} EGP to preview.`);
                          return;
                        }
                        setWithdrawBusy(true);
                        setWithdrawError(null);
                        try {
                          const q = await walletApiClient.getWithdrawalQuote(
                            accessToken,
                            amt,
                            withdrawCurrency.trim().toUpperCase(),
                          );
                          setCryptoQuote({
                            crypto: q.quotedCryptoAmount,
                            currency: q.payoutCurrency,
                          });
                        } catch (error) {
                          setWithdrawError(
                            isApiClientError(error) ? error.message : 'Could not load quote.',
                          );
                        } finally {
                          setWithdrawBusy(false);
                        }
                      })();
                    }}
                  >
                    Preview crypto quote
                  </button>
                  {cryptoQuote && (
                    <p className="wallet-settings-hint">
                      ≈ {cryptoQuote.crypto} {cryptoQuote.currency} (estimate; final amount set at submit)
                    </p>
                  )}
                </>
              )}

              {withdrawMethod === 'instapay' && (
                <>
                  <p className="wallet-settings-hint">
                    InstaPay deposits and withdrawals are processed manually and usually take 1-5 business days
                    to complete.
                  </p>
                  <label className="wallet-settings-form-label">
                    Recipient InstaPay phone / account
                    <input
                      type="text"
                      className="wallet-settings-input"
                      value={instapayRecipient}
                      onChange={(event) => setInstapayRecipient(event.target.value)}
                      required
                    />
                  </label>
                  <label className="wallet-settings-checkbox">
                    <input
                      type="checkbox"
                      checked={withdrawSaveInstapay}
                      onChange={(event) => setWithdrawSaveInstapay(event.target.checked)}
                    />
                    Save InstaPay recipient
                  </label>
                </>
              )}

              <button type="submit" className="wallet-settings-primary" disabled={withdrawBusy}>
                {withdrawBusy ? 'Submitting...' : 'Create withdrawal'}
              </button>
            </form>

            {activeWithdrawalId && (
              <form
                className="wallet-settings-form wallet-settings-verify"
                onSubmit={(event) => void handleVerifyWithdrawal(event)}
              >
                <label className="wallet-settings-form-label">
                  Verification code
                  <input
                    type="text"
                    className="wallet-settings-input"
                    value={withdrawCode}
                    onChange={(event) => setWithdrawCode(event.target.value)}
                    placeholder="Enter NOWPayments code"
                  />
                </label>
                <button type="submit" className="wallet-settings-secondary" disabled={withdrawBusy}>
                  {withdrawBusy ? 'Verifying...' : 'Verify withdrawal'}
                </button>
              </form>
            )}

            {withdrawError && (
              <p className="wallet-settings-message wallet-settings-message-error">{withdrawError}</p>
            )}
            {withdrawSuccess && (
              <p className="wallet-settings-message wallet-settings-message-success">
                {withdrawSuccess}
              </p>
            )}
          </section>
        )}

        {canWithdraw && (
          <section className="wallet-settings-card">
            <h2 className="wallet-settings-section-title">Withdrawal history</h2>
            {withdrawals.length === 0 ? (
              <p className="wallet-settings-hint">No withdrawals yet.</p>
            ) : (
              <div className="wallet-settings-history">
                {withdrawals.map((item) => (
                  <div key={item.id} className="wallet-settings-history-item">
                    <div>
                      <p className="wallet-settings-history-amount">
                        {item.sourceAmountEgp.toFixed(2)} EGP
                        {item.method === 'crypto' && item.destinationCryptoAmount != null
                          ? ` → ~${item.destinationCryptoAmount} ${item.destinationCurrency}`
                          : item.method === 'instapay'
                            ? ' → InstaPay'
                            : ''}
                      </p>
                      <p className="wallet-settings-history-meta">
                        {new Date(item.createdAt).toLocaleString(locale)}
                      </p>
                      {item.method === 'instapay' && item.status === 'awaiting_transfer' && accessToken && (
                        <button
                          type="button"
                          className="wallet-settings-secondary"
                          style={{ marginTop: 8 }}
                          onClick={() => {
                            void (async () => {
                              try {
                                await walletApiClient.cancelWithdrawal(accessToken, item.id);
                                await loadData();
                              } catch (error) {
                                setWithdrawError(
                                  isApiClientError(error) ? error.message : 'Cancel failed.',
                                );
                              }
                            })();
                          }}
                        >
                          Cancel request
                        </button>
                      )}
                    </div>
                    <span className={`wallet-settings-status wallet-settings-status-${item.status}`}>
                      {formatStatus(item.status)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </Container>

      {showDeposit && accessToken && (
        <WalletDepositModal
          dictionary={dictionary}
          accessToken={accessToken}
          onClose={() => setShowDeposit(false)}
          onDepositCreated={() => {
            void loadData();
          }}
        />
      )}
    </main>
  );
};
