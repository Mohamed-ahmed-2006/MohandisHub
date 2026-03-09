'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { SiteLogo } from '@/components/site-logo';
import { getChatSocket } from '@/lib/chat/socket';
import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type NavItem = {
  href: string;
  label: string;
  roles?: string[];
};

type AppSidebarProps = {
  locale: Locale;
  dictionary: Dictionary;
  userRole: string;
  isAdmin: boolean;
  accessToken: string | undefined;
  open: boolean;
  onClose: () => void;
};

export const AppSidebar = ({
  locale,
  dictionary,
  userRole,
  isAdmin,
  accessToken,
  open,
  onClose,
}: AppSidebarProps) => {
  const pathname = usePathname();
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [hasUnreadJobs, setHasUnreadJobs] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    const sock = getChatSocket(accessToken);
    if (!sock) return;

    const onNotification = (data: { type?: string }) => {
      if (data.type === 'new_message' || data.type === 'new_application_message') {
        setHasUnreadChat(true);
      } else {
        setHasUnreadJobs(true);
      }
    };

    sock.on('notification', onNotification);
    return () => {
      sock.off('notification', onNotification);
    };
  }, [accessToken]);

  // Clear unread when visiting the pages
  useEffect(() => {
    if (pathname.includes('/app/chat')) setHasUnreadChat(false);
    if (pathname === '/app') setHasUnreadJobs(false);
  }, [pathname]);

  const navItems: NavItem[] = [
    { href: '/app', label: dictionary.nav.home },
    { href: '/app/bookings', label: dictionary.nav.bookings ?? 'My Bookings' },
    { href: '/app/services', label: dictionary.nav.myServices ?? 'My Services', roles: ['expert', 'business'] },
    { href: '/app/calendar', label: dictionary.nav.calendar ?? 'Calendar', roles: ['expert', 'business'] },
    { href: '/app/settings', label: dictionary.nav.settings },
    { href: '/app/chat', label: dictionary.nav.chat },
    { href: '/app/history', label: dictionary.nav.history },
    { href: '/app/plan', label: dictionary.nav.plan },
    { href: '/app/admin', label: dictionary.nav.admin, roles: ['admin'] },
  ];

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true;
    if (item.roles.includes('admin')) return isAdmin;
    return item.roles.some((r) => r === userRole);
  });

  const isActive = (href: string) => {
    const full = buildLocalePath(locale, href);
    if (href === '/app') return pathname === full;
    return pathname.startsWith(full);
  };

  return (
    <>
      {open && (
        <div
          className="app-sidebar-backdrop"
          onClick={onClose}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          role="button"
          tabIndex={-1}
          aria-label={dictionary.nav.menuClose}
        />
      )}

      <aside className={`app-sidebar ${open ? 'app-sidebar--open' : ''}`}>
        <div className="app-sidebar-header">
          <Link href={buildLocalePath(locale, '/')} className="app-sidebar-brand" onClick={onClose}>
            <SiteLogo />
          </Link>
        </div>

        <nav className="app-sidebar-nav">
          {visibleItems.map((item) => (
            <Link
              key={`${item.href}-${item.label}`}
              href={buildLocalePath(locale, item.href)}
              className={`app-sidebar-link ${isActive(item.href) ? 'app-sidebar-link--active' : ''}`}
              onClick={onClose}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
              {item.label}
              {item.href === '/app/chat' && hasUnreadChat && (
                <span style={{ width: '8px', height: '8px', background: '#ef4444', borderRadius: '50%' }} />
              )}
              {item.href === '/app' && hasUnreadJobs && (
                <span style={{ width: '8px', height: '8px', background: '#3b82f6', borderRadius: '50%' }} />
              )}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};
