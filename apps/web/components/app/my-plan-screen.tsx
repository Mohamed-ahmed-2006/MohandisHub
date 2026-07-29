'use client';

import type { Plan, PlanUsageSummary } from '@mohandishub/shared';
import { ClipboardList } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';
import { plansApiClient } from '@/lib/plans/client';

import './my-plan-screen.css';

type Props = { locale: Locale; dictionary: Dictionary };

export const MyPlanScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard, updateAuthUser } = useAuth();
  const { status } = useAppStatus();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planUsage, setPlanUsage] = useState<PlanUsageSummary | null>(null);
  const [subscriptionEndsAt, setSubscriptionEndsAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const plansFeatureEnabled = status?.featurePlansEnabled !== false;

  // LAUNCH CONSTRAINT LC-02: paid plans are not purchasable yet, so they are
  // shown as "Coming soon" with no price and no subscribe control. The flag is
  // UX only — PlansService.subscribeToPlan refuses server-side regardless, and
  // an absent status must not be read as "purchasing is open".
  const subscriptionsPaused = status?.pausePlanSubscriptions !== false;
  /** A plan is paid if it carries any price at all. Free stays usable. */
  const isPaidPlan = (plan: Plan): boolean => Number(plan.price) > 0;

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
      setSubscriptionEndsAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // The EGP wallet is deliberately NOT fetched here. Nothing on this screen
      // is denominated in money any more, and the money wallet is frozen — so
      // reading it only creates a currency figure with nothing to spend it on.
      const [planList, subscription, usage] = await Promise.all([
        accessToken ? plansApiClient.listActivePlans(accessToken) : Promise.resolve([] as Plan[]),
        accessToken ? plansApiClient.getCurrentSubscription(accessToken) : Promise.resolve(null),
        accessToken ? plansApiClient.getMyUsage(accessToken) : Promise.resolve(null),
      ]);
      setPlans(planList);
      setPlanUsage(usage);
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
      // `result.walletBalance` is a legacy EGP figure and is deliberately not
      // read: no launch surface presents a money balance. The endpoint is
      // paused anyway (LC-02), so this path is unreachable at launch.
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
    ((role === 'customer' && u.customer) ||
      ((role === 'expert' || role === 'craftsman') && u.individualProvider) ||
      (role === 'business' && u.business) ||
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
          {/* The EGP wallet balance used to be rendered here. Removed with
              LC-02: the money wallet is frozen, plans are not bought with it,
              and showing a currency figure implied a balance the user could
              spend. An existing subscriber still sees their plan and its end
              date below. */}
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
                      ? fmt(d.usageServicesUnlimited ?? '', {
                          used: u.individualProvider.servicesCount,
                        })
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
                      ? fmt(d.usageBusinessServicesUnlimited ?? '', {
                          used: u.business.servicesCount,
                        })
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
          <div className="plan-screen-empty mh-empty-state mh-animate-fade-up" role="status">
            <div className="mh-empty-state-icon plan-screen-empty-icon" aria-hidden>
              <ClipboardList size={22} strokeWidth={2} aria-hidden />
            </div>
            <p className="mh-empty-state-desc">{d.noPlans ?? 'No plans available yet.'}</p>
          </div>
        ) : plansFeatureEnabled ? (
          <div className="plan-screen-grid">
            {plans.map((plan) => {
              const isCurrent = currentPlan === plan.slug;
              const paid = isPaidPlan(plan);
              // LC-02: a paid plan is presented as not-yet-available. It is NOT
              // relabelled free, and its price is not shown — quoting an EGP
              // figure for something that cannot be bought is worse than
              // quoting nothing.
              const notYetAvailable = paid && subscriptionsPaused;
              // No CTA while subscriptions are paused: subscribeToPlan refuses
              // for EVERY plan, so a button here would always fail. That covers
              // the one remaining case — a paid subscriber looking at the Free
              // card. The card still renders, so the catalogue stays honest.
              const showSubscribeButton = !isCurrent && !subscriptionsPaused;
              return (
                <article
                  key={plan.id}
                  className={`plan-card ${isCurrent ? 'plan-card--current' : ''} ${
                    notYetAvailable ? 'plan-card--coming-soon' : ''
                  }`}
                >
                  <div className="plan-card-icon" aria-hidden>
                    {getPlanIcon(plan.slug)}
                  </div>
                  <h2 className="plan-card-name">{plan.name}</h2>
                  {plan.description && <p className="plan-card-desc">{plan.description}</p>}
                  <div className="plan-card-price-wrap">
                    {notYetAvailable ? (
                      <span className="plan-card-price plan-card-price--coming-soon">
                        {dictionary.common.comingSoon}
                      </span>
                    ) : (
                      <>
                        <span className="plan-card-price">
                          {paid ? plan.price : (d.freePrice ?? 'Free')}
                        </span>
                        {paid && (
                          <span className="plan-card-cycle">
                            /
                            {plan.billingCycle === 'monthly'
                              ? (d.monthly ?? 'mo')
                              : plan.billingCycle}
                          </span>
                        )}
                      </>
                    )}
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
                    // An existing subscriber keeps seeing their plan. Labelled by
                    // PLAN NAME, never as a verification or trust signal.
                    <span className="plan-card-badge">
                      {paid ? `${plan.name} ${d.planNoun ?? 'plan'}` : (d.activePlan ?? 'Active')}
                    </span>
                  ) : notYetAvailable ? (
                    <span className="plan-card-badge plan-card-badge--coming-soon">
                      {dictionary.common.comingSoon}
                    </span>
                  ) : showSubscribeButton ? (
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
                  ) : null}
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
                {/* Names the plan and quotes NO amount. The legacy copy
                    (`d.confirmText`) promised "{price} {currency} deducted from
                    your wallet balance" against the wallet 20260728160000 froze;
                    it is left in the dictionary as legacy but is not rendered.
                    When per-plan pricing is decided (LC-02) this is where the
                    MHC amount belongs — not an EGP one. */}
                {(d.confirmTextNoPrice ?? 'Subscribe to {name}?').replace(
                  '{name}',
                  confirmPlan.name,
                )}
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
