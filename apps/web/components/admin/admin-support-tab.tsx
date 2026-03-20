'use client';

import type { SupportTicket, SupportTicketMessage } from '@mohandishub/shared';
import { ChevronLeft } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { adminApiClient } from '@/lib/admin/client';
import type { Dictionary } from '@/lib/i18n/types';
import { supportApiClient } from '@/lib/support/client';

type TicketWithEmail = SupportTicket & { userEmail?: string };

type Props = {
  dictionary: Dictionary;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

const STATUS_OPTIONS: SupportTicket['status'][] = ['open', 'in_progress', 'waiting_reply', 'resolved', 'closed'];

const buildTicketListParams = (page: number, limit: number, statusFilter: string) => ({
  page,
  limit,
  ...(statusFilter ? { status: statusFilter } : {}),
});

const buildAdminClientOptions = (refreshSession?: () => Promise<string | null>) =>
  refreshSession ? { refreshSession } : {};

export const AdminSupportTab = ({ dictionary, accessToken, refreshSession }: Props) => {
  const [tickets, setTickets] = useState<TicketWithEmail[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const limit = 20;

  const [selectedTicket, setSelectedTicket] = useState<TicketWithEmail | null>(null);
  const [messages, setMessages] = useState<SupportTicketMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApiClient.listSupportTickets(
        accessToken,
        buildTicketListParams(page, limit, statusFilter),
        buildAdminClientOptions(refreshSession),
      );
      setTickets(data.items);
      setTotal(data.total);
    } catch {
      setTickets([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, page, limit, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMessages = useCallback(
    async (ticketId: string) => {
      setMessagesLoading(true);
      try {
        const list = await supportApiClient.listMessages(accessToken, ticketId);
        setMessages(list);
      } catch {
        setMessages([]);
      } finally {
        setMessagesLoading(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    if (!selectedTicket) {
      setMessages([]);
      setReplyBody('');
      return;
    }
    void loadMessages(selectedTicket.id);
  }, [selectedTicket, loadMessages]);

  const handleStatusChange = async (ticketId: string, newStatus: SupportTicket['status']) => {
    try {
      await adminApiClient.updateSupportTicket(
        accessToken,
        ticketId,
        { status: newStatus },
        buildAdminClientOptions(refreshSession),
      );
      void load();
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch {
      /* ignore */
    }
  };

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyBody.trim()) return;
    setReplySubmitting(true);
    try {
      await supportApiClient.reply(accessToken, selectedTicket.id, { body: replyBody.trim() });
      setReplyBody('');
      await loadMessages(selectedTicket.id);
      void load();
    } catch {
      /* ignore */
    } finally {
      setReplySubmitting(false);
    }
  };

  const d = dictionary.admin;
  const totalPages = Math.ceil(total / limit) || 1;

  if (selectedTicket) {
    return (
      <section className="admin-tab-content">
        <h2 className="admin-tab-title">{d.tabs.support ?? 'Support'}</h2>
        <button
          type="button"
          className="admin-btn admin-btn--secondary"
          onClick={() => setSelectedTicket(null)}
          style={{ marginBottom: '1rem' }}
        >
          <ChevronLeft size={16} style={{ marginRight: '0.35rem' }} aria-hidden />
          Back to list
        </button>
        <div className="admin-user-card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>{selectedTicket.subject}</p>
          <p className="dashboard-card-meta" style={{ margin: 0 }}>
            {selectedTicket.userEmail ?? selectedTicket.userId} · Status:{' '}
            <span className="admin-badge admin-badge--pending">{selectedTicket.status}</span>
          </p>
          <div style={{ marginTop: '0.5rem' }}>
            <select
              className="admin-form-select admin-form-select--inline"
              value={selectedTicket.status}
              onChange={(e) =>
                void handleStatusChange(selectedTicket.id, e.target.value as SupportTicket['status'])
              }
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="admin-user-card">
          <p style={{ margin: '0 0 0.75rem', fontWeight: 600 }}>Conversation</p>
          {messagesLoading ? (
            <p className="dashboard-empty">{d.loading}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {messages.map((m) => (
                <li
                  key={m.id}
                  style={{
                    padding: '0.75rem',
                    background: m.isStaff ? 'hsl(var(--primary) / 0.08)' : 'hsl(var(--muted) / 0.4)',
                    borderRadius: 8,
                    borderLeft: m.isStaff ? '3px solid hsl(var(--primary))' : undefined,
                  }}
                >
                  <p className="dashboard-card-meta" style={{ margin: '0 0 0.35rem' }}>
                    {m.isStaff ? 'Staff' : 'Customer'} · {new Date(m.createdAt).toLocaleString()}
                  </p>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              void handleReply(e);
            }}
          >
            <label className="admin-form-label" htmlFor="admin-support-reply">
              Reply as staff
            </label>
            <textarea
              id="admin-support-reply"
              className="admin-form-input admin-form-textarea"
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type your reply..."
              rows={3}
              style={{ marginBottom: '0.5rem' }}
            />
            <button
              type="submit"
              className="admin-btn admin-btn--primary"
              disabled={replySubmitting || !replyBody.trim()}
            >
              {replySubmitting ? 'Sending...' : 'Send reply'}
            </button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-tab-content">
      <h2 className="admin-tab-title">{d.tabs.support ?? 'Support'}</h2>
      <div className="admin-toolbar">
        <select
          className="admin-toolbar-select"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="admin-empty">{d.loading}</p>
      ) : tickets.length === 0 ? (
        <p className="admin-empty">No support tickets.</p>
      ) : (
        <>
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Messages</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedTicket(t)}
                  >
                    <td>{t.subject}</td>
                    <td>{t.userEmail ?? t.userId}</td>
                    <td>
                      <span className="admin-badge admin-badge--pending">{t.status}</span>
                    </td>
                    <td>{t.messageCount ?? 0}</td>
                    <td>{new Date(t.updatedAt).toLocaleString()}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <select
                        className="admin-form-select admin-form-select--inline"
                        value={t.status}
                        onChange={(e) =>
                          void handleStatusChange(t.id, e.target.value as SupportTicket['status'])
                        }
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>
                            {s.replace('_', ' ')}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="admin-btn admin-btn--small"
                        style={{ marginLeft: '0.35rem' }}
                        onClick={() => setSelectedTicket(t)}
                      >
                        View & reply
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="admin-pagination">
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <span aria-hidden>Prev</span>
              </button>
              <span className="admin-pagination-info">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                className="admin-btn admin-btn--small"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <span aria-hidden>Next</span>
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
