import {
  PUBLIC_BUSINESS_PROFILE_FIELDS,
  PUBLIC_EXPERT_PROFILE_FIELDS,
  PUBLIC_USER_PROFILE_FIELDS,
} from '@mohandishub/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parsePublicUserProfile, profilesApiClient } from '../lib/profiles/client';

const unsafeBusinessResponse = {
  userId: 'business-1',
  role: 'business',
  displayName: 'Safe Business',
  avatarUrl: '/media/business.png',
  email: 'owner@example.com',
  businessProfile: {
    companyName: 'Safe Business LLC',
    industry: 'Engineering',
    companySize: '1-10',
    logoUrl: '/media/business.png',
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
    paymentDetails: 'pay@example.com',
  },
};

describe('public profile browser contract', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retains only the shared Business allowlist', () => {
    const result = parsePublicUserProfile(unsafeBusinessResponse);

    expect(Object.keys(result).sort()).toEqual([...PUBLIC_USER_PROFILE_FIELDS].sort());
    expect(Object.keys(result.businessProfile ?? {}).sort()).toEqual(
      [...PUBLIC_BUSINESS_PROFILE_FIELDS].sort(),
    );
    expect(result.businessProfile).toMatchObject({
      companyName: 'Safe Business LLC',
      logoUrl: '/media/business.png',
      description: 'Industrial design services',
      averageRating: 4.8,
    });
    expect(JSON.stringify(result)).not.toContain('business.example');
    expect(JSON.stringify(result)).not.toContain('sales@example.com');
    expect(JSON.stringify(result)).not.toContain('10 Exact Street');
  });

  it('does not retain unexpected contact fields returned by the network', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          await Promise.resolve();
          return { ok: true, data: unsafeBusinessResponse };
        },
      }),
    );

    const result = await profilesApiClient.getPublicProfile('business-1');

    expect(result.businessProfile?.companyName).toBe('Safe Business LLC');
    expect(JSON.stringify(result)).not.toContain('business.example');
    expect(JSON.stringify(result)).not.toContain('owner@example.com');
  });

  it('strips Expert external-contact URLs while preserving discovery fields', () => {
    const result = parsePublicUserProfile({
      userId: 'expert-1',
      role: 'expert',
      displayName: 'Expert Name',
      avatarUrl: '/media/expert.png',
      expertProfile: {
        title: 'Mechanical Engineer',
        headline: 'Product design',
        bio: 'Mechanical design specialist',
        specializations: ['mechanical'],
        yearsOfExperience: 8,
        hourlyRate: 500,
        city: 'Cairo',
        country: 'Egypt',
        languages: ['ar', 'en'],
        educationSummary: 'BSc Engineering',
        certificationsCount: 2,
        verificationStatus: 'verified',
        verificationBadgeEarned: true,
        averageRating: 4.7,
        reviewCount: 10,
        linkedinUrl: 'https://linkedin.com/in/expert',
        portfolioUrl: 'https://expert.example',
      },
    });

    expect(Object.keys(result.expertProfile ?? {}).sort()).toEqual(
      [...PUBLIC_EXPERT_PROFILE_FIELDS].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('linkedin.com');
    expect(JSON.stringify(result)).not.toContain('expert.example');
  });
});
