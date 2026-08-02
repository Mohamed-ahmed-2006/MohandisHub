// ---------------------------------------------------------------------------
// Profile types shared between API and frontend
// ---------------------------------------------------------------------------

import type { VerificationStatus } from './verification.js';

export type DocumentStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
export type AcademicRecordStatus = 'pending' | 'under_review' | 'approved' | 'rejected';
export type AdminReviewType = 'identity' | 'academic' | 'business_docs';

export type IdentityDocumentType = 'national_id' | 'driving_license' | 'passport';

export type IdentityDocumentBody = {
  documentType: IdentityDocumentType;
  fullNameOnDoc: string;
  dateOfBirth?: string;
  nationality?: string;
  documentNumber?: string;
  frontImageUrl?: string;
  backImageUrl?: string;
  selfieImageUrl?: string;
};

export type IdentityDocument = {
  id: string;
  userId: string;
  documentType: IdentityDocumentType;
  documentNumber: string | null;
  fullNameOnDoc: string;
  dateOfBirth: string | null;
  nationality: string | null;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  selfieImageUrl: string | null;
  provider: string | null;
  providerRef: string | null;
  status: DocumentStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type AcademicRecordType = 'degree' | 'diploma' | 'certificate' | 'license';

export type AcademicRecordBody = {
  recordType: AcademicRecordType;
  title: string;
  institution: string;
  fieldOfStudy?: string;
  graduationYear?: number;
  grade?: string;
  certificateImageUrl?: string;
  transcriptImageUrl?: string;
};

export type AcademicRecord = {
  id: string;
  userId: string;
  recordType: AcademicRecordType;
  title: string;
  institution: string;
  fieldOfStudy: string | null;
  graduationYear: number | null;
  grade: string | null;
  certificateImageUrl: string | null;
  transcriptImageUrl: string | null;
  status: AcademicRecordStatus;
  rejectionReason: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

export type CustomerProfile = {
  userId: string;
  city: string | null;
  country: string | null;
  contactPreference: string | null;
};

export type UpdateCustomerProfileBody = {
  city?: string | null;
  country?: string | null;
  contactPreference?: string | null;
};

export type AvailabilityStatus = 'available' | 'busy' | 'offline';

export type ExpertProfile = {
  id: string;
  userId: string;
  title: string | null;
  headline: string | null;
  bio: string | null;
  specializations: string[];
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  city: string | null;
  country: string;
  availabilityStatus: AvailabilityStatus;
  employer: string | null;
  jobTitle: string | null;
  linkedinUrl: string | null;
  portfolioUrl: string | null;
  languages: string[];
  educationSummary: string | null;
  certificationsCount: number;
  verificationStatus: VerificationStatus;
  identityVerified: boolean;
  academicVerified: boolean;
  identityVerificationMethod: 'didit' | 'manual' | null;
  payoutCurrency: string | null;
  payoutAddress: string | null;
  payoutExtraId: string | null;
  payoutUpdatedAt: string | null;
  createdAt: string;
  averageRating?: number | null;
  reviewCount?: number;
  verificationBadgeEarned?: boolean;
  platformVerifiedAt?: string | null;
};

export type UpdateExpertProfileBody = {
  title?: string;
  headline?: string;
  bio?: string;
  specializations?: string[];
  yearsOfExperience?: number;
  hourlyRate?: number;
  city?: string;
  country?: string;
  availabilityStatus?: AvailabilityStatus;
  employer?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  languages?: string[];
  educationSummary?: string;
};

export type CraftsmanProfile = {
  id: string;
  userId: string;
  trade: string | null;
  title: string | null;
  headline: string | null;
  bio: string | null;
  specializations: string[];
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  city: string | null;
  country: string;
  availabilityStatus: AvailabilityStatus;
  workshopName: string | null;
  workshopAddress: string | null;
  workshopLatitude: number | null;
  workshopLongitude: number | null;
  verificationStatus: VerificationStatus;
  identityVerified: boolean;
  identityVerificationMethod: 'didit' | 'manual' | null;
  payoutCurrency: string | null;
  payoutAddress: string | null;
  payoutExtraId: string | null;
  payoutUpdatedAt: string | null;
  createdAt: string;
  averageRating?: number | null;
  reviewCount?: number;
  verificationBadgeEarned?: boolean;
  platformVerifiedAt?: string | null;
};

export type UpdateCraftsmanProfileBody = {
  trade?: string;
  title?: string;
  headline?: string;
  bio?: string;
  specializations?: string[];
  yearsOfExperience?: number;
  hourlyRate?: number;
  city?: string;
  country?: string;
  availabilityStatus?: AvailabilityStatus;
  workshopName?: string;
  workshopAddress?: string;
  workshopLatitude?: number;
  workshopLongitude?: number;
};

export type CompanySize = '1-10' | '11-50' | '51-200' | '201-500' | '500+';

export type BusinessProfile = {
  id: string;
  userId: string;
  companyName: string;
  tradeLicenseNumber: string | null;
  taxId: string | null;
  commercialRegister: string | null;
  industry: string | null;
  companySize: CompanySize | null;
  website: string | null;
  companyEmail: string | null;
  companyPhone: string | null;
  address: string | null;
  logoUrl: string | null;
  city: string | null;
  country: string;
  description: string | null;
  ownerFullName: string | null;
  ownerTitle: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  socialFacebook: string | null;
  socialLinkedin: string | null;
  socialTwitter: string | null;
  employeesCount: number | null;
  foundedYear: number | null;
  verificationStatus: VerificationStatus;
  identityVerified: boolean;
  businessVerified: boolean;
  createdAt: string;
  averageRating?: number | null;
  reviewCount?: number;
  verificationBadgeEarned?: boolean;
  platformVerifiedAt?: string | null;
};

export type UpdateBusinessProfileBody = {
  companyName?: string;
  tradeLicenseNumber?: string;
  taxId?: string;
  commercialRegister?: string;
  industry?: string;
  companySize?: CompanySize;
  website?: string;
  companyEmail?: string;
  companyPhone?: string;
  address?: string;
  logoUrl?: string | null;
  city?: string;
  country?: string;
  description?: string;
  ownerFullName?: string;
  ownerTitle?: string;
  ownerEmail?: string;
  ownerPhone?: string;
  socialFacebook?: string;
  socialLinkedin?: string;
  socialTwitter?: string;
  employeesCount?: number;
  foundedYear?: number;
};

export type AdminReviewDecision = 'approved' | 'rejected';

export type AdminReviewBody = {
  decision: AdminReviewDecision;
  notes?: string;
};

export type AdminReview = {
  id: string;
  reviewerId: string;
  targetUserId: string;
  reviewType: AdminReviewType;
  targetTable: string;
  targetRecordId: string;
  decision: AdminReviewDecision;
  notes: string | null;
  createdAt: string;
};

/** Admin audit row with reviewer label for history UIs (GET .../verification/users/:id/reviews). */
export type AdminReviewHistoryItem = AdminReview & {
  reviewerDisplayName: string | null;
};

export type PendingVerificationItem = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  identityDocuments: IdentityDocument[];
  academicRecords: AcademicRecord[];
  expertProfile: ExpertProfile | null;
  businessProfile: BusinessProfile | null;
  craftsmanProfile: CraftsmanProfile | null;
};

export type PublicExpertProfile = {
  title: string | null;
  headline: string | null;
  bio: string | null;
  specializations: string[];
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  city: string | null;
  country: string;
  languages: string[];
  educationSummary: string | null;
  certificationsCount: number;
  verificationStatus: VerificationStatus;
  verificationBadgeEarned?: boolean;
  averageRating: number | null;
  reviewCount: number;
};

export type PublicCraftsmanProfile = {
  trade: string | null;
  title: string | null;
  headline: string | null;
  bio: string | null;
  specializations: string[];
  yearsOfExperience: number | null;
  hourlyRate: number | null;
  city: string | null;
  country: string;
  workshopName: string | null;
  verificationStatus: VerificationStatus;
  verificationBadgeEarned?: boolean;
  averageRating: number | null;
  reviewCount: number;
};

export type PublicBusinessProfile = {
  companyName: string;
  industry: string | null;
  companySize: CompanySize | null;
  logoUrl: string | null;
  city: string | null;
  country: string;
  description: string | null;
  verificationStatus: VerificationStatus;
  verificationBadgeEarned?: boolean;
  averageRating: number | null;
  reviewCount: number;
};

export type PublicCustomerProfile = {
  city: string | null;
  country: string | null;
};

export type PublicUserProfileRole = 'customer' | 'expert' | 'business' | 'craftsman';

export type PublicUserProfile = {
  userId: string;
  role: PublicUserProfileRole;
  displayName: string;
  avatarUrl: string | null;
  expertProfile?: PublicExpertProfile | null;
  businessProfile?: PublicBusinessProfile | null;
  craftsmanProfile?: PublicCraftsmanProfile | null;
  customerProfile?: PublicCustomerProfile | null;
};

/**
 * Runtime allowlists for GET /api/profiles/public/:userId.
 *
 * Private profile rows contain contact, location, payment and external-link
 * fields. Only these fields may cross the public profile boundary. Keep the
 * browser parser and API serializer on this shared contract so an unexpected
 * repository or network field is dropped rather than retained by structural
 * typing.
 */
export const PUBLIC_USER_PROFILE_FIELDS = [
  'userId',
  'role',
  'displayName',
  'avatarUrl',
  'expertProfile',
  'businessProfile',
  'craftsmanProfile',
  'customerProfile',
] as const satisfies readonly (keyof PublicUserProfile)[];

export const PUBLIC_EXPERT_PROFILE_FIELDS = [
  'title',
  'headline',
  'bio',
  'specializations',
  'yearsOfExperience',
  'hourlyRate',
  'city',
  'country',
  'languages',
  'educationSummary',
  'certificationsCount',
  'verificationStatus',
  'verificationBadgeEarned',
  'averageRating',
  'reviewCount',
] as const satisfies readonly (keyof PublicExpertProfile)[];

export const PUBLIC_BUSINESS_PROFILE_FIELDS = [
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
] as const satisfies readonly (keyof PublicBusinessProfile)[];

export const PUBLIC_CRAFTSMAN_PROFILE_FIELDS = [
  'trade',
  'title',
  'headline',
  'bio',
  'specializations',
  'yearsOfExperience',
  'hourlyRate',
  'city',
  'country',
  'workshopName',
  'verificationStatus',
  'verificationBadgeEarned',
  'averageRating',
  'reviewCount',
] as const satisfies readonly (keyof PublicCraftsmanProfile)[];

export const PUBLIC_CUSTOMER_PROFILE_FIELDS = [
  'city',
  'country',
] as const satisfies readonly (keyof PublicCustomerProfile)[];

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown, label: string): UnknownRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
};

