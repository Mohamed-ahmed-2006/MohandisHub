// ---------------------------------------------------------------------------
// Verification service — orchestrates provider + repository
// ---------------------------------------------------------------------------

import type { VerificationRequestType, VerificationStatus } from '@mohandishub/shared';
import { isVerifiableRole } from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../utils/http-error.js';
import { ProfilesRepository } from '../profiles/profiles.repository.js';
import {
  assertRequiredVerificationImage,
  getEffectiveBusinessVerificationStatus,
  getEffectiveCraftsmanVerificationStatus,
  getEffectiveExpertVerificationStatus,
  hasRequiredVerificationImage,
} from '../profiles/verification-image-requirements.js';

import type { IVerificationProvider } from './verification.provider.js';
import { createVerificationProvider } from './verification.provider.js';
import { VerificationRepository } from './verification.repository.js';
import type { VerificationRequestRow, WebhookHeaders } from './verification.types.js';

export class VerificationService {
  private readonly provider: IVerificationProvider;

  constructor(
    private readonly verificationRepo: VerificationRepository = new VerificationRepository(),
    private readonly profilesRepo: ProfilesRepository = new ProfilesRepository(),
    provider: IVerificationProvider = createVerificationProvider(env.VERIFICATION_PROVIDER),
  ) {
    this.provider = provider;
  }

  // ── Initiate verification ──────────────────────────────────────────────

