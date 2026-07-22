import { describe, expect, it, vi } from 'vitest';

import { ProfilesService } from '../modules/profiles/profiles.service.js';

const makeRepo = (platformVerifiedAt: Date | null, verificationStatus: string) => ({
  findActiveUserById: vi.fn().mockResolvedValue({
    id: 'expert-1',
    primary_role: 'expert',
    display_name: 'Expert',
    avatar_url: '/avatar.png',
  }),
  findExpertProfile: vi.fn().mockResolvedValue({
    title: 'Engineer',
    headline: null,
    bio: 'Profile bio',
    specializations: ['Structural'],
    years_of_experience: 5,
    hourly_rate: '100',
    city: 'Cairo',
    country: 'Egypt',
    linkedin_url: null,
    portfolio_url: null,
    languages: ['Arabic'],
    education_summary: null,
    certifications_count: 0,
    verification_status: verificationStatus,
  }),
  getPlatformVerifiedAt: vi.fn().mockResolvedValue(platformVerifiedAt),
});

const reviewsRepo = {
  getAvgRating: vi.fn().mockResolvedValue(null),
  getReviewCount: vi.fn().mockResolvedValue(0),
};

describe('platform verification badge source of truth', () => {
  it('does not expose the deposit/profile badge from identity status alone', async () => {
    const service = new ProfilesService(
      makeRepo(null, 'verified') as never,
      {} as never,
      {} as never,
      reviewsRepo as never,
      {} as never,
      {} as never,
    );

    const profile = await service.getPublicProfile('expert-1');
    expect(profile.expertProfile?.verificationStatus).toBe('verified');
    expect(profile.expertProfile?.verificationBadgeEarned).toBe(false);
  });

  it('keeps an earned platform badge independent of later identity status changes', async () => {
    const service = new ProfilesService(
      makeRepo(new Date('2026-07-01T00:00:00Z'), 'under_review') as never,
      {} as never,
      {} as never,
      reviewsRepo as never,
      {} as never,
      {} as never,
    );

    const profile = await service.getPublicProfile('expert-1');
    expect(profile.expertProfile?.verificationStatus).toBe('under_review');
    expect(profile.expertProfile?.verificationBadgeEarned).toBe(true);
  });
});
