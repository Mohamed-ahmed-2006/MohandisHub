import { describe, expect, it } from 'vitest';

import { getVisibleProfileSections } from '@/components/profile/profile-screen-sections';

// `preferences` and `wallet` are intentional additions. `wallet` is the MHC
// credits surface, not the retired EGP wallet — see components/app/mhc-credits-screen.
describe('getVisibleProfileSections', () => {
  it('shows only account and preferences for customers', () => {
    expect(getVisibleProfileSections('customer').map((section) => section.id)).toEqual([
      'account',
      'preferences',
    ]);
  });

  it('shows every section for experts', () => {
    expect(getVisibleProfileSections('expert').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
    ]);
  });

  it('shows every section for businesses', () => {
    expect(getVisibleProfileSections('business').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
    ]);
  });

  it('shows every section for craftsmen', () => {
    expect(getVisibleProfileSections('craftsman').map((section) => section.id)).toEqual([
      'account',
      'preferences',
      'profile',
      'verification',
    ]);
  });

  it('falls back to the role-agnostic sections when the role is unknown', () => {
    expect(getVisibleProfileSections(null).map((section) => section.id)).toEqual([
      'account',
      'preferences',
    ]);
  });

  it('does not expose the retired wallet section for any provider role', () => {
    for (const role of ['expert', 'craftsman', 'business']) {
      expect(getVisibleProfileSections(role).map((section) => String(section.id))).not.toContain(
        'wallet',
      );
    }
  });
});
