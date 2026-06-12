'use client';

import type { AdminMoneyAuditEvent, PaymobReadiness } from '@mohandishub/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

const formatMoney = (amount: number, currency = 'EGP') => `${amount.toFixed(2)} ${currency}`;

export const AdminMoneyAuditTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [items, setItems] = useState<AdminMoneyAuditEvent[]>([]);
  const [readiness, setReadiness] = useState<PaymobReadiness | null>(null);
  const [status, setStatus] = useState('');
  const [rail, setRail] = useState('');
  const [reviewNeeded, setReviewNeeded] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => (refreshSession ? { refreshSession } : {}), [refreshSession]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [audit, paymob] = await Promise.all([
        adminApiClient.getMoneyAudit(
          accessToken,
          {
            page: 1,
            limit: 50,
            ...(status ? { status } : {}),
            ...(rail ? { rail } : {}),
            reviewNeeded,
          },
          options,
        ),
        adminApiClient.getPaymobReadiness(accessToken, options),
      ]);
      setItems(audit.items);
      setReadiness(paymob);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load money audit.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, options, rail, reviewNeeded, status]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">Money audit &amp; Paymob readiness</h2>
      {error && <p className="admin-error">{error}</p>}

      {readiness && (
        <div className="admin-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
          <h3>Paymob readiness</h3>
          <div className="admin-form-grid">
            <p>
              <strong>Deposits:</strong>{' '}
              {readiness.depositConfigured ? 'configured' : 'not configured'}
            </p>
            <p>
              <strong>Withdrawals:</strong>{' '}
              {readiness.payoutConfigured ? 'configured' : 'not configured'}
            </p>
            <p>
              <strong>Webhook:</strong> {readiness.webhookUrl ?? 'API_PUBLIC_URL missing'}
            </p>
            <p>
              <strong>Return:</strong> {readiness.returnUrl ?? 'WEB_PUBLIC_URL missing'}
            </p>
          </div>
          {readiness.missingDepositKeys.length > 0 && (
            <p className="dashboard-card-meta">
              Missing deposit env: {readiness.missingDepositKeys.join(', ')}
            </p>
          )}
          {readiness.missingPayoutKeys.length > 0 && (
            <p className="dashboard-card-meta">
              Missing payout env: {readiness.missingPayoutKeys.join(', ')}
            </p>
          )}
          <p className="dashboard-card-meta">
            No secret values are exposed here. Add keys to env, restart API/worker, then retry.
          </p>
        </div>
      )}

      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="pending_review">Pending review</option>
          <option value="processing">Processing</option>
          <option value="failed">Failed</option>
          <option value="open">Open</option>
          <option value="held">Held</option>
          <option value="completed">Completed</option>
        </select>
        <select
          className="admin-toolbar-select"
          value={rail}
          onChange={(event) => setRail(event.target.value)}
        >
          <option value="">All rails</option>
          <option value="paymob">Paymob</option>
          <option value="nowpayments">NOWPayments</option>
          <option value="instapay_manual">InstaPay</option>
          <option value="reservation">Reservation</option>
          <option value="worker">Worker</option>
        </select>
        <label className="admin-inline-check">
          <input
            type="checkbox"
            checked={reviewNeeded}
            onChange={(event) => setReviewNeeded(event.target.checked)}
          />
          Review needed
        </label>
        <button
          type="button"
          className="admin-btn admin-btn--secondary"
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">No money audit events match the current filters.</p>
      ) : (
        <div className="admin-table-wrapper">
          <table className="admin-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>User</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Rail</th>
                <th>Reference</th>
                <th>Label</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={`${item.kind}-${item.id}`}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>{item.kind}</td>
                  <td>{item.userDisplayName ?? item.userEmail ?? item.userId ?? '-'}</td>
                  <td>{formatMoney(item.amount, item.currency)}</td>
                  <td>{item.status}</td>
                  <td>{item.rail ?? '-'}</td>
                  <td>{item.providerReference ?? item.referenceId ?? item.reservationId ?? '-'}</td>
                  <td>{item.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
