'use client';

import type { ManualDepositRequest, WithdrawalRequest } from '@mohandishub/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';
import { getPrivateFileOpenableUrl, uploadPrivateFile } from '@/lib/upload/client';

const LIMIT = 15;

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

export const AdminWalletRailsTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const d = dictionary.admin.walletRails;
  const txnLabels = dictionary.admin.txns;
  const isArabic = /[\u0600-\u06FF]/.test(dictionary.admin.title);
  const tr = (en: string, ar: string) => (isArabic ? ar : en);
  const statusLabel = (status: string) =>
    ({
      pending_review: tr('Pending review', 'قيد المراجعة'),
      paid: tr('Paid', 'مدفوع'),
      rejected: tr('Rejected', 'مرفوض'),
      awaiting_transfer: tr('Awaiting transfer', 'بانتظار التحويل'),
      finished: tr('Finished', 'مكتمل'),
      failed: tr('Failed', 'فشل'),
      cancelled: tr('Cancelled', 'ملغي'),
    })[status] ?? status;

  const [depPage, setDepPage] = useState(1);
  const [depStatus, setDepStatus] = useState('');
  const [depData, setDepData] = useState<{ items: ManualDepositRequest[]; total: number } | null>(
    null,
  );
  const [depLoading, setDepLoading] = useState(true);

  const [wPage, setWPage] = useState(1);
  const [wStatus, setWStatus] = useState('');
  const [wData, setWData] = useState<{ items: WithdrawalRequest[]; total: number } | null>(null);
  const [wLoading, setWLoading] = useState(true);

  const [modal, setModal] = useState<
    | null
    | { kind: 'approve-dep'; row: ManualDepositRequest }
    | { kind: 'reject-dep'; row: ManualDepositRequest }
    | { kind: 'complete-wdr'; row: WithdrawalRequest }
    | { kind: 'reject-wdr'; row: WithdrawalRequest }
  >(null);
  const [modalCredit, setModalCredit] = useState('');
  const [modalReason, setModalReason] = useState('');
  const [modalBusy, setModalBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadDeposits = useCallback(async () => {
    setDepLoading(true);
    try {
      const result = await adminApiClient.listManualInstapayDeposits(
        accessToken,
        {
          page: depPage,
          limit: LIMIT,
          ...(depStatus ? { status: depStatus } : {}),
        },
        refreshSession ? { refreshSession } : {},
      );
      setDepData(result);
    } catch {
      setDepData(null);
    } finally {
      setDepLoading(false);
    }
  }, [accessToken, depPage, depStatus, refreshSession]);

  const loadWithdrawals = useCallback(async () => {
    setWLoading(true);
    try {
      const result = await adminApiClient.listManualInstapayWithdrawals(
        accessToken,
        {
          page: wPage,
          limit: LIMIT,
          ...(wStatus ? { status: wStatus } : {}),
        },
        refreshSession ? { refreshSession } : {},
      );
      setWData(result);
    } catch {
      setWData(null);
    } finally {
      setWLoading(false);
    }
  }, [accessToken, wPage, wStatus, refreshSession]);

  useEffect(() => {
    void loadDeposits();
  }, [loadDeposits]);

  useEffect(() => {
    void loadWithdrawals();
  }, [loadWithdrawals]);

  const depTotalPages = depData ? Math.max(1, Math.ceil(depData.total / LIMIT)) : 1;
  const wTotalPages = wData ? Math.max(1, Math.ceil(wData.total / LIMIT)) : 1;

  const openProof = async (uploadId: string | null) => {
    if (!uploadId) return;
    try {
      const url = await getPrivateFileOpenableUrl(accessToken, uploadId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      /* empty */
    }
  };

  const closeModal = () => {
    setModal(null);
    setModalCredit('');
    setModalReason('');
    setActionError(null);
  };

  const submitApproveDeposit = async () => {
    if (!modal || modal.kind !== 'approve-dep') return;
    setModalBusy(true);
    setActionError(null);
    try {
      const raw = modalCredit.trim();
      const credited =
        raw === '' ? undefined : (parseFloat(raw.replace(/,/g, '.')) || undefined);
      await adminApiClient.approveManualInstapayDeposit(
        accessToken,
        modal.row.id,
        credited != null && Number.isFinite(credited) && credited > 0
          ? { creditedAmountEgp: credited }
          : {},
        refreshSession ? { refreshSession } : {},
      );
      closeModal();
      void loadDeposits();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : tr('Failed', 'فشلت العملية'));
    } finally {
      setModalBusy(false);
    }
  };

  const submitRejectDeposit = async () => {
    if (!modal || modal.kind !== 'reject-dep') return;
    const reason = modalReason.trim();
    if (!reason) {
      setActionError(d.reason);
      return;
    }
    setModalBusy(true);
    setActionError(null);
    try {
      await adminApiClient.rejectManualInstapayDeposit(
        accessToken,
        modal.row.id,
        { reason },
        refreshSession ? { refreshSession } : {},
      );
      closeModal();
      void loadDeposits();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : tr('Failed', 'فشلت العملية'));
    } finally {
      setModalBusy(false);
    }
  };

  const submitCompleteWithdrawal = async (file: File | undefined) => {
    if (!modal || modal.kind !== 'complete-wdr') return;
    if (!file) {
      setActionError(d.proofFile);
      return;
    }
    setModalBusy(true);
    setActionError(null);
    try {
      const uploaded = await uploadPrivateFile(accessToken, file);
      await adminApiClient.completeManualInstapayWithdrawal(
        accessToken,
        modal.row.id,
        { proofUploadId: uploaded.filename },
        refreshSession ? { refreshSession } : {},
      );
      closeModal();
      void loadWithdrawals();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : tr('Failed', 'فشلت العملية'));
    } finally {
      setModalBusy(false);
    }
  };

  const submitRejectWithdrawal = async () => {
    if (!modal || modal.kind !== 'reject-wdr') return;
    const reason = modalReason.trim();
    if (!reason) {
      setActionError(d.reason);
      return;
    }
    setModalBusy(true);
    setActionError(null);
    try {
      await adminApiClient.rejectManualInstapayWithdrawal(
        accessToken,
        modal.row.id,
        { reason },
        refreshSession ? { refreshSession } : {},
      );
      closeModal();
      void loadWithdrawals();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : tr('Failed', 'فشلت العملية'));
    } finally {
      setModalBusy(false);
    }
  };

  return (
    <>
      <h2 className="admin-settings-title">{d.title}</h2>

      <section className="admin-settings-section" style={{ marginTop: '1.5rem' }}>
        <h3 className="admin-settings-section-title">{d.depositsTitle}</h3>
        <div className="admin-toolbar">
          <select
            className="admin-toolbar-select"
            value={depStatus}
            onChange={(e) => {
              setDepStatus(e.target.value);
              setDepPage(1);
            }}
          >
            <option value="">{d.allStatuses}</option>
            <option value="pending_review">{statusLabel('pending_review')}</option>
            <option value="paid">{statusLabel('paid')}</option>
            <option value="rejected">{statusLabel('rejected')}</option>
          </select>
        </div>
        {depLoading ? (
          <p className="admin-empty">{dictionary.admin.loading}</p>
        ) : !depData || depData.items.length === 0 ? (
          <p className="admin-empty">{d.noItems}</p>
        ) : (
          <>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{d.userId}</th>
                    <th>{d.amountEgp}</th>
                    <th>{tr('Sender account', 'حساب المُرسل')}</th>
                    <th>{d.status}</th>
                    <th>{d.created}</th>
                    <th>{txnLabels.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {depData.items.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{row.userId}</td>
                      <td>{row.amountEgp.toFixed(2)}</td>
                      <td>{row.senderAccount ?? '—'}</td>
                      <td><span className="admin-badge">{statusLabel(row.status)}</span></td>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {row.proofUploadId && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--small"
                              onClick={() => void openProof(row.proofUploadId)}
                            >
                              {d.viewProof}
                            </button>
                          )}
                          {row.status === 'pending_review' && (
                            <>
                              <button
                                type="button"
                                className="admin-btn admin-btn--small admin-btn--primary"
                                onClick={() => {
                                  setModalCredit('');
                                  setModal({ kind: 'approve-dep', row });
                                }}
                              >
                                {d.approve}
                              </button>
                              <button
                                type="button"
                                className="admin-btn admin-btn--small admin-btn--danger"
                                onClick={() => {
                                  setModalReason('');
                                  setModal({ kind: 'reject-dep', row });
                                }}
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
            {depTotalPages > 1 && (
              <div className="admin-pagination">
                <button
                  type="button"
                  className="admin-btn admin-btn--small"
                  disabled={depPage <= 1}
                  onClick={() => setDepPage((p) => p - 1)}
                  aria-label={tr('Previous page', 'الصفحة السابقة')}
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <span className="admin-pagination-info">
                  {depPage} / {depTotalPages}
                </span>
                <button
                  type="button"
                  className="admin-btn admin-btn--small"
                  disabled={depPage >= depTotalPages}
                  onClick={() => setDepPage((p) => p + 1)}
                  aria-label={tr('Next page', 'الصفحة التالية')}
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section className="admin-settings-section" style={{ marginTop: '2rem' }}>
        <h3 className="admin-settings-section-title">{d.withdrawalsTitle}</h3>
        <div className="admin-toolbar">
          <select
            className="admin-toolbar-select"
            value={wStatus}
            onChange={(e) => {
              setWStatus(e.target.value);
              setWPage(1);
            }}
          >
            <option value="">{d.allStatuses}</option>
            <option value="awaiting_transfer">{statusLabel('awaiting_transfer')}</option>
            <option value="finished">{statusLabel('finished')}</option>
            <option value="rejected">{statusLabel('rejected')}</option>
            <option value="failed">{statusLabel('failed')}</option>
            <option value="cancelled">{statusLabel('cancelled')}</option>
          </select>
        </div>
        {wLoading ? (
          <p className="admin-empty">{dictionary.admin.loading}</p>
        ) : !wData || wData.items.length === 0 ? (
          <p className="admin-empty">{d.noItems}</p>
        ) : (
          <>
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{d.userId}</th>
                    <th>{d.amountEgp}</th>
                    <th>{d.recipient}</th>
                    <th>{d.status}</th>
                    <th>{d.created}</th>
                    <th>{txnLabels.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {wData.items.map((row) => (
                    <tr key={row.id}>
                      <td style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{row.userId}</td>
                      <td>{row.sourceAmountEgp.toFixed(2)}</td>
                      <td>{row.instapayRecipient ?? '—'}</td>
                      <td><span className="admin-badge">{statusLabel(row.status)}</span></td>
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>
                        {row.status === 'awaiting_transfer' && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--primary"
                              onClick={() => setModal({ kind: 'complete-wdr', row })}
                            >
                              {d.markSent}
                            </button>
                            <button
                              type="button"
                              className="admin-btn admin-btn--small admin-btn--danger"
                              onClick={() => {
                                setModalReason('');
                                setModal({ kind: 'reject-wdr', row });
                              }}
                            >
                              {d.reject}
                            </button>
                          </div>
                        )}
                        {row.status === 'finished' && row.adminProofUploadId && (
                          <button
                            type="button"
                            className="admin-btn admin-btn--small"
                            onClick={() => void openProof(row.adminProofUploadId)}
                          >
                            {d.viewProof}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {wTotalPages > 1 && (
              <div className="admin-pagination">
                <button
                  type="button"
                  className="admin-btn admin-btn--small"
                  disabled={wPage <= 1}
                  onClick={() => setWPage((p) => p - 1)}
                  aria-label={tr('Previous page', 'الصفحة السابقة')}
                >
                  <ChevronLeft size={16} aria-hidden />
                </button>
                <span className="admin-pagination-info">
                  {wPage} / {wTotalPages}
                </span>
                <button
                  type="button"
                  className="admin-btn admin-btn--small"
                  disabled={wPage >= wTotalPages}
                  onClick={() => setWPage((p) => p + 1)}
                  aria-label={tr('Next page', 'الصفحة التالية')}
                >
                  <ChevronRight size={16} aria-hidden />
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {modal && (
        <div className="admin-modal-overlay" onClick={() => !modalBusy && closeModal()}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            {modal.kind === 'approve-dep' && (
              <>
                <h2 className="admin-modal-title">{d.approveTitle}</h2>
                <p className="admin-settings-desc">{d.creditedAmountHint}</p>
                <div className="admin-form-group">
                  <label className="admin-form-label">{d.creditedAmountPlaceholder}</label>
                  <input
                    className="admin-form-input"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder={String(modal.row.amountEgp)}
                    value={modalCredit}
                    onChange={(e) => setModalCredit(e.target.value)}
                    disabled={modalBusy}
                  />
                </div>
                {actionError && <p className="admin-settings-error">{actionError}</p>}
                <div className="admin-modal-actions">
                  <button type="button" className="admin-btn" onClick={closeModal} disabled={modalBusy}>
                    {dictionary.common.back}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--primary"
                    disabled={modalBusy}
                    onClick={() => void submitApproveDeposit()}
                  >
                    {d.approve}
                  </button>
                </div>
              </>
            )}
            {modal.kind === 'reject-dep' && (
              <>
                <h2 className="admin-modal-title">{d.rejectTitle}</h2>
                <div className="admin-form-group">
                  <label className="admin-form-label">{d.reason}</label>
                  <textarea
                    className="admin-form-textarea"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    disabled={modalBusy}
                  />
                </div>
                {actionError && <p className="admin-settings-error">{actionError}</p>}
                <div className="admin-modal-actions">
                  <button type="button" className="admin-btn" onClick={closeModal} disabled={modalBusy}>
                    {dictionary.common.back}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger"
                    disabled={modalBusy}
                    onClick={() => void submitRejectDeposit()}
                  >
                    {d.reject}
                  </button>
                </div>
              </>
            )}
            {modal.kind === 'complete-wdr' && (
              <CompleteWithdrawalForm
                dictionary={dictionary}
                labels={d}
                busy={modalBusy}
                error={actionError}
                onCancel={closeModal}
                onSubmit={(file) => void submitCompleteWithdrawal(file)}
              />
            )}
            {modal.kind === 'reject-wdr' && (
              <>
                <h2 className="admin-modal-title">{d.confirmReject}</h2>
                <div className="admin-form-group">
                  <label className="admin-form-label">{d.reason}</label>
                  <textarea
                    className="admin-form-textarea"
                    value={modalReason}
                    onChange={(e) => setModalReason(e.target.value)}
                    disabled={modalBusy}
                  />
                </div>
                {actionError && <p className="admin-settings-error">{actionError}</p>}
                <div className="admin-modal-actions">
                  <button type="button" className="admin-btn" onClick={closeModal} disabled={modalBusy}>
                    {dictionary.common.back}
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--danger"
                    disabled={modalBusy}
                    onClick={() => void submitRejectWithdrawal()}
                  >
                    {d.reject}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};

function CompleteWithdrawalForm({
  dictionary,
  labels,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  dictionary: Dictionary;
  labels: Dictionary['admin']['walletRails'];
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (file: File | undefined) => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.querySelector<HTMLInputElement>('input[type=file]');
        onSubmit(input?.files?.[0]);
      }}
    >
      <h2 className="admin-modal-title">{labels.completeTitle}</h2>
      <div className="admin-form-group">
        <label className="admin-form-label">{labels.proofFile}</label>
        <input type="file" accept="image/*" disabled={busy} />
      </div>
      {error && <p className="admin-settings-error">{error}</p>}
      <div className="admin-modal-actions">
        <button type="button" className="admin-btn" onClick={onCancel} disabled={busy}>
          {dictionary.common.back}
        </button>
        <button type="submit" className="admin-btn admin-btn--primary" disabled={busy}>
          {labels.markSent}
        </button>
      </div>
    </form>
  );
}
