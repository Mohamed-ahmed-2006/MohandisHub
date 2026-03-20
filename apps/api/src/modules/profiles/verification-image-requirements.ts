import type { VerificationStatus } from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';

type VerificationImageRole = 'expert' | 'business' | 'craftsman';

type ExpertLikeProfile = {
  identity_verified: boolean;
  academic_verified: boolean;
  verification_status: VerificationStatus;
};

type CraftsmanLikeProfile = {
  identity_verified: boolean;
  verification_status: VerificationStatus;
};

type BusinessLikeProfile = {
  identity_verified: boolean;
  business_verified: boolean;
  verification_status: VerificationStatus;
};

type VerificationImageRepository = {
  getUserAvatarUrl(userId: string): Promise<string | null>;
  getBusinessLogoUrl(userId: string): Promise<string | null>;
  findExpertProfile(userId: string): Promise<ExpertLikeProfile | null>;
  findCraftsmanProfile(userId: string): Promise<CraftsmanLikeProfile | null>;
  findBusinessProfile(userId: string): Promise<BusinessLikeProfile | null>;
  updateExpertOverallStatus(userId: string, status: string): Promise<void>;
  updateCraftsmanOverallStatus(userId: string, status: string): Promise<void>;
  updateBusinessOverallStatus(userId: string, status: string): Promise<void>;
};

export function getRequiredVerificationImageMessage(role: VerificationImageRole): string {
  return role === 'business'
    ? 'Add your company logo before starting or completing verification.'
    : 'Add your profile picture before starting or completing verification.';
}

export async function hasRequiredVerificationImage(
  repo: Pick<VerificationImageRepository, 'getUserAvatarUrl' | 'getBusinessLogoUrl'>,
  userId: string,
  role: VerificationImageRole,
): Promise<boolean> {
  if (role === 'business') {
    const logoUrl = await repo.getBusinessLogoUrl(userId);
    return Boolean(logoUrl?.trim());
  }

  const avatarUrl = await repo.getUserAvatarUrl(userId);
  return Boolean(avatarUrl?.trim());
}

export async function assertRequiredVerificationImage(
  repo: Pick<VerificationImageRepository, 'getUserAvatarUrl' | 'getBusinessLogoUrl'>,
  userId: string,
  role: VerificationImageRole,
): Promise<void> {
  const hasImage = await hasRequiredVerificationImage(repo, userId, role);
  if (hasImage) return;

  throw new HttpError({
    statusCode: 400,
    code: 'VERIFICATION_REQUIRED_IMAGE_MISSING',
    message: getRequiredVerificationImageMessage(role),
  });
}

export function getEffectiveExpertVerificationStatus(
  profile: ExpertLikeProfile,
  hasAvatar: boolean,
): VerificationStatus {
  if (profile.identity_verified && profile.academic_verified && hasAvatar) {
    return 'verified';
  }
  if (
    profile.verification_status === 'verified' &&
    (!hasAvatar || !profile.identity_verified || !profile.academic_verified)
  ) {
    return 'under_review';
  }
  return profile.verification_status;
}

export function getEffectiveCraftsmanVerificationStatus(
  profile: CraftsmanLikeProfile,
  hasAvatar: boolean,
): VerificationStatus {
  if (profile.identity_verified && hasAvatar) {
    return 'verified';
  }
  if (profile.verification_status === 'verified' && (!hasAvatar || !profile.identity_verified)) {
    return 'under_review';
  }
  return profile.verification_status;
}

export function getEffectiveBusinessVerificationStatus(
  profile: BusinessLikeProfile,
  hasLogo: boolean,
): VerificationStatus {
  if (profile.identity_verified && profile.business_verified && hasLogo) {
    return 'verified';
  }
  if (
    profile.verification_status === 'verified' &&
    (!hasLogo || !profile.identity_verified || !profile.business_verified)
  ) {
    return 'under_review';
  }
  return profile.verification_status;
}

export async function syncVerificationStatusForRequiredImage(
  repo: VerificationImageRepository,
  userId: string,
  role: VerificationImageRole,
): Promise<void> {
  if (role === 'expert') {
    const [profile, avatarUrl] = await Promise.all([
      repo.findExpertProfile(userId),
      repo.getUserAvatarUrl(userId),
    ]);
    if (!profile) return;

    const effectiveStatus = getEffectiveExpertVerificationStatus(profile, Boolean(avatarUrl?.trim()));
    if (effectiveStatus !== profile.verification_status) {
      await repo.updateExpertOverallStatus(userId, effectiveStatus);
    }
    return;
  }

  if (role === 'craftsman') {
    const [profile, avatarUrl] = await Promise.all([
      repo.findCraftsmanProfile(userId),
      repo.getUserAvatarUrl(userId),
    ]);
    if (!profile) return;

    const effectiveStatus = getEffectiveCraftsmanVerificationStatus(
      profile,
      Boolean(avatarUrl?.trim()),
    );
    if (effectiveStatus !== profile.verification_status) {
      await repo.updateCraftsmanOverallStatus(userId, effectiveStatus);
    }
    return;
  }

  const [profile, logoUrl] = await Promise.all([
    repo.findBusinessProfile(userId),
    repo.getBusinessLogoUrl(userId),
  ]);
  if (!profile) return;

  const effectiveStatus = getEffectiveBusinessVerificationStatus(profile, Boolean(logoUrl?.trim()));
  if (effectiveStatus !== profile.verification_status) {
    await repo.updateBusinessOverallStatus(userId, effectiveStatus);
  }
}
