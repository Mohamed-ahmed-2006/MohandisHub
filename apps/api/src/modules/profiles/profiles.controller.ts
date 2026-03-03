// ---------------------------------------------------------------------------
// Profiles controller — HTTP handlers for profiles, docs, records, admin
// ---------------------------------------------------------------------------

import type {
  AcademicRecord,
  AdminReview,
  ApiSuccessBody,
  BusinessProfile,
  ExpertProfile,
  IdentityDocument,
  PendingVerificationItem,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ProfilesService } from './profiles.service.js';
import {
  academicRecordSchema,
  adminReviewSchema,
  identityDocumentSchema,
  updateBusinessProfileSchema,
  updateExpertProfileSchema,
} from './profiles.validation.js';

const profilesService = new ProfilesService();

// ── Helpers ──────────────────────────────────────────────────────────────

function requireAuth(req: { user?: { id: string; role: string } }): { id: string; role: string } {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

function requireAdmin(req: { user?: { id: string; role: string } }): { id: string; role: string } {
  const user = requireAuth(req);
  if (user.role !== 'admin') {
    throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Admin access required.' });
  }
  return user;
}

// ═════════════════════════════════════════════════════════════════════════
// EXPERT PROFILE
// ═════════════════════════════════════════════════════════════════════════

const getExpertProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const profile = await profilesService.getExpertProfile(user.id);
  const response: ApiSuccessBody<ExpertProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateExpertProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts can update expert profiles.',
    });
  }
  const input = updateExpertProfileSchema.parse(req.body);
  const profile = await profilesService.updateExpertProfile(user.id, input);
  const response: ApiSuccessBody<ExpertProfile> = { ok: true, data: profile };
  res.json(response);
});

// ═════════════════════════════════════════════════════════════════════════
// BUSINESS PROFILE
// ═════════════════════════════════════════════════════════════════════════

const getBusinessProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const profile = await profilesService.getBusinessProfile(user.id);
  const response: ApiSuccessBody<BusinessProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateBusinessProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'business') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only business users can update business profiles.',
    });
  }
  const input = updateBusinessProfileSchema.parse(req.body);
  const profile = await profilesService.updateBusinessProfile(user.id, input);
  const response: ApiSuccessBody<BusinessProfile> = { ok: true, data: profile };
  res.json(response);
});

// ═════════════════════════════════════════════════════════════════════════
// IDENTITY DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════

const submitIdentityDocument = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert' && user.role !== 'business') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts and businesses need identity verification.',
    });
  }
  const input = identityDocumentSchema.parse(req.body);
  const doc = await profilesService.submitIdentityDocument(user.id, input);
  const response: ApiSuccessBody<IdentityDocument> = { ok: true, data: doc };
  res.status(201).json(response);
});

const getIdentityDocuments = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const docs = await profilesService.getIdentityDocuments(user.id);
  const response: ApiSuccessBody<IdentityDocument[]> = { ok: true, data: docs };
  res.json(response);
});

// ═════════════════════════════════════════════════════════════════════════
// ACADEMIC RECORDS
// ═════════════════════════════════════════════════════════════════════════

const submitAcademicRecord = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts can submit academic records.',
    });
  }
  const input = academicRecordSchema.parse(req.body);
  const record = await profilesService.submitAcademicRecord(user.id, input);
  const response: ApiSuccessBody<AcademicRecord> = { ok: true, data: record };
  res.status(201).json(response);
});

const getAcademicRecords = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const records = await profilesService.getAcademicRecords(user.id);
  const response: ApiSuccessBody<AcademicRecord[]> = { ok: true, data: records };
  res.json(response);
});

// ═════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS
// ═════════════════════════════════════════════════════════════════════════

/** GET /api/admin/verification/pending — list all pending verifications */
const getPendingVerifications = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const items = await profilesService.getPendingVerifications();
  const response: ApiSuccessBody<PendingVerificationItem[]> = { ok: true, data: items };
  res.json(response);
});

/** POST /api/admin/identity/:docId/review — approve/reject identity doc */
const reviewIdentityDocument = asyncHandler(async (req, res) => {
  const admin = requireAdmin(req);
  const { docId } = req.params;
  const input = adminReviewSchema.parse(req.body);
  const review = await profilesService.adminReviewIdentityDocument({
    docId: docId!,
    reviewerId: admin.id,
    decision: input.decision,
    notes: input.notes,
  });
  const response: ApiSuccessBody<AdminReview> = { ok: true, data: review };
  res.json(response);
});

/** POST /api/admin/academic/:recordId/review — approve/reject academic record */
const reviewAcademicRecord = asyncHandler(async (req, res) => {
  const admin = requireAdmin(req);
  const { recordId } = req.params;
  const input = adminReviewSchema.parse(req.body);
  const review = await profilesService.adminReviewAcademicRecord({
    recordId: recordId!,
    reviewerId: admin.id,
    decision: input.decision,
    notes: input.notes,
  });
  const response: ApiSuccessBody<AdminReview> = { ok: true, data: review };
  res.json(response);
});

/** POST /api/admin/business/:userId/review — approve/reject business docs */
const reviewBusinessDocs = asyncHandler(async (req, res) => {
  const admin = requireAdmin(req);
  const { userId } = req.params;
  const input = adminReviewSchema.parse(req.body);
  const review = await profilesService.adminReviewBusinessDocs({
    userId: userId!,
    reviewerId: admin.id,
    decision: input.decision,
    notes: input.notes,
  });
  const response: ApiSuccessBody<AdminReview> = { ok: true, data: review };
  res.json(response);
});

/** GET /api/admin/user/:userId/profile — view full profile for any user */
const getAnyUserProfile = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { userId } = req.params;

  const expertProfile = await profilesService.getExpertProfile(userId!).catch(() => null);
  const businessProfile = await profilesService.getBusinessProfile(userId!).catch(() => null);
  const identityDocs = await profilesService.getIdentityDocuments(userId!);
  const academicRecords = await profilesService.getAcademicRecords(userId!);

  const response: ApiSuccessBody<{
    expertProfile: ExpertProfile | null;
    businessProfile: BusinessProfile | null;
    identityDocuments: IdentityDocument[];
    academicRecords: AcademicRecord[];
  }> = {
    ok: true,
    data: { expertProfile, businessProfile, identityDocuments: identityDocs, academicRecords },
  };
  res.json(response);
});

export const profilesController = {
  getExpertProfile,
  updateExpertProfile,
  getBusinessProfile,
  updateBusinessProfile,
  submitIdentityDocument,
  getIdentityDocuments,
  submitAcademicRecord,
  getAcademicRecords,
  getPendingVerifications,
  reviewIdentityDocument,
  reviewAcademicRecord,
  reviewBusinessDocs,
  getAnyUserProfile,
};
