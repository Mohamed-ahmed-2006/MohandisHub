import { describe, expect, it } from 'vitest';

import {
  PUBLIC_BUSINESS_PROFILE_FIELDS,
  PUBLIC_CRAFTSMAN_PROFILE_FIELDS,
  PUBLIC_EXPERT_PROFILE_FIELDS,
  PUBLIC_USER_PROFILE_FIELDS,
  sanitizePublicUserProfile,
} from './profiles.js';

describe('public profile allowlist', () => {
  it('contains only approved discovery fields', () => {
    expect(PUBLIC_USER_PROFILE_FIELDS).toEqual([
      'userId',
      'role',
      'displayName',
      'avatarUrl',
      'expertProfile',
      'businessProfile',
      'craftsmanProfile',
      'customerProfile',
    ]);
    expect(PUBLIC_BUSINESS_PROFILE_FIELDS).toEqual([
      'companyName',
      'industry',
      'companySize',
      'logoUrl',
      'city',
      'country',
      'description',
      'verificationStatus',
      'verificationBadgeEarned',
      'averageRating',
      'reviewCount',
    ]);

    const publicProviderFields = [
      ...PUBLIC_EXPERT_PROFILE_FIELDS,
      ...PUBLIC_BUSINESS_PROFILE_FIELDS,
      ...PUBLIC_CRAFTSMAN_PROFILE_FIELDS,
    ].join(' ');
    expect(publicProviderFields).not.toMatch(
      /website|portfolio|linkedin|facebook|twitter|instagram|whatsapp|telegram|email|phone|address|latitude|longitude|coordinate|payment|payout|bookingUrl/i,
    );
  });

  it('recursively strips unexpected public Business contact fields', () => {
    const result = sanitizePublicUserProfile({
      userId: 'business-1',
      role: 'business',
      displayName: 'Safe Business',
      avatarUrl: '/media/business-logo.png',
      email: 'owner@example.com',
      businessProfile: {
        companyName: 'Safe Business LLC',
        industry: 'Engineering',
        companySize: '1-10',
        logoUrl: '/media/business-logo.png',
        city: 'Cairo',
        country: 'Egypt',
        description: 'Industrial design services',
        verificationStatus: 'verified',
        verificationBadgeEarned: true,
        averageRating: 4.8,
        reviewCount: 12,
        website: 'https://business.example',
        companyEmail: 'sales@example.com',
        companyPhone: '+201000000000',
        address: '10 Exact Street',
        latitude: 30.0444,
        longitude: 31.2357,
        socialFacebook: 'https://facebook.com/business',
        socialLinkedin: 'https://linkedin.com/company/business',
        socialTwitter: 'https://x.com/business',
        whatsappUrl: 'https://wa.me/201000000000',
        paymentDetails: 'pay@example.com',
      },
    });

    expect(Object.keys(result).sort()).toEqual([...PUBLIC_USER_PROFILE_FIELDS].sort());
    expect(Object.keys(result.businessProfile ?? {}).sort()).toEqual(
      [...PUBLIC_BUSINESS_PROFILE_FIELDS].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('business.example');
    expect(JSON.stringify(result)).not.toContain('sales@example.com');
    expect(JSON.stringify(result)).not.toContain('10 Exact Street');
    expect(JSON.stringify(result)).not.toContain('wa.me');
  });
});
