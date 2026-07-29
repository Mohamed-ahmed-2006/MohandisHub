'use client';

import type { ReservationDisputeCase, ReservationDisputeListItem } from '@mohandishub/shared';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { reservationsApiClient } from '@/lib/reservations/client';
import { getPrivateFileOpenableUrl, uploadPrivateFile } from '@/lib/upload/client';

import './disputes-screen.css';

function formatMoney(amount: number, currency = 'EGP') {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} ${currency}`;
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
      <Container className="disputes-screen-container">
        <p className="admin-empty">Loading dispute center...</p>
      </Container>
    );
  }

  if (!isAuthenticated || !accessToken) {
    return (
      <Container className="disputes-screen-container">
        <p className="admin-empty">Please sign in to view your dispute cases.</p>
      </Container>
    );
  }

  return (
    <main className="disputes-screen-main">
      <Container className="disputes-screen-container">
        <header className="history-header">
          <div>
            <h1 className="history-screen-title">Dispute Center</h1>
            <p className="admin-section-desc" style={{ margin: '0.2rem 0 0' }}>
              Track reservation disputes, submit evidence, inspect money movements, and communicate.
            </p>
          </div>
        </header>

        {error && <p className="admin-error-banner">{error}</p>}

        <div className="disputes-grid-layout">
          {/* Cases Column */}
          <section className="disputes-cases-card">
            <h3 className="disputes-cases-title">Dispute Cases ({items.length})</h3>
            {items.length === 0 ? (
              <p className="admin-empty">No active dispute cases.</p>
            ) : (
              items.map((item) => {
                const isActive = selectedId === item.dispute.id;
                return (
                  <button
                    key={item.dispute.id}
                    type="button"
                    className={`disputes-case-btn ${isActive ? 'disputes-case-btn--active' : ''}`}
                    onClick={() => setSelectedId(item.dispute.id)}
                  >
                    <div className="disputes-case-header">
                      <span className="disputes-case-name">
                        {item.reservation.serviceTitle ?? 'Reservation dispute'}
                      </span>
                      <span className={`dispute-status-badge dispute-status-badge--${item.dispute.status}`}>
                        {item.dispute.status}
                      </span>
                    </div>
                    <span className="disputes-case-meta">
                      {item.evidenceCount} evidence · {item.noteCount} notes
                    </span>
                    <span className="disputes-case-meta" style={{ fontSize: '0.72rem' }}>
                      {new Date(item.lastActivityAt).toLocaleString()}
                    </span>
                  </button>
                );
              })
            )}
          </section>

          {/* Case Detail Column */}
          <section className="disputes-detail-card">
            {!caseFile ? (
              <p className="admin-empty">Select a dispute case on the left to inspect.</p>
            ) : (
              <>
                <div className="disputes-detail-header">
                  <div>
                    <h2 className="disputes-detail-title">
                      {caseFile.reservation.serviceTitle ?? 'Reservation Dispute'}
                    </h2>
                    <p className="disputes-detail-desc">
                      Reason: <strong>{caseFile.dispute.reason}</strong> · Amount:{' '}
                      <strong>
                        {formatMoney(
                          caseFile.reservation.expertPriceAmount,
                          caseFile.reservation.currency,
                        )}
                      </strong>
                    </p>
                    {caseFile.dispute.description && (
                      <p className="disputes-detail-desc" style={{ marginTop: '0.4rem' }}>
                        {caseFile.dispute.description}
                      </p>
                    )}
                  </div>
                  <span className={`dispute-status-badge dispute-status-badge--${caseFile.dispute.status}`}>
                    {caseFile.dispute.status}
                  </span>
                </div>

                {/* Evidence Section */}
                <div className="disputes-section-box">
                  <h3 className="disputes-section-title">Evidence Files</h3>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      className="admin-settings-input"
                      style={{ flex: 1 }}
                      value={evidenceLabel}
                      onChange={(event) => setEvidenceLabel(event.target.value)}
                      placeholder="Evidence label / description"
                    />
                    <input
                      type="file"
                      className="admin-settings-input"
                      style={{ width: 'auto' }}
                      disabled={busy}
                      onChange={(event) => {
                        void submitEvidence(event.currentTarget.files?.[0]);
                        event.currentTarget.value = '';
                      }}
                    />
                  </div>
                  {caseFile.evidence.length === 0 ? (
                    <p className="admin-empty" style={{ padding: '0.5rem 0' }}>
                      No evidence attached yet. Upload a document or photo above.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {caseFile.evidence.map((item) => (
                        <div key={item.id} className="disputes-evidence-item">
                          <span>📁 {item.label ?? item.uploadId}</span>
                          <button
                            type="button"
                            className="admin-btn admin-btn--small admin-btn--primary"
                            onClick={() => void openEvidence(item.uploadId)}
                          >
                            Open File
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Case Notes & Discussion */}
                <div className="disputes-section-box">
                  <h3 className="disputes-section-title">Case Notes &amp; Discussion</h3>
                  <textarea
                    className="admin-form-textarea"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Add a case note or message to support..."
                    rows={3}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      disabled={busy || !note.trim()}
                      onClick={() => void submitNote()}
                    >
                      Post Note
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem' }}>
                    {caseFile.notes.map((item) => (
                      <div key={item.id} className="disputes-note-bubble">
                        <span className="disputes-note-author">{item.authorName ?? 'User'}:</span>
                        <span>{item.body}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Money Events */}
                <div className="disputes-section-box">
                  <h3 className="disputes-section-title">Escrow &amp; Financial Ledger</h3>
                  {caseFile.moneyEvents.length === 0 ? (
                    <p className="admin-empty" style={{ padding: '0.5rem 0' }}>
                      No money events linked to this dispute.
                    </p>
                  ) : (
                    caseFile.moneyEvents.map((item) => (
                      <div key={item.id} className="disputes-timeline-item">
                        <span>💰</span>
                        <div>
                          <strong>
                            {item.kind} · {item.status} ({formatMoney(item.amount, item.currency)})
                          </strong>
                          <div>{item.label}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Audit Timeline */}
                <div className="disputes-section-box">
                  <h3 className="disputes-section-title">Audit Timeline</h3>
                  {caseFile.timeline.map((item) => (
                    <div key={item.id} className="disputes-timeline-item">
                      <span>⏱️</span>
                      <span>
                        {new Date(item.createdAt).toLocaleString()} —{' '}
                        <strong>{item.eventType}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