const pickFields = (value: UnknownRecord, fields: readonly string[]): UnknownRecord =>
  Object.fromEntries(
    fields.filter((field) => field in value).map((field) => [field, value[field]]),
  );

const pickNestedProfile = (
  value: unknown,
  fields: readonly string[],
  label: string,
): UnknownRecord | null | undefined => {
  if (value === undefined || value === null) return value;
  return pickFields(asRecord(value, label), fields);
};

/** Strip every field outside the explicit public-profile contract. */
export const sanitizePublicUserProfile = (value: unknown): PublicUserProfile => {
  const source = asRecord(value, 'Public user profile');
  const sanitized = pickFields(source, PUBLIC_USER_PROFILE_FIELDS);

  sanitized.expertProfile = pickNestedProfile(
    source.expertProfile,
    PUBLIC_EXPERT_PROFILE_FIELDS,
    'Public expert profile',
  );
  sanitized.businessProfile = pickNestedProfile(
    source.businessProfile,
    PUBLIC_BUSINESS_PROFILE_FIELDS,
    'Public business profile',
  );
  sanitized.craftsmanProfile = pickNestedProfile(
    source.craftsmanProfile,
    PUBLIC_CRAFTSMAN_PROFILE_FIELDS,
    'Public craftsman profile',
  );
  sanitized.customerProfile = pickNestedProfile(
    source.customerProfile,
    PUBLIC_CUSTOMER_PROFILE_FIELDS,
    'Public customer profile',
  );

  return sanitized as PublicUserProfile;
};
