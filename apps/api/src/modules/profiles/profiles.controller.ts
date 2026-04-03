// ---------------------------------------------------------------------------
// Profiles controller — HTTP handlers for profiles, docs, records, admin
// ---------------------------------------------------------------------------

import type {
  AcademicRecord,
  AdminReview,
  AdminReviewHistoryItem,
  ApiSuccessBody,
  BusinessProfile,
  CraftsmanProfile,
  CustomerProfile,
  ExpertProfile,
  IdentityDocument,
  PendingVerificationItem,
  PublicUserProfile,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';

import { ProfilesService } from './profiles.service.js';
import {
  academicRecordSchema,
  adminReviewSchema,
  identityDocumentSchema,
  updateAcademicRecordSchema,
  updateBusinessProfileSchema,
  updateCraftsmanProfileSchema,
  updateCustomerProfileSchema,
  updateExpertProfileSchema,
} from './profiles.validation.js';

const profilesService = new ProfilesService();

// ── Helpers ──────────────────────────────────────────────────────────────

function requireAuth(req: {
  user?: { id: string; role: string; isAdmin?: boolean };
}): { id: string; role: string; isAdmin?: boolean } {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user;
}

function requireAdmin(req: {
  user?: { id: string; role: string; isAdmin?: boolean };
}): { id: string; role: string; isAdmin?: boolean } {
  const user = requireAuth(req);
  if (user.isAdmin !== true) {
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
// CUSTOMER PROFILE
// ═════════════════════════════════════════════════════════════════════════

const getCraftsmanProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const profile = await profilesService.getCraftsmanProfile(user.id);
  const response: ApiSuccessBody<CraftsmanProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateCraftsmanProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'craftsman') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only craftsmen can update craftsman profiles.',
    });
  }
  const input = updateCraftsmanProfileSchema.parse(req.body);
  const profile = await profilesService.updateCraftsmanProfile(user.id, input);
  const response: ApiSuccessBody<CraftsmanProfile> = { ok: true, data: profile };
  res.json(response);
});

const completeCraftsmanOnboarding = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'craftsman') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only craftsmen can complete craftsman onboarding.',
    });
  }
  await profilesService.completeCraftsmanOnboarding(user.id);
  res.json({ ok: true, data: null });
});

const getCustomerProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'customer') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only customers have a customer profile.',
    });
  }
  const profile = await profilesService.getCustomerProfile(user.id);
  const response: ApiSuccessBody<CustomerProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateCustomerProfile = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'customer') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only customers can update customer profile.',
    });
  }
  const input = updateCustomerProfileSchema.parse(req.body);
  const profile = await profilesService.updateCustomerProfile(user.id, input);
  const response: ApiSuccessBody<CustomerProfile> = { ok: true, data: profile };
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

const completeBusinessOnboarding = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'business') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only business users can complete business onboarding.',
    });
  }
  await profilesService.completeBusinessOnboarding(user.id);
  res.json({ ok: true, data: null });
});

// ═════════════════════════════════════════════════════════════════════════
// IDENTITY DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════

const submitIdentityDocument = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert' && user.role !== 'business' && user.role !== 'craftsman') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only providers with identity verification can submit identity documents.',
    });
  }
  const input = identityDocumentSchema.parse(req.body);
  const doc = await profilesService.submitIdentityDocument(user.id, user.role, input);
  const response: ApiSuccessBody<IdentityDocument> = { ok: true, data: doc };
  res.status(201).json(response);
});

const getIdentityDocuments = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  const docs = await profilesService.getIdentityDocuments(user.id);
  const response: ApiSuccessBody<IdentityDocument[]> = { ok: true, data: docs };
  res.json(response);
});

const withdrawIdentityDocument = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert' && user.role !== 'business' && user.role !== 'craftsman') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only providers with identity verification can withdraw identity submissions.',
    });
  }
  const docId = (req.params.docId ?? '').trim();
  if (!docId) {
    throw new HttpError({
      statusCode: 400,
      code: 'INVALID_REQUEST',
      message: 'Document id is required.',
    });
  }
  await profilesService.withdrawPendingIdentityDocument(user.id, user.role, docId);
  const response: ApiSuccessBody<null> = { ok: true, data: null };
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

