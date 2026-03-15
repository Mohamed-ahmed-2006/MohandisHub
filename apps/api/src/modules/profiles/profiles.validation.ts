// ---------------------------------------------------------------------------
// Profiles validation — Zod schemas
// ---------------------------------------------------------------------------

import { z } from 'zod';

/** Permissive URL: accepts http/https, with or without www, any TLD (.com, .eg, .com.eg, etc.) */
const urlOrDomain = (maxLen: number) =>
  z
    .string()
    .max(maxLen)
    .optional()
    .refine(
      (val) => {
        if (!val || !val.trim()) return true;
        const s = val.trim();
        const withProtocol = /^https?:\/\//i.test(s) ? s : `https://${s}`;
        try {
          new URL(withProtocol);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Enter a valid URL or domain (e.g. example.com, linkedin.com/in/username)' },
    );

// ── Identity document ────────────────────────────────────────────────────

export const identityDocumentSchema = z
  .object({
    documentType: z.enum(['national_id', 'driving_license', 'passport']),
    fullNameOnDoc: z.string().min(2).max(200),
    documentNumber: z.string().max(100).optional(),
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
      .optional(),
    nationality: z.string().max(100).optional(),
    frontImageUrl: z.string().url().optional(),
    backImageUrl: z.string().url().optional(),
    selfieImageUrl: z.string().url().optional(),
  })
  .refine(
    (data) => {
      if (!data.frontImageUrl || !data.selfieImageUrl) return false;
      if (
        (data.documentType === 'national_id' || data.documentType === 'driving_license') &&
        !data.backImageUrl
      ) {
        return false;
      }
      return true;
    },
    {
      message:
        'Document front image, live selfie photo, and document back image (for National ID/Driving License) are required.',
    },
  );

// ── Academic record ──────────────────────────────────────────────────────

export const academicRecordSchema = z.object({
  recordType: z.enum(['degree', 'diploma', 'certificate', 'license']),
  title: z.string().min(2).max(300),
  institution: z.string().min(2).max(300),
  fieldOfStudy: z.string().max(200).optional(),
  graduationYear: z.number().int().min(1950).max(new Date().getFullYear()).optional(),
  grade: z.string().max(50).optional(),
  certificateImageUrl: z.string().url().optional(),
  transcriptImageUrl: z.string().url().optional(),
});

/** PATCH body for updating an academic record (all optional). */
export const updateAcademicRecordSchema = academicRecordSchema.partial();

// ── Expert profile update ────────────────────────────────────────────────

export const updateExpertProfileSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  headline: z.string().min(2).max(300).optional(),
  bio: z.string().max(2000).optional(),
  specializations: z.array(z.string().max(100)).max(20).optional(),
  yearsOfExperience: z.number().int().min(0).max(60).optional(),
  hourlyRate: z.number().min(0).max(100000).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  availabilityStatus: z.enum(['available', 'busy', 'offline']).optional(),
  employer: z.string().max(200).optional(),
  jobTitle: z.string().max(200).optional(),
  linkedinUrl: urlOrDomain(500),
  portfolioUrl: urlOrDomain(500),
  languages: z.array(z.string().max(50)).max(10).optional(),
  educationSummary: z.string().max(2000).optional(),
});

// ── Business profile update ──────────────────────────────────────────────

export const updateCustomerProfileSchema = z.object({
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  contactPreference: z.string().max(50).nullable().optional(),
});

export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;

export const updateBusinessProfileSchema = z.object({
  companyName: z.string().min(2).max(200).optional(),
  tradeLicenseNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),
  commercialRegister: z.string().max(100).optional(),
  industry: z.string().max(100).optional(),
  companySize: z.enum(['1-10', '11-50', '51-200', '201-500', '500+']).optional(),
  website: urlOrDomain(255),
  companyEmail: z.string().email().max(255).optional(),
  companyPhone: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  logoUrl: z
    .union([z.string().max(500).url(), z.null()])
    .optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
  ownerFullName: z.string().max(200).optional(),
  ownerTitle: z.string().max(100).optional(),
  ownerEmail: z.string().email().max(255).optional(),
  ownerPhone: z.string().max(20).optional(),
  socialFacebook: urlOrDomain(500),
  socialLinkedin: urlOrDomain(500),
  socialTwitter: urlOrDomain(500),
  employeesCount: z.number().int().min(1).max(100000).optional(),
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
});

// ── Admin review ─────────────────────────────────────────────────────────

export const adminReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().max(2000).optional(),
});
