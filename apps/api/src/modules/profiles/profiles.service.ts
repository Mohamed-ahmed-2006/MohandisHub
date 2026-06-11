// ---------------------------------------------------------------------------
// Profiles service — business logic for profiles, docs, records, admin review
// ---------------------------------------------------------------------------

import type {
  AcademicRecord,
  AdminReview,
  AdminReviewHistoryItem,
  BusinessProfile,
  CraftsmanProfile,
  CustomerProfile,
  ExpertProfile,
  IdentityDocument,
  PendingVerificationItem,
  PublicBusinessProfile,
  PublicCraftsmanProfile,
  PublicCustomerProfile,
  PublicExpertProfile,
  PublicUserProfile,
} from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';
import { sendTransactionalEmail } from '../../utils/send-transactional-email.js';
import { AdminRepository } from '../admin/admin.repository.js';
import { logAudit } from '../audit/audit.service.js';
import { ReviewsRepository } from '../reviews/reviews.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { VerificationRepository } from '../verification/verification.repository.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { ProfilesRepository } from './profiles.repository.js';
import type {
  AcademicRecordRow,
  BusinessProfileRow,
  CraftsmanProfileRow,
  ExpertProfileRow,
  IdentityDocumentRow,
} from './profiles.types.js';
import {
  assertRequiredVerificationImage,
  getEffectiveBusinessVerificationStatus,
  getEffectiveCraftsmanVerificationStatus,
  getEffectiveExpertVerificationStatus,
  hasRequiredVerificationImage,
  syncVerificationStatusForRequiredImage,
} from './verification-image-requirements.js';

