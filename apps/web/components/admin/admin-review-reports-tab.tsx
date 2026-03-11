'use client';

import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';

type ReportRow = {
  id: string;
  review_id: string;
  reporter_id: string;
  reason: string;
  comment: string | null;
  status: string;
  created_at: string;
  review_rating: number;
  review_comment: string | null;
  target_user_id: string;
  reporter_name: string;
};

type DisputeRow = {
  id: string;
  review_id: string;
  disputer_id: string;
  reason: string;
  status: string;
  created_at: string;
  review_rating: number;
  review_comment: string | null;
  target_user_id: string;
  disputer_name: string;
};

type Props = {
  dictionary: Dictionary;
  accessToken: string;
};

export const AdminReviewReportsTab = ({ dictionary, accessToken }: Props) => {
  const [subTab, setSubTab] = useState<'reports' | 'disputes'>('reports');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [reportsTotal, setReportsTotal] = useState(0);
  const [disputesTotal, setDisputesTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'all'>('pending');

  const loadReports = useCallback(async () => {
    try {
      const data = await adminApiClient.listReviewReports(accessToken, {
        page: 1,
        limit: 50,
        status: statusFilter,
      });
      setReports(data.rows);
      setReportsTotal(data.total);
    } catch {
      setReports([]);
      setReportsTotal(0);
    }
  }, [accessToken, statusFilter]);

  const loadDisputes = useCallback(async () => {
    try {
      const data = await adminApiClient.listReviewDisputes(accessToken, {
        page: 1,
        limit: 50,
        status: statusFilter,
      });
      setDisputes(data.rows);
      setDisputesTotal(data.total);
    } catch {
      setDisputes([]);
      setDisputesTotal(0);
    }
  }, [accessToken, statusFilter]);

  useEffect(() => {
    setLoading(true);
    if (subTab === 'reports') void loadReports().finally(() => setLoading(false));
    else void loadDisputes().finally(() => setLoading(false));
  }, [subTab, loadReports, loadDisputes]);

  const handleResolveReport = async (reportId: string, decision: 'dismissed' | 'upheld', hideReview: boolean) => {
    setResolvingId(reportId);
    try {
      await adminApiClient.resolveReviewReport(accessToken, reportId, { decision, hideReview });
      await loadReports();
    } finally {
      setResolvingId(null);
    }
  };

  const handleResolveDispute = async (disputeId: string, decision: 'dismissed' | 'upheld', hideReview: boolean) => {
    setResolvingId(disputeId);
    try {
      await adminApiClient.resolveReviewDispute(accessToken, disputeId, { decision, hideReview });
      await loadDisputes();
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">Review reports &amp; disputes</h2>
      <div className="admin-subtabs" style={{ marginBottom: '1rem' }}>
        <button
          type="button"
          className={`admin-panel-tab ${subTab === 'reports' ? 'admin-panel-tab--active' : ''}`}
          onClick={() => setSubTab('reports')}
        >
          Reports ({reportsTotal})
        </button>
        <button
          type="button"
          className={`admin-panel-tab ${subTab === 'disputes' ? 'admin-panel-tab--active' : ''}`}
          onClick={() => setSubTab('disputes')}
        >
          Disputes ({disputesTotal})
        </button>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'pending' | 'all')}
          className="dashboard-input"
          style={{ marginLeft: 'auto' }}
        >
          <option value="pending">Pending only</option>
          <option value="all">All</option>
        </select>
      </div>
      {loading ? (
        <p className="dashboard-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
      ) : subTab === 'reports' ? (
        <ul className="admin-list">
          {reports.length === 0 ? (
            <li className="admin-empty">No reports.</li>
          ) : (
            reports.map((r) => (
              <li key={r.id} className="admin-card" style={{ padding: '1rem' }}>
                <p><strong>Review:</strong> {r.review_rating}★ {r.review_comment ?? '(no comment)'}</p>
                <p><strong>Reporter:</strong> {r.reporter_name} · Reason: {r.reason}{r.comment ? ` · ${r.comment}` : ''}</p>
                <p className="dashboard-card-meta">{new Date(r.created_at).toLocaleString()} · Status: {r.status}</p>
                {r.status === 'pending' && (
                  <div className="calendar-booking-actions" style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                      disabled={resolvingId === r.id}
                      onClick={() => { void handleResolveReport(r.id, 'dismissed', false); }}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      disabled={resolvingId === r.id}
                      onClick={() => { void handleResolveReport(r.id, 'upheld', false); }}
                    >
                      Uphold
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      disabled={resolvingId === r.id}
                      onClick={() => { void handleResolveReport(r.id, 'upheld', true); }}
                    >
                      Uphold &amp; hide review
                    </button>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      ) : (
        <ul className="admin-list">
          {disputes.length === 0 ? (
            <li className="admin-empty">No disputes.</li>
          ) : (
            disputes.map((d) => (
              <li key={d.id} className="admin-card" style={{ padding: '1rem' }}>
                <p><strong>Review:</strong> {d.review_rating}★ {d.review_comment ?? '(no comment)'}</p>
                <p><strong>Disputer:</strong> {d.disputer_name} · Reason: {d.reason}</p>
                <p className="dashboard-card-meta">{new Date(d.created_at).toLocaleString()} · Status: {d.status}</p>
                {d.status === 'pending' && (
                  <div className="calendar-booking-actions" style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                      disabled={resolvingId === d.id}
                      onClick={() => { void handleResolveDispute(d.id, 'dismissed', false); }}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                      disabled={resolvingId === d.id}
                      onClick={() => { void handleResolveDispute(d.id, 'upheld', false); }}
                    >
                      Uphold
                    </button>
                    <button
                      type="button"
                      className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                      disabled={resolvingId === d.id}
                      onClick={() => { void handleResolveDispute(d.id, 'upheld', true); }}
                    >
                      Uphold &amp; hide review
                    </button>
                  </div>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
};
