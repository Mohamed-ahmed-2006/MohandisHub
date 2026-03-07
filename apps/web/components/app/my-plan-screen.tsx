'use client';

import type { Plan, Wallet } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { plansApiClient } from '@/lib/plans/client';
import { walletApiClient } from '@/lib/wallet/client';

import './my-plan-screen.css';

type Props = { locale: Locale; dictionary: Dictionary };

export const MyPlanScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const d = dictionary.plan ?? ({} as Record<string, string>);

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [planList, w] = await Promise.all([
        plansApiClient.listActivePlans(),
        accessToken ? walletApiClient.getMyWallet(accessToken) : Promise.resolve(null),
      ]);
      setPlans(planList);
      setWallet(w);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubscribe = async () => {
    if (!confirmPlan || !accessToken) return;
    setSubscribing(true);
    setMessage(null);
    try {
      const result = await plansApiClient.subscribe(accessToken, confirmPlan.id);
      setWallet((prev) => (prev ? { ...prev, balance: result.walletBalance } : prev));
      await updateAuthUser();
      setMessage({ type: 'success', text: d.subscribeSuccess ?? 'Subscribed successfully!' });
      setConfirmPlan(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Subscription failed';
      setMessage({ type: 'error', text: msg });
      setConfirmPlan(null);
    } finally {
      setSubscribing(false);
    }
  };

  if (!isReady || !authUser) {
    return (
      <main className="plan-screen-main">
        <Container>
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const currentPlan = authUser.plan ?? 'free';

  return (
    <main className="plan-screen-main">
      <Container className="plan-screen-container">
        <h1 className="plan-screen-title">{dictionary.nav.plan}</h1>

        <p className="plan-screen-current">
          {d.currentPlan ?? 'Current plan'}: <strong>{currentPlan}</strong>
          {wallet && (
            <span className="plan-screen-balance">
              {' '}
              — {dictionary.wallet.balance}: {wallet.balance.toFixed(2)} {wallet.currency}
            </span>
          )}
        </p>

        {message && (
          <div className={`plan-screen-msg plan-screen-msg--${message.type}`}>{message.text}</div>
        )}

        {loading ? (
          <p>{dictionary.admin?.loading ?? 'Loading...'}</p>
        ) : plans.length === 0 ? (
          <p>{d.noPlans ?? 'No plans available yet.'}</p>
        ) : (
          <div className="plan-screen-grid">
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.slug;
              return (
                <div key={plan.id} className={`plan-card ${isCurrent ? 'plan-card--current' : ''}`}>
                  <h2 className="plan-card-name">{plan.name}</h2>
                  {plan.description && <p className="plan-card-desc">{plan.description}</p>}
                  <p className="plan-card-price">
                    {plan.price} {plan.currency}
                    <span className="plan-card-cycle">
                      /{plan.billingCycle === 'monthly' ? (d.monthly ?? 'mo') : plan.billingCycle}
                    </span>
                  </p>
                  {plan.features.length > 0 && (
                    <ul className="plan-card-features">
                      {plan.features.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                  {isCurrent ? (
                    <span className="plan-card-badge">{d.activePlan ?? 'Active'}</span>
                  ) : (
                    <button
                      type="button"
                      className="plan-card-cta"
                      onClick={() => {
                        setMessage(null);
                        setConfirmPlan(plan);
                      }}
                    >
                      {d.choosePlan ?? 'Choose Plan'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {confirmPlan && (
          <div className="plan-modal-overlay" onClick={() => setConfirmPlan(null)}>
            <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="plan-modal-title">{d.confirmTitle ?? 'Confirm Subscription'}</h3>
              <p className="plan-modal-text">
                {d.confirmText
                  ? d.confirmText
                      .replace('{name}', confirmPlan.name)
                      .replace('{price}', String(confirmPlan.price))
                      .replace('{currency}', confirmPlan.currency)
                  : `Subscribe to ${confirmPlan.name} for ${confirmPlan.price} ${confirmPlan.currency}? This will be deducted from your wallet balance.`}
              </p>
              <div className="plan-modal-actions">
                <button
                  type="button"
                  className="plan-modal-cancel"
                  onClick={() => setConfirmPlan(null)}
                  disabled={subscribing}
                >
                  {dictionary.common.back}
                </button>
                <button
                  type="button"
                  className="plan-modal-confirm"
                  onClick={() => void handleSubscribe()}
                  disabled={subscribing}
                >
                  {subscribing
                    ? (dictionary.auth?.common?.loading ?? '...')
                    : (d.confirm ?? 'Confirm')}
                </button>
              </div>
            </div>
          </div>
        )}
      </Container>
    </main>
  );
};
