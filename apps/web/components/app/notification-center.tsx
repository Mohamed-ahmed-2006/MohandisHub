'use client';

import type { Notification as NotificationType, NotificationPayload } from '@mohandishub/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { getChatSocket } from '@/lib/chat/socket';
import type { Dictionary } from '@/lib/i18n/types';
import { notificationsApiClient } from '@/lib/notifications/client';

type Props = {
  accessToken: string;
  dictionary: Dictionary;
};

function formatTime(
  iso: string,
  t: Dictionary['notificationCenter'],
): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return t.justNow;
  if (diffMins < 60) return t.timeAgoMinutes.replace('{n}', String(diffMins));
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return t.timeAgoHours.replace('{n}', String(diffHours));
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return t.timeAgoDays.replace('{n}', String(diffDays));
  return d.toLocaleDateString();
}

export function NotificationCenter({ accessToken, dictionary }: Props) {
  const t = dictionary.notificationCenter;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationType[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sendingDemo, setSendingDemo] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const data = await notificationsApiClient.getUnreadCount(accessToken);
      setUnreadCount(data.unreadCount);
    } catch {
      setUnreadCount(0);
    }
  }, [accessToken]);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationsApiClient.getNotifications(accessToken, { page: 1, limit: 20 });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void fetchUnreadCount();
  }, [fetchUnreadCount]);

  useEffect(() => {
    if (!accessToken) return;
    getChatSocket(accessToken).then((sock) => {
      if (!sock) return;
      const onNotification = () => {
        void fetchUnreadCount();
        if (open) void fetchList();
      };
      sock.on('notification', onNotification);
    });
    return () => {
      void getChatSocket(accessToken).then((sock) => {
        if (sock) sock.off('notification');
      });
    };
  }, [accessToken, open, fetchUnreadCount, fetchList]);

  useEffect(() => {
    if (open) void fetchList();
  }, [open, fetchList]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [open]);

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      try {
        await notificationsApiClient.markAsRead(accessToken, id);
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    },
    [accessToken],
  );

  const handleMarkAllAsRead = useCallback(async () => {
    try {
      await notificationsApiClient.markAllAsRead(accessToken);
      setUnreadCount(0);
      setItems((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })),
      );
    } catch {
      /* ignore */
    }
  }, [accessToken]);

  const handleSendDemo = useCallback(async () => {
    setSendingDemo(true);
    try {
      const created = await notificationsApiClient.sendDemo(accessToken);
      const newItem: NotificationType = {
        id: created.id,
        userId: (created as { userId?: string }).userId ?? '',
        type: created.type as NotificationType['type'],
        title: created.title,
        message: created.message,
        payload:
          ((created as { payload?: NotificationPayload | null }).payload) ??
          null,
        readAt: created.readAt ?? null,
        createdAt: created.createdAt,
      };
      setItems((prev) => [newItem, ...prev]);
      setUnreadCount((c) => c + 1);
      if (created.id !== 'stub-no-table') {
        void fetchUnreadCount();
        if (open) void fetchList();
      }
    } catch {
      /* ignore */
    } finally {
      setSendingDemo(false);
    }
  }, [accessToken, open, fetchUnreadCount, fetchList]);

  return (
    <div className="app-notification-center" ref={dropdownRef}>
      <button
        type="button"
        className="app-notification-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? t.ariaUnread.replace('{count}', String(unreadCount)) : t.ariaNotifications}
        aria-expanded={open}
      >
        <svg
          className="app-notification-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="app-notification-badge" aria-hidden>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="app-notification-dropdown" role="dialog" aria-label={t.ariaNotifications}>
          <div className="app-notification-dropdown-header">
            <span className="app-notification-dropdown-title">{t.title}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                className="app-notification-mark-all"
                onClick={() => void handleMarkAllAsRead()}
              >
                {t.markAllRead}
              </button>
            )}
          </div>
          <div className="app-notification-list">
            {loading ? (
              <p className="app-notification-empty">{t.loading}</p>
            ) : items.length === 0 ? (
              <p className="app-notification-empty">{t.empty}</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className={`app-notification-item ${n.readAt ? '' : 'app-notification-item--unread'}`}
                  onClick={() => {
                    if (!n.readAt) void handleMarkAsRead(n.id);
                  }}
                >
                  <span className="app-notification-item-title">{n.title}</span>
                  <span className="app-notification-item-message">{n.message}</span>
                  <span className="app-notification-item-time">{formatTime(n.createdAt, t)}</span>
                </button>
              ))
            )}
          </div>
          <div className="app-notification-dropdown-footer">
            <button
              type="button"
              className="app-notification-send-demo"
              onClick={() => void handleSendDemo()}
              disabled={sendingDemo}
            >
              {sendingDemo ? t.loading : t.sendDemo}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
