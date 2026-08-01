import {
  DIRECT_PAYMENT_ISSUE_REASONS,
  NEED_JOB_DISPUTE_REASONS,
  SAFETY_REPORT_REASONS,
} from '@mohandishub/shared';
import { z } from 'zod';

/**
 * Public upload URLs may be absolute (Supabase) or root-relative (`/uploads/…`).
 * Mirrors the support module's rule so a client that already works there does
 * not start failing when it posts through the unified centre.
 */
const attachmentUrl = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed || trimmed.includes('..')) return false;
    try {
      const u = new URL(trimmed);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return trimmed.startsWith('/');
    }
  },
  { message: 'Invalid attachment URL (expected http(s) URL or root-relative path).' },
);

const uuid = z.string().uuid();

const generalSupportSchema = z.object({
  kind: z.literal('general_support'),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(10000),
  category: z.enum(['bug', 'suggestion', 'error', 'other']).optional(),
  attachmentUrls: z.array(attachmentUrl).max(2).optional(),
});

const needJobDisputeSchema = z.object({
  kind: z.literal('need_job_dispute'),
  subjectType: z.enum(['need', 'job_application']),
  subjectId: uuid,
  reason: z.enum(NEED_JOB_DISPUTE_REASONS),
  description: z.string().trim().min(1).max(10000),
  evidenceUploadIds: z.array(uuid).max(10).optional(),
});

const directPaymentSchema = z.object({
  kind: z.literal('direct_payment'),
  subjectType: z.enum(['need', 'reservation']),
  subjectId: uuid,
  reason: z.enum(DIRECT_PAYMENT_ISSUE_REASONS),
  description: z.string().trim().min(1).max(10000),
  amount: z.number().nonnegative().max(1_000_000_000).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  evidenceUploadIds: z.array(uuid).max(10).optional(),
});

const safetyReportSchema = z.object({
  kind: z.literal('safety_report'),
  reason: z.enum(SAFETY_REPORT_REASONS),
  description: z.string().trim().min(1).max(10000),
  reportedUserId: uuid.optional(),
  subjectType: z.enum(['service', 'need', 'job', 'reservation', 'message', 'user']).optional(),
  subjectId: uuid.optional(),
  evidenceUploadIds: z.array(uuid).max(10).optional(),
});

export const createCaseSchema = z
  .discriminatedUnion('kind', [
    generalSupportSchema,
    needJobDisputeSchema,
    directPaymentSchema,
    safetyReportSchema,
  ])
  .refine(
    (value) =>
      value.kind !== 'safety_report' || (value.subjectType == null) === (value.subjectId == null),
    { message: 'subjectType and subjectId must be provided together.' },
  );

export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(10000),
  visibility: z.enum(['participants', 'admin']).optional(),
  attachmentUrls: z.array(attachmentUrl).max(2).optional(),
});

export const addEvidenceSchema = z.object({
  uploadId: uuid,
  label: z.string().trim().min(1).max(280).optional(),
});

export const escalateSchema = z.object({
  reason: z.string().trim().min(1).max(2000).optional(),
});

export const resolveCaseSchema = z.object({
  outcome: z.enum([
    'resolved_for_opener',
    'resolved_for_counterparty',
    'resolved_partial',
    'no_action',
    'duplicate',
    'withdrawn',
  ]),
  notes: z.string().trim().min(1).max(4000),
  status: z.enum(['resolved', 'closed']).optional(),
});

export const adminStatusSchema = z.object({
  status: z.enum(['open', 'awaiting_user', 'under_review']),
});

export const assignCaseSchema = z.object({
  adminId: uuid.nullable(),
});

export const counterpartyAccessSchema = z.object({
  granted: z.boolean(),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type PostMessageInput = z.infer<typeof postMessageSchema>;
export type AddEvidenceInput = z.infer<typeof addEvidenceSchema>;
export type EscalateInput = z.infer<typeof escalateSchema>;
export type ResolveCaseInput = z.infer<typeof resolveCaseSchema>;
export type AdminStatusInput = z.infer<typeof adminStatusSchema>;
export type AssignCaseInput = z.infer<typeof assignCaseSchema>;
export type CounterpartyAccessInput = z.infer<typeof counterpartyAccessSchema>;
