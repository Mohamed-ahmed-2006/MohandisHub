'use client';

import type { SupportTicket, SupportTicketCategory, SupportTicketMessage } from '@mohandishub/shared';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { getApiBaseUrl } from '@/lib/env';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { toStoredAttachmentUrl } from '@/lib/support/attachment-url';
import { supportApiClient } from '@/lib/support/client';
import { uploadFile } from '@/lib/upload/client';

import '@/app/dashboard.css';

const CATEGORY_ADMIN_KEYS: Record<SupportTicketCategory, string> = {
  bug: 'categoryBug',
  suggestion: 'categorySuggestion',
  error: 'categoryError',
  other: 'categoryOther',
};

function categoryLabel(
  c: SupportTicketCategory | undefined,
  sf: Record<string, string>,
  st: Record<string, string>,
): string {
  const cat = c ?? 'other';
  const adminKey = CATEGORY_ADMIN_KEYS[cat];
  const fromAdmin = st[adminKey];
  if (typeof fromAdmin === 'string') return fromAdmin;
  switch (cat) {
    case 'bug':
      return sf.categoryBug ?? cat;
    case 'suggestion':
      return sf.categorySuggestion ?? cat;
    case 'error':
      return sf.categoryError ?? cat;
    default:
      return sf.categoryOther ?? cat;
  }
}

function statusLabel(
  s: SupportTicket['status'],
  st: Record<string, string>,
): string {
  switch (s) {
    case 'open':
      return st.statusOpen ?? s;
    case 'in_progress':
      return st.statusInProgress ?? s;
    case 'waiting_reply':
      return st.statusWaitingReply ?? s;
    case 'resolved':
      return st.statusResolved ?? s;
    case 'closed':
      return st.statusClosed ?? s;
    default:
      return s;
  }
}

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
  const [createCategory, setCreateCategory] = useState<SupportTicketCategory>('other');
  const [createBody, setCreateBody] = useState('');
  const [createFiles, setCreateFiles] = useState<File[]>([]);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);

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
      const attachmentUrls: string[] = [];
      for (const file of replyFiles.slice(0, 2)) {
        const { url } = await uploadFile(accessToken, file);
        attachmentUrls.push(toStoredAttachmentUrl(url));
      }
      const msg = await supportApiClient.reply(accessToken, selectedTicket.id, {
        body: replyBody.trim(),
        ...(attachmentUrls.length ? { attachmentUrls } : {}),
      });
      setMessages((prev) => [...prev, msg]);
      setReplyBody('');
      setReplyFiles([]);
      void loadTickets();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !createBody.trim()) return;
    setSubmitting(true);
    try {
      const attachmentUrls: string[] = [];
      for (const file of createFiles.slice(0, 2)) {
        const { url } = await uploadFile(accessToken, file);
        attachmentUrls.push(toStoredAttachmentUrl(url));
      }
      await supportApiClient.createTicket(accessToken, {
        category: createCategory,
        body: createBody.trim(),
        ...(attachmentUrls.length ? { attachmentUrls } : {}),
      });
      setShowCreate(false);
      setCreateCategory('other');
      setCreateBody('');
      setCreateFiles([]);
      void loadTickets();
    } finally {
      setSubmitting(false);
    }
  };

  const d = dictionary.common as Record<string, string | undefined>;
  const sf = dictionary.supportFab as Record<string, string>;
  const st = (dictionary.admin?.supportTicket ?? {}) as Record<string, string>;
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
              <label className="dashboard-form-label-inline" htmlFor="support-create-category">
                {sf.categoryLabel}
              </label>
              <select
                id="support-create-category"
                className="dashboard-input"
                value={createCategory}
                onChange={(e) => setCreateCategory(e.target.value as SupportTicketCategory)}
              >
                <option value="bug">{sf.categoryBug}</option>
                <option value="suggestion">{sf.categorySuggestion}</option>
                <option value="error">{sf.categoryError}</option>
                <option value="other">{sf.categoryOther}</option>
              </select>
              <textarea
                className="dashboard-input"
                placeholder={sf.descriptionPlaceholder}
                value={createBody}
                onChange={(e) => setCreateBody(e.target.value)}
                required
                rows={4}
                maxLength={10000}
              />
              <div className="dashboard-form-field">
                <label className="dashboard-form-label-inline">
                  {d.upload ?? 'Upload'} — {d.maxTwoImages ?? 'Max 2 images'}
                </label>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="dashboard-input"
                  onChange={(e) => setCreateFiles(Array.from(e.target.files ?? []).slice(0, 2))}
                />
                {createFiles.length > 0 && (
                  <p className="dashboard-form-hint">
                    {createFiles.length} / 2
                  </p>
                )}
              </div>
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
                    {categoryLabel(t.category, sf, st)} · {statusLabel(t.status, st)} ·{' '}
                    {new Date(t.updatedAt).toLocaleDateString()}
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
                  aria-label={d.back ?? 'Back'}
                >
                  <ChevronLeft size={16} style={{ marginRight: '0.35rem' }} aria-hidden />
                  {d.back ?? 'Back'}
                </button>
                <div className="dashboard-card">
                  <h3>{selectedTicket.subject}</h3>
                  <p className="dashboard-card-meta">
                    {categoryLabel(selectedTicket.category, sf, st)} · {statusLabel(selectedTicket.status, st)}
                  </p>
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
                        {m.attachmentUrls?.length ? (
                          <div className="dashboard-card-media" style={{ marginTop: '0.5rem' }}>
                            {m.attachmentUrls.map((u) => {
                              const src = u.startsWith('http') ? u : `${getApiBaseUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
                              return (
                                <a key={u} href={src} target="_blank" rel="noopener noreferrer" className="dashboard-card-media-thumb">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={src} alt="" width={80} height={80} />
                                </a>
                              );
                            })}
                          </div>
                        ) : null}
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
                      <div className="dashboard-form-field" style={{ marginTop: '0.5rem' }}>
                        <label className="dashboard-form-label-inline">
                          {d.upload ?? 'Upload'} — {d.maxTwoImages ?? 'Max 2 images'}
                        </label>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="dashboard-input"
                          onChange={(e) => setReplyFiles(Array.from(e.target.files ?? []).slice(0, 2))}
                        />
                      </div>
                      <button type="submit" className="dashboard-primary-btn" style={{ marginTop: '0.5rem' }} disabled={submitting}>
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
