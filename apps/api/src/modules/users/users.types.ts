import type { UserRole } from '@mohandishub/shared';
import type { VerificationStatus } from '@mohandishub/shared';

export type UserSummary = {
  id: string;
  fullName: string;
  role: UserRole;
};

/** Extended user type with verification info — used in user listings. */
export type UserPublicProfile = {
  id: string;
  displayName: string;
  role: UserRole;
  avatarUrl: string | null;
  verificationStatus: VerificationStatus | null;
  createdAt: string;
};
