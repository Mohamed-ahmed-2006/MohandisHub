// ---------------------------------------------------------------------------
// Profile types — internal DB row types
// ---------------------------------------------------------------------------

import type {
  AcademicRecordStatus,
  AcademicRecordType,
  AdminReviewDecision,
  AdminReviewType,
  AvailabilityStatus,
  CompanySize,
  DocumentStatus,
  IdentityDocumentType,
  VerificationStatus,
} from '@mohandishub/shared';

/** Row from `identity_documents` table. */
export type IdentityDocumentRow = {
  id: string;
  user_id: string;
  document_type: IdentityDocumentType;
  document_number: string | null;
  full_name_on_doc: string;
  date_of_birth: Date | null;
  nationality: string | null;
  front_image_url: string | null;
  back_image_url: string | null;
  selfie_image_url: string | null;
  provider: string | null;
  provider_ref: string | null;
  status: DocumentStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Row from `academic_records` table. */
export type AcademicRecordRow = {
  id: string;
  user_id: string;
  record_type: AcademicRecordType;
  title: string;
  institution: string;
  field_of_study: string | null;
  graduation_year: number | null;
  grade: string | null;
  certificate_image_url: string | null;
  transcript_image_url: string | null;
  status: AcademicRecordStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Row from `expert_profiles` table (full). */
export type ExpertProfileRow = {
  id: string;
  user_id: string;
  title: string | null;
  headline: string | null;
  bio: string | null;
  specializations: string[];
  years_of_experience: number | null;
  hourly_rate: string | null; // NUMERIC comes as string from pg
  city: string | null;
  country: string;
  availability_status: AvailabilityStatus;
  employer: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  languages: string[];
  education_summary: string | null;
  certifications_count: number;
  verification_status: VerificationStatus;
  identity_verified: boolean;
  academic_verified: boolean;
  identity_verification_method?: 'didit' | 'manual' | null;
  payout_currency?: string | null;
  payout_address?: string | null;
  payout_extra_id?: string | null;
  payout_updated_at?: Date | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Row from `business_profiles` table (full). */
export type BusinessProfileRow = {
  id: string;
  user_id: string;
  company_name: string;
  trade_license_number: string | null;
  tax_id: string | null;
  commercial_register: string | null;
  industry: string | null;
  company_size: CompanySize | null;
  website: string | null;
  company_email: string | null;
  company_phone: string | null;
  address: string | null;
  logo_url: string | null;
  city: string | null;
  country: string;
  description: string | null;
  owner_full_name: string | null;
  owner_title: string | null;
  owner_email: string | null;
  owner_phone: string | null;
  social_facebook: string | null;
  social_linkedin: string | null;
  social_twitter: string | null;
  employees_count: number | null;
  founded_year: number | null;
  verification_status: VerificationStatus;
  identity_verified: boolean;
  business_verified: boolean;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Row from `customer_profiles` table. */
export type CustomerProfileRow = {
  id: string;
  user_id: string;
  address: string | null;
  city: string | null;
  country: string | null;
  preferences: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

/** Row from `admin_reviews` table. */
export type AdminReviewRow = {
  id: string;
  reviewer_id: string;
  target_user_id: string;
  review_type: AdminReviewType;
  target_table: string;
  target_record_id: string;
  decision: AdminReviewDecision;
  notes: string | null;
  created_at: Date;
};
