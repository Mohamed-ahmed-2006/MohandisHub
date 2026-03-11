'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { buildLocalePath } from '@/lib/i18n/path';
import type { Dictionary, Locale } from '@/lib/i18n/types';

type AppAvatarMenuProps = {
  locale: Locale;
  dictionary: Dictionary;
  displayName: string;
  email: string;
  role: string;
  onLogout: () => void;
};

export const AppAvatarMenu = ({
  locale,
  dictionary,
  displayName,
  email,
  role,
  onLogout,
}: AppAvatarMenuProps) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const initials = displayName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const roleLabel = dictionary.auth.roles[role as keyof typeof dictionary.auth.roles] ?? role;

  return (
    <div className="app-avatar-menu" ref={ref}>
      <button
        type="button"
        className="app-avatar-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="app-avatar-circle">{initials}</span>
      </button>

      {open && (
        <div className="app-avatar-dropdown" role="menu">
          <div className="app-avatar-dropdown-header">
            <span className="app-avatar-dropdown-name">{displayName}</span>
            <span className="app-avatar-dropdown-email">{email}</span>
            <span className="app-avatar-dropdown-role">{roleLabel}</span>
          </div>

          <div className="app-avatar-dropdown-divider" />

          <Link
            href={buildLocalePath(locale, '/app/settings')}
            className="app-avatar-dropdown-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {dictionary.nav.settings}
          </Link>
          <Link
            href={buildLocalePath(locale, '/app/settings/wallet')}
            className="app-avatar-dropdown-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {dictionary.wallet.balance}
          </Link>
          <Link
            href={buildLocalePath(locale, '/app/plan')}
            className="app-avatar-dropdown-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            {dictionary.nav.upgradePlan}
          </Link>

          <div className="app-avatar-dropdown-divider" />

          <button
            type="button"
            className="app-avatar-dropdown-item app-avatar-dropdown-logout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            {dictionary.nav.logout}
          </button>
        </div>
      )}
    </div>
  );
};
