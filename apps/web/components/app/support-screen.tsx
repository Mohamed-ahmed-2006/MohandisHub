'use client';

import type {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketMessage,
} from '@mohandishub/shared';
import { ChevronLeft, Inbox } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import { getApiBaseUrl } from '@/lib/env';
import { useI18n } from '@/lib/i18n/context';
import { buildLocalePath } from '@/lib/i18n/path';
import { toStoredAttachmentUrl } from '@/lib/support/attachment-url';
import { supportApiClient } from '@/lib/support/client';
import { uploadFile } from '@/lib/upload/client';

import '@/app/dashboard.css';
import './case-thread.css';

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

function statusLabel(s: SupportTicket['status'], st: Record<string, string>): string {
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

function statusPillModifier(status: SupportTicket['status']): string {
  switch (status) {
    case 'open':
      return 'support-pill--open';
    case 'in_progress':
      return 'support-pill--progress';
    case 'waiting_reply':
      return 'support-pill--wait';
    default:
      return 'support-pill--done';
  }
}

/** User may not add messages once staff marked resolved or closed. */
function isTicketLockedForUserReply(status: SupportTicket['status']): boolean {
  return status === 'resolved' || status === 'closed';
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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const sp = (dictionary.supportPage ?? {}) as Record<string, string>;

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
    const id = selectedTicket?.id;
    if (!id) return;
    const next = tickets.find((t) => t.id === id);
    if (!next) return;
    setSelectedTicket((prev) => {
      if (!prev || prev.id !== id) return prev;
      if (
        prev.status === next.status &&
        prev.updatedAt === next.updatedAt &&
        prev.subject === next.subject &&
        prev.category === next.category
      ) {
        return prev;
      }
      return next;
    });
  }, [tickets, selectedTicket?.id]);

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, messagesLoading, selectedTicket]);

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
      <main className="support-screen">
        <Container className="support-screen__container">
          <p>{d.loading ?? 'Loading...'}</p>
        </Container>
      </main>
    );
  }

  const layoutClass = `support-layout${selectedTicket ? ' support-layout--thread' : ''}`;

  return (
    <main className="support-screen">
      <Container className="support-screen__container">
        <header className="support-screen__header">
          <h1 className="support-screen__title">{supportTitle}</h1>
          <p className="support-screen__intro">
            {sp.intro ??
              'Support tickets are conversations with the platform team. You can add replies until the ticket is closed.'}
          </p>
          <p className="support-screen__tip">
            {sp.reviewTip ??
              'To report an inappropriate review, open that review and use Report — moderators handle that separately.'}
          </p>
        </header>

        <div className={layoutClass}>
          <aside className="support-inbox" aria-label={supportTitle}>
            <div className="support-inbox__toolbar">
              {!showCreate ? (
                <button
                  type="button"
                  className="support-inbox__new"
                  onClick={() => setShowCreate(true)}
                  disabled={submitting}
                >
                  {sp.newTicket ?? d.createTicket ?? 'New ticket'}
                </button>
              ) : (
                <div className="support-create-panel">
                  <h3>{d.createTicket ?? 'New ticket'}</h3>
                  <form
                    onSubmit={(e) => {
                      void handleCreate(e);
                    }}
                    className="dashboard-form"
                  >
                    <label
                      className="dashboard-form-label-inline"
                      htmlFor="support-create-category"
                    >
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
                        onChange={(e) =>
                          setCreateFiles(Array.from(e.target.files ?? []).slice(0, 2))
                        }
                      />
                      {createFiles.length > 0 && (
                        <p className="dashboard-form-hint">{createFiles.length} / 2</p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
              )}
            </div>

            <div className="support-inbox__list">
              {loading ? (
                <p className="support-empty">{d.loading ?? 'Loading...'}</p>
              ) : tickets.length === 0 ? (
                <p className="support-empty">
                  {d.noTickets ?? 'No tickets yet. Open a ticket for help.'}
                </p>
              ) : (
                tickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`support-ticket-row ${selectedTicket?.id === t.id ? 'support-ticket-row--active' : ''}`}
                    onClick={() => setSelectedTicket(t)}
                  >
                    <span className="support-ticket-row__subject">{t.subject}</span>
                    <span className="support-ticket-row__meta">
                      <span className={`support-pill ${statusPillModifier(t.status)}`}>
                        {statusLabel(t.status, st)}
                      </span>
                      <span>{categoryLabel(t.category, sf, st)}</span>
                      <span>{new Date(t.updatedAt).toLocaleDateString()}</span>
                      {t.messageCount != null && t.messageCount > 0 && (
                        <span>· {t.messageCount}</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="support-thread" aria-live="polite">
            {!selectedTicket ? (
              <div className="support-thread__placeholder">
                <div className="support-thread__placeholder-icon" aria-hidden>
                  <Inbox size={28} strokeWidth={1.75} />
                </div>
                <p>{sp.selectTicket ?? 'Select a ticket to read the thread.'}</p>
              </div>
            ) : (
              <>
                <div className="support-thread__header">
                  <button
                    type="button"
                    className="support-thread__back"
                    onClick={() => setSelectedTicket(null)}
                    aria-label={d.back ?? 'Back'}
                  >
                    <ChevronLeft size={18} aria-hidden />
                    {d.back ?? 'Back'}
                  </button>
                  <div className="support-thread__header-body">
                    <h2>{selectedTicket.subject}</h2>
                    <div className="support-thread__header-chips">
                      <span className={`support-pill ${statusPillModifier(selectedTicket.status)}`}>
                        {statusLabel(selectedTicket.status, st)}
                      </span>
                      <span className="support-pill">
                        {categoryLabel(selectedTicket.category, sf, st)}
                      </span>
                    </div>
                  </div>
                </div>

                {messagesLoading ? (
                  <p className="support-empty">{d.loading ?? 'Loading...'}</p>
                ) : (
                  <div
                    className="support-scroll"
                    role="region"
                    aria-label={sp.threadTitle ?? 'Conversation'}
                  >
                    {messages.map((m) => {
                      const isStaff = m.isStaff;
                      return (
                        <div
                          key={m.id}
                          className={`support-bubble ${isStaff ? 'support-bubble--staff' : 'support-bubble--user'}`}
                        >
                          <span className="support-bubble__label">
                            {isStaff ? (sp.staffLabel ?? 'Support team') : (sp.youLabel ?? 'You')}
                          </span>
                          <p className="support-bubble__body">{m.body}</p>
                          {m.attachmentUrls?.length ? (
                            <div className="support-attachments">
                              {m.attachmentUrls.map((u) => {
                                const src = u.startsWith('http')
                                  ? u
                                  : `${getApiBaseUrl()}${u.startsWith('/') ? '' : '/'}${u}`;
                                return (
                                  <a key={u} href={src} target="_blank" rel="noopener noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={src} alt="" width={80} height={80} />
                                  </a>
                                );
                              })}
                            </div>
                          ) : null}
                          <span className="support-bubble__time">
                            {new Date(m.createdAt).toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                )}

                {isTicketLockedForUserReply(selectedTicket.status) ? (
                  <div className="support-thread__readonly" role="status">
                    <p className="support-thread__readonly-title">
                      {sp.ticketReadOnlyTitle ?? 'This ticket is finished'}
                    </p>
                    <p className="support-thread__readonly-body">
                      {sp.ticketReadOnlyBody ??
                        'This ticket is resolved or closed. You cannot send more messages here. Use New ticket if you still need help.'}
                    </p>
                  </div>
                ) : (
                  <div className="support-composer">
                    <form
                      onSubmit={(e) => {
                        void handleReply(e);
                      }}
                    >
                      <textarea
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder={d.reply ?? 'Reply...'}
                        rows={3}
                        maxLength={10000}
                      />
                      <div className="support-composer__row">
                        <div className="support-composer__files">
                          <label
                            className="dashboard-form-label-inline"
                            htmlFor="support-reply-files"
                          >
                            {d.upload ?? 'Upload'} — {d.maxTwoImages ?? 'Max 2'}
                          </label>
                          <input
                            id="support-reply-files"
                            type="file"
                            accept="image/*"
                            multiple
                            className="dashboard-input"
                            onChange={(e) =>
                              setReplyFiles(Array.from(e.target.files ?? []).slice(0, 2))
                            }
                          />
                        </div>
                        <button
                          type="submit"
                          className="support-composer__submit"
                          disabled={submitting || !replyBody.trim()}
                        >
                          {d.reply ?? 'Send reply'}
                        </button>
                      </div>
                      {replyFiles.length > 0 && (
                        <p className="dashboard-form-hint" style={{ margin: '0.35rem 0 0' }}>
                          {replyFiles.length} / 2
                        </p>
                      )}
                    </form>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
