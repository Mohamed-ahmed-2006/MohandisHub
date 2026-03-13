// ---------------------------------------------------------------------------
// Profile types — shared between API and frontend
// ---------------------------------------------------------------------------

import type { VerificationStatus } from './verification.js';

// ── Document / record statuses ───────────────────────────────────────────

export type DocumentStatus = 'pending' | 'under_review' | 'approved' | 'rejected' | 'expired';
export type AcademicRecordStatus = 'pending' | 'under_review' | 'approved' | 'rejected';
export type AdminReviewType = 'identity' | 'academic' | 'business_docs';

// ── Identity document types ──────────────────────────────────────────────

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

// ── Academic record types ────────────────────────────────────────────────

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

// ── Customer profile types ────────────────────────────────────────────────

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

// ── Expert profile types ─────────────────────────────────────────────────

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
  /** How identity was verified: 'didit' = external KYC (e.g. Didit), 'manual' = admin-reviewed identity document */
  identityVerificationMethod: 'didit' | 'manual' | null;
  payoutCurrency: string | null;
  payoutAddress: string | null;
  payoutExtraId: string | null;
  payoutUpdatedAt: string | null;
  createdAt: string;
  /** Set by API when profile is fetched for display */
  averageRating?: number | null;
  reviewCount?: number;
  /** Earned when profile is complete and user has deposited >= 1000 USD */
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

// ── Business profile types ───────────────────────────────────────────────

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
  /** Set by API when profile is fetched for display */
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
  logoUrl?: string;
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

// ── Admin review types ───────────────────────────────────────────────────

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

// ── Admin: pending applications view ─────────────────────────────────────

export type PendingVerificationItem = {
  userId: string;
  displayName: string;
  email: string;
  role: string;
  identityDocuments: IdentityDocument[];
  academicRecords: AcademicRecord[];
  expertProfile: ExpertProfile | null;
  businessProfile: BusinessProfile | null;
};
