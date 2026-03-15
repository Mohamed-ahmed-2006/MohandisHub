'use client';

import type { AdminTransactionListItem, PaginatedResponse } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = { dictionary: Dictionary; accessToken: string };

export const AdminTransactionsTab = ({ dictionary, accessToken }: Props) => {
  const [data, setData] = useState<PaginatedResponse<AdminTransactionListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustForm, setAdjustForm] = useState({
    userId: '',
    type: 'deposit' as string,
    amount: 0,
    description: '',
  });

  const d = dictionary.admin.txns;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { page: number; limit: number; type?: string; status?: string } = {
        page,
        limit: 20,
      };
      if (typeFilter) params.type = typeFilter;
      if (statusFilter) params.status = statusFilter;
      const result = await adminApiClient.getTransactions(accessToken, params);
      setData(result);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, typeFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReverse = async (txnId: string) => {
    if (!confirm(d.confirmReverse)) return;
    try {
      await adminApiClient.reverseTransaction(accessToken, txnId);
      void load();
    } catch {
      /* empty */
    }
  };

  const handleAdjust = async () => {
    try {
      const body: {
        userId: string;
        type: 'deposit' | 'withdrawal' | 'adjustment' | 'bonus';
        amount: number;
        description?: string;
      } = {
        userId: adjustForm.userId,
        type: adjustForm.type as 'deposit' | 'withdrawal' | 'adjustment' | 'bonus',
        amount: adjustForm.amount,
      };
      if (adjustForm.description) body.description = adjustForm.description;
      await adminApiClient.adjustBalance(accessToken, body);
      setShowAdjust(false);
      setAdjustForm({ userId: '', type: 'deposit', amount: 0, description: '' });
      void load();
    } catch {
      /* empty */
    }
  };

  return (
    <>
      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{d.allTypes}</option>
          <option value="deposit">Deposit</option>
          <option value="withdrawal">Withdrawal</option>
          <option value="payment">Payment</option>
          <option value="refund">Refund</option>
          <option value="adjustment">Adjustment</option>
          <option value="bonus">Bonus</option>
          <option value="commission">Commission</option>
        </select>
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{d.allStatuses}</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="reversed">Reversed</option>
        </select>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          onClick={() => setShowAdjust(true)}
        >
          {d.adjust}
        </button>
      </div>

      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="admin-empty">{d.noTransactions}</p>
      ) : (
        <>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{d.user}</th>
                  <th>{d.type}</th>
                  <th>{d.amount}</th>
                  <th>{d.balanceAfter}</th>
                  <th>{d.status}</th>
                  <th>{d.description}</th>
                  <th>{d.date}</th>
                  <th>{d.actions}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((txn) => (
                  <tr key={txn.id}>
                    <td>{txn.userDisplayName}</td>
                    <td>
                      <span className="admin-badge">{txn.type}</span>
                    </td>
                    <td>{txn.amount.toFixed(2)}</td>
                    <td>{txn.balanceAfter.toFixed(2)}</td>
                    <td>
                      <span className={`admin-badge admin-badge--${txn.status}`}>{txn.status}</span>
                    </td>
                    <td>{txn.description ?? '—'}</td>
                    <td>{new Date(txn.createdAt).toLocaleDateString()}</td>
                    <td>
                      {txn.status === 'completed' && (
                        <button
                          type="button"
                          className="admin-btn admin-btn--small admin-btn--danger"
                          onClick={() => void handleReverse(txn.id)}
                        >
                          {d.reverse}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.totalPages > 1 && (
            <div className="admin-pagination">
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <span className="admin-pagination-info">
                {page} / {data.totalPages}
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page >= data.totalPages}
                onClick={() => setPage(page + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}

      {showAdjust && (
        <div className="admin-modal-overlay" onClick={() => setShowAdjust(false)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">{d.adjustTitle}</h2>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.adjustUser}</label>
              <input
                className="admin-form-input"
                value={adjustForm.userId}
                onChange={(e) => setAdjustForm({ ...adjustForm, userId: e.target.value })}
                placeholder="UUID"
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.adjustType}</label>
              <select
                className="admin-form-select"
                value={adjustForm.type}
                onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value })}
              >
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="adjustment">Adjustment</option>
                <option value="bonus">Bonus</option>
                <option value="commission">Commission</option>
              </select>
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.adjustAmount}</label>
              <input
                className="admin-form-input"
                type="number"
                value={adjustForm.amount}
                onChange={(e) =>
                  setAdjustForm({ ...adjustForm, amount: parseFloat(e.target.value) || 0 })
                }
              />
            </div>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.adjustDescription}</label>
              <textarea
                className="admin-form-textarea"
                value={adjustForm.description}
                onChange={(e) => setAdjustForm({ ...adjustForm, description: e.target.value })}
              />
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setShowAdjust(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--primary"
                onClick={() => void handleAdjust()}
              >
                {dictionary.common.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
