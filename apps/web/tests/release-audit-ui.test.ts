import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { arDictionary } from '@/lib/i18n/dictionaries/ar';
import { enDictionary } from '@/lib/i18n/dictionaries/en';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// Regression coverage for the release-audit-ui pass. Each assertion pins a
// user-facing defect that was fixed so it cannot silently regress.
describe('release-audit-ui fixes', () => {
  it('localizes the InstaPay deposit sender/reference fields in both dictionaries', () => {
    for (const dict of [enDictionary, arDictionary]) {
      expect(dict.wallet.instapaySenderLabel).toBeTruthy();
      expect(dict.wallet.instapaySenderPlaceholder).toBeTruthy();
      expect(dict.wallet.instapaySenderRequired).toBeTruthy();
      expect(dict.wallet.instapayReferenceLabel).toBeTruthy();
      expect(dict.wallet.instapayReferencePlaceholder).toBeTruthy();
    }
    // Arabic must not fall back to the English source strings.
    expect(arDictionary.wallet.instapaySenderLabel).not.toBe(
      enDictionary.wallet.instapaySenderLabel,
    );
    expect(arDictionary.wallet.instapayReferenceLabel).not.toBe(
      enDictionary.wallet.instapayReferenceLabel,
    );
  });

  it('drives the InstaPay deposit form from the dictionary, not hardcoded English', () => {
    const modal = read('components/app/wallet-deposit-modal.tsx');
    expect(modal).toContain('d.instapaySenderLabel');
    expect(modal).toContain('d.instapaySenderPlaceholder');
    expect(modal).toContain('d.instapaySenderRequired');
    expect(modal).toContain('d.instapayReferenceLabel');
    expect(modal).toContain('d.instapayReferencePlaceholder');
  });

  it('exposes toasts to assistive tech and positions them with a logical property', () => {
    const toast = read('components/app/toast.tsx');
    expect(toast).toContain('aria-live="polite"');
    expect(toast).toContain('role="status"');
    expect(toast).toContain('insetInlineEnd');
    // No hardcoded physical `right` offset that breaks RTL.
    expect(toast).not.toContain("right: '20px'");
  });

  it('only renders factory-reset controls for a super admin', () => {
    const settingsTab = read('components/admin/admin-settings-tab.tsx');
    const adminPanel = read('components/admin/admin-panel.tsx');

    expect(settingsTab).toContain('canFactoryReset && (');
    expect(settingsTab).toContain('canFactoryReset && factoryResetModalOpen');
    expect(adminPanel).toContain("adminPermissions ?? []).includes('super_admin')");
  });

  it('gives the chat share-location icon button an accessible name', () => {
    const chat = read('components/app/chat-screen.tsx');
    // The location button now carries an aria-label and hides the emoji glyph.
    expect(chat).toContain('aria-label={t.shareLocation}');
    expect(chat).toContain('<span aria-hidden>📍</span>');
  });
});