  async initiate(params: { userId: string; role: string }): Promise<{
    requestId: string;
    redirectUrl?: string | undefined;
    sessionToken?: string | undefined;
  }> {
    if (!isVerifiableRole(params.role)) {
      throw new HttpError({
        statusCode: 400,
        code: 'VERIFICATION_NOT_REQUIRED',
        message: 'Verification is not required for your role.',
      });
    }

    await assertRequiredVerificationImage(this.profilesRepo, params.userId, params.role);

    const identityDocs = await this.profilesRepo.findIdentityDocuments(params.userId);
    if (identityDocs.some((d) => d.status === 'pending' || d.status === 'under_review')) {
      throw new HttpError({
        statusCode: 409,
        code: 'IDENTITY_SUBMISSION_BLOCKS_KYC',
        message:
          'You have a manual identity submission in review. Remove it before starting online verification.',
      });
    }

    // Check if there's already a pending/under_review verification
    const existing = await this.verificationRepo.findLatestByUserId(params.userId);
    if (existing && (existing.status === 'initiated' || existing.status === 'submitted')) {
      throw new HttpError({
        statusCode: 409,
        code: 'VERIFICATION_ALREADY_PENDING',
        message: 'You already have a pending verification request.',
      });
    }

    const requestType: VerificationRequestType =
      params.role === 'business' ? 'business' : 'identity';

    const account = await this.profilesRepo.findUserBasicById(params.userId);
    if (!account) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found.',
      });
    }

    // Call the provider
    const session = await this.provider.createSession({
      userId: params.userId,
      email: account.email,
      displayName: account.display_name,
      type: requestType,
    });

    // Store in DB
    const verificationRequest = await this.verificationRepo.createRequest({
      userId: params.userId,
      provider: env.VERIFICATION_PROVIDER,
      providerSessionId: session.sessionId,
      requestType,
    });

    // Update profile status to 'pending'
    const verifiableRole: 'expert' | 'business' | 'craftsman' =
      params.role === 'business'
        ? 'business'
        : params.role === 'craftsman'
          ? 'craftsman'
          : 'expert';
    await this.verificationRepo.updateProfileVerificationStatus(
      params.userId,
      verifiableRole,
      'pending',
    );

    return {
      requestId: verificationRequest.id,
      redirectUrl: session.redirectUrl,
      sessionToken: session.sessionToken,
    };
  }

  // ── Get current verification status ────────────────────────────────────

  async getStatus(
    userId: string,
    role?: string,
  ): Promise<{
    status: VerificationStatus;
    latestRequest: VerificationRequestRow | null;
  }> {
    // For manual identity flow, admin approves identity_documents and updates only
    // business_profiles/expert_profiles.verification_status (no verification_request).
    // So we must consider profile status so GET /status returns 'verified' after admin approval.
    if (role === 'expert' || role === 'business' || role === 'craftsman') {
      const profileStatus =
        role === 'expert'
          ? getEffectiveExpertVerificationStatus(
              (await this.profilesRepo.findExpertProfile(userId)) ?? {
                verification_status: 'unverified',
                identity_verified: false,
                academic_verified: false,
              },
              Boolean((await this.profilesRepo.getUserAvatarUrl(userId))?.trim()),
            )
          : role === 'craftsman'
            ? getEffectiveCraftsmanVerificationStatus(
                (await this.profilesRepo.findCraftsmanProfile(userId)) ?? {
                  verification_status: 'unverified',
                  identity_verified: false,
                },
                Boolean((await this.profilesRepo.getUserAvatarUrl(userId))?.trim()),
              )
            : getEffectiveBusinessVerificationStatus(
                (await this.profilesRepo.findBusinessProfile(userId)) ?? {
                  verification_status: 'unverified',
                  identity_verified: false,
                  business_verified: false,
                },
                Boolean((await this.profilesRepo.getBusinessLogoUrl(userId))?.trim()),
              );
      if (profileStatus === 'verified') {
        const latestRequest = await this.verificationRepo.findLatestByUserId(userId);
        return { status: 'verified', latestRequest };
      }
      if (profileStatus === 'rejected') {
        const latestRequest = await this.verificationRepo.findLatestByUserId(userId);
        return { status: 'rejected', latestRequest };
      }
      if (profileStatus === 'pending' || profileStatus === 'under_review') {
        const latestRequest = await this.verificationRepo.findLatestByUserId(userId);
        return { status: profileStatus, latestRequest };
      }
    }

    const latestRequest = await this.verificationRepo.findLatestByUserId(userId);

    if (!latestRequest) {
      return { status: 'unverified', latestRequest: null };
    }

    // Map request status → verification status
    const statusMap: Record<string, VerificationStatus> = {
      initiated: 'pending',
      submitted: 'under_review',
      approved: 'verified',
      rejected: 'rejected',
      expired: 'unverified',
    };

    return {
      status: statusMap[latestRequest.status] ?? 'unverified',
      latestRequest,
    };
  }

  // ── Handle provider webhook ────────────────────────────────────────────

  async handleWebhook(payload: unknown, headers?: WebhookHeaders): Promise<void> {
    const result = await this.provider.handleWebhook(payload, headers);

    const isTerminal = result.approved === true || result.approved === false;
    const isUnderReview = result.status === 'under_review';

    if (!isTerminal && !isUnderReview) {
      logger.info('Webhook: non-terminal status, acknowledged without DB update', {
        sessionId: result.sessionId,
      });
      return;
    }

    const request = await this.verificationRepo.findByProviderSessionId(result.sessionId);
    if (!request) {
      logger.warn('Webhook: unknown session ID', { sessionId: result.sessionId });
      return;
    }

    if (isTerminal) {
      const newStatus = result.approved ? 'approved' : 'rejected';
      const role = await this.resolveRequestRole(request.user_id, request.request_type);
      const hasRequiredImage = await hasRequiredVerificationImage(
        this.profilesRepo,
        request.user_id,
        role,
      );
      const profileStatus =
        result.approved && !hasRequiredImage
          ? 'under_review'
          : result.approved
            ? 'verified'
            : 'rejected';
      const identityMethod =
        result.approved && role !== 'business'
          ? request.provider === 'manual'
            ? 'manual'
            : 'didit'
          : undefined;

      const transitioned = await this.verificationRepo.applyTerminalOutcome({
        requestId: request.id,
        status: newStatus,
        providerResponse: result.rawPayload,
        role,
        profileStatus,
        identityApproved: result.approved === true,
        ...(identityMethod ? { identityVerificationMethod: identityMethod } : {}),
        auditAction: 'verification.webhook_result',
      });
      if (!transitioned) {
        logger.warn('Webhook: ignored duplicate or conflicting terminal transition', {
          sessionId: result.sessionId,
          currentStatus: request.status,
          attemptedStatus: newStatus,
        });
      }
      return;
    }

    // Under review: provider sent "In Progress" / "In Review" etc.
    const transitioned = await this.verificationRepo.transitionStatus(
      request.id,
      ['initiated'],
      'submitted',
      { providerResponse: result.rawPayload },
    );
    if (!transitioned) return;

    const role = await this.resolveRequestRole(request.user_id, request.request_type);
    await this.verificationRepo.updateProfileVerificationStatus(
      request.user_id,
      role,
      'under_review',
    );
  }

  // ── Admin: manually approve/reject (for 'manual' provider) ────────────

  async adminReview(params: {
    requestId: string;
    approved: boolean;
    reviewerNotes?: string;
    reviewedBy: string;
  }): Promise<void> {
    const request = await this.verificationRepo.findById(params.requestId);

    if (!request) {
      throw new HttpError({
        statusCode: 404,
        code: 'VERIFICATION_NOT_FOUND',
        message: 'Verification request not found.',
      });
    }

    const role = await this.resolveRequestRole(request.user_id, request.request_type);
    const hasRequiredImage = params.approved
      ? await hasRequiredVerificationImage(this.profilesRepo, request.user_id, role)
      : false;
    const profileStatus =
      params.approved && !hasRequiredImage
        ? 'under_review'
        : params.approved
          ? 'verified'
          : 'rejected';
    const identityMethod = params.approved && role !== 'business' ? 'manual' : undefined;

    const transitioned = await this.verificationRepo.applyTerminalOutcome({
      requestId: request.id,
      status: params.approved ? 'approved' : 'rejected',
      ...(params.reviewerNotes ? { reviewerNotes: params.reviewerNotes } : {}),
      reviewedBy: params.reviewedBy,
      role,
      profileStatus,
      identityApproved: params.approved,
      ...(identityMethod ? { identityVerificationMethod: identityMethod } : {}),
      auditAction: 'verification.admin_review',
    });
    if (!transitioned) {
      throw new HttpError({
        statusCode: 409,
        code: 'VERIFICATION_ALREADY_REVIEWED',
        message: 'This verification request has already reached a terminal state.',
      });
    }
  }

  private async resolveRequestRole(
    userId: string,
    requestType: VerificationRequestType,
  ): Promise<'expert' | 'business' | 'craftsman'> {
    if (requestType === 'business') return 'business';

    const user = await this.profilesRepo.findUserBasicById(userId);
    if (user?.primary_role === 'craftsman') return 'craftsman';
    return 'expert';
  }
}
