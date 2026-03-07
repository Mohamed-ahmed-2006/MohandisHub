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
  isAdmin: boolean;
  open: boolean;
  onClose: () => void;
};

export const AppSidebar = ({
  locale,
  dictionary,
  userRole,
  isAdmin,
  open,
  onClose,
}: AppSidebarProps) => {
  const pathname = usePathname();

  const navItems: NavItem[] = [
    { href: '/app', label: dictionary.nav.home },
    { href: '/app/settings', label: dictionary.nav.settings },
    { href: '/app/chat', label: dictionary.nav.chat },
    { href: '/app/history', label: dictionary.nav.history },
    { href: '/app/plan', label: dictionary.nav.plan },
    { href: '/app/admin', label: dictionary.nav.admin, roles: ['admin'] },
  ];

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true;
    if (item.roles.includes('admin')) return isAdmin;
    return item.roles.includes(userRole);
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
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
};
