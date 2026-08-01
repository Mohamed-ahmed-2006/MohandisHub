// ---------------------------------------------------------------------------
// Wave 2 Visual QA Mediums & Low-Risk Defect Fixes Test Suite
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

describe('Wave 2 Visual QA Medium & Low-Risk Fixes Verification', () => {
  const adminAdsTabSource = readFileSync(
    new URL('../components/admin/admin-ads-tab.tsx', import.meta.url),
    'utf8',
  );
  const myAdsCssSource = readFileSync(new URL('../app/my-ads.css', import.meta.url), 'utf8');
  const helpResolutionSource = readFileSync(
    new URL('../components/app/help-resolution-screen.tsx', import.meta.url),
    'utf8',
  );
  const supportScreenSource = readFileSync(
    new URL('../components/app/support-screen.tsx', import.meta.url),
    'utf8',
  );
  const businessTeamPanelSource = readFileSync(
    new URL('../components/app/business-team-panel.tsx', import.meta.url),
    'utf8',
  );
  const appShellSource = readFileSync(
    new URL('../components/app/app-shell.tsx', import.meta.url),
    'utf8',
  );

  // ---------------------------------------------------------------------------
  // W2-01: Advertisement Admin Status Filter
  // ---------------------------------------------------------------------------
  describe('W2-01: Admin Advertisement Status Filter', () => {
    it('includes pending_payment option in the status filter dropdown', () => {
      expect(adminAdsTabSource).toContain('value="pending_payment"');
      expect(adminAdsTabSource).toContain('statusPendingPayment');
    });
  });

  // ---------------------------------------------------------------------------
  // W2-02: Raw Advertisement Status Token & Fallback
  // ---------------------------------------------------------------------------
  describe('W2-02: Localized Advertisement Status & Fallback', () => {
    it('renders mapped localized status labels and has safe fallback for unknown status', () => {
      expect(adminAdsTabSource).toContain('statusLabels: Record<string, string>');
      expect(adminAdsTabSource).toContain('statusLabels[ad.status]');
      expect(adminAdsTabSource).toContain("ad.status.replace(/_/g, ' ')");
    });
  });

  // ---------------------------------------------------------------------------
  // W2-03: Advertisement Admin Dialogs Focus Trap & Accessibility
  // ---------------------------------------------------------------------------
  describe('W2-03: Admin Ads Modal Dialogs Accessibility', () => {
    it('defines role="dialog", aria-modal="true", and aria-labelledby on admin modals', () => {
      expect(adminAdsTabSource).toContain('role="dialog"');
      expect(adminAdsTabSource).toContain('aria-modal="true"');
      expect(adminAdsTabSource).toContain('aria-labelledby="schedule-ad-modal-title"');
      expect(adminAdsTabSource).toContain('aria-labelledby="pricing-ad-modal-title"');
      expect(adminAdsTabSource).toContain('aria-labelledby="reject-ad-modal-title"');
    });

    it('implements focus trap, Escape handler, initial focus, and focus restoration ref', () => {
      expect(adminAdsTabSource).toContain('previousFocusRef');
      expect(adminAdsTabSource).toContain('activeModalRef');
      expect(adminAdsTabSource).toContain("event.key === 'Escape'");
      expect(adminAdsTabSource).toContain("event.key !== 'Tab'");
      expect(adminAdsTabSource).toContain('initialTarget?.focus()');
    });
  });

  // ---------------------------------------------------------------------------
  // W2-05: Provider Advertisement RTL Control Inset Property
  // ---------------------------------------------------------------------------
  describe('W2-05: Provider Advertisement RTL Image Remove Button', () => {
    it('uses logical inset-inline-end property instead of physical right', () => {
      expect(myAdsCssSource).toContain('.myads-upload-remove');
      expect(myAdsCssSource).toContain('inset-inline-end: 0.5rem;');
      expect(myAdsCssSource).not.toMatch(/\.myads-upload-remove\s*\{[^}]*right:\s*0\.5rem;/);
    });
  });

  // ---------------------------------------------------------------------------
  // W2-10: Help & Resolution Direct Stylesheet Import
  // ---------------------------------------------------------------------------
  describe('W2-10: Help & Resolution Stylesheet Import', () => {
    it('imports case-thread.css directly in help-resolution-screen.tsx', () => {
      expect(helpResolutionSource).toContain("import './case-thread.css';");
    });
  });

  // ---------------------------------------------------------------------------
  // W2-11: New-Case Dialog Accessibility & Focus Trap
  // ---------------------------------------------------------------------------
  describe('W2-11: New-Case Dialog Accessibility & Focus Trap', () => {
    it('defines dialog accessibility attributes, focus trap, Escape closing, and focus restoration', () => {
      expect(helpResolutionSource).toContain('role="dialog"');
      expect(helpResolutionSource).toContain('aria-modal="true"');
      expect(helpResolutionSource).toContain('aria-labelledby="hr-modal-title"');
      expect(helpResolutionSource).toContain('previousFocusRef');
      expect(helpResolutionSource).toContain('createCaseButtonRef');
      expect(helpResolutionSource).toContain("event.key === 'Escape'");
      expect(helpResolutionSource).toContain("event.key !== 'Tab'");
    });
  });

  // ---------------------------------------------------------------------------
  // W2-12: User-Facing Wording & Notice Sanitization
  // ---------------------------------------------------------------------------
  describe('W2-12: User-Facing Product Wording Sanitization', () => {
    it('sanitizes notices to remove internal API paths, route names, and raw enum tokens', () => {
      expect(helpResolutionSource).toContain('sanitizeUserNotice');
      expect(helpResolutionSource).toContain("rawMessage.includes('/api/')");
      expect(helpResolutionSource).toContain("rawMessage.includes('Contract:')");
      expect(helpResolutionSource).toContain("rawMessage.includes('need_job_dispute')");
      expect(helpResolutionSource).not.toContain('POST /api/v1/help-resolution/job-disputes');
    });
  });

  // ---------------------------------------------------------------------------
  // W2-18: Business Team Permission Keys Localization
  // ---------------------------------------------------------------------------
  describe('W2-18: Business Team Permission Keys Localization', () => {
    it('maps permission machine keys to human-readable localized labels and keeps deferred permissions disabled', () => {
      expect(businessTeamPanelSource).toContain('permissionLabels: Record<string');
      expect(businessTeamPanelSource).toContain("en: 'Manage Support & Disputes'");
      expect(businessTeamPanelSource).toContain("ar: 'إدارة الدعم والنزاعات'");
      expect(businessTeamPanelSource).toContain("en: 'Manage Services'");
      expect(businessTeamPanelSource).toContain("en: 'View Analytics'");
      expect(businessTeamPanelSource).toContain('team-permission-chip--deferred');
      expect(businessTeamPanelSource).toContain('disabled={!isEnforced}');
    });
  });

  // ---------------------------------------------------------------------------
  // W2-19: Member Display Name Fallback (No UUID Fragment Exposure)
  // ---------------------------------------------------------------------------
  describe('W2-19: Member Display Name Safe Fallback', () => {
    it('uses safe product name fallback without exposing userId.slice(0, 8) fragments', () => {
      expect(businessTeamPanelSource).not.toContain('member.userId.slice(0, 8)');
      expect(businessTeamPanelSource).toContain(
        "member.displayName ?? member.email ?? tr('Team member', 'عضو في الفريق')",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Additional Low-Risk Corrections: Safety Translation, Chevron & Inset
  // ---------------------------------------------------------------------------
  describe('Additional Low-Risk Corrections', () => {
    it('verifies Arabic Safety translation is Safety and Payments (السلامة والمدفوعات), not Policy (السياسة)', () => {
      expect(arDictionary.helpResolutionPage?.safetyAndPayments).toBe('السلامة والمدفوعات');
      expect(enDictionary.helpResolutionPage?.safetyAndPayments).toBe('Safety & payments');
    });

    it('renders direction-aware back chevron in RTL mobile views', () => {
      expect(helpResolutionSource).toContain('ChevronRight');
      expect(helpResolutionSource).toContain(
        '<ChevronRight size={18} className="support-thread__back-icon"',
      );
      expect(supportScreenSource).toContain('<ChevronRight size={18} aria-hidden');
    });

    it('replaces physical right positioning with logical insetInlineEnd in app-shell toast', () => {
      expect(appShellSource).toContain("insetInlineEnd: '20px'");
      expect(appShellSource).not.toContain("right: '20px'");
    });
  });
});
