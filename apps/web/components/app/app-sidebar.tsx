'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SiteLogo } from '@/components/site-logo';
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
  open: boolean;
  onClose: () => void;
};

export const AppSidebar = ({ locale, dictionary, userRole, open, onClose }: AppSidebarProps) => {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { href: '/app', label: dictionary.nav.home },
    { href: '/app/profile', label: dictionary.nav.profile },
    { href: '/app/browse', label: dictionary.nav.browse },
    { href: '/app/bookings', label: dictionary.nav.bookings },
    { href: '/app/projects', label: dictionary.nav.projects },
    { href: '/app/chat', label: dictionary.nav.chat },
    { href: '/app/admin', label: dictionary.nav.admin, roles: ['admin'] },
    { href: '/app/plan', label: dictionary.nav.plan },
  ];

  const visibleItems = navItems.filter((item) => !item.roles || item.roles.includes(userRole));

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
              key={item.href}
              href={buildLocalePath(locale, item.href)}
              className={`app-sidebar-link ${isActive(item.href) ? 'app-sidebar-link--active' : ''}`}
              onClick={onClose}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};
