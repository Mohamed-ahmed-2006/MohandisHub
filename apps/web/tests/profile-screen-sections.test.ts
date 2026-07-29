import { describe, expect, it } from 'vitest';

import { getVisibleProfileSections } from '@/components/profile/profile-screen-sections';

// `preferences` and `wallet` are intentional additions. `wallet` is the MHC
// credits surface, not the retired EGP wallet — see components/app/mhc-credits-screen.
describe('getVisibleProfileSections', () => {
  it('shows account, preferences, and wallet for customers', () => {
    expect(getVisibleProfileSections('customer').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'wallet',
    ]);
  });

  it('shows every section for experts', () => {
    expect(getVisibleProfileSections('expert').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
      'wallet',
    ]);
  });

  it('shows every section for businesses', () => {
    expect(getVisibleProfileSections('business').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
      'wallet',
    ]);
  });

  it('shows every section for craftsmen', () => {
    expect(getVisibleProfileSections('craftsman').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
      'wallet',
    ]);
  });

  it('falls back to the role-agnostic sections when the role is unknown', () => {
    expect(getVisibleProfileSections(null).map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'wallet',
    ]);
  });

  it('anchors the wallet section at wallet-settings', () => {
    // profile-screen.tsx resolves the `#wallet-settings` hash to this tab, and
    // the award-offer "buy credits" link points at it.
    const wallet = getVisibleProfileSections('expert').find((s) => s.id === 'wallet');
    expect(wallet?.anchorId).toBe('wallet-settings');
  });
});
