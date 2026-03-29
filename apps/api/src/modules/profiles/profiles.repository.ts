// ---------------------------------------------------------------------------
// Profiles repository — database access layer for profiles, docs, records
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  AcademicRecordRow,
  AdminReviewRow,
  BusinessProfileRow,
  CraftsmanProfileRow,
  CustomerProfileRow,
  ExpertProfileRow,
  IdentityDocumentRow,
} from './profiles.types.js';

export class ProfilesRepository {
  private get db(): Pool {
    return getPool();
  }

  // ── Expert profiles ────────────────────────────────────────────────────

  async findExpertProfile(userId: string): Promise<ExpertProfileRow | null> {
    const { rows } = await this.db.query<ExpertProfileRow>(
      'SELECT * FROM expert_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async getUserAvatarUrl(userId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM users WHERE id = $1 LIMIT 1',
      [userId],
    );
    return rows[0]?.avatar_url ?? null;
  }

  async updateExpertProfile(
    userId: string,
    fields: Partial<{
      title: string;
      headline: string;
      bio: string;
      specializations: string[];
      years_of_experience: number;
      hourly_rate: number;
      city: string;
      country: string;
      availability_status: string;
      employer: string;
      job_title: string;
      linkedin_url: string;
      portfolio_url: string;
      languages: string[];
      education_summary: string;
      certifications_count: number;
    }>,
  ): Promise<ExpertProfileRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findExpertProfile(userId);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([, v]) => v);

    const { rows } = await this.db.query<ExpertProfileRow>(
      `UPDATE expert_profiles SET ${setClauses.join(', ')} WHERE user_id = $1 RETURNING *`,
      [userId, ...values],
    );
    return rows[0] ?? null;
  }

  async findCraftsmanProfile(userId: string): Promise<CraftsmanProfileRow | null> {
    const { rows } = await this.db.query<CraftsmanProfileRow>(
      'SELECT * FROM craftsman_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async updateCraftsmanProfile(
    userId: string,
    fields: Partial<{
      trade: string;
      title: string;
      headline: string;
      bio: string;
      specializations: string[];
      years_of_experience: number;
      hourly_rate: number;
      city: string;
      country: string;
      availability_status: string;
      workshop_name: string;
      workshop_address: string;
      workshop_latitude: number;
      workshop_longitude: number;
    }>,
  ): Promise<CraftsmanProfileRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findCraftsmanProfile(userId);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([, v]) => v);

    const { rows } = await this.db.query<CraftsmanProfileRow>(
      `UPDATE craftsman_profiles SET ${setClauses.join(', ')} WHERE user_id = $1 RETURNING *`,
      [userId, ...values],
    );
    return rows[0] ?? null;
  }

  // ── Customer profiles ───────────────────────────────────────────────────

  async findCustomerProfile(userId: string): Promise<CustomerProfileRow | null> {
    const { rows } = await this.db.query<CustomerProfileRow>(
      'SELECT * FROM customer_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async updateCustomerProfile(
    userId: string,
    fields: { city?: string | null | undefined; country?: string | null | undefined; contactPreference?: string | null | undefined },
  ): Promise<CustomerProfileRow | null> {
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    if (fields.city !== undefined) {
      updates.push(`city = $${idx++}`);
      values.push(fields.city);
    }
    if (fields.country !== undefined) {
      updates.push(`country = $${idx++}`);
      values.push(fields.country);
    }
    if (fields.contactPreference !== undefined) {
      updates.push(`preferences = COALESCE(preferences, '{}'::jsonb) || jsonb_build_object('contactPreference', $${idx++}::text)`);
      values.push(fields.contactPreference);
    }
    if (updates.length === 0) return this.findCustomerProfile(userId);
    values.push(userId);
    await this.db.query(
      `UPDATE customer_profiles SET ${updates.join(', ')}, updated_at = now() WHERE user_id = $${idx}`,
      values,
    );
    return this.findCustomerProfile(userId);
  }

  // ── Business profiles ──────────────────────────────────────────────────

  async findBusinessProfile(userId: string): Promise<BusinessProfileRow | null> {
    const { rows } = await this.db.query<BusinessProfileRow>(
      'SELECT * FROM business_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0] ?? null;
  }

  async getBusinessLogoUrl(userId: string): Promise<string | null> {
    const { rows } = await this.db.query<{ logo_url: string | null }>(
      'SELECT logo_url FROM business_profiles WHERE user_id = $1 LIMIT 1',
      [userId],
    );
    return rows[0]?.logo_url ?? null;
  }

  async getPlatformVerifiedAt(userId: string): Promise<Date | null> {
    const { rows } = await this.db.query<{ platform_verified_at: Date | null }>(
      'SELECT platform_verified_at FROM users WHERE id = $1',
      [userId],
    );
    return rows[0]?.platform_verified_at ?? null;
  }

  async setPlatformVerifiedAt(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET platform_verified_at = now() WHERE id = $1 AND platform_verified_at IS NULL`,
      [userId],
    );
  }

  async setBusinessOnboardingCompletedAt(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE business_profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE user_id = $1`,
      [userId],
    );
  }

  async setCraftsmanOnboardingCompletedAt(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE craftsman_profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE user_id = $1`,
      [userId],
    );
  }

  async updateBusinessProfile(
    userId: string,
    fields: Partial<{
      company_name: string;
      trade_license_number: string;
      tax_id: string;
      commercial_register: string;
      industry: string;
      company_size: string;
      website: string;
      company_email: string;
      company_phone: string;
      address: string;
      logo_url: string | null;
      city: string;
      country: string;
      description: string;
      owner_full_name: string;
      owner_title: string;
      owner_email: string;
      owner_phone: string;
      social_facebook: string;
      social_linkedin: string;
      social_twitter: string;
      employees_count: number;
      founded_year: number;
    }>,
  ): Promise<BusinessProfileRow | null> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findBusinessProfile(userId);

    const setClauses = entries.map(([key], i) => `${key} = $${i + 2}`);
    const values = entries.map(([, v]) => v);

    const { rows } = await this.db.query<BusinessProfileRow>(
      `UPDATE business_profiles SET ${setClauses.join(', ')} WHERE user_id = $1 RETURNING *`,
      [userId, ...values],
    );
    return rows[0] ?? null;
  }

  // ── Identity documents ─────────────────────────────────────────────────

  async createIdentityDocument(params: {
    userId: string;
    documentType: string;
    fullNameOnDoc: string;
    documentNumber?: string | undefined;
    dateOfBirth?: string | undefined;
    nationality?: string | undefined;
    frontImageUrl?: string | undefined;
    backImageUrl?: string | undefined;
    selfieImageUrl?: string | undefined;
  }): Promise<IdentityDocumentRow> {
    const { rows } = await this.db.query<IdentityDocumentRow>(
      `INSERT INTO identity_documents
         (user_id, document_type, full_name_on_doc, document_number, date_of_birth,
          nationality, front_image_url, back_image_url, selfie_image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.userId,
        params.documentType,
        params.fullNameOnDoc,
        params.documentNumber ?? null,
        params.dateOfBirth ?? null,
        params.nationality ?? null,
        params.frontImageUrl ?? null,
        params.backImageUrl ?? null,
        params.selfieImageUrl ?? null,
      ],
    );
    return rows[0]!;
  }

  async findIdentityDocuments(userId: string): Promise<IdentityDocumentRow[]> {
    const { rows } = await this.db.query<IdentityDocumentRow>(
      'SELECT * FROM identity_documents WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return rows;
  }

  async findIdentityDocumentById(docId: string): Promise<IdentityDocumentRow | null> {
    const { rows } = await this.db.query<IdentityDocumentRow>(
      'SELECT * FROM identity_documents WHERE id = $1 LIMIT 1',
      [docId],
    );
    return rows[0] ?? null;
  }

  /** Removes a user-owned submission only while it is still pending review (not approved/rejected). */
  async deleteIdentityDocumentIfPending(userId: string, docId: string): Promise<IdentityDocumentRow | null> {
    const { rows } = await this.db.query<IdentityDocumentRow>(
      `DELETE FROM identity_documents
       WHERE id = $1 AND user_id = $2 AND status IN ('pending', 'under_review')
       RETURNING *`,
      [docId, userId],
    );
    return rows[0] ?? null;
  }

  async updateIdentityDocumentStatus(
    docId: string,
    status: string,
    extra?: { rejectionReason?: string | undefined; reviewedBy?: string | undefined },
  ): Promise<void> {
    await this.db.query(
      `UPDATE identity_documents
       SET status = $1,
           rejection_reason = COALESCE($2, rejection_reason),
           reviewed_by = COALESCE($3, reviewed_by),
           reviewed_at = CASE WHEN $5 IN ('approved', 'rejected') THEN now() ELSE reviewed_at END
       WHERE id = $4`,
      [status, extra?.rejectionReason ?? null, extra?.reviewedBy ?? null, docId, status],
    );
  }

  // ── Academic records ───────────────────────────────────────────────────

  async createAcademicRecord(params: {
    userId: string;
    recordType: string;
    title: string;
    institution: string;
    fieldOfStudy?: string | undefined;
    graduationYear?: number | undefined;
    grade?: string | undefined;
    certificateImageUrl?: string | undefined;
    transcriptImageUrl?: string | undefined;
  }): Promise<AcademicRecordRow> {
    const { rows } = await this.db.query<AcademicRecordRow>(
      `INSERT INTO academic_records
         (user_id, record_type, title, institution, field_of_study,
          graduation_year, grade, certificate_image_url, transcript_image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        params.userId,
        params.recordType,
        params.title,
        params.institution,
        params.fieldOfStudy ?? null,
        params.graduationYear ?? null,
        params.grade ?? null,
        params.certificateImageUrl ?? null,
        params.transcriptImageUrl ?? null,
      ],
    );
    return rows[0]!;
  }

  async findAcademicRecords(userId: string): Promise<AcademicRecordRow[]> {
    const { rows } = await this.db.query<AcademicRecordRow>(
      'SELECT * FROM academic_records WHERE user_id = $1 ORDER BY graduation_year DESC NULLS LAST',
      [userId],
    );
    return rows;
  }

  async findAcademicRecordById(recordId: string): Promise<AcademicRecordRow | null> {
    const { rows } = await this.db.query<AcademicRecordRow>(
      'SELECT * FROM academic_records WHERE id = $1 LIMIT 1',
      [recordId],
    );
    return rows[0] ?? null;
  }

  async updateAcademicRecordStatus(
    recordId: string,
    status: string,
    extra?: { rejectionReason?: string | undefined; reviewedBy?: string | undefined },
  ): Promise<void> {
    await this.db.query(
      `UPDATE academic_records
       SET status = $1,
           rejection_reason = COALESCE($2, rejection_reason),
           reviewed_by = COALESCE($3, reviewed_by),
           reviewed_at = CASE WHEN $5 IN ('approved', 'rejected') THEN now() ELSE reviewed_at END
       WHERE id = $4`,
      [status, extra?.rejectionReason ?? null, extra?.reviewedBy ?? null, recordId, status],
    );
  }

  /** User-facing update of own academic record (expert only). Only updates provided fields. */
  async updateAcademicRecord(
    recordId: string,
    userId: string,
    params: {
      recordType?: string | undefined;
      title?: string | undefined;
      institution?: string | undefined;
      fieldOfStudy?: string | null | undefined;
      graduationYear?: number | null | undefined;
      grade?: string | null | undefined;
      certificateImageUrl?: string | null | undefined;
      transcriptImageUrl?: string | null | undefined;
    },
  ): Promise<AcademicRecordRow | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (params.recordType !== undefined) {
      setClauses.push(`record_type = $${i++}`);
      values.push(params.recordType);
    }
    if (params.title !== undefined) {
      setClauses.push(`title = $${i++}`);
      values.push(params.title);
    }
    if (params.institution !== undefined) {
      setClauses.push(`institution = $${i++}`);
      values.push(params.institution);
    }
    if (params.fieldOfStudy !== undefined) {
      setClauses.push(`field_of_study = $${i++}`);
      values.push(params.fieldOfStudy);
    }
    if (params.graduationYear !== undefined) {
      setClauses.push(`graduation_year = $${i++}`);
      values.push(params.graduationYear);
    }
    if (params.grade !== undefined) {
      setClauses.push(`grade = $${i++}`);
      values.push(params.grade);
    }
    if (params.certificateImageUrl !== undefined) {
      setClauses.push(`certificate_image_url = $${i++}`);
      values.push(params.certificateImageUrl);
    }
    if (params.transcriptImageUrl !== undefined) {
      setClauses.push(`transcript_image_url = $${i++}`);
      values.push(params.transcriptImageUrl);
    }
    if (setClauses.length === 0) {
      const row = await this.findAcademicRecordById(recordId);
      return row?.user_id === userId ? row : null;
    }
    setClauses.push(`updated_at = now()`);
    const idParam = i;
    const userIdParam = i + 1;
    values.push(recordId, userId);
    const { rows } = await this.db.query<AcademicRecordRow>(
      `UPDATE academic_records SET ${setClauses.join(', ')} WHERE id = $${idParam} AND user_id = $${userIdParam} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  // ── Update verified flags on profiles ──────────────────────────────────

  async setExpertIdentityVerified(userId: string, verified: boolean): Promise<void> {
    await this.db.query('UPDATE expert_profiles SET identity_verified = $1 WHERE user_id = $2', [
      verified,
      userId,
    ]);
  }

  /** Set how identity was verified: 'manual' when admin approves an identity_document. */
  async setExpertIdentityVerificationMethod(
    userId: string,
    method: 'didit' | 'manual',
  ): Promise<void> {
    await this.db.query(
      'UPDATE expert_profiles SET identity_verification_method = $1 WHERE user_id = $2',
      [method, userId],
    );
  }

  async setExpertAcademicVerified(userId: string, verified: boolean): Promise<void> {
    await this.db.query('UPDATE expert_profiles SET academic_verified = $1 WHERE user_id = $2', [
      verified,
      userId,
    ]);
  }

  async setCraftsmanIdentityVerified(userId: string, verified: boolean): Promise<void> {
    await this.db.query(
      'UPDATE craftsman_profiles SET identity_verified = $1 WHERE user_id = $2',
      [verified, userId],
    );
  }

  async setCraftsmanIdentityVerificationMethod(
    userId: string,
    method: 'didit' | 'manual',
  ): Promise<void> {
    await this.db.query(
      'UPDATE craftsman_profiles SET identity_verification_method = $1 WHERE user_id = $2',
      [method, userId],
    );
  }

  async setBusinessIdentityVerified(userId: string, verified: boolean): Promise<void> {
    await this.db.query('UPDATE business_profiles SET identity_verified = $1 WHERE user_id = $2', [
      verified,
      userId,
    ]);
  }

  async setBusinessBusinessVerified(userId: string, verified: boolean): Promise<void> {
    await this.db.query('UPDATE business_profiles SET business_verified = $1 WHERE user_id = $2', [
      verified,
      userId,
    ]);
  }

  /**
   * Update the main verification_status to 'verified' when both checks pass,
   * or set to specific state.
   */
  async updateExpertOverallStatus(userId: string, status: string): Promise<void> {
    const verifiedAt = status === 'verified' ? 'now()' : 'NULL';
    await this.db.query(
      `UPDATE expert_profiles SET verification_status = $1, verified_at = ${verifiedAt} WHERE user_id = $2`,
      [status, userId],
    );
  }

  async updateBusinessOverallStatus(userId: string, status: string): Promise<void> {
    const verifiedAt = status === 'verified' ? 'now()' : 'NULL';
    await this.db.query(
      `UPDATE business_profiles SET verification_status = $1, verified_at = ${verifiedAt} WHERE user_id = $2`,
      [status, userId],
    );
  }

  async updateCraftsmanOverallStatus(userId: string, status: string): Promise<void> {
    const verifiedAt = status === 'verified' ? 'now()' : 'NULL';
    await this.db.query(
      `UPDATE craftsman_profiles SET verification_status = $1, verified_at = ${verifiedAt} WHERE user_id = $2`,
      [status, userId],
    );
  }

  /**
   * Sync verified_at for profiles that were manually set to verified in the DB.
   * Sets verified_at = now() where verification_status = 'verified' AND verified_at IS NULL.
   */
  async syncVerifiedAtForManuallyVerified(): Promise<{
    experts: number;
    businesses: number;
    craftsmen: number;
  }> {
    const [expertRes, businessRes, craftsmanRes] = await Promise.all([
      this.db.query(
        `UPDATE expert_profiles SET verified_at = now() WHERE verification_status = 'verified' AND verified_at IS NULL RETURNING user_id`,
      ),
      this.db.query(
        `UPDATE business_profiles SET verified_at = now() WHERE verification_status = 'verified' AND verified_at IS NULL RETURNING user_id`,
      ),
      this.db.query(
        `UPDATE craftsman_profiles SET verified_at = now() WHERE verification_status = 'verified' AND verified_at IS NULL RETURNING user_id`,
      ),
    ]);
    return {
      experts: expertRes.rowCount ?? 0,
      businesses: businessRes.rowCount ?? 0,
      craftsmen: craftsmanRes.rowCount ?? 0,
    };
  }

  /**
   * Set verification_status to 'verified' when both identity_verified and academic_verified
   * are true but status is not yet 'verified' (e.g. after manual DB edits or edge cases).
   * Also fixes experts who have approved academic and are pending/under_review (e.g. identity
   * was approved via Didit but identity_verified was never set) — sets them to verified and
   * sets identity_verified = true for consistency.
   */
  async syncExpertVerificationStatusFromFlags(): Promise<number> {
    const { rows: alreadyBoth } = await this.db.query<{ user_id: string }>(
      `UPDATE expert_profiles
       SET verification_status = 'verified', verified_at = COALESCE(verified_at, now())
       WHERE identity_verified = true AND academic_verified = true AND verification_status != 'verified'
       RETURNING user_id`,
    );
    const { rows: academicDonePending } = await this.db.query<{ user_id: string }>(
      `UPDATE expert_profiles
       SET verification_status = 'verified', verified_at = COALESCE(verified_at, now()), identity_verified = true
       WHERE academic_verified = true AND verification_status IN ('pending', 'under_review')
       RETURNING user_id`,
    );
    return alreadyBoth.length + academicDonePending.length;
  }

  // ── Admin reviews ──────────────────────────────────────────────────────

  async createAdminReview(params: {
    reviewerId: string;
    targetUserId: string;
    reviewType: string;
    targetTable: string;
    targetRecordId: string;
    decision: string;
    notes?: string | undefined;
  }): Promise<AdminReviewRow> {
    const { rows } = await this.db.query<AdminReviewRow>(
      `INSERT INTO admin_reviews
         (reviewer_id, target_user_id, review_type, target_table, target_record_id, decision, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        params.reviewerId,
        params.targetUserId,
        params.reviewType,
        params.targetTable,
        params.targetRecordId,
        params.decision,
        params.notes ?? null,
      ],
    );
    return rows[0]!;
  }

  // ── Admin: list pending items ──────────────────────────────────────────

  async findPendingIdentityDocuments(): Promise<IdentityDocumentRow[]> {
    const { rows } = await this.db.query<IdentityDocumentRow>(
      `SELECT * FROM identity_documents WHERE status IN ('pending', 'under_review') ORDER BY created_at ASC`,
    );
    return rows;
  }

  async findPendingAcademicRecords(): Promise<AcademicRecordRow[]> {
    const { rows } = await this.db.query<AcademicRecordRow>(
      `SELECT * FROM academic_records WHERE status IN ('pending', 'under_review') ORDER BY created_at ASC`,
    );
    return rows;
  }

  // ── Admin: get user details for review ─────────────────────────────────

  async findUserBasicById(
    userId: string,
  ): Promise<{ id: string; display_name: string; email: string; primary_role: string } | null> {
    const { rows } = await this.db.query<{
      id: string;
      display_name: string;
      email: string;
      primary_role: string;
    }>('SELECT id, display_name, email, primary_role FROM users WHERE id = $1 LIMIT 1', [userId]);
    return rows[0] ?? null;
  }

  /** For public profile: active user with display name and avatar. */
  async findActiveUserById(
    userId: string,
  ): Promise<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    primary_role: string;
  } | null> {
    const { rows } = await this.db.query<{
      id: string;
      display_name: string;
      avatar_url: string | null;
      primary_role: string;
    }>(
      `SELECT id, COALESCE(display_name, email) AS display_name, avatar_url, primary_role
       FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async findTopExperts(limit: number = 6): Promise<
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
    const { rows } = await this.db.query<{
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      title: string | null;
      headline: string | null;
      specializations: string[];
      city: string | null;
    }>(
      `SELECT u.id AS user_id, u.display_name, u.avatar_url, e.title, e.headline, e.specializations, e.city
       FROM expert_profiles e
       JOIN users u ON u.id = e.user_id
       WHERE e.verification_status = 'verified' AND u.is_active = true AND u.avatar_url IS NOT NULL
       ORDER BY e.verified_at DESC NULLS LAST, e.created_at DESC
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      title: r.title,
      headline: r.headline,
      specializations: r.specializations ?? [],
      city: r.city,
    }));
  }

  async findTopBusinesses(limit: number = 6): Promise<
    Array<{
      userId: string;
      displayName: string;
      avatarUrl: string | null;
      companyName: string;
      industry: string | null;
      city: string | null;
    }>
  > {
    const { rows } = await this.db.query<{
      user_id: string;
      display_name: string;
      avatar_url: string | null;
      company_name: string;
      industry: string | null;
      city: string | null;
    }>(
      `SELECT u.id AS user_id, u.display_name, u.avatar_url, b.company_name, b.industry, b.city
       FROM business_profiles b
       JOIN users u ON u.id = b.user_id
       WHERE b.verification_status = 'verified' AND u.is_active = true AND b.logo_url IS NOT NULL
       ORDER BY b.verified_at DESC NULLS LAST, b.created_at DESC
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      companyName: r.company_name,
      industry: r.industry,
      city: r.city,
    }));
  }

  async findTopCraftsmen(limit: number = 6): Promise<
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
    try {
      const { rows } = await this.db.query<{
        user_id: string;
        display_name: string;
        avatar_url: string | null;
        trade: string | null;
        headline: string | null;
        specializations: string[];
        city: string | null;
      }>(
        `SELECT u.id AS user_id, u.display_name, u.avatar_url, c.trade, c.headline, c.specializations, c.city
         FROM craftsman_profiles c
         JOIN users u ON u.id = c.user_id
         WHERE c.verification_status = 'verified' AND u.is_active = true AND u.avatar_url IS NOT NULL
         ORDER BY c.verified_at DESC NULLS LAST, c.created_at DESC
         LIMIT $1::int`,
        [limit],
      );
      return rows.map((r) => ({
        userId: r.user_id,
        displayName: r.display_name,
        avatarUrl: r.avatar_url,
        trade: r.trade,
        headline: r.headline,
        specializations: r.specializations ?? [],
        city: r.city,
      }));
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error ? String(error.code) : null;

      if (code === '42P01') {
        return [];
      }

      throw error;
    }
  }
}
