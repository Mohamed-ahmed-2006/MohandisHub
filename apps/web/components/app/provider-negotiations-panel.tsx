'use client';

import type { PriceNegotiation } from '@mohandishub/shared';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';

const visuallyHidden: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

import type { Dictionary } from '@/lib/i18n/types';
import { negotiationsApiClient } from '@/lib/negotiations/client';

import '@/app/dashboard.css';

type Props = {
  accessToken: string;
  dictionary: Dictionary;
  /** Page already has H1; use a visually hidden heading for this section. */
  embedInPage?: boolean;
};

export function ProviderNegotiationsPanel({ accessToken, dictionary, embedInPage }: Props) {
  const np = (dictionary as { negotiation?: Record<string, string> }).negotiation ?? {};
  const [negotiations, setNegotiations] = useState<PriceNegotiation[]>([]);
  const [negLoading, setNegLoading] = useState(false);
  const [negBusyId, setNegBusyId] = useState<string | null>(null);
  const [negCounterPrice, setNegCounterPrice] = useState<Record<string, string>>({});
  const [negValidHours, setNegValidHours] = useState<Record<string, '24' | '48' | '168'>>({});
  const [localError, setLocalError] = useState<string | null>(null);

  const loadNegotiations = useCallback(async () => {
    if (!accessToken) return;
    setNegLoading(true);
    setLocalError(null);
    try {
      const res = await negotiationsApiClient.list(accessToken, { role: 'provider', limit: 50 });
      setNegotiations(res.items);
    } catch {
      setNegotiations([]);
      setLocalError(dictionary.common?.errorLoading ?? 'Failed to load.');
    } finally {
      setNegLoading(false);
    }
  }, [accessToken, dictionary.common?.errorLoading]);

  useEffect(() => {
    void loadNegotiations();
  }, [loadNegotiations]);

  return (
    <section className="services-negotiations-section" aria-labelledby="negotiations-heading">
      <div
        className="services-negotiations-header"
        style={embedInPage ? { justifyContent: 'flex-end' } : undefined}
      >
        {embedInPage ? (
          <h2 id="negotiations-heading" className="services-negotiations-title" style={visuallyHidden}>
            {np.providerSectionTitle ?? 'Price negotiations'}
          </h2>
        ) : (
          <h2 id="negotiations-heading" className="services-negotiations-title">
            {np.providerSectionTitle ?? 'Price negotiations'}
          </h2>
        )}
        <button type="button" className="dashboard-link-btn" onClick={() => void loadNegotiations()}>
          {np.refresh ?? 'Refresh'}
        </button>
      </div>
      {localError && <p className="services-negotiations-muted">{localError}</p>}
      {negLoading ? (
        <p className="services-negotiations-muted">{dictionary.common?.loading ?? 'Loading...'}</p>
      ) : negotiations.length === 0 ? (
        <p className="services-negotiations-muted">{np.noNegotiations ?? 'No negotiations yet.'}</p>
      ) : (
        <ul className="services-negotiations-list">
          {negotiations.map((n) => {
            const providerTurn = n.status === 'pending' && n.latestOfferedBy === n.customerId;
            const hKey = n.id;
            const validH = negValidHours[hKey] ?? '48';
            return (
              <li key={n.id} className="services-negotiation-card">
                <p className="services-negotiation-title">{n.serviceTitle ?? 'Service'}</p>
                <p className="services-negotiation-meta">
                  {n.customerName ?? 'Customer'} · {n.status} · {n.latestAmount} {n.currency}
                </p>
                {n.status === 'pending' && providerTurn && (
                  <div className="services-negotiation-actions">
                    <label className="services-negotiation-label">{np.validForLabel}</label>
                    <select
                      className="dashboard-select services-negotiation-select"
                      value={validH}
                      onChange={(e) =>
                        setNegValidHours((prev) => ({
                          ...prev,
                          [hKey]: e.target.value as '24' | '48' | '168',
                        }))
                      }
                    >
                      <option value="24">{np.hours24 ?? '24 hours'}</option>
                      <option value="48">{np.hours48 ?? '48 hours'}</option>
                      <option value="168">{np.hours168 ?? '7 days'}</option>
                    </select>
                    <div className="services-negotiation-btn-row">
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--primary"
                        disabled={negBusyId === n.id}
                        onClick={() => {
                          void (async () => {
                            if (!accessToken) return;
                            setNegBusyId(n.id);
                            try {
                              await negotiationsApiClient.respond(accessToken, n.id, {
                                decision: 'accept',
                                validForHours: validH === '24' ? 24 : validH === '48' ? 48 : 168,
                              });
                              await loadNegotiations();
                            } catch (err) {
                              setLocalError(err instanceof Error ? err.message : 'Failed');
                            } finally {
                              setNegBusyId(null);
                            }
                          })();
                        }}
                      >
                        {np.accept ?? 'Accept'}
                      </button>
                      <button
                        type="button"
                        className="dashboard-btn dashboard-btn--secondary"
                        disabled={negBusyId === n.id}
                        onClick={() => {
                          void (async () => {
                            if (!accessToken) return;
                            setNegBusyId(n.id);
                            try {
                              await negotiationsApiClient.respond(accessToken, n.id, {
                                decision: 'reject',
                              });
                              await loadNegotiations();
                            } catch (err) {
                              setLocalError(err instanceof Error ? err.message : 'Failed');
                            } finally {
                              setNegBusyId(null);
                            }
                          })();
                        }}
                      >
                        {np.reject ?? 'Reject'}
                      </button>
                    </div>
                    <label className="services-negotiation-label">{np.counterPrice}</label>
                    <input
                      type="number"
                      className="dashboard-input services-negotiation-input"
                      min={0}
                      step="0.01"
                      value={negCounterPrice[n.id] ?? ''}
                      onChange={(e) =>
                        setNegCounterPrice((prev) => ({ ...prev, [n.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--secondary"
                      disabled={negBusyId === n.id || !negCounterPrice[n.id]}
                      onClick={() => {
                        const p = parseFloat(negCounterPrice[n.id] ?? '');
                        if (!Number.isFinite(p) || p <= 0) return;
                        void (async () => {
                          if (!accessToken) return;
                          setNegBusyId(n.id);
                          try {
                            await negotiationsApiClient.respond(accessToken, n.id, {
                              decision: 'counter',
                              counterPrice: p,
                            });
                            setNegCounterPrice((prev) => {
                              const next = { ...prev };
                              delete next[n.id];
                              return next;
                            });
                            await loadNegotiations();
                          } catch (err) {
                            setLocalError(err instanceof Error ? err.message : 'Failed');
                          } finally {
                            setNegBusyId(null);
                          }
                        })();
                      }}
                    >
                      {np.counter ?? 'Counter'}
                    </button>
                  </div>
                )}
                {n.status === 'pending' && !providerTurn && (
                  <p className="services-negotiations-muted">{np.waitingCustomer}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
