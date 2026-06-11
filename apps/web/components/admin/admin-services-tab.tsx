'use client';

import type { AdminServiceListItem, PaginatedResponse } from '@mohandishub/shared';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type Props = { dictionary: Dictionary; accessToken: string };

export const AdminServicesTab = ({ dictionary, accessToken }: Props) => {
  const [data, setData] = useState<PaginatedResponse<AdminServiceListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const d = dictionary.admin.servicesMgmt;
  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);
  const statusLabel = (status: string) =>
    ({
      draft: tr('Draft', 'مسودة'),
      pending_review: tr('Pending Review', 'بانتظار المراجعة'),
      active: tr('Active', 'نشط'),
      paused: tr('Paused', 'موقوف'),
      rejected: tr('Rejected', 'مرفوض'),
      archived: tr('Archived', 'مؤرشف'),
    })[status] ?? status;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: { page: number; limit: number; status?: string } = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      const result = await adminApiClient.getServices(accessToken, params);
      setData(result);
    } catch {
      /* empty */
    } finally {
      setLoading(false);
    }
  }, [accessToken, page, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = async (serviceId: string) => {
    try {
      await adminApiClient.approveService(accessToken, serviceId);
      void load();
    } catch {
      /* empty */
    }
  };

  const handleReject = async () => {
    if (!rejectId || !rejectReason) return;
    try {
      await adminApiClient.rejectService(accessToken, rejectId, rejectReason);
      setRejectId(null);
      setRejectReason('');
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
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{d.allStatuses}</option>
          <option value="draft">{statusLabel('draft')}</option>
          <option value="pending_review">{statusLabel('pending_review')}</option>
          <option value="active">{statusLabel('active')}</option>
          <option value="paused">{statusLabel('paused')}</option>
          <option value="rejected">{statusLabel('rejected')}</option>
          <option value="archived">{statusLabel('archived')}</option>
        </select>
      </div>

      {loading ? (
        <p className="admin-empty">{dictionary.admin.loading}</p>
      ) : !data || data.items.length === 0 ? (
        <p className="admin-empty">{d.noServices}</p>
      ) : (
        <>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{tr('Title', 'العنوان')}</th>
                  <th>{d.provider}</th>
                  <th>{d.category}</th>
                  <th>{d.price}</th>
                  <th>{d.status}</th>
                  <th>{d.featured}</th>
                  <th>{d.actions}</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((svc) => (
                  <tr key={svc.id}>
                    <td>{svc.title}</td>
                    <td>
                      {svc.providerName}
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'hsl(var(--text-soft))' }}>
                        {svc.providerEmail}
                      </span>
                    </td>
                    <td>{svc.categoryNameEn ?? '—'}</td>
                    <td>{svc.price != null ? `${svc.price} ${svc.currency ?? 'EGP'}` : '—'}</td>
                    <td>
                      <span
                        className={`admin-badge admin-badge--${svc.status === 'active' ? 'active' : svc.status === 'rejected' ? 'rejected' : 'pending'}`}
                      >
                        {statusLabel(svc.status)}
                      </span>
                    </td>
                    <td>
                      {svc.isFeatured ? (
                        <Star size={16} aria-hidden style={{ verticalAlign: 'middle' }} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      <div className="admin-actions-row">
                        {svc.status === 'pending_review' && (
                          <>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--success"
                              onClick={() => void handleApprove(svc.id)}
                            >
                              {d.approve}
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--danger"
                              onClick={() => setRejectId(svc.id)}
                            >
                              {d.reject}
                            </button>
                          </>
                        )}
                      </div>
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
                aria-label={tr('Previous page', 'الصفحة السابقة')}
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
                aria-label={tr('Next page', 'الصفحة التالية')}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </>
      )}

      {rejectId && (
        <div className="admin-modal-overlay" onClick={() => setRejectId(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="admin-modal-title">{d.reject}</h2>
            <div className="admin-form-group">
              <label className="admin-form-label">{d.rejectReason}</label>
              <textarea
                className="admin-form-textarea"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div className="admin-modal-actions">
              <button type="button" className="admin-btn" onClick={() => setRejectId(null)}>
                {dictionary.common.cancel}
              </button>
              <button
                type="button"
                className="admin-btn admin-btn--danger"
                onClick={() => void handleReject()}
              >
                {d.reject}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
