'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useAppStatus } from '@/components/app-status-provider';
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
  const { status } = useAppStatus();
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [hasUnreadJobs, setHasUnreadJobs] = useState(false);
  const [hasUnreadBookings, setHasUnreadBookings] = useState(false);
  const [hasUnreadNegotiations, setHasUnreadNegotiations] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let activeSocket: Awaited<ReturnType<typeof getChatSocket>> | null = null;
    const onNotification = (data: { type?: string }) => {
      const type = data.type ?? '';
      if (type === 'new_message' || type === 'new_application_message' || type === 'chat_message') {
        setHasUnreadChat(true);
        return;
      }
      if (type.startsWith('reservation_')) {
        setHasUnreadBookings(true);
        return;
      }
      if (type === 'price_negotiation') {
        setHasUnreadNegotiations(true);
        return;
      }
      if (
        type.startsWith('job_') ||
        type === 'application_status' ||
        type.startsWith('milestone_') ||
        type.startsWith('need_bid_') ||
        type === 'need_closed' ||
        type.startsWith('service_') ||
        type.startsWith('review_')
      ) {
        setHasUnreadJobs(true);
        return;
      }
      setHasUnreadJobs(true);
    };
    void getChatSocket(accessToken).then((sock) => {
      if (!sock) return;
      activeSocket = sock;
      sock.on('notification', onNotification);
    });
    return () => {
      if (activeSocket) activeSocket.off('notification', onNotification);
    };
  }, [accessToken]);

  // Clear unread when visiting the pages (pathname is locale-prefixed e.g. /en/app, /ar/app/chat)
  useEffect(() => {
    if (pathname.includes('/app/chat')) setHasUnreadChat(false);
    if (pathname === buildLocalePath(locale, '/app')) setHasUnreadJobs(false);
    if (pathname.includes('/app/bookings')) setHasUnreadBookings(false);
    if (pathname.includes('/app/negotiations')) setHasUnreadNegotiations(false);
  }, [pathname, locale]);

  const navItems: NavItem[] = [
    { href: '/app', label: dictionary.nav.home },
    { href: '/app/bookings', label: dictionary.nav.bookings },
    {
      href: '/app/services',
      label: dictionary.nav.myCatalogue ?? dictionary.nav.myServices ?? 'My Catalogue',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/projects',
      label: dictionary.nav.hiring ?? dictionary.nav.projects ?? 'Hiring',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/credits',
      label: dictionary.nav.credits ?? 'MHC Credits',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/analytics',
      label: dictionary.nav.analytics ?? 'Analytics',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/negotiations',
      label: dictionary.nav.negotiations ?? 'Price negotiations',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/advertisements',
      label: dictionary.nav.advertisements ?? 'My Ads',
      roles: ['expert', 'craftsman', 'business'],
    },
    {
      href: '/app/calendar',
      label: dictionary.nav.calendar ?? dictionary.calendarPage?.title ?? dictionary.nav.home,
      roles: ['expert', 'craftsman', 'business'],
    },
    { href: '/app/settings', label: dictionary.nav.settings },
    { href: '/app/chat', label: dictionary.nav.chat },
    { href: '/app/history', label: dictionary.nav.history },
    {
      href: '/app/help-resolution',
      label: dictionary.nav.helpResolution ?? dictionary.nav.support,
    },
    { href: '/app/plan', label: dictionary.nav.plan },
    { href: '/app/admin', label: dictionary.nav.admin, roles: ['admin'] },
  ];

  const hiddenHrefs = status?.sidebarHiddenHrefs ?? [];

  /**
   * Support and Disputes are one screen now, so an admin's old choice to hide
   * one of them no longer maps onto a single entry. Hiding the merged entry
   * requires that BOTH legacy entries were hidden: closing an entry an admin
   * left open would take away access people still have, and that is the worse
   * of the two ways to get this wrong.
   */
  const helpResolutionHidden =
    hiddenHrefs.includes('/app/help-resolution') ||
    (hiddenHrefs.includes('/app/support') && hiddenHrefs.includes('/app/disputes'));

  const visibleItems = navItems.filter((item) => {
    if (item.href === '/app/help-resolution') return !helpResolutionHidden;
    if (hiddenHrefs.includes(item.href)) return false;
    if (item.href === '/app/plan' && status?.featurePlansEnabled === false) return false;
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
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    background: '#ef4444',
                    borderRadius: '50%',
                  }}
                />
              )}
              {item.href === '/app' && hasUnreadJobs && (
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    background: '#3b82f6',
                    borderRadius: '50%',
                  }}
                />
              )}
              {item.href === '/app/bookings' && hasUnreadBookings && (
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    background: '#f97316',
                    borderRadius: '50%',
                  }}
                />
              )}
              {item.href === '/app/negotiations' && hasUnreadNegotiations && (
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    background: '#a855f7',
                    borderRadius: '50%',
                  }}
                />
              )}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};
