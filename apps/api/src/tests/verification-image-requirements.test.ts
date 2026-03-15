import { describe, expect, it, vi } from 'vitest';

import {
  assertRequiredVerificationImage,
  getEffectiveBusinessVerificationStatus,
  getEffectiveExpertVerificationStatus,
  syncVerificationStatusForRequiredImage,
} from '../modules/profiles/verification-image-requirements.js';

describe('verification image requirements', () => {
  it('rejects expert verification when avatar is missing', async () => {
    const repo = {
      getUserAvatarUrl: vi.fn().mockResolvedValue(null),
      getBusinessLogoUrl: vi.fn(),
    };

    await expect(assertRequiredVerificationImage(repo, 'user-1', 'expert')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VERIFICATION_REQUIRED_IMAGE_MISSING',
    });
  });

  it('rejects business verification when logo is missing', async () => {
    const repo = {
      getUserAvatarUrl: vi.fn(),
      getBusinessLogoUrl: vi.fn().mockResolvedValue(null),
    };

    await expect(assertRequiredVerificationImage(repo, 'user-2', 'business')).rejects.toMatchObject({
      statusCode: 400,
      code: 'VERIFICATION_REQUIRED_IMAGE_MISSING',
    });
  });

  it('returns verified for expert only when both approvals and avatar exist', () => {
    expect(
      getEffectiveExpertVerificationStatus(
        {
          verification_status: 'under_review',
          identity_verified: true,
          academic_verified: true,
        },
        true,
      ),
    ).toBe('verified');

    expect(
      getEffectiveExpertVerificationStatus(
        {
          verification_status: 'verified',
          identity_verified: true,
          academic_verified: true,
        },
        false,
      ),
    ).toBe('under_review');
  });

  it('returns verified for business only when both approvals and logo exist', () => {
    expect(
      getEffectiveBusinessVerificationStatus(
        {
          verification_status: 'under_review',
          identity_verified: true,
          business_verified: true,
        },
        true,
      ),
    ).toBe('verified');

    expect(
      getEffectiveBusinessVerificationStatus(
        {
          verification_status: 'verified',
          identity_verified: true,
          business_verified: true,
        },
        false,
      ),
    ).toBe('under_review');
  });

  it('promotes expert to verified when required image is added after approvals', async () => {
    const repo = {
      getUserAvatarUrl: vi.fn().mockResolvedValue('https://cdn.example.com/avatar.png'),
      getBusinessLogoUrl: vi.fn(),
      findExpertProfile: vi.fn().mockResolvedValue({
        verification_status: 'under_review',
        identity_verified: true,
        academic_verified: true,
      }),
      findBusinessProfile: vi.fn(),
      updateExpertOverallStatus: vi.fn().mockResolvedValue(undefined),
      updateBusinessOverallStatus: vi.fn(),
    };

    await syncVerificationStatusForRequiredImage(repo, 'expert-1', 'expert');

    expect(repo.updateExpertOverallStatus).toHaveBeenCalledWith('expert-1', 'verified');
  });

  it('downgrades business to under_review when required logo is removed', async () => {
    const repo = {
      getUserAvatarUrl: vi.fn(),
      getBusinessLogoUrl: vi.fn().mockResolvedValue(null),
      findExpertProfile: vi.fn(),
      findBusinessProfile: vi.fn().mockResolvedValue({
        verification_status: 'verified',
        identity_verified: true,
        business_verified: true,
      }),
      updateExpertOverallStatus: vi.fn(),
      updateBusinessOverallStatus: vi.fn().mockResolvedValue(undefined),
    };

    await syncVerificationStatusForRequiredImage(repo, 'business-1', 'business');

    expect(repo.updateBusinessOverallStatus).toHaveBeenCalledWith('business-1', 'under_review');
  });
});