const updateAcademicRecord = asyncHandler(async (req, res) => {
  const user = requireAuth(req);
  if (user.role !== 'expert') {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'Only experts can update academic records.',
    });
  }
  const { recordId } = req.params;
  const input = updateAcademicRecordSchema.parse(req.body);
  const record = await profilesService.updateAcademicRecord(user.id, recordId!, input);
  const response: ApiSuccessBody<AcademicRecord> = { ok: true, data: record };
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

/** GET /api/admin/verification/users/:userId/reviews — audit trail of past approve/reject decisions */
const getVerificationReviewHistory = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const userId = req.params.userId;
  if (!userId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'userId is required.',
    });
  }
  const data = await profilesService.getAdminVerificationReviewHistory(userId);
  const response: ApiSuccessBody<AdminReviewHistoryItem[]> = { ok: true, data };
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

/** POST /api/admin/verification/sync-verified-at — sync verification status from flags, then fix verified_at */
const syncVerifiedAt = asyncHandler(async (_req, res) => {
  const result = await profilesService.syncVerifiedAtForManuallyVerified();
  const response: ApiSuccessBody<{
    experts: number;
    businesses: number;
    craftsmen: number;
    expertsStatusSynced?: number;
  }> = { ok: true, data: result };
  res.json(response);
});

/** GET /api/admin/user/:userId/profile — view full profile for any user */
const getAnyUserProfile = asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { userId } = req.params;

  const expertProfile = await profilesService.getExpertProfile(userId!).catch(() => null);
  const businessProfile = await profilesService.getBusinessProfile(userId!).catch(() => null);
  const craftsmanProfile = await profilesService.getCraftsmanProfile(userId!).catch(() => null);
  const identityDocs = await profilesService.getIdentityDocuments(userId!);
  const academicRecords = await profilesService.getAcademicRecords(userId!);

  const response: ApiSuccessBody<{
    expertProfile: ExpertProfile | null;
    businessProfile: BusinessProfile | null;
    craftsmanProfile: CraftsmanProfile | null;
    identityDocuments: IdentityDocument[];
    academicRecords: AcademicRecord[];
  }> = {
    ok: true,
    data: {
      expertProfile,
      businessProfile,
      craftsmanProfile,
      identityDocuments: identityDocs,
      academicRecords,
    },
  };
  res.json(response);
});

const getTopExperts = asyncHandler(async (_req, res) => {
  const items = await profilesService.getTopExperts(6);
  res.json({ ok: true, data: items });
});

const getTopBusinesses = asyncHandler(async (_req, res) => {
  const items = await profilesService.getTopBusinesses(6);
  res.json({ ok: true, data: items });
});

const getTopCraftsmen = asyncHandler(async (_req, res) => {
  const items = await profilesService.getTopCraftsmen(6);
  res.json({ ok: true, data: items });
});

const getPublicProfile = asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  if (!userId) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'userId is required.',
    });
  }
  const profile = await profilesService.getPublicProfile(userId);
  const response: ApiSuccessBody<PublicUserProfile> = { ok: true, data: profile };
  res.json(response);
});

export const profilesController = {
  getTopExperts,
  getTopBusinesses,
  getTopCraftsmen,
  getPublicProfile,
  getExpertProfile,
  updateExpertProfile,
  getCraftsmanProfile,
  updateCraftsmanProfile,
  completeCraftsmanOnboarding,
  getCustomerProfile,
  updateCustomerProfile,
  getBusinessProfile,
  updateBusinessProfile,
  completeBusinessOnboarding,
  submitIdentityDocument,
  getIdentityDocuments,
  withdrawIdentityDocument,
  submitAcademicRecord,
  getAcademicRecords,
  updateAcademicRecord,
  getPendingVerifications,
  getVerificationReviewHistory,
  syncVerifiedAt,
  reviewIdentityDocument,
  reviewAcademicRecord,
  reviewBusinessDocs,
  getAnyUserProfile,
};
