'use client';

import type { JobApplicationMessage } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/auth-provider';
import { getChatSocket } from '@/lib/chat/socket';
import { jobsApiClient } from '@/lib/jobs/client';

type Props = {
  applicationId: string;
};

export const ApplicationChat = ({ applicationId }: Props) => {
  const { accessToken, authUser } = useAuth();
  const [messages, setMessages] = useState<JobApplicationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [msgText, setMsgText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await jobsApiClient.getApplicationMessages(accessToken, applicationId);
      setMessages(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [accessToken, applicationId]);

  useEffect(() => {
    void loadMessages();
    const sock = getChatSocket();
    if (!sock) return;

    sock.emit('join_application', { applicationId });

    const onNewMessage = (msg: JobApplicationMessage) => {
      if (msg.jobApplicationId === applicationId) {
        setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
      }
    };
    
    sock.on('new_application_message', onNewMessage);

    return () => {
      sock.emit('leave_application', { applicationId });
      sock.off('new_application_message', onNewMessage);
    };
  }, [loadMessages, applicationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !msgText.trim() || sending) return;
    setSending(true);
    try {
      const newMsg = await jobsApiClient.sendApplicationMessage(accessToken, applicationId, msgText.trim());
      setMessages(prev => [...prev, newMsg]);
      setMsgText('');
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div style={{ padding: '1rem' }}>Loading chat...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '400px', border: '1px solid #ddd', borderRadius: '8px', background: '#fff', overflow: 'hidden', marginTop: '1rem' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {messages.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#888', marginTop: 'auto', marginBottom: 'auto' }}>No messages yet. Start the conversation!</p>
        ) : (
          messages.map(m => {
            const isMine = m.senderId === authUser?.id;
            return (
              <div key={m.id} style={{ alignSelf: isMine ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                <div style={{ 
                  background: isMine ? 'hsl(var(--primary))' : '#f1f1f1', 
                  color: isMine ? '#fff' : '#333', 
                  padding: '0.5rem 1rem', 
                  borderRadius: '16px', 
                  borderBottomRightRadius: isMine ? '4px' : '16px',
                  borderBottomLeftRadius: isMine ? '16px' : '4px',
                }}>
                  {m.content}
                </div>
                <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '0.2rem', textAlign: isMine ? 'right' : 'left' }}>
                  {m.senderName} • {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={(e) => void handleSend(e)} style={{ display: 'flex', padding: '0.75rem', borderTop: '1px solid #ddd', background: '#fafafa', gap: '0.5rem' }}>
        <input 
          type="text" 
          value={msgText} 
          onChange={e => setMsgText(e.target.value)} 
          placeholder="Type a message..." 
          style={{ flex: 1, padding: '0.5rem 1rem', borderRadius: '20px', border: '1px solid #ccc', outline: 'none' }}
        />
        <button type="submit" disabled={sending || !msgText.trim()} style={{ background: 'hsl(var(--primary))', color: '#fff', border: 'none', borderRadius: '20px', padding: '0.5rem 1rem', cursor: 'pointer', opacity: (sending || !msgText.trim()) ? 0.6 : 1 }}>
          Send
        </button>
      </form>
    </div>
  );
};
