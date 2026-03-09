'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { Container } from '@/components/ui/container';
import type { Conversation, Message } from '@/lib/chat/client';
import { chatApiClient } from '@/lib/chat/client';
import { getChatSocket } from '@/lib/chat/socket';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

import './chat-screen.css';

type Props = { locale: Locale; dictionary: Dictionary };

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
  const messagesEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!activeConvId || !accessToken) return;
    const sock = getChatSocket(accessToken);
    if (!sock) return;
    sock.emit('join_conversation', { conversationId: activeConvId });
    const onNewMessage = (msg: Message) => {
      if (msg.conversation_id === activeConvId) {
        // #region agent log
        fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'40e02a'},body:JSON.stringify({sessionId:'40e02a',location:'chat-screen.tsx:socket-new_message',message:'Socket new_message received',data:{msgId:msg.id,hypothesisId:'H6'},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        setMessages((prev) => {
          const hasDup = prev.some((m) => m.id === msg.id);
          const willAdd = !hasDup;
          // #region agent log
          fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'40e02a'},body:JSON.stringify({sessionId:'40e02a',location:'chat-screen.tsx:socket-setMessages',message:'Socket adding message',data:{msgId:msg.id,prevCount:prev.length,hasDup,willAdd,hypothesisId:'H6'},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
          return hasDup ? prev : [...prev, msg];
        });
      }
    };
    sock.on('new_message', onNewMessage);
    return () => {
      sock.emit('leave_conversation', { conversationId: activeConvId });
      sock.off('new_message', onNewMessage);
    };
  }, [activeConvId, accessToken]);

  const handleSend = async () => {
    if (!accessToken || !activeConvId || !msgText.trim() || sending) return;
    setSending(true);
    try {
      const msg = await chatApiClient.sendMessage(accessToken, activeConvId, msgText.trim());
      // #region agent log
      fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'40e02a'},body:JSON.stringify({sessionId:'40e02a',location:'chat-screen.tsx:handleSend',message:'API returned message, adding to state',data:{msgId:msg.id,hypothesisId:'H6'},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      setMessages((prev) => {
        const hasDup = prev.some((m) => m.id === msg.id);
        // #region agent log
        fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'40e02a'},body:JSON.stringify({sessionId:'40e02a',location:'chat-screen.tsx:handleSend-setMessages',message:'API adding message',data:{msgId:msg.id,prevCount:prev.length,hasDup,hypothesisId:'H6'},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return hasDup ? prev : [...prev, msg];
      });
      setMsgText('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
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

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const isClosed = convStatus === 'closed';

  return (
    <main className="chat-screen-main">
      <Container className="chat-screen-container">
        <h1 className="chat-screen-title">{dictionary.nav.chat}</h1>

        <div className="chat-layout">
          <aside className="chat-sidebar">
            {loading ? (
              <p className="chat-loading">{dictionary.admin?.loading ?? 'Loading...'}</p>
            ) : conversations.length === 0 ? (
              <p className="chat-empty">No conversations yet.</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className={`chat-conv-item ${conv.id === activeConvId ? 'chat-conv-item--active' : ''}`}
                  onClick={() => openConv(conv.id)}
                >
                  <span className="chat-conv-name">{conv.other_display_name}</span>
                  {conv.last_message_body && (
                    <span className="chat-conv-preview" style={{ fontWeight: conv.has_unread ? 700 : 400 }}>
                      {conv.last_message_body}
                    </span>
                  )}
                  {conv.has_unread && <span className="chat-conv-badge" style={{ background: 'hsl(var(--destructive))', color: '#fff' }}>New</span>}
                  {conv.status === 'closed' && <span className="chat-conv-badge">Closed</span>}
                </button>
              ))
            )}
          </aside>

          <section className="chat-messages-area">
            {!activeConvId ? (
              <p className="chat-no-conv">Select a conversation to start chatting.</p>
            ) : (
              <>
                {activeConv && (
                  <div className="chat-messages-header">
                    <strong>{activeConv.other_display_name}</strong>
                    {isClosed && <span className="chat-closed-badge">Closed</span>}
                  </div>
                )}
                <div className="chat-messages-list">
                  {(() => {
                    const ids = messages.map((m) => m.id);
                    const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
                    if (dupIds.length > 0) {
                      fetch('http://127.0.0.1:7325/ingest/ebd08bf8-7d73-450c-ad4d-4436a6c2225b',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'40e02a'},body:JSON.stringify({sessionId:'40e02a',location:'chat-screen.tsx:render-messages',message:'Duplicate message ids in render',data:{dupIds,msgCount:messages.length,hypothesisId:'H6'},timestamp:Date.now()})}).catch(()=>{});
                    }
                    return null;
                  })()}
                  {messages.map((m) => {
                    const isMine = m.sender_id === authUser.id;
                    return (
                      <div
                        key={m.id}
                        className={`chat-msg ${isMine ? 'chat-msg--mine' : 'chat-msg--other'}`}
                      >
                        <span className="chat-msg-body">{m.body}</span>
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
                {isClosed ? (
                  <div className="chat-closed-notice">This conversation is closed.</div>
                ) : (
                  <form
                    className="chat-input-row"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSend();
                    }}
                  >
                    <input
                      type="text"
                      className="chat-input"
                      value={msgText}
                      onChange={(e) => setMsgText(e.target.value)}
                      placeholder="Type a message..."
                    />
                    <button
                      type="submit"
                      className="chat-send-btn"
                      disabled={sending || !msgText.trim()}
                    >
                      Send
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </Container>
    </main>
  );
};
