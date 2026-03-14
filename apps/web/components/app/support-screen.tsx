'use client';

import type { SupportTicket, SupportTicketMessage } from '@mohandishub/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { supportApiClient } from '@/lib/support/client';

import '@/app/dashboard.css';

export const SupportScreen = () => {
  const { locale, dictionary } = useI18n();
  const router = useRouter();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createSubject, setCreateSubject] = useState('');
  const [createBody, setCreateBody] = useState('');

  useEffect(() => {
    if (!isReady) return;
    if (!isAuthenticated || !authUser) {
      router.replace(`${buildLocalePath(locale, '/auth')}?mode=login`);
      return;
    }
    if (!authGuard.emailVerified) {
      router.replace(buildLocalePath(locale, '/verify-email'));
    }
  }, [isReady, isAuthenticated, authUser, authGuard.emailVerified, locale, router]);

  const loadTickets = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const data = await supportApiClient.listMyTickets(accessToken, { page: 1, limit: 50 });
      setTickets(data.items);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    if (!selectedTicket || !accessToken) {
      setMessages([]);
      return;
    }
    setMessagesLoading(true);
    supportApiClient
      .listMessages(accessToken, selectedTicket.id)
      .then(setMessages)
      .catch(() => setMessages([]))
      .finally(() => setMessagesLoading(false));
  }, [selectedTicket, accessToken]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !selectedTicket || !replyBody.trim()) return;
    setSubmitting(true);
    try {
      const msg = await supportApiClient.reply(accessToken, selectedTicket.id, { body: replyBody.trim() });
      setMessages((prev) => [...prev, msg]);
      setReplyBody('');
      void loadTickets();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !createSubject.trim() || !createBody.trim()) return;
    setSubmitting(true);
    try {
      await supportApiClient.createTicket(accessToken, { subject: createSubject.trim(), body: createBody.trim() });
      setShowCreate(false);
      setCreateSubject('');
      setCreateBody('');
      void loadTickets();
    } finally {
      setSubmitting(false);
    }
  };

  const d = dictionary.common as Record<string, string | undefined>;
  const supportTitle = dictionary.nav?.support ?? 'Support';

  if (!isReady || !authUser) {
    return (
      <main className="dashboard-section">
        <Container>
          <p>{d.loading ?? 'Loading...'}</p>
        </Container>
      </main>
    );
  }

  return (
    <main className="dashboard-section">
      <Container>
        <h1 className="dashboard-section-title">{supportTitle}</h1>

        {showCreate ? (
          <div className="dashboard-card" style={{ marginBottom: '1rem' }}>
            <h2>{d.createTicket ?? 'New ticket'}</h2>
            <form onSubmit={(e) => { void handleCreate(e); }} className="dashboard-form">
              <input
                type="text"
                className="dashboard-input"
                placeholder={d.subject ?? 'Subject'}
                value={createSubject}
                onChange={(e) => setCreateSubject(e.target.value)}
                required
                maxLength={500}
              />
              <textarea
                className="dashboard-input"
                placeholder={d.message ?? 'Message'}
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                required
                rows={4}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="dashboard-primary-btn" disabled={submitting}>
                  {d.submit ?? 'Submit'}
                </button>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--secondary"
                  onClick={() => setShowCreate(false)}
                >
                  {d.cancel ?? 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <button
            type="button"
            className="dashboard-primary-btn"
            style={{ marginBottom: '1rem' }}
            onClick={() => setShowCreate(true)}
          >
            {d.createTicket ?? 'New ticket'}
          </button>
        )}

        {loading ? (
          <p className="dashboard-empty">{d.loading ?? 'Loading...'}</p>
        ) : tickets.length === 0 ? (
          <p className="dashboard-empty">{d.noTickets ?? 'No tickets yet. Open a ticket for help.'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {!selectedTicket ? (
              tickets.map((t) => (
                <div
                  key={t.id}
                  className="dashboard-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedTicket(t)}
                >
                  <strong>{t.subject}</strong>
                  <p className="dashboard-card-meta">
                    {t.status} · {new Date(t.updatedAt).toLocaleDateString()}
                    {t.messageCount != null && ` · ${t.messageCount} message(s)`}
                  </p>
                </div>
              ))
            ) : (
              <>
                <button
                  type="button"
                  className="dashboard-btn dashboard-btn--secondary"
                  onClick={() => setSelectedTicket(null)}
                >
                  ← {d.back ?? 'Back'}
                </button>
                <div className="dashboard-card">
                  <h3>{selectedTicket.subject}</h3>
                  <p className="dashboard-card-meta">Status: {selectedTicket.status}</p>
                </div>
                {messagesLoading ? (
                  <p className="dashboard-empty">{d.loading ?? 'Loading...'}</p>
                ) : (
                  <div className="dashboard-card">
                    <h4>{d.messages ?? 'Messages'}</h4>
                    {messages.map((m) => (
                      <div
                        key={m.id}
                        style={{
                          padding: '0.5rem 0',
                          borderBottom: '1px solid var(--border-color, #eee)',
                        }}
                      >
                        <p className="dashboard-card-meta">
                          {m.isStaff ? 'Staff' : 'You'} · {new Date(m.createdAt).toLocaleString()}
                        </p>
                        <p style={{ margin: 0 }}>{m.body}</p>
                      </div>
                    ))}
                    <form onSubmit={(e) => { void handleReply(e); }} style={{ marginTop: '1rem' }}>
                      <textarea
                        className="dashboard-input"
                        placeholder={d.reply ?? 'Reply...'}
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        rows={3}
                      />
                      <button type="submit" className="dashboard-primary-btn" disabled={submitting}>
                        {d.reply ?? 'Reply'}
                      </button>
                    </form>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Container>
    </main>
  );
};
