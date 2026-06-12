'use client';

import type { ReservationDisputeCase, ReservationDisputeListItem } from '@mohandishub/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';
import { getPrivateFileOpenableUrl, uploadPrivateFile } from '@/lib/upload/client';

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

const formatMoney = (amount: number, currency = 'EGP') => `${amount.toFixed(2)} ${currency}`;

export const AdminDisputesTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [items, setItems] = useState<ReservationDisputeListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseFile, setCaseFile] = useState<ReservationDisputeCase | null>(null);
  const [status, setStatus] = useState('open');
  const [note, setNote] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [settlementOutcome, setSettlementOutcome] = useState<
    'refund' | 'release' | 'split' | 'none'
  >('refund');
  const [customerRefundAmount, setCustomerRefundAmount] = useState('');
  const [providerReleaseAmount, setProviderReleaseAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = useMemo(() => (refreshSession ? { refreshSession } : {}), [refreshSession]);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const data = await adminApiClient.listReservationDisputeCases(
        accessToken,
        { page: 1, limit: 50, ...(status ? { status } : {}) },
        options,
      );
      setItems(data.items);
      if (!selectedId && data.items[0]) setSelectedId(data.items[0].dispute.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dispute cases.');
    }
  }, [accessToken, options, selectedId, status]);

  const loadCase = useCallback(async () => {
    if (!selectedId) {
      setCaseFile(null);
      return;
    }
    setError(null);
    try {
      setCaseFile(await adminApiClient.getReservationDisputeCase(accessToken, selectedId, options));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dispute case.');
    }
  }, [accessToken, options, selectedId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  const addInternalNote = async () => {
    if (!selectedId || !note.trim()) return;
    setBusy(true);
    try {
      await adminApiClient.addReservationDisputeNote(
        accessToken,
        selectedId,
        { body: note.trim(), visibility: 'admin' },
        options,
      );
      setNote('');
      await loadCase();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add note.');
    } finally {
      setBusy(false);
    }
  };

  const addEvidence = async (file: File | undefined) => {
    if (!selectedId || !file) return;
    setBusy(true);
    try {
      const uploaded = await uploadPrivateFile(accessToken, file);
      await adminApiClient.addReservationDisputeEvidence(
        accessToken,
        selectedId,
        {
          uploadId: uploaded.filename,
          ...(evidenceLabel.trim() ? { label: evidenceLabel.trim() } : {}),
        },
        options,
      );
      setEvidenceLabel('');
      await loadCase();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach evidence.');
    } finally {
      setBusy(false);
    }
  };

  const resolveCase = async (
    statusValue: 'resolved_customer' | 'resolved_provider' | 'resolved_partial' | 'dismissed',
  ) => {
    if (!selectedId || !resolutionNotes.trim()) {
      setError('Resolution reason is required.');
      return;
    }
    setBusy(true);
    try {
      await adminApiClient.resolveReservationDispute(
        accessToken,
        selectedId,
        {
          status: statusValue,
          resolutionNotes: resolutionNotes.trim(),
          settlementOutcome,
          ...(settlementOutcome === 'split'
            ? {
                customerRefundAmount: Number.parseFloat(customerRefundAmount) || 0,
                providerReleaseAmount: Number.parseFloat(providerReleaseAmount) || 0,
              }
            : {}),
        },
        options,
      );
      setResolutionNotes('');
      await loadList();
      await loadCase();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resolve dispute.');
    } finally {
      setBusy(false);
    }
  };

  const openEvidence = async (uploadId: string) => {
    const url = await getPrivateFileOpenableUrl(accessToken, uploadId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">Reservation dispute center</h2>
      {error && <p className="admin-error">{error}</p>}
      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="open">Open</option>
          <option value="">All</option>
          <option value="resolved_customer">Resolved customer</option>
          <option value="resolved_provider">Resolved provider</option>
          <option value="resolved_partial">Resolved partial</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      <div className="admin-grid">
        <div className="admin-card">
          {items.length === 0 ? (
            <p className="admin-empty">No reservation disputes.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.dispute.id}
                type="button"
                className={`admin-list-button ${selectedId === item.dispute.id ? 'admin-list-button--active' : ''}`}
                onClick={() => setSelectedId(item.dispute.id)}
              >
                <strong>{item.reservation.serviceTitle ?? item.reservation.id}</strong>
                <span>{item.dispute.status}</span>
                <small>
                  {item.evidenceCount} evidence · {item.noteCount} notes ·{' '}
                  {new Date(item.lastActivityAt).toLocaleString()}
                </small>
              </button>
            ))
          )}
        </div>
        <div className="admin-card">
          {!caseFile ? (
            <p className="admin-empty">{dictionary.admin?.loading ?? 'Loading...'}</p>
          ) : (
            <>
              <h3>{caseFile.reservation.serviceTitle ?? 'Reservation dispute'}</h3>
              <p className="dashboard-card-meta">
                {caseFile.dispute.reason} · {caseFile.dispute.status} ·{' '}
                {formatMoney(caseFile.reservation.expertPriceAmount, caseFile.reservation.currency)}
              </p>
              <h4>Settlement</h4>
              <select
                className="dashboard-input"
                value={settlementOutcome}
                onChange={(event) =>
                  setSettlementOutcome(event.target.value as typeof settlementOutcome)
                }
              >
                <option value="refund">Full refund</option>
                <option value="release">Full release</option>
                <option value="split">Custom split</option>
                <option value="none">No money movement</option>
              </select>
              {settlementOutcome === 'split' && (
                <div className="admin-form-grid">
                  <input
                    className="dashboard-input"
                    value={customerRefundAmount}
                    onChange={(event) => setCustomerRefundAmount(event.target.value)}
                    placeholder="Customer refund EGP"
                  />
                  <input
                    className="dashboard-input"
                    value={providerReleaseAmount}
                    onChange={(event) => setProviderReleaseAmount(event.target.value)}
                    placeholder="Provider release EGP"
                  />
                </div>
              )}
              <textarea
                className="dashboard-input"
                rows={3}
                value={resolutionNotes}
                onChange={(event) => setResolutionNotes(event.target.value)}
                placeholder="Required admin reason"
              />
              <div className="calendar-booking-actions">
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                  disabled={busy}
                  onClick={() => void resolveCase('resolved_customer')}
                >
                  Refund
                </button>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--small dashboard-btn--primary"
                  disabled={busy}
                  onClick={() => void resolveCase('resolved_provider')}
                >
                  Release
                </button>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--small dashboard-btn--secondary"
                  disabled={busy}
                  onClick={() => void resolveCase('resolved_partial')}
                >
                  Split
                </button>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--small dashboard-btn--danger"
                  disabled={busy}
                  onClick={() => void resolveCase('dismissed')}
                >
                  Dismiss
                </button>
              </div>

              <h4>Evidence</h4>
              <input
                className="dashboard-input"
                value={evidenceLabel}
                onChange={(event) => setEvidenceLabel(event.target.value)}
                placeholder="Evidence label"
              />
              <input
                className="dashboard-input"
                type="file"
                disabled={busy}
                onChange={(event) => {
                  void addEvidence(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              {caseFile.evidence.map((item) => (
                <p key={item.id} className="dashboard-card-meta">
                  {item.label ?? item.uploadId}{' '}
                  <button type="button" onClick={() => void openEvidence(item.uploadId)}>
                    Open
                  </button>
                </p>
              ))}

              <h4>Internal note</h4>
              <textarea
                className="dashboard-input"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Admin-only note"
              />
              <button
                type="button"
                className="dashboard-btn dashboard-btn--secondary"
                disabled={busy || !note.trim()}
                onClick={() => void addInternalNote()}
              >
                Add internal note
              </button>

              <h4>Case file</h4>
              {caseFile.notes.map((item) => (
                <p key={item.id} className="dashboard-card-meta">
                  <strong>{item.visibility}:</strong> {item.body}
                </p>
              ))}
              {caseFile.moneyEvents.map((item) => (
                <p key={item.id} className="dashboard-card-meta">
                  {item.kind} · {item.status} · {formatMoney(item.amount, item.currency)} ·{' '}
                  {item.label}
                </p>
              ))}
              {caseFile.timeline.map((item) => (
                <p key={item.id} className="dashboard-card-meta">
                  {new Date(item.createdAt).toLocaleString()} · {item.eventType}
                </p>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
};
