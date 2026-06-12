'use client';

import type { ReservationDisputeCase, ReservationDisputeListItem } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { reservationsApiClient } from '@/lib/reservations/client';
import { getPrivateFileOpenableUrl, uploadPrivateFile } from '@/lib/upload/client';

import '@/app/dashboard.css';

function formatMoney(amount: number, currency = 'EGP') {
  return `${amount.toFixed(2)} ${currency}`;
}

export const DisputesScreen = () => {
  const { accessToken, isReady, isAuthenticated } = useAuth();
  const [items, setItems] = useState<ReservationDisputeListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caseFile, setCaseFile] = useState<ReservationDisputeCase | null>(null);
  const [note, setNote] = useState('');
  const [evidenceLabel, setEvidenceLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      const rows = await reservationsApiClient.listMyDisputeCases(accessToken);
      setItems(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].dispute.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load disputes.');
    }
  }, [accessToken, selectedId]);

  const loadCase = useCallback(async () => {
    if (!accessToken || !selectedId) {
      setCaseFile(null);
      return;
    }
    setError(null);
    try {
      setCaseFile(await reservationsApiClient.getDisputeCase(accessToken, selectedId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dispute case.');
    }
  }, [accessToken, selectedId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadCase();
  }, [loadCase]);

  const submitNote = async () => {
    if (!accessToken || !selectedId || !note.trim()) return;
    setBusy(true);
    try {
      await reservationsApiClient.addDisputeNote(accessToken, selectedId, { body: note.trim() });
      setNote('');
      await loadCase();
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add note.');
    } finally {
      setBusy(false);
    }
  };

  const submitEvidence = async (file: File | undefined) => {
    if (!accessToken || !selectedId || !file) return;
    setBusy(true);
    try {
      const uploaded = await uploadPrivateFile(accessToken, file);
      await reservationsApiClient.addDisputeEvidence(accessToken, selectedId, {
        uploadId: uploaded.filename,
        ...(evidenceLabel.trim() ? { label: evidenceLabel.trim() } : {}),
      });
      setEvidenceLabel('');
      await loadCase();
      await loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach evidence.');
    } finally {
      setBusy(false);
    }
  };

  const openEvidence = async (uploadId: string) => {
    if (!accessToken) return;
    const url = await getPrivateFileOpenableUrl(accessToken, uploadId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (!isReady) {
    return (
      <Container>
        <p className="dashboard-loading">Loading...</p>
      </Container>
    );
  }

  if (!isAuthenticated || !accessToken) {
    return (
      <Container>
        <p className="dashboard-empty">Please sign in to view disputes.</p>
      </Container>
    );
  }

  return (
    <Container className="dashboard-container">
      <header className="dashboard-header">
        <div>
          <h1 className="dashboard-title">Dispute Center</h1>
          <p className="dashboard-subtitle">
            Track reservation disputes, evidence, notes, and settlement activity.
          </p>
        </div>
      </header>

      {error && <p className="dashboard-alert dashboard-alert--error">{error}</p>}

      <div className="dashboard-grid dashboard-grid--two">
        <section className="dashboard-card">
          <h2>Cases</h2>
          {items.length === 0 ? (
            <p className="dashboard-empty">No dispute cases yet.</p>
          ) : (
            <div className="dashboard-list">
              {items.map((item) => (
                <button
                  key={item.dispute.id}
                  type="button"
                  className={`dashboard-list-item ${selectedId === item.dispute.id ? 'dashboard-list-item--active' : ''}`}
                  onClick={() => setSelectedId(item.dispute.id)}
                >
                  <strong>{item.reservation.serviceTitle ?? 'Reservation dispute'}</strong>
                  <span>{item.dispute.status}</span>
                  <small>
                    {item.evidenceCount} evidence · {item.noteCount} notes ·{' '}
                    {new Date(item.lastActivityAt).toLocaleString()}
                  </small>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="dashboard-card">
          {!caseFile ? (
            <p className="dashboard-empty">Select a case.</p>
          ) : (
            <div className="reservation-detail">
              <h2>{caseFile.reservation.serviceTitle ?? 'Reservation dispute'}</h2>
              <p className="dashboard-card-meta">
                Status: {caseFile.dispute.status} · Reason: {caseFile.dispute.reason}
              </p>
              {caseFile.dispute.description && <p>{caseFile.dispute.description}</p>}

              <div className="reservation-section-box">
                <h3>Evidence</h3>
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
                    void submitEvidence(event.currentTarget.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
                {caseFile.evidence.length === 0 ? (
                  <p className="dashboard-empty">No evidence attached.</p>
                ) : (
                  <ul className="dashboard-list">
                    {caseFile.evidence.map((item) => (
                      <li key={item.id} className="dashboard-list-row">
                        <span>{item.label ?? item.uploadId}</span>
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--small"
                          onClick={() => void openEvidence(item.uploadId)}
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="reservation-section-box">
                <h3>Notes</h3>
                <textarea
                  className="dashboard-input"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Add a case note"
                  rows={3}
                />
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--primary"
                  disabled={busy || !note.trim()}
                  onClick={() => void submitNote()}
                >
                  Add note
                </button>
                {caseFile.notes.map((item) => (
                  <p key={item.id} className="dashboard-card-meta">
                    <strong>{item.authorName ?? 'User'}:</strong> {item.body}
                  </p>
                ))}
              </div>

              <div className="reservation-section-box">
                <h3>Money Events</h3>
                {caseFile.moneyEvents.length === 0 ? (
                  <p className="dashboard-empty">No money events linked.</p>
                ) : (
                  caseFile.moneyEvents.map((item) => (
                    <p key={item.id} className="dashboard-card-meta">
                      {item.kind} · {item.status} · {formatMoney(item.amount, item.currency)} ·{' '}
                      {item.label}
                    </p>
                  ))
                )}
              </div>

              <div className="reservation-section-box">
                <h3>Timeline</h3>
                {caseFile.timeline.map((item) => (
                  <p key={item.id} className="dashboard-card-meta">
                    {new Date(item.createdAt).toLocaleString()} · {item.eventType}
                  </p>
                ))}
              </div>

              <div className="reservation-section-box">
                <h3>Messages</h3>
                {caseFile.messages.length === 0 ? (
                  <p className="dashboard-empty">No messages linked.</p>
                ) : (
                  caseFile.messages.map((item) => (
                    <p key={item.id} className="dashboard-card-meta">
                      <strong>{item.senderName ?? 'User'}:</strong>{' '}
                      {item.body ?? item.attachmentUrl ?? 'Attachment'}
                    </p>
                  ))
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </Container>
  );
};
