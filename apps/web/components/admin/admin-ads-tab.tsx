'use client';

import { useCallback, useEffect, useState } from 'react';

import { advertisementsApiClient, type Advertisement } from '@/lib/advertisements/client';
import type { Dictionary } from '@/lib/i18n/types';

type AdminAdsTabProps = {
  dictionary: Dictionary;
  accessToken: string;
};

export const AdminAdsTab = ({ dictionary, accessToken }: AdminAdsTabProps) => {
  const [rows, setRows] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [scheduleAdId, setScheduleAdId] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ startsAt: '', expiresAt: '', reason: '' });
  const [pricingAdId, setPricingAdId] = useState<string | null>(null);
  const [overrideAmount, setOverrideAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = statusFilter as 'pending_payment' | 'active' | 'expired' | 'cancelled' | 'paused_by_admin' | '';
      const data = await advertisementsApiClient.adminListAds(
        accessToken,
        status ? { status } : undefined,
      );
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ads');
    } finally {
      setLoading(false);
    }
  }, [accessToken, statusFilter]);

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

  return (
    <section>
      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">{dictionary.admin?.txns?.allStatuses ?? 'All statuses'}</option>
          <option value="pending_payment">pending_payment</option>
          <option value="active">active</option>
          <option value="paused_by_admin">paused_by_admin</option>
          <option value="expired">expired</option>
          <option value="cancelled">cancelled</option>
        </select>
      </div>

      {error ? <p className="admin-empty">{error}</p> : null}
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
                  <td>{ad.amount_paid ?? ad.admin_price_override ?? '—'}</td>
                  <td>{ad.impressions}</td>
                  <td>{ad.clicks}</td>
                  <td>
                    <div className="admin-actions-row">
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => void setStatus(ad.id, 'active')}>
                        Activate
                      </button>
                      <button type="button" className="admin-btn admin-btn--small admin-btn--danger" onClick={() => void setStatus(ad.id, 'paused_by_admin')}>
                        Pause
                      </button>
                      <button type="button" className="admin-btn admin-btn--small admin-btn--danger" onClick={() => void setStatus(ad.id, 'cancelled')}>
                        Cancel
                      </button>
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => setScheduleAdId(ad.id)}>
                        Schedule
                      </button>
                      <button type="button" className="admin-btn admin-btn--small" onClick={() => setPricingAdId(ad.id)}>
                        Pricing
                      </button>
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
            <h2 className="admin-modal-title">{dictionary.advertisements?.schedule ?? 'Schedule ad'}</h2>
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
              <button type="button" className="admin-btn admin-btn--primary" onClick={() => void saveSchedule()}>
                {dictionary.common.save}
              </button>
            </div>
          </div>
        </div>
      )}

      {pricingAdId && (
        <div className="admin-modal-overlay" onClick={() => setPricingAdId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">{dictionary.advertisements?.pricing?.override ?? 'Override price'}</h2>
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
              <button type="button" className="admin-btn admin-btn--primary" onClick={() => void savePriceOverride()}>
                {dictionary.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