export class ProfilesService {
  constructor(
    private readonly repo: ProfilesRepository = new ProfilesRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly adminRepo: AdminRepository = new AdminRepository(),
    private readonly reviewsRepo: ReviewsRepository = new ReviewsRepository(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly verificationRepo: VerificationRepository = new VerificationRepository(),
  ) {}

  // ── Expert profile ─────────────────────────────────────────────────────

  async getExpertProfile(userId: string): Promise<ExpertProfile> {
    const row = await this.repo.findExpertProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Expert profile not found.',
      });
    }
    const profile = this.toExpertProfile(row);
    const [averageRating, reviewCount, avatarUrl] = await Promise.all([
      this.reviewsRepo.getAvgRating(userId, 'expert'),
      this.reviewsRepo.getReviewCount(userId, 'expert'),
      this.repo.getUserAvatarUrl(userId),
    ]);
    const hasAvatar = Boolean(avatarUrl?.trim());
    const isProfileComplete =
      hasAvatar &&
      Boolean(row.title?.trim()) &&
      Boolean(row.bio?.trim()) &&
      Array.isArray(row.specializations) &&
      row.specializations.length > 0 &&
      Boolean(row.city?.trim()) &&
      Boolean(row.country?.trim());
    const effectiveStatus = getEffectiveExpertVerificationStatus(row, hasAvatar);
    const totalDeposited = await this.walletRepo.getTotalDeposited(userId);
    const badgeEligible = isProfileComplete && totalDeposited >= 1000;
    if (badgeEligible) await this.repo.setPlatformVerifiedAt(userId);
    const platformVerifiedAt = await this.repo.getPlatformVerifiedAt(userId);
    return {
      ...profile,
      verificationStatus: effectiveStatus,
      averageRating: averageRating ?? null,
      reviewCount,
      verificationBadgeEarned: badgeEligible,
      platformVerifiedAt: platformVerifiedAt?.toISOString() ?? null,
    };
  }

  async updateExpertProfile(
    userId: string,
    input: {
      title?: string | undefined;
      headline?: string | undefined;
      bio?: string | undefined;
      specializations?: string[] | undefined;
      yearsOfExperience?: number | undefined;
      hourlyRate?: number | undefined;
      city?: string | undefined;
      country?: string | undefined;
      availabilityStatus?: string | undefined;
      employer?: string | undefined;
      jobTitle?: string | undefined;
      linkedinUrl?: string | undefined;
      portfolioUrl?: string | undefined;
      languages?: string[] | undefined;
      educationSummary?: string | undefined;
    },
  ): Promise<ExpertProfile> {
    const appStatus = await this.settingsService.getAppStatus();
    if (appStatus.featureHourlyPricingEnabled === false && input.hourlyRate !== undefined) {
      throw new HttpError({
        statusCode: 400,
        code: 'HOURLY_PRICING_DISABLED',
        message: 'Hourly pricing is disabled.',
      });
    }
    // Map camelCase to snake_case for DB
    const dbFields: Record<string, unknown> = {};
    if (input.title !== undefined) dbFields.title = input.title;
    if (input.headline !== undefined) dbFields.headline = input.headline;
    if (input.bio !== undefined) dbFields.bio = input.bio;
    if (input.specializations !== undefined) dbFields.specializations = input.specializations;
    if (input.yearsOfExperience !== undefined)
      dbFields.years_of_experience = input.yearsOfExperience;
    if (input.hourlyRate !== undefined) dbFields.hourly_rate = input.hourlyRate;
    if (input.city !== undefined) dbFields.city = input.city;
    if (input.country !== undefined) dbFields.country = input.country;
    if (input.availabilityStatus !== undefined)
      dbFields.availability_status = input.availabilityStatus;
    if (input.employer !== undefined) dbFields.employer = input.employer;
    if (input.jobTitle !== undefined) dbFields.job_title = input.jobTitle;
    if (input.linkedinUrl !== undefined) dbFields.linkedin_url = input.linkedinUrl;
    if (input.portfolioUrl !== undefined) dbFields.portfolio_url = input.portfolioUrl;
    if (input.languages !== undefined) dbFields.languages = input.languages;
    if (input.educationSummary !== undefined) dbFields.education_summary = input.educationSummary;

    const row = await this.repo.updateExpertProfile(userId, dbFields);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Expert profile not found.',
      });
    }
    await syncVerificationStatusForRequiredImage(this.repo, userId, 'expert');
    return this.toExpertProfile((await this.repo.findExpertProfile(userId)) ?? row);
  }

  // ── Customer profile ───────────────────────────────────────────────────

  async getCraftsmanProfile(userId: string): Promise<CraftsmanProfile> {
    const row = await this.repo.findCraftsmanProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Craftsman profile not found.',
      });
    }
    const profile = this.toCraftsmanProfile(row);
    const [averageRating, reviewCount, avatarUrl] = await Promise.all([
      this.reviewsRepo.getAvgRating(userId, 'craftsman'),
      this.reviewsRepo.getReviewCount(userId, 'craftsman'),
      this.repo.getUserAvatarUrl(userId),
    ]);
    const hasAvatar = Boolean(avatarUrl?.trim());
    const isProfileComplete =
      hasAvatar &&
      Boolean(row.trade?.trim() || row.title?.trim()) &&
      Boolean(row.bio?.trim()) &&
      Array.isArray(row.specializations) &&
      row.specializations.length > 0 &&
      Boolean(row.city?.trim()) &&
      Boolean(row.country?.trim()) &&
      Boolean(row.workshop_name?.trim()) &&
      Boolean(row.workshop_address?.trim());
    const effectiveStatus = getEffectiveCraftsmanVerificationStatus(row, hasAvatar);
    const totalDeposited = await this.walletRepo.getTotalDeposited(userId);
    const badgeEligible = isProfileComplete && totalDeposited >= 1000;
    if (badgeEligible) await this.repo.setPlatformVerifiedAt(userId);
    const platformVerifiedAt = await this.repo.getPlatformVerifiedAt(userId);
    return {
      ...profile,
      verificationStatus: effectiveStatus,
      averageRating: averageRating ?? null,
      reviewCount,
      verificationBadgeEarned: badgeEligible,
      platformVerifiedAt: platformVerifiedAt?.toISOString() ?? null,
    };
  }

  async updateCraftsmanProfile(
    userId: string,
    input: {
      trade?: string | undefined;
      title?: string | undefined;
      headline?: string | undefined;
      bio?: string | undefined;
      specializations?: string[] | undefined;
      yearsOfExperience?: number | undefined;
      hourlyRate?: number | undefined;
      city?: string | undefined;
      country?: string | undefined;
      availabilityStatus?: string | undefined;
      workshopName?: string | undefined;
      workshopAddress?: string | undefined;
      workshopLatitude?: number | undefined;
      workshopLongitude?: number | undefined;
    },
  ): Promise<CraftsmanProfile> {
    const appStatus = await this.settingsService.getAppStatus();
    if (appStatus.featureHourlyPricingEnabled === false && input.hourlyRate !== undefined) {
      throw new HttpError({
        statusCode: 400,
        code: 'HOURLY_PRICING_DISABLED',
        message: 'Hourly pricing is disabled.',
      });
    }
    const dbFields: Record<string, unknown> = {};
    if (input.trade !== undefined) dbFields.trade = input.trade;
    if (input.title !== undefined) dbFields.title = input.title;
    if (input.headline !== undefined) dbFields.headline = input.headline;
    if (input.bio !== undefined) dbFields.bio = input.bio;
    if (input.specializations !== undefined) dbFields.specializations = input.specializations;
    if (input.yearsOfExperience !== undefined)
      dbFields.years_of_experience = input.yearsOfExperience;
    if (input.hourlyRate !== undefined) dbFields.hourly_rate = input.hourlyRate;
    if (input.city !== undefined) dbFields.city = input.city;
    if (input.country !== undefined) dbFields.country = input.country;
    if (input.availabilityStatus !== undefined)
      dbFields.availability_status = input.availabilityStatus;
    if (input.workshopName !== undefined) dbFields.workshop_name = input.workshopName;
    if (input.workshopAddress !== undefined) dbFields.workshop_address = input.workshopAddress;
    if (input.workshopLatitude !== undefined) dbFields.workshop_latitude = input.workshopLatitude;
    if (input.workshopLongitude !== undefined)
      dbFields.workshop_longitude = input.workshopLongitude;

    const row = await this.repo.updateCraftsmanProfile(userId, dbFields);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Craftsman profile not found.',
      });
    }
    await syncVerificationStatusForRequiredImage(this.repo, userId, 'craftsman');
    return this.toCraftsmanProfile((await this.repo.findCraftsmanProfile(userId)) ?? row);
  }

  async completeCraftsmanOnboarding(userId: string): Promise<void> {
    const row = await this.repo.findCraftsmanProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Craftsman profile not found.',
      });
    }
    await this.repo.setCraftsmanOnboardingCompletedAt(userId);
  }

  async getCustomerProfile(userId: string): Promise<CustomerProfile> {
    const row = await this.repo.findCustomerProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Customer profile not found.',
      });
    }
    const contactPreference =
      typeof row.preferences?.contactPreference === 'string'
        ? row.preferences.contactPreference
        : null;
    return {
      userId: row.user_id,
      city: row.city ?? null,
      country: row.country ?? null,
      contactPreference,
    };
  }

  async updateCustomerProfile(
    userId: string,
    input: {
      city?: string | null | undefined;
      country?: string | null | undefined;
      contactPreference?: string | null | undefined;
    },
  ): Promise<CustomerProfile> {
    const updated = await this.repo.updateCustomerProfile(userId, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Customer profile not found.',
      });
    }
    const contactPreference =
      typeof updated.preferences?.contactPreference === 'string'
        ? updated.preferences.contactPreference
        : null;
    return {
      userId: updated.user_id,
      city: updated.city ?? null,
      country: updated.country ?? null,
      contactPreference,
    };
  }

  // ── Business profile ───────────────────────────────────────────────────

  async getBusinessProfile(userId: string): Promise<BusinessProfile> {
    const row = await this.repo.findBusinessProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Business profile not found.',
      });
    }
    const profile = this.toBusinessProfile(row);
    const [averageRating, reviewCount] = await Promise.all([
      this.reviewsRepo.getAvgRating(userId, 'business'),
      this.reviewsRepo.getReviewCount(userId, 'business'),
    ]);
    const isProfileComplete =
      Boolean(row.company_name?.trim()) &&
      Boolean(row.industry?.trim()) &&
      Boolean(row.logo_url?.trim()) &&
      Boolean(row.city?.trim()) &&
      Boolean(row.country?.trim()) &&
      Boolean(row.description?.trim());
    const effectiveStatus = getEffectiveBusinessVerificationStatus(
      row,
      Boolean(row.logo_url?.trim()),
    );
    const totalDeposited = await this.walletRepo.getTotalDeposited(userId);
    const badgeEligible = isProfileComplete && totalDeposited >= 1000;
    if (badgeEligible) await this.repo.setPlatformVerifiedAt(userId);
    const platformVerifiedAt = await this.repo.getPlatformVerifiedAt(userId);
    return {
      ...profile,
      verificationStatus: effectiveStatus,
      averageRating: averageRating ?? null,
      reviewCount,
      verificationBadgeEarned: badgeEligible,
      platformVerifiedAt: platformVerifiedAt?.toISOString() ?? null,
    };
  }

  async updateBusinessProfile(
    userId: string,
    input: {
      companyName?: string | undefined;
      tradeLicenseNumber?: string | undefined;
      taxId?: string | undefined;
      commercialRegister?: string | undefined;
      industry?: string | undefined;
      companySize?: string | undefined;
      website?: string | undefined;
      companyEmail?: string | undefined;
      companyPhone?: string | undefined;
      address?: string | undefined;
      logoUrl?: string | null | undefined;
      city?: string | undefined;
      country?: string | undefined;
      description?: string | undefined;
      ownerFullName?: string | undefined;
      ownerTitle?: string | undefined;
      ownerEmail?: string | undefined;
      ownerPhone?: string | undefined;
      socialFacebook?: string | undefined;
      socialLinkedin?: string | undefined;
      socialTwitter?: string | undefined;
      employeesCount?: number | undefined;
      foundedYear?: number | undefined;
    },
  ): Promise<BusinessProfile> {
    const dbFields: Record<string, unknown> = {};
    if (input.companyName !== undefined) dbFields.company_name = input.companyName;
    if (input.tradeLicenseNumber !== undefined)
      dbFields.trade_license_number = input.tradeLicenseNumber;
    if (input.taxId !== undefined) dbFields.tax_id = input.taxId;
    if (input.commercialRegister !== undefined)
      dbFields.commercial_register = input.commercialRegister;
    if (input.industry !== undefined) dbFields.industry = input.industry;
    if (input.companySize !== undefined) dbFields.company_size = input.companySize;
    if (input.website !== undefined) dbFields.website = input.website;
    if (input.companyEmail !== undefined) dbFields.company_email = input.companyEmail;
    if (input.companyPhone !== undefined) dbFields.company_phone = input.companyPhone;
    if (input.address !== undefined) dbFields.address = input.address;
    if (input.logoUrl !== undefined) dbFields.logo_url = input.logoUrl;
    if (input.city !== undefined) dbFields.city = input.city;
    if (input.country !== undefined) dbFields.country = input.country;
    if (input.description !== undefined) dbFields.description = input.description;
    if (input.ownerFullName !== undefined) dbFields.owner_full_name = input.ownerFullName;
    if (input.ownerTitle !== undefined) dbFields.owner_title = input.ownerTitle;
    if (input.ownerEmail !== undefined) dbFields.owner_email = input.ownerEmail;
    if (input.ownerPhone !== undefined) dbFields.owner_phone = input.ownerPhone;
    if (input.socialFacebook !== undefined) dbFields.social_facebook = input.socialFacebook;
    if (input.socialLinkedin !== undefined) dbFields.social_linkedin = input.socialLinkedin;
    if (input.socialTwitter !== undefined) dbFields.social_twitter = input.socialTwitter;
    if (input.employeesCount !== undefined) dbFields.employees_count = input.employeesCount;
    if (input.foundedYear !== undefined) dbFields.founded_year = input.foundedYear;

    const row = await this.repo.updateBusinessProfile(userId, dbFields);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Business profile not found.',
      });
    }
    if (input.logoUrl !== undefined) {
      await syncVerificationStatusForRequiredImage(this.repo, userId, 'business');
    }
    return this.toBusinessProfile((await this.repo.findBusinessProfile(userId)) ?? row);
  }

  async completeBusinessOnboarding(userId: string): Promise<void> {
    const row = await this.repo.findBusinessProfile(userId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Business profile not found.',
      });
    }
    await this.repo.setBusinessOnboardingCompletedAt(userId);
  }

  // ── Identity documents ─────────────────────────────────────────────────

  async submitIdentityDocument(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
    input: {
      documentType: string;
      fullNameOnDoc: string;
      documentNumber?: string | undefined;
      dateOfBirth?: string | undefined;
      nationality?: string | undefined;
      frontImageUrl?: string | undefined;
      backImageUrl?: string | undefined;
      selfieImageUrl?: string | undefined;
    },
  ): Promise<IdentityDocument> {
    const status = await this.settingsService.getAppStatus();
    if (status.pauseVerificationSubmissions) {
      throw new HttpError({
        statusCode: 503,
        code: 'VERIFICATION_SUBMISSIONS_PAUSED',
        message: 'Verification submissions are temporarily disabled.',
      });
    }

    await assertRequiredVerificationImage(this.repo, userId, role);

    const existingDocs = await this.repo.findIdentityDocuments(userId);
    if (role === 'business' && existingDocs.some((d) => d.status === 'approved')) {
      throw new HttpError({
        statusCode: 409,
        code: 'IDENTITY_ALREADY_VERIFIED',
        message:
          'Your identity has already been verified. A new submission is only allowed after a rejection.',
      });
    }
    if (existingDocs.some((d) => d.status === 'pending' || d.status === 'under_review')) {
      throw new HttpError({
        statusCode: 409,
        code: 'IDENTITY_SUBMISSION_ALREADY_PENDING',
        message:
          'You already have an identity submission under review. Remove it before submitting a new one.',
      });
    }

    const row = await this.repo.createIdentityDocument({
      userId,
      ...input,
    });

    // Set profile verification_status to 'pending' so GET /verification/status returns 'pending'
    // and the UI does not redirect back to the KYC selector.
    if (role === 'business') {
      await this.repo.updateBusinessOverallStatus(userId, 'pending');
    } else if (role === 'craftsman') {
      await this.repo.updateCraftsmanOverallStatus(userId, 'pending');
    } else {
      await this.repo.updateExpertOverallStatus(userId, 'pending');
    }

    return this.toIdentityDocument(row);
  }

  async getIdentityDocuments(userId: string): Promise<IdentityDocument[]> {
    const rows = await this.repo.findIdentityDocuments(userId);
    return rows.map((r) => this.toIdentityDocument(r));
  }

  async withdrawPendingIdentityDocument(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
    docId: string,
  ): Promise<void> {
    const deleted = await this.repo.deleteIdentityDocumentIfPending(userId, docId);
    if (!deleted) {
      throw new HttpError({
        statusCode: 404,
        code: 'IDENTITY_DOCUMENT_NOT_WITHDRAWABLE',
        message:
          'That document was not found or cannot be withdrawn. Only pending or under-review submissions can be removed.',
      });
    }
    await this.reconcileProfileAfterIdentityWithdraw(userId, role);
  }

  private async reconcileProfileAfterIdentityWithdraw(
    userId: string,
    role: 'expert' | 'business' | 'craftsman',
  ): Promise<void> {
    const docs = await this.repo.findIdentityDocuments(userId);
    if (docs.some((d) => d.status === 'pending' || d.status === 'under_review')) {
      return;
    }

    const latestReq = await this.verificationRepo.findLatestByUserId(userId);
    if (latestReq && (latestReq.status === 'initiated' || latestReq.status === 'submitted')) {
      return;
    }

    const row =
      role === 'expert'
        ? await this.repo.findExpertProfile(userId)
        : role === 'craftsman'
          ? await this.repo.findCraftsmanProfile(userId)
          : await this.repo.findBusinessProfile(userId);
    const rawStatus = row?.verification_status;
    if (rawStatus !== 'pending' && rawStatus !== 'under_review') {
      return;
    }

    if (role === 'business') {
      await this.repo.updateBusinessOverallStatus(userId, 'unverified');
    } else if (role === 'craftsman') {
      await this.repo.updateCraftsmanOverallStatus(userId, 'unverified');
    } else {
      await this.repo.updateExpertOverallStatus(userId, 'unverified');
    }

    await syncVerificationStatusForRequiredImage(this.repo, userId, role);
  }

  // ── Academic records ───────────────────────────────────────────────────

  async submitAcademicRecord(
    userId: string,
    input: {
      recordType: string;
      title: string;
      institution: string;
      fieldOfStudy?: string | undefined;
      graduationYear?: number | undefined;
      grade?: string | undefined;
      certificateImageUrl?: string | undefined;
      transcriptImageUrl?: string | undefined;
    },
  ): Promise<AcademicRecord> {
    const status = await this.settingsService.getAppStatus();
    if (status.pauseVerificationSubmissions) {
      throw new HttpError({
        statusCode: 503,
        code: 'VERIFICATION_SUBMISSIONS_PAUSED',
        message: 'Verification submissions are temporarily disabled.',
      });
    }

    const row = await this.repo.createAcademicRecord({
      userId,
      ...input,
    });

    // Update the certifications_count on expert profile
    const records = await this.repo.findAcademicRecords(userId);
    const profile = await this.repo.findExpertProfile(userId);
    if (profile) {
      await this.repo.updateExpertProfile(userId, {
        certifications_count: records.length,
      } as Record<string, unknown>);
    }

    return this.toAcademicRecord(row);
  }

  async getAcademicRecords(userId: string): Promise<AcademicRecord[]> {
    const rows = await this.repo.findAcademicRecords(userId);
    return rows.map((r) => this.toAcademicRecord(r));
  }

  async updateAcademicRecord(
    userId: string,
    recordId: string,
    input: {
      recordType?: string | undefined;
      title?: string | undefined;
      institution?: string | undefined;
      fieldOfStudy?: string | null | undefined;
      graduationYear?: number | null | undefined;
      grade?: string | null | undefined;
      certificateImageUrl?: string | null | undefined;
      transcriptImageUrl?: string | null | undefined;
    },
  ): Promise<AcademicRecord> {
    const row = await this.repo.updateAcademicRecord(recordId, userId, input);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'ACADEMIC_RECORD_NOT_FOUND',
        message: 'Academic record not found or you do not have permission to update it.',
      });
    }
    return this.toAcademicRecord(row);
  }

  /**
   * Where admin verification decisions are stored (see also `admin_reviews`):
   * - **Identity** (`review_type: identity`, `target_table: identity_documents`): updates the
   *   identity document row’s status; sets profile `identity_verified` on expert / business /
   *   craftsman; sets expert `identity_verification_method` when manual; recomputes
   *   `verification_status` / `verified_at` on the role profile (expert also needs academic + avatar;
   *   business needs `business_verified` + logo; craftsman needs avatar).
   * - **Academic** (`academic`, `academic_records`): expert `academic_verified` and overall expert status.
   * - **Business company docs** (`business_docs`, `business_profiles`): `business_verified` and
   *   overall business `verification_status`; `target_record_id` is the **business_profiles.id** UUID.
   */
  async getAdminVerificationReviewHistory(targetUserId: string): Promise<AdminReviewHistoryItem[]> {
    const rows = await this.repo.findAdminReviewsForTargetUser(targetUserId);
    return rows.map((r) => ({
      id: r.id,
      reviewerId: r.reviewer_id,
      reviewerDisplayName: r.reviewer_display_name,
      targetUserId: r.target_user_id,
      reviewType: r.review_type,
      targetTable: r.target_table,
      targetRecordId: r.target_record_id,
      decision: r.decision,
      notes: r.notes,
      createdAt: r.created_at.toISOString(),
    }));
  }

  // ── Admin: review identity document ────────────────────────────────────

  async adminReviewIdentityDocument(params: {
    docId: string;
    reviewerId: string;
    decision: 'approved' | 'rejected';
    notes?: string | undefined;
  }): Promise<AdminReview> {
    const doc = await this.repo.findIdentityDocumentById(params.docId);
    if (!doc) {
      throw new HttpError({
        statusCode: 404,
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Identity document not found.',
      });
    }

    // Update document status
    await this.repo.updateIdentityDocumentStatus(params.docId, params.decision, {
      rejectionReason: params.decision === 'rejected' ? params.notes : undefined,
      reviewedBy: params.reviewerId,
    });

    // Create audit trail
    const review = await this.repo.createAdminReview({
      reviewerId: params.reviewerId,
      targetUserId: doc.user_id,
      reviewType: 'identity',
      targetTable: 'identity_documents',
      targetRecordId: params.docId,
      decision: params.decision,
      notes: params.notes,
    });
    await logAudit({
      actorId: params.reviewerId,
      action: 'admin.verification.identity_review',
      resourceType: 'identity_document',
      resourceId: params.docId,
      details: {
        targetUserId: doc.user_id,
        decision: params.decision,
        notes: params.notes ?? null,
      },
    });

    // If approved, update the identity_verified flag on expert or business profile
    if (params.decision === 'approved') {
      const expertProfile = await this.repo.findExpertProfile(doc.user_id);
      if (expertProfile) {
        await this.repo.setExpertIdentityVerified(doc.user_id, true);
        await this.repo.setExpertIdentityVerificationMethod(doc.user_id, 'manual');
        // Check if both identity + academic are verified → set overall status
        const hasAvatar = await hasRequiredVerificationImage(this.repo, doc.user_id, 'expert');
        if (expertProfile.academic_verified && hasAvatar) {
          await this.repo.updateExpertOverallStatus(doc.user_id, 'verified');
        } else {
          await this.repo.updateExpertOverallStatus(doc.user_id, 'under_review');
        }
      }

      const businessProfile = await this.repo.findBusinessProfile(doc.user_id);
      if (businessProfile) {
        await this.repo.setBusinessIdentityVerified(doc.user_id, true);
        const hasLogo = await hasRequiredVerificationImage(this.repo, doc.user_id, 'business');
        if (businessProfile.business_verified && hasLogo) {
          await this.repo.updateBusinessOverallStatus(doc.user_id, 'verified');
        } else {
          await this.repo.updateBusinessOverallStatus(doc.user_id, 'under_review');
        }
      }

      const craftsmanProfile = await this.repo.findCraftsmanProfile(doc.user_id);
      if (craftsmanProfile) {
        await this.repo.setCraftsmanIdentityVerified(doc.user_id, true);
        await this.repo.setCraftsmanIdentityVerificationMethod(doc.user_id, 'manual');
        const hasAvatar = await hasRequiredVerificationImage(this.repo, doc.user_id, 'craftsman');
        if (hasAvatar) {
          await this.repo.updateCraftsmanOverallStatus(doc.user_id, 'verified');
        } else {
          await this.repo.updateCraftsmanOverallStatus(doc.user_id, 'under_review');
        }
      }

      const user = await this.repo.findUserBasicById(doc.user_id);
      if (user) {
        await sendTransactionalEmail({
          to: user.email,
          displayName: user.display_name,
          subject: 'MohandisHub - Identity verified',
          preheader: 'Your identity has been verified',
          title: 'Identity verified',
          greeting: `Hello ${user.display_name},`,
          introLines: [
            'Your identity document has been reviewed and approved.',
            'You can now continue with your onboarding and access the full platform.',
          ],
        });
      }
    }

    if (params.decision === 'rejected') {
      const user = await this.repo.findUserBasicById(doc.user_id);
      if (user) {
        const reason = params.notes?.trim() || 'No reason provided.';
        await sendTransactionalEmail({
          to: user.email,
          displayName: user.display_name,
          subject: 'MohandisHub - Identity verification rejected',
          preheader: 'Your identity verification was rejected',
          title: 'Identity verification rejected',
          greeting: `Hello ${user.display_name},`,
          introLines: [
            'Your identity document has been reviewed and was not approved.',
            `Reason: ${reason}`,
            'Please log in and resubmit your identity document to continue.',
          ],
        });
      }
      // Allow user to resubmit: update profile to rejected, do not soft-delete
      const expertProfile = await this.repo.findExpertProfile(doc.user_id);
      if (expertProfile) {
        await this.repo.setExpertIdentityVerified(doc.user_id, false);
        await this.repo.updateExpertOverallStatus(doc.user_id, 'rejected');
      }
      const businessProfile = await this.repo.findBusinessProfile(doc.user_id);
      if (businessProfile) {
        await this.repo.setBusinessIdentityVerified(doc.user_id, false);
        await this.repo.updateBusinessOverallStatus(doc.user_id, 'rejected');
      }
      const craftsmanProfile = await this.repo.findCraftsmanProfile(doc.user_id);
      if (craftsmanProfile) {
        await this.repo.setCraftsmanIdentityVerified(doc.user_id, false);
        await this.repo.updateCraftsmanOverallStatus(doc.user_id, 'rejected');
      }
    }

    return this.toAdminReview(review);
  }

  // ── Admin: review academic record ──────────────────────────────────────

  async adminReviewAcademicRecord(params: {
    recordId: string;
    reviewerId: string;
    decision: 'approved' | 'rejected';
    notes?: string | undefined;
  }): Promise<AdminReview> {
    const record = await this.repo.findAcademicRecordById(params.recordId);
    if (!record) {
      throw new HttpError({
        statusCode: 404,
        code: 'RECORD_NOT_FOUND',
        message: 'Academic record not found.',
      });
    }

    await this.repo.updateAcademicRecordStatus(params.recordId, params.decision, {
      rejectionReason: params.decision === 'rejected' ? params.notes : undefined,
      reviewedBy: params.reviewerId,
    });

    const review = await this.repo.createAdminReview({
      reviewerId: params.reviewerId,
      targetUserId: record.user_id,
      reviewType: 'academic',
      targetTable: 'academic_records',
      targetRecordId: params.recordId,
      decision: params.decision,
      notes: params.notes,
    });
    await logAudit({
      actorId: params.reviewerId,
      action: 'admin.verification.academic_review',
      resourceType: 'academic_record',
      resourceId: params.recordId,
      details: {
        targetUserId: record.user_id,
        decision: params.decision,
        notes: params.notes ?? null,
      },
    });

    // If approved, update the academic_verified flag
    if (params.decision === 'approved') {
      const expertProfile = await this.repo.findExpertProfile(record.user_id);
      if (expertProfile) {
        await this.repo.setExpertAcademicVerified(record.user_id, true);
        const hasAvatar = await hasRequiredVerificationImage(this.repo, record.user_id, 'expert');
        if (expertProfile.identity_verified && hasAvatar) {
          await this.repo.updateExpertOverallStatus(record.user_id, 'verified');
        } else {
          await this.repo.updateExpertOverallStatus(record.user_id, 'under_review');
        }
      }

      const user = await this.repo.findUserBasicById(record.user_id);
      if (user) {
        await sendTransactionalEmail({
          to: user.email,
          displayName: user.display_name,
          subject: 'MohandisHub - Academic document verified',
          preheader: 'Your academic document has been approved',
          title: 'Academic document verified',
          greeting: `Hello ${user.display_name},`,
          introLines: [
            'Your academic document has been reviewed and approved.',
            'You can now access the full platform and go to your dashboard.',
          ],
        });
      }
    }

    if (params.decision === 'rejected') {
      const user = await this.repo.findUserBasicById(record.user_id);
      if (user) {
        const reason = params.notes?.trim() || 'No reason provided.';
        await sendTransactionalEmail({
          to: user.email,
          displayName: user.display_name,
          subject: 'MohandisHub - Academic document not approved',
          preheader: 'Your academic document was not approved',
          title: 'Academic document not approved',
          greeting: `Hello ${user.display_name},`,
          introLines: [
            'Your academic document has been reviewed and was not approved.',
            `Reason: ${reason}`,
            'You may submit a new document or contact support if you have questions.',
          ],
        });
      }
    }

    return this.toAdminReview(review);
  }

  // ── Admin: review business documents ───────────────────────────────────
  // Business verification is based on reviewing the business profile data
  // (commercial register, trade license, etc.) — not a separate record.

  async adminReviewBusinessDocs(params: {
    userId: string;
    reviewerId: string;
    decision: 'approved' | 'rejected';
    notes?: string | undefined;
  }): Promise<AdminReview> {
    const profile = await this.repo.findBusinessProfile(params.userId);
    if (!profile) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Business profile not found.',
      });
    }

    const review = await this.repo.createAdminReview({
      reviewerId: params.reviewerId,
      targetUserId: params.userId,
      reviewType: 'business_docs',
      targetTable: 'business_profiles',
      targetRecordId: profile.id,
      decision: params.decision,
      notes: params.notes,
    });
    await logAudit({
      actorId: params.reviewerId,
      action: 'admin.verification.business_review',
      resourceType: 'business_profile',
      resourceId: profile.id,
      details: {
        targetUserId: params.userId,
        decision: params.decision,
        notes: params.notes ?? null,
      },
    });

    if (params.decision === 'approved') {
      await this.repo.setBusinessBusinessVerified(params.userId, true);
      const hasLogo = await hasRequiredVerificationImage(this.repo, params.userId, 'business');
      if (profile.identity_verified && hasLogo) {
        await this.repo.updateBusinessOverallStatus(params.userId, 'verified');
      } else {
        await this.repo.updateBusinessOverallStatus(params.userId, 'under_review');
      }
    } else {
      await this.repo.updateBusinessOverallStatus(params.userId, 'rejected');
    }

    return this.toAdminReview(review);
  }

  // ── Admin: get pending items ───────────────────────────────────────────

  async getPendingVerifications(): Promise<PendingVerificationItem[]> {
    const [pendingDocs, pendingRecords, pendingBusinessUserIds] = await Promise.all([
      this.repo.findPendingIdentityDocuments(),
      this.repo.findPendingAcademicRecords(),
      this.repo.findUserIdsWithPendingBusinessVerificationReview(),
    ]);

    // Collect unique user IDs
    const userIds = new Set<string>();
    pendingDocs.forEach((d) => userIds.add(d.user_id));
    pendingRecords.forEach((r) => userIds.add(r.user_id));
    pendingBusinessUserIds.forEach((id) => userIds.add(id));

    // Build result per user
    const items: PendingVerificationItem[] = [];

    for (const userId of userIds) {
      const user = await this.repo.findUserBasicById(userId);
      if (!user) continue;

      const expertProfile = await this.repo.findExpertProfile(userId);
      const businessProfile = await this.repo.findBusinessProfile(userId);
      const craftsmanProfile = await this.repo.findCraftsmanProfile(userId);

      items.push({
        userId,
        displayName: user.display_name,
        email: user.email,
        role: user.primary_role,
        identityDocuments: pendingDocs
          .filter((d) => d.user_id === userId)
          .map((d) => this.toIdentityDocument(d)),
        academicRecords: pendingRecords
          .filter((r) => r.user_id === userId)
          .map((r) => this.toAcademicRecord(r)),
        expertProfile: expertProfile ? this.toExpertProfile(expertProfile) : null,
        businessProfile: businessProfile ? this.toBusinessProfile(businessProfile) : null,
        craftsmanProfile: craftsmanProfile ? this.toCraftsmanProfile(craftsmanProfile) : null,
      });
    }

    return items;
  }

  // ── Public profile (view another user) ───────────────────────────────────

  async getPublicProfile(userId: string): Promise<PublicUserProfile> {
    const user = await this.repo.findActiveUserById(userId);
    if (!user) {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found or inactive.',
      });
    }
    const role = user.primary_role as PublicUserProfile['role'];
    if (role !== 'customer' && role !== 'expert' && role !== 'business' && role !== 'craftsman') {
      throw new HttpError({
        statusCode: 404,
        code: 'USER_NOT_FOUND',
        message: 'User not found or inactive.',
      });
    }
    const base = {
      userId: user.id,
      role,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    };

    if (role === 'expert') {
      const row = await this.repo.findExpertProfile(userId);
      if (!row) {
        return { ...base, expertProfile: null };
      }
      const [averageRating, reviewCount] = await Promise.all([
        this.reviewsRepo.getAvgRating(userId, 'expert'),
        this.reviewsRepo.getReviewCount(userId, 'expert'),
      ]);
      const expertProfile: PublicExpertProfile = {
        title: row.title,
        headline: row.headline,
        bio: row.bio,
        specializations: row.specializations ?? [],
        yearsOfExperience: row.years_of_experience,
        hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
        city: row.city,
        country: row.country ?? 'Egypt',
        linkedinUrl: row.linkedin_url,
        portfolioUrl: row.portfolio_url,
        languages: row.languages ?? [],
        educationSummary: row.education_summary,
        certificationsCount: row.certifications_count ?? 0,
        verificationStatus: row.verification_status,
        verificationBadgeEarned: row.verification_status === 'verified',
        averageRating: averageRating ?? null,
        reviewCount,
      };
      return { ...base, expertProfile, businessProfile: null, customerProfile: null };
    }

    if (role === 'craftsman') {
      const row = await this.repo.findCraftsmanProfile(userId);
      if (!row) {
        return { ...base, craftsmanProfile: null };
      }
      const [averageRating, reviewCount] = await Promise.all([
        this.reviewsRepo.getAvgRating(userId, 'craftsman'),
        this.reviewsRepo.getReviewCount(userId, 'craftsman'),
      ]);
      const craftsmanProfile: PublicCraftsmanProfile = {
        trade: row.trade,
        title: row.title,
        headline: row.headline,
        bio: row.bio,
        specializations: row.specializations ?? [],
        yearsOfExperience: row.years_of_experience,
        hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
        city: row.city,
        country: row.country ?? 'Egypt',
        workshopName: row.workshop_name,
        verificationStatus: row.verification_status,
        verificationBadgeEarned: row.verification_status === 'verified',
        averageRating: averageRating ?? null,
        reviewCount,
      };
      return {
        ...base,
        expertProfile: null,
        businessProfile: null,
        craftsmanProfile,
        customerProfile: null,
      };
    }

    if (role === 'business') {
      const row = await this.repo.findBusinessProfile(userId);
      if (!row) {
        return { ...base, businessProfile: null };
      }
      const [averageRating, reviewCount] = await Promise.all([
        this.reviewsRepo.getAvgRating(userId, 'business'),
        this.reviewsRepo.getReviewCount(userId, 'business'),
      ]);
      const businessProfile: PublicBusinessProfile = {
        companyName: row.company_name,
        industry: row.industry,
        companySize: row.company_size,
        website: row.website,
        logoUrl: row.logo_url,
        city: row.city,
        country: row.country ?? 'Egypt',
        description: row.description,
        verificationStatus: row.verification_status,
        verificationBadgeEarned: row.verification_status === 'verified',
        averageRating: averageRating ?? null,
        reviewCount,
      };
      return {
        ...base,
        expertProfile: null,
        businessProfile,
        craftsmanProfile: null,
        customerProfile: null,
      };
    }

    const custRow = await this.repo.findCustomerProfile(userId);
    const customerProfile: PublicCustomerProfile | null = custRow
      ? { city: custRow.city, country: custRow.country }
      : null;
    return {
      ...base,
      expertProfile: null,
      businessProfile: null,
      craftsmanProfile: null,
      customerProfile,
    };
  }

  // ── Top providers (public) ───────────────────────────────────────────────

  async getTopExperts(limit: number = 6): Promise<
    Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      title: string | null;
      headline: string | null;
      specializations: string[];
      city: string | null;
    }>
  > {
    return this.repo.findTopExperts(limit);
  }

  async syncVerifiedAtForManuallyVerified(): Promise<{
    experts: number;
    businesses: number;
    craftsmen: number;
    expertsStatusSynced?: number;
  }> {
    const expertsStatusSynced = await this.repo.syncExpertVerificationStatusFromFlags();
    const result = await this.repo.syncVerifiedAtForManuallyVerified();
    return { ...result, expertsStatusSynced };
  }

  async getTopBusinesses(limit: number = 6): Promise<
    Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      companyName: string;
      industry: string | null;
      city: string | null;
    }>
  > {
    return this.repo.findTopBusinesses(limit);
  }

  async getTopCraftsmen(limit: number = 6): Promise<
    Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      trade: string | null;
      headline: string | null;
      specializations: string[];
      city: string | null;
    }>
  > {
    return this.repo.findTopCraftsmen(limit);
  }

  // ── Mappers ────────────────────────────────────────────────────────────

  private toExpertProfile(row: ExpertProfileRow): ExpertProfile {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      headline: row.headline,
      bio: row.bio,
      specializations: row.specializations ?? [],
      yearsOfExperience: row.years_of_experience,
      hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
      city: row.city,
      country: row.country ?? 'Egypt',
      availabilityStatus: row.availability_status,
      employer: row.employer,
      jobTitle: row.job_title,
      linkedinUrl: row.linkedin_url,
      portfolioUrl: row.portfolio_url,
      languages: row.languages ?? [],
      educationSummary: row.education_summary,
      certificationsCount: row.certifications_count ?? 0,
      verificationStatus: row.verification_status,
      identityVerified: row.identity_verified,
      academicVerified: row.academic_verified,
      identityVerificationMethod: row.identity_verification_method ?? null,
      payoutCurrency: row.payout_currency ?? null,
      payoutAddress: row.payout_address ?? null,
      payoutExtraId: row.payout_extra_id ?? null,
      payoutUpdatedAt: row.payout_updated_at ? row.payout_updated_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toCraftsmanProfile(row: CraftsmanProfileRow): CraftsmanProfile {
    return {
      id: row.id,
      userId: row.user_id,
      trade: row.trade,
      title: row.title,
      headline: row.headline,
      bio: row.bio,
      specializations: row.specializations ?? [],
      yearsOfExperience: row.years_of_experience,
      hourlyRate: row.hourly_rate ? Number(row.hourly_rate) : null,
      city: row.city,
      country: row.country ?? 'Egypt',
      availabilityStatus: row.availability_status,
      workshopName: row.workshop_name,
      workshopAddress: row.workshop_address,
      workshopLatitude: row.workshop_latitude ? Number(row.workshop_latitude) : null,
      workshopLongitude: row.workshop_longitude ? Number(row.workshop_longitude) : null,
      verificationStatus: row.verification_status,
      identityVerified: row.identity_verified,
      identityVerificationMethod: row.identity_verification_method ?? null,
      payoutCurrency: row.payout_currency ?? null,
      payoutAddress: row.payout_address ?? null,
      payoutExtraId: row.payout_extra_id ?? null,
      payoutUpdatedAt: row.payout_updated_at ? row.payout_updated_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toBusinessProfile(row: BusinessProfileRow): BusinessProfile {
    return {
      id: row.id,
      userId: row.user_id,
      companyName: row.company_name,
      tradeLicenseNumber: row.trade_license_number,
      taxId: row.tax_id,
      commercialRegister: row.commercial_register,
      industry: row.industry,
      companySize: row.company_size,
      website: row.website,
      companyEmail: row.company_email,
      companyPhone: row.company_phone,
      address: row.address,
      logoUrl: row.logo_url,
      city: row.city,
      country: row.country ?? 'Egypt',
      description: row.description,
      ownerFullName: row.owner_full_name,
      ownerTitle: row.owner_title,
      ownerEmail: row.owner_email,
      ownerPhone: row.owner_phone,
      socialFacebook: row.social_facebook,
      socialLinkedin: row.social_linkedin,
      socialTwitter: row.social_twitter,
      employeesCount: row.employees_count,
      foundedYear: row.founded_year,
      verificationStatus: row.verification_status,
      identityVerified: row.identity_verified,
      businessVerified: row.business_verified,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toIdentityDocument(row: IdentityDocumentRow): IdentityDocument {
    return {
      id: row.id,
      userId: row.user_id,
      documentType: row.document_type,
      documentNumber: row.document_number,
      fullNameOnDoc: row.full_name_on_doc,
      dateOfBirth: row.date_of_birth ? row.date_of_birth.toISOString().slice(0, 10) : null,
      nationality: row.nationality,
      frontImageUrl: row.front_image_url,
      backImageUrl: row.back_image_url,
      selfieImageUrl: row.selfie_image_url,
      provider: row.provider,
      providerRef: row.provider_ref,
      status: row.status,
      rejectionReason: row.rejection_reason,
      reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toAcademicRecord(row: AcademicRecordRow): AcademicRecord {
    return {
      id: row.id,
      userId: row.user_id,
      recordType: row.record_type,
      title: row.title,
      institution: row.institution,
      fieldOfStudy: row.field_of_study,
      graduationYear: row.graduation_year,
      grade: row.grade,
      certificateImageUrl: row.certificate_image_url,
      transcriptImageUrl: row.transcript_image_url,
      status: row.status,
      rejectionReason: row.rejection_reason,
      reviewedAt: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    };
  }

  private toAdminReview(row: {
    id: string;
    reviewer_id: string;
    target_user_id: string;
    review_type: string;
    target_table: string;
    target_record_id: string;
    decision: string;
    notes: string | null;
    created_at: Date;
  }): AdminReview {
    return {
      id: row.id,
      reviewerId: row.reviewer_id,
      targetUserId: row.target_user_id,
      reviewType: row.review_type as AdminReview['reviewType'],
      targetTable: row.target_table,
      targetRecordId: row.target_record_id,
      decision: row.decision as AdminReview['decision'],
      notes: row.notes,
      createdAt: row.created_at.toISOString(),
    };
  }
}
