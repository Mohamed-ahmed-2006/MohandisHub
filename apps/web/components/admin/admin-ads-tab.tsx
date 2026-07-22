'use client';

import type { AdminPermission } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import {
  advertisementsApiClient,
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

export const AdminAdsTab = ({ dictionary, accessToken, adminPermissions }: AdminAdsTabProps) => {
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [controls, setControls] = useState<AdminAdControls>({ acceptAds: false, pricePerDay: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [scheduleAdId, setScheduleAdId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ startsAt: '', expiresAt: '', reason: '' });
  const [pricingAdId, setPricingAdId] = useState<string | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('');
  const [savingControls, setSavingControls] = useState(false);
  const canManageAds = hasPermission(adminPermissions, 'manage_ads');
  const canManageAdPricing = hasPermission(adminPermissions, 'manage_ad_pricing');
  const canManageAdScheduling = hasPermission(adminPermissions, 'manage_ad_scheduling');

  const stats = {
    total: rows.length,
    active: rows.filter((row) => row.status === 'active').length,
    paused: rows.filter((row) => row.status === 'paused_by_admin').length,
    expired: rows.filter((row) => row.status === 'expired').length,
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = statusFilter as
        | 'pending_payment'
        | 'active'
        | 'expired'
        | 'cancelled'
        | 'paused_by_admin'
        | '';
      const [data, adControls] = await Promise.all([
        advertisementsApiClient.adminListAds(accessToken, status ? { status } : undefined),
        canManageAdPricing
          ? advertisementsApiClient.adminGetControls(accessToken)
          : Promise.resolve({ acceptAds: false, pricePerDay: 0 }),
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

  const setStatus = async (adId: string, status: 'active' | 'paused_by_admin' | 'cancelled') => {
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
    if (controls.pricePerDay < 0) return;
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

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">{dictionary.admin?.tabs?.ads ?? 'Advertisements'}</h2>

      <div className="admin-section">
        <div className="admin-panel-header">
          <div>
            <h3 className="admin-section-title">Overview & Ad Controls</h3>
            <p className="admin-section-desc">
              Global controls: enable/disable accepting ads and set one price per day.
            </p>
          </div>
        </div>
        <div className="admin-stats-grid">
          <article className="admin-stat-card">
            <p className="admin-stat-label">Total campaigns</p>
            <p className="admin-stat-value">{stats.total}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Active</p>
            <p className="admin-stat-value">{stats.active}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Paused by admin</p>
            <p className="admin-stat-value">{stats.paused}</p>
          </article>
          <article className="admin-stat-card">
            <p className="admin-stat-label">Expired</p>
            <p className="admin-stat-value">{stats.expired}</p>
          </article>
        </div>
        {canManageAdPricing && (
          <div className="admin-settings-section" style={{ marginBottom: '1rem' }}>
            <p className="admin-settings-section-title">Global advertisement settings</p>
            <div className="admin-settings-row">
              <label className="admin-settings-label-wrap">
                <span className="admin-settings-label">Price per day (EGP)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="admin-settings-input admin-settings-input--number"
                  value={String(controls.pricePerDay)}
                  onChange={(e) =>
                    setControls((prev) => ({
                      ...prev,
                      pricePerDay: Number.parseFloat(e.target.value || '0'),
                    }))
                  }
                />
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
        <h3 className="admin-section-title">Campaign Controls</h3>
        <p className="admin-section-desc">
          Per-campaign controls (Activate, Pause, Cancel, Schedule, Price Override) appear on each
          campaign row below.
        </p>
      </div>

      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{dictionary.admin?.txns?.allStatuses ?? 'All statuses'}</option>
          <option value="active">Active</option>
          <option value="paused_by_admin">Paused</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error ? <p className="admin-empty">{error}</p> : null}
      {!loading && rows.length === 0 ? (
        <p className="admin-empty" style={{ marginBottom: '0.75rem' }}>
          No ad campaigns yet. Once first campaign is created, you will immediately get row
          controls: Activate / Pause / Cancel / Schedule / Pricing Override.
        </p>
      ) : null}
      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : rows.length === 0 ? (
        <p className="admin-empty">{dictionary.advertisements?.noAds ?? 'No ads found.'}</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{dictionary.common.description}</th>
                <th>{dictionary.common.status}</th>
                <th>{dictionary.advertisements?.amountPaid ?? 'Amount paid'}</th>
                <th>{dictionary.advertisements?.impressions ?? 'Impressions'}</th>
                <th>{dictionary.advertisements?.clicks ?? 'Clicks'}</th>
                <th>{dictionary.admin?.users?.actions ?? 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ad) => (
                <tr key={ad.id}>
                  <td>
                    <strong>{ad.title_en}</strong>
                    <br />
                    <span style={{ fontSize: '0.8rem', color: 'hsl(var(--text-soft))' }}>
                      {ad.advertiser_name ?? ad.advertiser_id}
                    </span>
                  </td>
                  <td>{ad.status}</td>
                  <td>{ad.amount_paid ? `${ad.amount_paid} EGP` : '—'}</td>
                  <td>{ad.impressions}</td>
                  <td>{ad.clicks}</td>
                  <td>
                    <div className="admin-actions-row">
                      {canManageAds &&
                        ad.status !== 'active' &&
                        ad.status !== 'cancelled' &&
                        ad.status !== 'expired' && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => void setStatus(ad.id, 'active')}
                          >
                            Activate
                          </button>
                        )}
                      {canManageAds && ad.status === 'active' && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => void setStatus(ad.id, 'paused_by_admin')}
                        >
                          Pause
                        </button>
                      )}
                      {canManageAds && ad.status !== 'cancelled' && ad.status !== 'expired' && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => void setStatus(ad.id, 'cancelled')}
                        >
                          Cancel
                        </button>
                      )}
                      {canManageAdScheduling &&
                        ad.status !== 'cancelled' &&
                        ad.status !== 'expired' && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => setScheduleAdId(ad.id)}
                          >
                            Schedule
                          </button>
                        )}
                      {canManageAdPricing && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small"
                          onClick={() => setPricingAdId(ad.id)}
                        >
                          Pricing
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scheduleAdId && (
        <div className="admin-modal-overlay" onClick={() => setScheduleAdId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">
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
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">
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
