'use client';

import type { Plan, PlanUsageSummary, Wallet } from '@mohandishub/shared';
import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
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
  const { status } = useAppStatus();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planUsage, setPlanUsage] = useState<PlanUsageSummary | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const plansFeatureEnabled = status?.featurePlansEnabled !== false;

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
    if (!plansFeatureEnabled) {
      setPlans([]);
      setPlanUsage(null);
      setWallet(null);
      setSubscriptionEndsAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [planList, w, subscription, usage] = await Promise.all([
        accessToken
          ? plansApiClient.listActivePlans(accessToken)
          : Promise.resolve([] as Plan[]),
        accessToken ? walletApiClient.getMyWallet(accessToken) : Promise.resolve(null),
        accessToken ? plansApiClient.getCurrentSubscription(accessToken) : Promise.resolve(null),
        accessToken ? plansApiClient.getMyUsage(accessToken) : Promise.resolve(null),
      ]);
      setPlans(planList);
      setPlanUsage(usage);
      setWallet(w);
      setSubscriptionEndsAt(subscription?.subscriptionEndsAt ?? null);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken, plansFeatureEnabled]);

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
      try {
        const nextUsage = await plansApiClient.getMyUsage(accessToken);
        setPlanUsage(nextUsage);
      } catch {
        setPlanUsage(null);
      }
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
  const role = authUser.role;
  const u = planUsage;

  const fmt = (template: string, vars: Record<string, string | number>) =>
    template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));

  const showPlanUsage =
    plansFeatureEnabled &&
    !loading &&
    u?.plansFeatureEnabled &&
    (((role === 'customer' && u.customer) ||
      ((role === 'expert' || role === 'craftsman') && u.individualProvider) ||
      (role === 'business' && u.business)) ||
      (u.usageQuotas?.length ?? 0) > 0);

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
              {dictionary.wallet.balance}: {wallet.balance.toFixed(2)} {wallet.currency ?? 'EGP'}
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

        {showPlanUsage && u && (
          <section className="plan-screen-usage" aria-labelledby="plan-usage-heading">
            <h2 id="plan-usage-heading" className="plan-screen-usage-title">
              {d.usageTitle ?? 'Your plan usage'}
            </h2>
            <p className="plan-screen-usage-note">{d.usageConcurrentNote}</p>
            <ul className="plan-screen-usage-list">
              {role === 'customer' && u.customer && (
                <li>
                  {u.customer.maxNeeds == null
                    ? fmt(d.usageNeedsUnlimited ?? '', { used: u.customer.activeNeedsCount })
                    : fmt(d.usageNeeds ?? '', {
                        used: u.customer.activeNeedsCount,
                        max: u.customer.maxNeeds,
                        remaining: u.customer.remainingNeeds ?? 0,
                      })}
                </li>
              )}
              {(role === 'expert' || role === 'craftsman') && u.individualProvider && (
                <>
                  <li>
                    {u.individualProvider.maxServices == null
                      ? fmt(d.usageServicesUnlimited ?? '', { used: u.individualProvider.servicesCount })
                      : fmt(d.usageServices ?? '', {
                          used: u.individualProvider.servicesCount,
                          max: u.individualProvider.maxServices,
                          remaining: u.individualProvider.remainingServices ?? 0,
                        })}
                  </li>
                  <li>
                    {u.individualProvider.maxActiveBids == null
                      ? fmt(d.usagePendingBidsUnlimited ?? '', {
                          used: u.individualProvider.pendingBidsCount,
                        })
                      : fmt(d.usagePendingBids ?? '', {
                          used: u.individualProvider.pendingBidsCount,
                          max: u.individualProvider.maxActiveBids,
                          remaining: u.individualProvider.remainingActiveBids ?? 0,
                        })}
                  </li>
                </>
              )}
              {role === 'business' && u.business && (
                <>
                  <li>
                    {u.business.maxJobs == null
                      ? fmt(d.usageJobsUnlimited ?? '', { used: u.business.jobsCount })
                      : fmt(d.usageJobs ?? '', {
                          used: u.business.jobsCount,
                          max: u.business.maxJobs,
                          remaining: u.business.remainingJobs ?? 0,
                        })}
                  </li>
                  <li>
                    {u.business.maxBusinessServices == null
                      ? fmt(d.usageBusinessServicesUnlimited ?? '', { used: u.business.servicesCount })
                      : fmt(d.usageBusinessServices ?? '', {
                          used: u.business.servicesCount,
                          max: u.business.maxBusinessServices,
                          remaining: u.business.remainingBusinessServices ?? 0,
                        })}
                  </li>
                </>
              )}
            </ul>
            {u.usageQuotas && u.usageQuotas.length > 0 && (
              <>
                <h3 className="plan-screen-usage-subtitle">{d.usageMeteredTitle}</h3>
                <p className="plan-screen-usage-note">{d.usageMeteredIntro}</p>
                <ul className="plan-screen-usage-list">
                  {u.usageQuotas.map((q) => {
                    const label = d[`quotaFeature_${q.featureKey}`] ?? q.featureKey;
                    const ends = new Date(q.periodEndsAt).toLocaleDateString(
                      locale === 'ar' ? 'ar-EG' : undefined,
                      { year: 'numeric', month: 'short', day: 'numeric' },
                    );
                    return (
                      <li key={q.featureKey}>
                        {fmt(d.usageQuotaLine ?? '', {
                          label,
                          used: q.used,
                          max: q.maxPerPeriod,
                          remaining: q.remaining,
                          ends,
                        })}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
        )}

        {message && (
          <div className={`plan-screen-msg plan-screen-msg--${message.type}`} role="alert">
            {message.text}
          </div>
        )}
        {!plansFeatureEnabled && (
          <div className="plan-screen-msg plan-screen-msg--error" role="status">
            Plans are currently disabled by admin.
          </div>
        )}

        {plansFeatureEnabled && loading ? (
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
        ) : plansFeatureEnabled && plans.length === 0 ? (
          <div className="plan-screen-empty">
            <div className="plan-screen-empty-icon" aria-hidden>
              <ClipboardList size={32} aria-hidden />
            </div>
            <p>{d.noPlans ?? 'No plans available yet.'}</p>
          </div>
        ) : plansFeatureEnabled ? (
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
                      {plan.price} {plan.currency ?? 'EGP'}
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
        ) : null}

        {confirmPlan && (
          <div className="plan-modal-overlay" onClick={() => setConfirmPlan(null)}>
            <div className="plan-modal" onClick={(e) => e.stopPropagation()}>
              <h3 className="plan-modal-title">{d.confirmTitle ?? 'Confirm Subscription'}</h3>
              <p className="plan-modal-text">
                {d.confirmText
                  ? d.confirmText
                      .replace('{name}', confirmPlan.name)
                      .replace('{price}', String(confirmPlan.price))
                      .replace('{currency}', confirmPlan.currency ?? 'EGP')
                  : `Subscribe to ${confirmPlan.name} for ${confirmPlan.price} ${confirmPlan.currency ?? 'EGP'}? This will be deducted from your wallet balance.`}
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
