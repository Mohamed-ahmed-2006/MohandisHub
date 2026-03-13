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
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState<string | null>(null);
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
      const [planList, w, subscription] = await Promise.all([
        plansApiClient.listActivePlans(),
        accessToken ? walletApiClient.getMyWallet(accessToken) : Promise.resolve(null),
        accessToken ? plansApiClient.getCurrentSubscription(accessToken) : Promise.resolve(null),
      ]);
      setPlans(planList);
      setWallet(w);
      setSubscriptionEndsAt(subscription?.subscriptionEndsAt ?? null);
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
      setSubscriptionEndsAt(result.subscriptionEndsAt);
      await updateAuthUser();
      window.dispatchEvent(new CustomEvent('wallet-updated'));
      const endDate = result.subscriptionEndsAt
        ? new Date(result.subscriptionEndsAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
        : '';
      const successText = endDate
        ? `${d.subscribeSuccess ?? 'Subscribed successfully!'} (${d.subscriptionEndsAt ?? 'Subscription ends'}: ${endDate})`
        : (d.subscribeSuccess ?? 'Subscribed successfully!');
      setMessage({ type: 'success', text: successText });
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

  const getPlanIcon = (slug: string) => {
    const icons: Record<string, React.ReactNode> = {
      free: (
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
      basic: (
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
        </svg>
      ),
      pro: (
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
      premium: (
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
      ),
    };
    return icons[slug] ?? icons.free;
  };

  return (
    <main className="plan-screen-main">
      <Container className="plan-screen-container">
        <header className="plan-screen-header">
          <h1 className="plan-screen-title">{dictionary.nav.plan}</h1>
          <p className="plan-screen-subtitle">
            {d.subtitle ?? 'Choose the plan that fits your needs'}
          </p>
        </header>

        <div className="plan-screen-status">
          <span className="plan-screen-current">
            {d.currentPlan ?? 'Current plan'}: <strong>{currentPlan}</strong>
          </span>
          {wallet && (
            <span className="plan-screen-balance">
              {dictionary.wallet.balance}: {wallet.balance.toFixed(2)} {wallet.currency ?? 'USD'}
            </span>
          )}
          {subscriptionEndsAt && (
            <span className="plan-screen-ends-at">
              {d.subscriptionEndsAt ?? 'Subscription ends'}:{' '}
              {new Date(subscriptionEndsAt).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </div>

        {message && (
          <div className={`plan-screen-msg plan-screen-msg--${message.type}`} role="alert">
            {message.text}
          </div>
        )}

        {loading ? (
          <div className="plan-screen-grid plan-screen-grid--loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="plan-card plan-card--skeleton">
                <div className="plan-card-icon-skeleton" />
                <div className="plan-card-name-skeleton" />
                <div className="plan-card-price-skeleton" />
                <div className="plan-card-features-skeleton" />
              </div>
            ))}
          </div>
        ) : plans.length === 0 ? (
          <div className="plan-screen-empty">
            <div className="plan-screen-empty-icon" aria-hidden>
              📋
            </div>
            <p>{d.noPlans ?? 'No plans available yet.'}</p>
          </div>
        ) : (
          <div className="plan-screen-grid">
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.slug;
              return (
                <article
                  key={plan.id}
                  className={`plan-card ${isCurrent ? 'plan-card--current' : ''}`}
                >
                  <div className="plan-card-icon" aria-hidden>
                    {getPlanIcon(plan.slug)}
                  </div>
                  <h2 className="plan-card-name">{plan.name}</h2>
                  {plan.description && <p className="plan-card-desc">{plan.description}</p>}
                  <div className="plan-card-price-wrap">
                    <span className="plan-card-price">
                      {plan.price} {plan.currency ?? 'USD'}
                    </span>
                    <span className="plan-card-cycle">
                      /{plan.billingCycle === 'monthly' ? (d.monthly ?? 'mo') : plan.billingCycle}
                    </span>
                  </div>
                  {plan.features.length > 0 && (
                    <ul className="plan-card-features">
                      {plan.features.map((f, i) => (
                        <li key={i}>
                          <span className="plan-card-feature-check" aria-hidden>
                            ✓
                          </span>
                          {f}
                        </li>
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
                </article>
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
                      .replace('{currency}', confirmPlan.currency ?? 'USD')
                  : `Subscribe to ${confirmPlan.name} for ${confirmPlan.price} ${confirmPlan.currency ?? 'USD'}? This will be deducted from your wallet balance.`}
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
