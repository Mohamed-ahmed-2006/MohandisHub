'use client';

import type { AdminPermission } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  advertisementsApiClient,
  type AdStatus,
  type Advertisement,
  type AdminAdControls,
} from '@/lib/advertisements/client';
import type { Dictionary } from '@/lib/i18n/types';

type AdminAdsTabProps = {
  dictionary: Dictionary;
  accessToken: string;
  adminPermissions: AdminPermission[];
};

const hasPermission = (permissions: string[], permission: string): boolean =>
  permissions.includes('super_admin') || permissions.includes(permission);

/** Billing state, spelled out. Never a currency figure. */
const BILLING_LABEL: Record<string, string> = {
  legacy: 'Legacy (pre-weekly, never charged in credits)',
  pending_review: 'Awaiting review — not charged',
  rejected: 'Rejected — not charged',
  awaiting_start: 'Approved — charges when its start is due',
  awaiting_credits: 'Approved — advertiser has insufficient credits',
  active: 'Paid week running',
  renewal_required: 'Week ended — advertiser must renew',
  cancelled: 'Cancelled — current week not refunded',
};

export const AdminAdsTab = ({ dictionary, accessToken, adminPermissions }: AdminAdsTabProps) => {
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [controls, setControls] = useState<AdminAdControls>({ acceptAds: true, mhcPrice: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending_review');
  const [scheduleAdId, setScheduleAdId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ startsAt: '', expiresAt: '', reason: '' });
  const [pricingAdId, setPricingAdId] = useState<string | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [rejectAdId, setRejectAdId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [savingControls, setSavingControls] = useState(false);
  const [busyAdId, setBusyAdId] = useState<string | null>(null);
  const canManageAds = hasPermission(adminPermissions, 'manage_ads');
  const canManageAdPricing = hasPermission(adminPermissions, 'manage_ad_pricing');
  const canManageAdScheduling = hasPermission(adminPermissions, 'manage_ad_scheduling');

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const activeModalRef = useRef<HTMLDivElement>(null);
  const activeModalId = rejectAdId || scheduleAdId || pricingAdId;

  const closeModal = useCallback(() => {
    setRejectAdId(null);
    setScheduleAdId(null);
    setPricingAdId(null);
  }, []);

  useEffect(() => {
    if (!activeModalId) return;

    const dialog = activeModalRef.current;
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    const getFocusableElements = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );

    const initialTarget = getFocusableElements()[0] ?? dialog;
    initialTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModal();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;
      if (!dialog?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const focusTarget = previousFocusRef.current;
      requestAnimationFrame(() => focusTarget?.focus());
      previousFocusRef.current = null;
    };
  }, [activeModalId, closeModal]);

  const stats = {
    total: rows.length,
    pendingReview: rows.filter((row) => row.status === 'pending_review').length,
    active: rows.filter((row) => row.status === 'active').length,
    awaitingCredits: rows.filter((row) => row.billing_status === 'awaiting_credits').length,
    renewalRequired: rows.filter((row) => row.billing_status === 'renewal_required').length,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = statusFilter as AdStatus | '';
      const [data, adControls] = await Promise.all([
        advertisementsApiClient.adminListAds(accessToken, status ? { status } : undefined),
        canManageAdPricing
          ? advertisementsApiClient.adminGetControls(accessToken)
          : Promise.resolve({ acceptAds: true, mhcPrice: 0 }),
      ]);
      setRows(data.rows);
      setControls(adControls);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ads');
    } finally {
      setLoading(false);
    }
  }, [accessToken, canManageAdPricing, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Approve. For an immediate campaign this also buys its first week in one
   * server-side transaction; for a future-dated one it only records the
   * approval, and the week is charged when the start becomes due.
   */
  const approve = async (adId: string) => {
    setBusyAdId(adId);
    setError(null);
    try {
      await advertisementsApiClient.adminApprove(accessToken, adId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve ad');
    } finally {
      setBusyAdId(null);
    }
  };

  const reject = async () => {
    if (!rejectAdId) return;
    const reason = rejectReason.trim();
    if (reason.length < 3) return;
    setBusyAdId(rejectAdId);
    setError(null);
    try {
      await advertisementsApiClient.adminReject(accessToken, rejectAdId, reason);
      setRejectAdId(null);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject ad');
    } finally {
      setBusyAdId(null);
    }
  };

  /** Start an approved campaign whose scheduled start has arrived. */
  const activateDue = async (adId: string) => {
    setBusyAdId(adId);
    setError(null);
    try {
      await advertisementsApiClient.adminActivateDue(accessToken, adId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate ad');
    } finally {
      setBusyAdId(null);
    }
  };

  const setStatus = async (adId: string, status: 'paused_by_admin' | 'cancelled') => {
    try {
      await advertisementsApiClient.adminSetStatus(accessToken, adId, { status });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ad status');
    }
  };

  const saveSchedule = async () => {
    if (!scheduleAdId) return;
    try {
      const reason = scheduleForm.reason.trim();
      await advertisementsApiClient.adminSchedule(accessToken, scheduleAdId, {
        startsAt: scheduleForm.startsAt || null,
        expiresAt: scheduleForm.expiresAt || null,
        ...(reason ? { reason } : {}),
      });
      setScheduleAdId(null);
      setScheduleForm({ startsAt: '', expiresAt: '', reason: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    }
  };

  const savePriceOverride = async () => {
    if (!pricingAdId) return;
    const amount = Number.parseFloat(overrideAmount);
    if (!Number.isFinite(amount) || amount < 0) return;
    try {
      await advertisementsApiClient.adminPricingOverride(accessToken, pricingAdId, amount);
      setPricingAdId(null);
      setOverrideAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to override amount');
    }
  };

  const saveControls = async () => {
    if (controls.mhcPrice < 0) return;
    setSavingControls(true);
    try {
      await advertisementsApiClient.adminUpdateControls(accessToken, controls);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ad controls');
    } finally {
      setSavingControls(false);
    }
  };

  const formatDate = (value: string | null): string =>
    value ? new Date(value).toLocaleString('en-US') : '—';

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">{dictionary.admin?.tabs?.ads ?? 'Advertisements'}</h2>

      <div className="admin-section">
        <div className="admin-panel-header">
          <div>
            <h3 className="admin-section-title">Overview & Ad Controls</h3>
            <p className="admin-section-desc">
              Ads are reviewed before they run. Submitting is free; a campaign is charged when a
              seven-day week starts, and again each time the advertiser renews.
            </p>
          </div>
        </div>
        <div className="admin-stats-grid">
          <article className="admin-stat-card">
            <p className="admin-stat-label">Total campaigns</p>
            <p className="admin-stat-value">{stats.total}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Awaiting review</p>
            <p className="admin-stat-value">{stats.pendingReview}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Paid week running</p>
            <p className="admin-stat-value">{stats.active}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Approved, no credits</p>
            <p className="admin-stat-value">{stats.awaitingCredits}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Awaiting renewal</p>
            <p className="admin-stat-value">{stats.renewalRequired}</p>
          </article>
        </div>
        {canManageAdPricing && (
          <div className="admin-settings-section" style={{ marginBottom: '1rem' }}>
            <p className="admin-settings-section-title">Global advertisement settings</p>
            <div className="admin-settings-row">
              <label className="admin-settings-label-wrap">
                {/* Writes mhc_action_prices.advertisement — the same row the
                    charge primitive reads, so displayed and charged cannot
                    drift. MHC is a platform credit, not a currency. */}
                <span className="admin-settings-label">MHC per advertisement week</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="admin-settings-input admin-settings-input--number"
                  value={String(controls.mhcPrice)}
                  onChange={(e) =>
                    setControls((prev) => ({
                      ...prev,
                      mhcPrice: Number.parseFloat(e.target.value || '0'),
                    }))
                  }
                />
                <span className="admin-settings-label" style={{ opacity: 0.7 }}>
                  0 keeps advertising free. A change applies to future weeks only — weeks already
                  bought keep the price they were charged.
                </span>
              </label>
              <label
                className="admin-settings-row"
                style={{ justifyContent: 'flex-start', gap: '0.6rem', marginTop: '0.5rem' }}
              >
                <button
                  type="button"
                  className={`admin-settings-toggle ${controls.acceptAds ? 'admin-settings-toggle--on' : ''}`}
                  onClick={() => setControls((prev) => ({ ...prev, acceptAds: !prev.acceptAds }))}
                  aria-label="Toggle accepting ads"
                  aria-pressed={controls.acceptAds}
                >
                  <span className="admin-settings-toggle-thumb" />
                </button>
                <span className="admin-settings-label">Accept new ads</span>
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void saveControls()}
                disabled={savingControls}
              >
                {savingControls ? 'Saving...' : 'Save controls'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Review queue</h3>
        <p className="admin-section-desc">
          Approve or reject each campaign. Rejection needs a reason, which the advertiser is shown.
          Neither action can charge a rejected campaign.
        </p>
      </div>

      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="pending_review">Awaiting review</option>
          <option value="pending_payment">
            {dictionary.advertisements?.statusPendingPayment ?? 'Pending payment'}
          </option>
          <option value="">{dictionary.admin?.txns?.allStatuses ?? 'All statuses'}</option>
          <option value="scheduled">Approved</option>
          <option value="active">Active</option>
          <option value="expired">Ended</option>
          <option value="rejected">Rejected</option>
          <option value="paused_by_admin">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error ? <p className="admin-empty">{error}</p> : null}
      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : rows.length === 0 ? (
        <p className="admin-empty">
          {statusFilter === 'pending_review'
            ? 'No advertisements are awaiting review.'
            : (dictionary.advertisements?.noAds ?? 'No ads found.')}
        </p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{dictionary.common.description}</th>
                <th>{dictionary.common.status}</th>
                <th>Billing</th>
                <th>Current week</th>
                <th>Scheduled start</th>
                <th>{dictionary.advertisements?.impressions ?? 'Impressions'}</th>
                <th>{dictionary.advertisements?.clicks ?? 'Clicks'}</th>
                <th>{dictionary.admin?.users?.actions ?? 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ad) => {
                const busy = busyAdId === ad.id;
                const isWeekly = ad.billing_model === 'weekly';
                const isPending = ad.status === 'pending_review';
                const isDueForStart =
                  isWeekly &&
                  ad.status === 'scheduled' &&
                  (!ad.starts_at || new Date(ad.starts_at).getTime() <= Date.now());
                const statusLabels: Record<string, string> = {
                  pending_review: 'Awaiting review',
                  pending_payment:
                    dictionary.advertisements?.statusPendingPayment ?? 'Pending payment',
                  scheduled: 'Approved',
                  active: 'Active',
                  expired: 'Ended',
                  rejected: 'Rejected',
                  paused_by_admin: 'Paused',
                  cancelled: 'Cancelled',
                };
                const formattedStatus =
                  statusLabels[ad.status] ??
                  (typeof ad.status === 'string'
                    ? ad.status.replace(/_/g, ' ')
                    : String(ad.status ?? ''));
                return (
                  <tr key={ad.id}>
                    <td>
                      <strong>{ad.title_en}</strong>
                      <br />
                      <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-soft))' }}>
                        {ad.advertiser_name ?? ad.advertiser_id}
                      </span>
                      {ad.status === 'rejected' && ad.rejection_reason ? (
                        <>
                          <br />
                          <span style={{ fontSize: '0.8rem' }}>Reason: {ad.rejection_reason}</span>
                        </>
                      ) : null}
                    </td>
                    <td>{formattedStatus}</td>
                    <td>{BILLING_LABEL[ad.billing_status] ?? ad.billing_status}</td>
                    <td>
                      {ad.current_period_starts_at
                        ? `${formatDate(ad.current_period_starts_at)} → ${formatDate(ad.current_period_ends_at)}`
                        : '—'}
                    </td>
                    <td>{formatDate(ad.starts_at)}</td>
                    <td>{ad.impressions}</td>
                    <td>{ad.clicks}</td>
                    <td>
                      <div className="admin-actions-row">
                        {canManageAds && isPending && (
                          <>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small"
                              disabled={busy}
                              onClick={(e) => {
                                previousFocusRef.current = e.currentTarget;
                                void approve(ad.id);
                              }}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--danger"
                              disabled={busy}
                              onClick={(e) => {
                                previousFocusRef.current = e.currentTarget;
                                setRejectAdId(ad.id);
                                setRejectReason('');
                              }}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {canManageAds && isDueForStart && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            disabled={busy}
                            onClick={(e) => {
                              previousFocusRef.current = e.currentTarget;
                              void activateDue(ad.id);
                            }}
                          >
                            Start due week
                          </button>
                        )}
                        {canManageAds && ad.status === 'active' && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small admin-btn--danger"
                            onClick={(e) => {
                              previousFocusRef.current = e.currentTarget;
                              void setStatus(ad.id, 'paused_by_admin');
                            }}
                          >
                            Pause
                          </button>
                        )}
                        {canManageAds &&
                          ad.status !== 'cancelled' &&
                          ad.status !== 'rejected' &&
                          ad.status !== 'expired' && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--danger"
                              onClick={(e) => {
                                previousFocusRef.current = e.currentTarget;
                                void setStatus(ad.id, 'cancelled');
                              }}
                            >
                              Cancel
                            </button>
                          )}
                        {canManageAdScheduling &&
                          ad.status !== 'cancelled' &&
                          ad.status !== 'rejected' && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--small"
                              onClick={(e) => {
                                previousFocusRef.current = e.currentTarget;
                                setScheduleAdId(ad.id);
                              }}
                            >
                              Schedule
                            </button>
                          )}
                        {canManageAdPricing && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={(e) => {
                              previousFocusRef.current = e.currentTarget;
                              setPricingAdId(ad.id);
                            }}
                          >
                            Pricing
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rejectAdId && (
        <div className="admin-modal-overlay" onClick={() => setRejectAdId(null)}>
          <div
            ref={activeModalRef}
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reject-ad-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reject-ad-modal-title" className="admin-modal-title">
              Reject advertisement
            </h2>
            <p className="admin-section-desc">
              The advertiser sees this reason. Rejecting creates no billing period and charges
              nothing.
            </p>
            <textarea
              className="admin-form-textarea"
              placeholder="Why is this ad being rejected?"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setRejectAdId(null)}>
                {dictionary.common.cancel}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                disabled={rejectReason.trim().length < 3}
                onClick={() => void reject()}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {scheduleAdId && (
        <div className="admin-modal-overlay" onClick={() => setScheduleAdId(null)}>
          <div
            ref={activeModalRef}
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="schedule-ad-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="schedule-ad-modal-title" className="admin-modal-title">
              {dictionary.advertisements?.schedule ?? 'Schedule ad'}
            </h2>
            <input
              type="datetime-local"
              className="admin-form-input"
              value={scheduleForm.startsAt}
              onChange={(e) => setScheduleForm((prev) => ({ ...prev, startsAt: e.target.value }))}
            />
            <input
              type="datetime-local"
              className="admin-form-input"
              value={scheduleForm.expiresAt}
              onChange={(e) => setScheduleForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
            />
            <textarea
              className="admin-form-textarea"
              placeholder="Reason"
              value={scheduleForm.reason}
              onChange={(e) => setScheduleForm((prev) => ({ ...prev, reason: e.target.value }))}
            />
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setScheduleAdId(null)}>
                {dictionary.common.cancel}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void saveSchedule()}
              >
                {dictionary.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {pricingAdId && (
        <div className="admin-modal-overlay" onClick={() => setPricingAdId(null)}>
          <div
            ref={activeModalRef}
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pricing-ad-modal-title"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="pricing-ad-modal-title" className="admin-modal-title">
              {dictionary.advertisements?.pricing?.override ?? 'Override price'}
            </h2>
            <input
              type="number"
              min={0}
              step="0.01"
              className="admin-form-input"
              value={overrideAmount}
              onChange={(e) => setOverrideAmount(e.target.value)}
            />
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setPricingAdId(null)}>
                {dictionary.common.cancel}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void savePriceOverride()}
              >
                {dictionary.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
