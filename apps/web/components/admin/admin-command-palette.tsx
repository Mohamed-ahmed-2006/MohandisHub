'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Locale } from '@/lib/i18n/types';

import './admin-command-palette.css';

type TabId =
  | 'dashboard'
  | 'users'
  | 'plans'
  | 'coupons'
  | 'transactions'
  | 'moneyAudit'
  | 'walletRails'
  | 'disputes'
  | 'services'
  | 'categories'
  | 'verifications'
  | 'reviewReports'
  | 'support'
  | 'notifications'
  | 'settings'
  | 'operations'
  | 'retention'
  | 'media'
  | 'ads';

type AdminCommandPaletteProps = {
  isOpen: boolean;
  onClose: () => void;
  onSelectTab: (tabId: TabId) => void;
  tabs: Array<{ id: TabId; label: string }>;
  locale: Locale;
};

export const AdminCommandPalette = ({
  isOpen,
  onClose,
  onSelectTab,
  tabs,
  locale,
}: AdminCommandPaletteProps) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredTabs = tabs.filter((t) =>
    t.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery('');
        return;
      }

      if (!isOpen) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredTabs.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(
          (prev) => (prev - 1 + filteredTabs.length) % Math.max(1, filteredTabs.length),
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filteredTabs[selectedIndex];
        if (selected) {
          onSelectTab(selected.id);
          onClose();
        }
      }
    },
    [isOpen, onClose, filteredTabs, selectedIndex, onSelectTab],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  if (!isOpen) return null;

  const isAr = locale === 'ar';

  return (
    <div className="admin-cmd-overlay" onClick={onClose}>
      <div className="admin-cmd-box" onClick={(e) => e.stopPropagation()}>
        <div className="admin-cmd-header">
          <span className="admin-cmd-icon">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="text"
            className="admin-cmd-input"
            placeholder={
              isAr ? 'ابحث عن قسم أو إجراء إداري... (Ctrl + K)' : 'Search admin tabs or commands... (Ctrl + K)'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <span className="admin-cmd-shortcut-badge">ESC</span>
        </div>

        <div className="admin-cmd-list">
          <div className="admin-cmd-section-title">
            {isAr ? 'الأقسام الإدارية' : 'Admin Navigation'}
          </div>
          {filteredTabs.length === 0 ? (
            <div className="admin-cmd-item" style={{ cursor: 'default', opacity: 0.6 }}>
              <span>{isAr ? 'لا توجد نتائج مطابقة' : 'No matching tabs found.'}</span>
            </div>
          ) : (
            filteredTabs.map((tab, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={tab.id}
                  type="button"
                  className={`admin-cmd-item ${isSelected ? 'admin-cmd-item--selected' : ''}`}
                  onClick={() => {
                    onSelectTab(tab.id);
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div className="admin-cmd-item-left">
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                    </svg>
                    <span className="admin-cmd-item-label">{tab.label}</span>
                  </div>
                  <span className="admin-cmd-item-tag">{isAr ? 'انتقال' : 'Jump to tab'}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="admin-cmd-footer">
          <span>{isAr ? 'استخدم ↵ للانتقال · ↑↓ للتنقل' : 'Use ↵ to jump · ↑↓ to navigate'}</span>
          <span>MohandisHub Admin Engine</span>
        </div>
      </div>
    </div>
  );
};
