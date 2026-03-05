'use client';

import type { UserRole } from '@mohandishub/shared';
import { useState } from 'react';

type TopBarDictionary = {
  roleLabel: string;
  profile: string;
  settings: string;
  logout: string;
  balanceTitle: string;
  balanceTopUp: string;
  balanceStubNote: string;
};

type TopBarProps = {
  appName: string;
  role: UserRole;
  roleTitle: string;
  dictionary: TopBarDictionary;
  onLogout: () => Promise<void>;
};

export const TopBar = ({ appName, role, roleTitle, dictionary, onLogout }: TopBarProps) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await onLogout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  return (
    <header className="app-home-topbar">
      <div className="app-home-brand-block">
        <strong className="app-home-brand">{appName}</strong>
        <span className="app-home-role-badge">
          {dictionary.roleLabel}: {roleTitle} ({role})
        </span>
      </div>

      <div className="app-home-topbar-actions">
        <div className="app-home-balance-card">
          <p className="app-home-balance-title">{dictionary.balanceTitle}</p>
          <p className="app-home-balance-value">EGP 0.00</p>
          <button type="button" className="app-home-balance-button" disabled>
            {dictionary.balanceTopUp}
          </button>
          <p className="app-home-balance-note">{dictionary.balanceStubNote}</p>
        </div>

        <div className="app-home-profile-menu">
          <button
            type="button"
            className="app-home-profile-trigger"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
          >
            {dictionary.profile}
          </button>

          {menuOpen ? (
            <div className="app-home-profile-dropdown">
              <a href="#" className="app-home-profile-link">
                {dictionary.profile}
              </a>
              <a href="#" className="app-home-profile-link">
                {dictionary.settings}
              </a>
              <button
                type="button"
                className="app-home-profile-logout"
                onClick={() => void handleLogout()}
                disabled={isLoggingOut}
              >
                {dictionary.logout}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};
