'use client';

import { useAppStatus } from '@/components/app-status-provider';

export const GlobalAnnouncementBanner = () => {
  const { status } = useAppStatus();
  const message = status?.globalAnnouncement?.trim();

  if (!message) return null;

  return (
    <div
      role="status"
      style={{
        width: '100%',
        padding: '0.625rem 1rem',
        textAlign: 'center',
        background: 'hsl(var(--primary) / 0.16)',
        borderBottom: '1px solid hsl(var(--primary) / 0.28)',
        color: 'hsl(var(--foreground))',
        fontSize: '0.9rem',
        fontWeight: 600,
      }}
    >
      {message}
    </div>
  );
};
