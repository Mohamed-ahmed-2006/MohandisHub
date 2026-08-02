import { PUBLIC_BUSINESS_PROFILE_FIELDS, PUBLIC_EXPERT_PROFILE_FIELDS } from '@mohandishub/shared';
import { describe, expect, it, vi } from 'vitest';

import { ProfilesService } from '../modules/profiles/profiles.service.js';
import type {
  BusinessProfileRow,
  CraftsmanProfileRow,
  ExpertProfileRow,
} from '../modules/profiles/profiles.types.js';

const now = new Date('2026-08-02T12:00:00.000Z');

const businessRow: BusinessProfileRow = {
  id: 'business-profile-1',
  user_id: 'business-1',
  company_name: 'Safe Business LLC',
  trade_license_number: 'TL-123',
  tax_id: 'TAX-123',
  commercial_register: 'CR-123',
  industry: 'Engineering',
  company_size: '1-10',
  website: 'https://business.example',
  company_email: 'sales@example.com',
  company_phone: '+201000000000',
  address: '10 Exact Street',
  logo_url: '/media/business-logo.png',
  city: 'Cairo',
  country: 'Egypt',
  description: 'Industrial design services',
  owner_full_name: 'Business Owner',
  owner_title: 'Director',
  owner_email: 'owner@example.com',
  owner_phone: '+201111111111',
  social_facebook: 'https://facebook.com/business',
  social_linkedin: 'https://linkedin.com/company/business',
  social_twitter: 'https://x.com/business',
  employees_count: 8,
  founded_year: 2020,
  verification_status: 'verified',
  identity_verified: true,
  business_verified: true,
  verified_at: now,
  created_at: now,
  updated_at: now,
};

const expertRow: ExpertProfileRow = {
  id: 'expert-profile-1',
  user_id: 'expert-1',
  title: 'Mechanical Engineer',
  headline: 'Product design',
  bio: 'Mechanical design specialist',
  specializations: ['mechanical'],
  years_of_experience: 8,
  hourly_rate: '500',
  city: 'Cairo',
  country: 'Egypt',
  availability_status: 'available',
  employer: null,
  job_title: null,
  linkedin_url: 'https://linkedin.com/in/expert',
  portfolio_url: 'https://expert.example',
  languages: ['ar', 'en'],
  education_summary: 'BSc Engineering',
  certifications_count: 2,
  verification_status: 'verified',
  identity_verified: true,
  academic_verified: true,
  verified_at: now,
  created_at: now,
  updated_at: now,
};

const craftsmanRow: CraftsmanProfileRow = {
  id: 'craftsman-profile-1',
  user_id: 'craftsman-1',
  trade: 'Carpentry',
  title: 'Furniture maker',
  headline: 'Custom woodwork',
  bio: 'Made-to-order furniture',
  specializations: ['furniture'],
  years_of_experience: 12,
  hourly_rate: '300',
  city: 'Giza',
  country: 'Egypt',
  availability_status: 'available',
  workshop_name: 'Wood Works',
  workshop_address: '22 Exact Workshop Street',
  workshop_latitude: '30.0131',
  workshop_longitude: '31.2089',
  verification_status: 'verified',
  identity_verified: true,
  verified_at: now,
  created_at: now,
  updated_at: now,
};

const createService = (role: 'business' | 'expert' | 'craftsman') => {
  const row = role === 'business' ? businessRow : role === 'expert' ? expertRow : craftsmanRow;
  const repo = {
    findActiveUserById: vi.fn().mockResolvedValue({
      id: `${role}-1`,
      primary_role: role,
      display_name: `Safe ${role}`,
      avatar_url: `/media/${role}.png`,
    }),
    findBusinessProfile: vi.fn().mockResolvedValue(role === 'business' ? row : null),
    findExpertProfile: vi.fn().mockResolvedValue(role === 'expert' ? row : null),
    findCraftsmanProfile: vi.fn().mockResolvedValue(role === 'craftsman' ? row : null),
    updateBusinessProfile: vi.fn(),
    getPlatformVerifiedAt: vi.fn().mockResolvedValue(null),
    setPlatformVerifiedAt: vi.fn(),
  };
  const reviews = {
    getAvgRating: vi.fn().mockResolvedValue(4.8),
    getReviewCount: vi.fn().mockResolvedValue(12),
  };
  const wallet = { getTotalDeposited: vi.fn().mockResolvedValue(0) };
  const service = new ProfilesService(
    repo as never,
    {} as never,
    {} as never,
    reviews as never,
    wallet as never,
    {} as never,
  );
  return { repo, service };
};

const recursivelyCollectedKeys = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(recursivelyCollectedKeys);
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...recursivelyCollectedKeys(nested),
  ]);
};

describe('GET /api/profiles/public/:userId security contract', () => {
  it('returns safe Business discovery fields and no contact route', async () => {
    const { service } = createService('business');
    const result = await service.getPublicProfile('business-1');

    expect(Object.keys(result.businessProfile ?? {}).sort()).toEqual(
      [...PUBLIC_BUSINESS_PROFILE_FIELDS].sort(),
    );
    expect(result.businessProfile).toMatchObject({
      companyName: 'Safe Business LLC',
      logoUrl: '/media/business-logo.png',
      description: 'Industrial design services',
      verificationStatus: 'verified',
      averageRating: 4.8,
      reviewCount: 12,
    });
    expect(recursivelyCollectedKeys(result).join(' ')).not.toMatch(
      /website|email|phone|address|latitude|longitude|facebook|linkedin|twitter|instagram|whatsapp|telegram|payment|payout/i,
    );
    expect(JSON.stringify(result)).not.toContain('business.example');
  });

  it('omits Expert LinkedIn and portfolio URLs', async () => {
    const { service } = createService('expert');
    const result = await service.getPublicProfile('expert-1');

    expect(Object.keys(result.expertProfile ?? {}).sort()).toEqual(
      [...PUBLIC_EXPERT_PROFILE_FIELDS].sort(),
    );
    expect(JSON.stringify(result)).not.toContain('linkedin.com');
    expect(JSON.stringify(result)).not.toContain('expert.example');
  });

  it('omits the Craftsman workshop address and coordinates', async () => {
    const { service } = createService('craftsman');
    const result = await service.getPublicProfile('craftsman-1');

    expect(JSON.stringify(result)).not.toContain('22 Exact Workshop Street');
    expect(JSON.stringify(result)).not.toContain('30.0131');
    expect(JSON.stringify(result)).not.toContain('31.2089');
    expect(result.craftsmanProfile).toMatchObject({
      workshopName: 'Wood Works',
      city: 'Giza',
    });
  });

  it('preserves website and contact fields on the authenticated private profile path', async () => {
    const { service } = createService('business');
    const result = await service.getBusinessProfile('business-1');

    expect(result.website).toBe('https://business.example');
    expect(result.companyEmail).toBe('sales@example.com');
    expect(result.companyPhone).toBe('+201000000000');
    expect(result.socialLinkedin).toBe('https://linkedin.com/company/business');
  });

  it('preserves private website editing', async () => {
    const { repo, service } = createService('business');
    const updated = { ...businessRow, website: 'https://updated.example' };
    repo.updateBusinessProfile.mockResolvedValue(updated);
    repo.findBusinessProfile.mockResolvedValue(updated);

    const result = await service.updateBusinessProfile('business-1', {
      website: 'https://updated.example',
    });

    expect(repo.updateBusinessProfile).toHaveBeenCalledWith('business-1', {
      website: 'https://updated.example',
    });
    expect(result.website).toBe('https://updated.example');
  });
});
