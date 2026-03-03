// ---------------------------------------------------------------------------
// Verification statuses and types — shared between API and frontend
// ---------------------------------------------------------------------------

export type VerificationStatus =
  | 'unverified'
  | 'pending'
  | 'under_review'
  | 'verified'
  | 'rejected';

export type VerificationRequestType = 'identity' | 'business';

export type VerificationProvider = 'didit' | 'idenfy' | 'manual';

export type VerificationRequestStatus =
  | 'initiated'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired';

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: 'Not Verified',
  pending: 'Pending Review',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Rejected',
};

/** Roles that require verification before they can offer services. */
export const ROLES_REQUIRING_VERIFICATION = ['expert', 'business'] as const;

export type VerifiableRole = (typeof ROLES_REQUIRING_VERIFICATION)[number];

export const isVerifiableRole = (role: string): role is VerifiableRole =>
  (ROLES_REQUIRING_VERIFICATION as readonly string[]).includes(role);
