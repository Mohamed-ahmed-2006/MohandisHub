// ---------------------------------------------------------------------------
// Auth module types — internal DB row types
// ---------------------------------------------------------------------------

import type { UserRole } from '@mohandishub/shared';
import type { VerificationStatus } from '@mohandishub/shared';

/** Row returned from the `users` table. */
export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  phone: string | null;
  phone_code: string | null;
  nationality: string | null;
  display_name: string;
  avatar_url: string | null;
  date_of_birth: Date | null;
  primary_role: UserRole;
  is_admin: boolean;
  admin_permissions?: string[];
  plan_id: string | null;
  plan_slug: string;
  plan_limits: Record<string, unknown> | null;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Row returned from the `refresh_tokens` table. */
export type RefreshTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  device_info: string | null;
  ip_address: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
};

/** Row returned from expert_profiles (just verification fields). */
export type ExpertVerificationRow = {
  verification_status: VerificationStatus;
  identity_verified: boolean;
  academic_verified: boolean;
};

/** Row returned from business_profiles (just verification fields). */
export type BusinessVerificationRow = {
  verification_status: VerificationStatus;
  identity_verified: boolean;
  business_verified: boolean;
};

/** Row returned from craftsman_profiles (just verification fields). */
export type CraftsmanVerificationRow = {
  verification_status: VerificationStatus;
  identity_verified: boolean;
};
