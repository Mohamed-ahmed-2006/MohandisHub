'use client';

import { Link2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useProfileModal } from './profile-modal-context';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import type { Conversation, Message } from '@/lib/chat/client';
import { chatApiClient } from '@/lib/chat/client';
import { getChatSocket } from '@/lib/chat/socket';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './chat-screen.css';

type Props = { locale: Locale; dictionary: Dictionary };

type MessageType = 'text' | 'image' | 'voice' | 'link' | 'location';

function renderTextWithLinks(text: string): ReactNode[] {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRe);
  return parts.map((part, index) => {
    const isUrl = /^https?:\/\/[^\s]+$/.test(part);
    if (!isUrl) return <span key={`text-${index}`}>{part}</span>;
    return (
      <a
        key={`url-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-msg-link"
      >
        {part}
      </a>
    );
  });
}

function formatLocationUrl(lat: number | string, lng: number | string): string {
  const la = typeof lat === 'string' ? parseFloat(lat) : lat;
  const lo = typeof lng === 'string' ? parseFloat(lng) : lng;
  return `https://www.google.com/maps?q=${la},${lo}`;
}

export const ChatScreen = ({ locale, dictionary }: Props) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { authUser, accessToken, isAuthenticated, isReady, authGuard } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convStatus, setConvStatus] = useState<string>('ongoing');
  const [loading, setLoading] = useState(true);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [contextMessageId, setContextMessageId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [shareLinkOpen, setShareLinkOpen] = useState(false);
  const [shareLocationLoading, setShareLocationLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMessageId || !contextMenuPos) return;
    const close = () => {
      setContextMessageId(null);
      setContextMenuPos(null);
    };
    const onDocClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [contextMessageId, contextMenuPos]);

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

  const loadConversations = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const convs = await chatApiClient.listConversations(accessToken);
      setConversations(convs);
      const paramConvId = searchParams.get('c');
      if (paramConvId && convs.some((c) => c.id === paramConvId)) {
        setActiveConvId(paramConvId);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken, searchParams]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(async () => {
    if (!accessToken || !activeConvId) return;
    try {
      const data = await chatApiClient.getMessages(accessToken, activeConvId);
      setMessages(data.messages);
      setConvStatus(data.status);
    } catch {
      // ignore
    }
  }, [accessToken, activeConvId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const chatSocketRef = useRef<Awaited<ReturnType<typeof getChatSocket>>>(null);
  useEffect(() => {
    if (!activeConvId || !accessToken) return;
    void getChatSocket(accessToken).then((s) => {
      chatSocketRef.current = s;
      if (!s) return;
      s.emit('join_conversation', { conversationId: activeConvId });
      const onNewMessage = (msg: Message) => {
        if (msg.conversation_id === activeConvId) {
          setMessages((prev) => {
            const hasDup = prev.some((m) => m.id === msg.id);
            return hasDup ? prev : [...prev, msg];
          });
        }
      };
      const onMessageDeleted = (payload: { messageId: string; scope: string }) => {
        setMessages((prev) => {
          if (payload.scope === 'for_everyone') return prev.filter((m) => m.id !== payload.messageId);
          return prev.filter((m) => !(m.id === payload.messageId && m.sender_id === authUser?.id));
        });
      };
      s.on('new_message', onNewMessage);
      s.on('message_deleted', onMessageDeleted);
    });
    return () => {
      const s = chatSocketRef.current;
      if (s) {
        s.emit('leave_conversation', { conversationId: activeConvId });
        s.off('new_message');
        s.off('message_deleted');
        chatSocketRef.current = null;
      }
    };
  }, [activeConvId, accessToken, authUser?.id]);

  const handleSend = async () => {
    if (!accessToken || !activeConvId || sending) return;
    const body = msgText.trim();
    if (!body) return;
    setSending(true);
    try {
      const payload: Parameters<typeof chatApiClient.sendMessage>[2] = {
        body,
        messageType: 'text',
        ...(replyingTo ? { replyToId: replyingTo.id } : {}),
      };
      const msg = await chatApiClient.sendMessage(accessToken, activeConvId, payload);
      setMessages((prev) => {
        const hasDup = prev.some((m) => m.id === msg.id);
        return hasDup ? prev : [...prev, msg];
      });
      setMsgText('');
      setReplyingTo(null);
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string, scope: 'for_me' | 'for_everyone') => {
    if (!accessToken || !activeConvId) return;
    setContextMessageId(null);
    setContextMenuPos(null);
    try {
      await chatApiClient.deleteMessage(accessToken, activeConvId, messageId, scope);
      setMessages((prev) => {
        if (scope === 'for_everyone') return prev.filter((m) => m.id !== messageId);
        return prev.filter((m) => !(m.id === messageId && m.sender_id === authUser?.id));
      });
    } catch {
      // ignore
    }
  };

  const handleCopyMessage = (text: string) => {
    if (text && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setContextMessageId(null);
    setContextMenuPos(null);
  };

  const openConv = (convId: string) => {
    setActiveConvId(convId);
    setMessages([]);
  };

  if (!isReady || !authUser) {
    return (
      <main className="chat-screen-main">
        <Container>
          <p>{dictionary.appHome.loading}</p>
        </Container>
      </main>
    );
  }

  const { openProfileModal } = useProfileModal();
  const activeConv = conversations.find((c) => c.id === activeConvId);
  const isClosed = convStatus === 'closed';
  const t = dictionary.chatPage ?? {
    shareLink: 'Share link',
    shareLocation: 'Share location',
    reply: 'Reply',
    replyingTo: 'Replying to',
    copy: 'Copy',
    deleteForMe: 'Delete for me',
    deleteForEveryone: 'Delete for everyone',
    openLink: 'Open link',
    viewOnMap: 'View on map',
    sendLink: 'Send link',
    cancelReply: 'Cancel reply',
    typeMessage: 'Type a message...',
    pasteLinkUrl: 'Paste link URL',
    optionalCaption: 'Optional caption',
  };

  return (
    <main className="chat-screen-main">
      <Container className="chat-screen-container">
        <h1 className="chat-screen-title">{dictionary.nav.chat}</h1>

        <div className="chat-layout">
          <aside className="chat-sidebar">
            {loading ? (
              <p className="chat-loading">{t.loadingConversations ?? dictionary.common.loading}</p>
            ) : conversations.length === 0 ? (
              <p className="chat-empty">{t.noConversations ?? 'No conversations yet.'}</p>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  role="button"
                  tabIndex={0}
                  className={`chat-conv-item ${conv.id === activeConvId ? 'chat-conv-item--active' : ''}`}
                  onClick={() => openConv(conv.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      openConv(conv.id);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="chat-conv-name-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      openProfileModal(conv.other_user_id, { displayName: conv.other_display_name });
                    }}
                  >
                    {conv.other_display_name}
                  </button>
                  {conv.last_message_body && (
                    <span className="chat-conv-preview" style={{ fontWeight: conv.has_unread ? 700 : 400 }}>
                      {conv.last_message_body}
                    </span>
                  )}
                  {conv.has_unread && <span className="chat-conv-badge" style={{ background: 'hsl(var(--destructive))', color: '#fff' }}>{t.newBadge ?? 'New'}</span>}
                  {conv.status === 'closed' && <span className="chat-conv-badge">{t.closedBadge ?? 'Closed'}</span>}
                </div>
              ))
            )}
          </aside>

          <section className="chat-messages-area">
            {!activeConvId ? (
              <p className="chat-no-conv">{t.selectConversation ?? 'Select a conversation to start chatting.'}</p>
            ) : (
              <>
                {activeConv && (
                  <div className="chat-messages-header">
                    <button
                      type="button"
                      className="chat-messages-header-name-btn"
                      onClick={() =>
                        openProfileModal(activeConv.other_user_id, {
                          displayName: activeConv.other_display_name,
                        })
                      }
                    >
                      {activeConv.other_display_name}
                    </button>
                    {isClosed && <span className="chat-closed-badge">{t.closedBadge ?? 'Closed'}</span>}
                  </div>
                )}
                <div className="chat-messages-list">
                  {messages.map((m) => {
                    const isMine = m.sender_id === authUser.id;
                    const replyToMsg = m.reply_to_id
                      ? messages.find((x) => x.id === m.reply_to_id)
                      : null;
                    const type = (m.message_type ?? 'text') as MessageType;
                    const body = m.body ?? '';
                    return (
                      <div
                        key={m.id}
                        className={`chat-msg ${isMine ? 'chat-msg--mine' : 'chat-msg--other'}`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMessageId(m.id);
                          setContextMenuPos({ x: e.clientX, y: e.clientY });
                        }}
                        onTouchEnd={(e) => {
                          const touch = e.changedTouches[0];
                          if (touch) {
                            const now = Date.now();
                            const t = (e.target as HTMLElement).closest('.chat-msg') as unknown as { _touchStart?: number } | null;
                            if (t?._touchStart != null && now - t._touchStart > 500) {
                              setContextMessageId(m.id);
                              setContextMenuPos({ x: touch.clientX, y: touch.clientY });
                            }
                          }
                        }}
                        onTouchStart={(e) => {
                          const t = (e.target as HTMLElement).closest('.chat-msg') as unknown as { _touchStart?: number } | null;
                          if (t) t._touchStart = Date.now();
                        }}
                      >
                        {replyToMsg && (
                          <div className="chat-msg-reply-preview">
                            <span className="chat-msg-reply-author">{replyToMsg.sender_name}</span>
                            <span className="chat-msg-reply-body">
                              {(replyToMsg.message_type === 'link' && (replyToMsg.link_url || replyToMsg.body))
                                ? (replyToMsg.body?.trim() || replyToMsg.link_url || '[Link]')
                                : replyToMsg.message_type === 'location'
                                  ? (replyToMsg.location_label?.trim() || '[Location]')
                                  : (replyToMsg.body ?? '').slice(0, 60)}
                              {((replyToMsg.body ?? '').length > 60 ? '…' : '')}
                            </span>
                          </div>
                        )}
                        {type === 'link' && m.link_url && (
                          <>
                            {body.trim() && (
                              <span className="chat-msg-body">{renderTextWithLinks(body.trim())}</span>
                            )}
                            <a
                              href={m.link_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="chat-msg-link-block"
                            >
                              {t.openLink}
                            </a>
                          </>
                        )}
                        {type === 'location' && (
                          <span className="chat-msg-body">
                            {m.location_label?.trim() && `${m.location_label}\n`}
                            <a
                              href={formatLocationUrl(
                                m.location_lat ?? 0,
                                m.location_lng ?? 0,
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="chat-msg-link-block"
                            >
                              {t.viewOnMap}
                            </a>
                          </span>
                        )}
                        {(type === 'image' || type === 'voice') && m.attachment_url && (
                          <>
                            {type === 'image' && (
                              <a href={m.attachment_url} target="_blank" rel="noopener noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element -- user content URL, sizing constraints */}
                                <img
                                  src={m.attachment_url}
                                  alt=""
                                  className="chat-msg-img"
                                  style={{ maxWidth: '200px', maxHeight: '200px', borderRadius: 'var(--radius)' }}
                                />
                              </a>
                            )}
                            {type === 'voice' && (
                              <audio controls src={m.attachment_url} className="chat-msg-voice" />
                            )}
                            {body.trim() && (
                              <span className="chat-msg-body">{renderTextWithLinks(body)}</span>
                            )}
                          </>
                        )}
                        {type === 'text' && body.trim() && (
                          <span className="chat-msg-body">{renderTextWithLinks(body)}</span>
                        )}
                        {type === 'link' && !m.link_url && body.trim() && (
                          <span className="chat-msg-body">{renderTextWithLinks(body)}</span>
                        )}
                        <span className="chat-msg-time">
                          {new Date(m.created_at).toLocaleTimeString(locale, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                {contextMenuPos && contextMessageId && (() => {
                  const msg = messages.find((m) => m.id === contextMessageId);
                  if (!msg) return null;
                  const isMine = msg.sender_id === authUser.id;
                  const copyText =
                    msg.message_type === 'link'
                      ? (msg.body?.trim() || msg.link_url || '')
                      : msg.message_type === 'location'
                        ? (msg.location_label?.trim() || '')
                        : msg.body ?? '';
                  return (
                    <div
                      ref={contextMenuRef}
                      className="chat-context-menu"
                      style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
                    >
                      <button
                        type="button"
                        className="chat-context-menu-btn"
                        onClick={() => {
                          setReplyingTo(msg);
                          setContextMessageId(null);
                          setContextMenuPos(null);
                        }}
                      >
                        {t.reply}
                      </button>
                      {copyText && (
                        <button
                          type="button"
                          className="chat-context-menu-btn"
                          onClick={() => handleCopyMessage(copyText)}
                        >
                          {t.copy}
                        </button>
                      )}
                      {isMine && (
                        <>
                          <button
                            type="button"
                            className="chat-context-menu-btn"
                            onClick={() => { void handleDeleteMessage(contextMessageId, 'for_me'); }}
                          >
                            {t.deleteForMe}
                          </button>
                          <button
                            type="button"
                            className="chat-context-menu-btn chat-context-menu-btn--danger"
                            onClick={() => { void handleDeleteMessage(contextMessageId, 'for_everyone'); }}
                          >
                            {t.deleteForEveryone}
                          </button>
                        </>
                      )}
                    </div>
                  );
                })()}
                {isClosed ? (
                  <div className="chat-closed-notice">{t.conversationClosed ?? 'This conversation is closed.'}</div>
                ) : (
                  <>
                    {replyingTo && (
                      <div className="chat-reply-preview">
                        <span>{t.replyingTo} {replyingTo.sender_name}</span>
                        <button
                          type="button"
                          className="chat-reply-cancel"
                          onClick={() => setReplyingTo(null)}
                          aria-label={t.cancelReply}
                        >
                          ×
                        </button>
                      </div>
                    )}
                    {shareLinkOpen && (
                      <div className="chat-share-link-row">
                        <input
                          type="url"
                          placeholder={t.pasteLinkUrl}
                          className="chat-input"
                          id="chat-share-link-url"
                        />
                        <input
                          type="text"
                          placeholder={t.optionalCaption}
                          className="chat-input"
                          id="chat-share-link-caption"
                        />
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--secondary"
                          onClick={() => setShareLinkOpen(false)}
                        >
                          {dictionary.common?.cancel ?? dictionary.common?.back ?? 'Cancel'}
                        </button>
                        <button
                          type="button"
                          className="dashboard-btn dashboard-btn--primary"
                          onClick={() => {
                            void (async () => {
                              const urlInput = document.getElementById('chat-share-link-url') as HTMLInputElement | null;
                              const capInput = document.getElementById('chat-share-link-caption') as HTMLInputElement | null;
                              const url = urlInput?.value?.trim();
                              if (!url || !accessToken || !activeConvId || sending) return;
                              setSending(true);
                              try {
                                const msg = await chatApiClient.sendMessage(accessToken, activeConvId, {
                                  messageType: 'link',
                                  linkUrl: url,
                                  body: capInput?.value?.trim() ?? '',
                                  ...(replyingTo ? { replyToId: replyingTo.id } : {}),
                                });
                                setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
                                setReplyingTo(null);
                                setShareLinkOpen(false);
                                if (urlInput) urlInput.value = '';
                                if (capInput) capInput.value = '';
                              } catch {
                                // ignore
                              } finally {
                                setSending(false);
                              }
                            })();
                          }}
                        >
                          {t.sendLink}
                        </button>
                      </div>
                    )}
                    <form
                      className="chat-input-row"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSend();
                      }}
                    >
                      <div className="chat-input-actions">
                        <button
                          type="button"
                          className="chat-action-btn"
                          onClick={() => setShareLinkOpen((v) => !v)}
                          title={t.shareLink}
                          aria-label={t.shareLink}
                        >
                          <Link2 size={18} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="chat-action-btn"
                          disabled={shareLocationLoading}
                          onClick={() => {
                            if (!accessToken || !activeConvId || sending) return;
                            setShareLocationLoading(true);
                            if (!navigator.geolocation) {
                              setShareLocationLoading(false);
                              return;
                            }
                            navigator.geolocation.getCurrentPosition(
                              (pos) => {
                                void (async () => {
                                  if (!accessToken || !activeConvId) return;
                                  try {
                                    const msg = await chatApiClient.sendMessage(accessToken, activeConvId, {
                                      messageType: 'location',
                                      lat: pos.coords.latitude,
                                      lng: pos.coords.longitude,
                                      ...(replyingTo ? { replyToId: replyingTo.id } : {}),
                                    });
                                    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
                                    setReplyingTo(null);
                                  } catch {
                                    // ignore
                                  } finally {
                                    setShareLocationLoading(false);
                                  }
                                })();
                              },
                              () => setShareLocationLoading(false),
                            );
                          }}
                          title={t.shareLocation}
                        >
                          📍
                        </button>
                      </div>
                      <input
                        type="text"
                        className="chat-input"
                        value={msgText}
                        onChange={(e) => setMsgText(e.target.value)}
                        placeholder={t.typeMessage}
                      />
                      <button
                        type="submit"
                        className="chat-send-btn"
                        disabled={sending || !msgText.trim()}
                      >
                        {t.send ?? dictionary.common.submit}
                      </button>
                    </form>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
