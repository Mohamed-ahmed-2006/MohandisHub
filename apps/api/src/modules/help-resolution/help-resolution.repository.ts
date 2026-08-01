// ---------------------------------------------------------------------------
// Help & Resolution repository — the case spine and its legacy projections
// ---------------------------------------------------------------------------
// A case is either NATIVE (rows live in resolution_case_*) or BACKED by one of
// the two pre-existing engines. Reads here project both shapes into one row
// type; writes to a backed case are the caller's job and go through that
// engine's own service, so its invariants keep running.
// ---------------------------------------------------------------------------

import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

export type ResolutionCaseRow = {
  id: string;
  reference_code: string;
  kind: string;
  status: string;
  opened_by: string;
  counterparty_id: string | null;
  counterparty_access: boolean;
  reported_user_id: string | null;
  subject_type: string | null;
  subject_id: string | null;
  title: string;
  description: string | null;
  reason_code: string | null;
  support_ticket_id: string | null;
  reservation_dispute_id: string | null;
  assigned_admin_id: string | null;
  escalated_at: string | null;
  escalated_by: string | null;
  escalation_reason: string | null;
  resolution_outcome: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  last_activity_at: string;
  created_at: string;
  updated_at: string;
};

export type ResolutionCaseListRow = ResolutionCaseRow & {
  counterparty_name: string | null;
  engine_status: string | null;
  message_count: string;
  evidence_count: string;
};

export type ResolutionCaseMessageRow = {
  id: string;
  case_id: string;
  author_id: string;
  author_name: string | null;
  body: string;
  visibility: string;
  is_staff: boolean;
  created_at: string;
  attachment_urls?: string[] | null;
};

export type ResolutionCaseEvidenceRow = {
  id: string;
  case_id: string;
  uploaded_by: string;
  upload_id: string;
  label: string | null;
  original_name: string | null;
  created_at: string;
};

export type ResolutionCaseEventRow = {
  id: string;
  case_id: string;
  event_type: string;
  actor_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type EligibleSubjectRow = {
  subject_type: string;
  subject_id: string;
  label: string | null;
  counterparty_id: string | null;
  counterparty_name: string | null;
};

/**
 * Counts and engine status, computed per kind.
 *
 * `message_count` is the PARTICIPANT-visible count on purpose: it is rendered
 * next to a case in the user's list, and an internal admin note must not make a
 * participant think somebody replied to them.
 */
const CASE_PROJECTION = `
  c.*,
  cp.display_name AS counterparty_name,
  CASE c.kind
    WHEN 'general_support' THEN (
      SELECT t.status FROM support_tickets t WHERE t.id = c.support_ticket_id)
    WHEN 'reservation_dispute' THEN (
      SELECT d.status FROM reservation_disputes d WHERE d.id = c.reservation_dispute_id)
    ELSE NULL
  END AS engine_status,
  CASE c.kind
    WHEN 'general_support' THEN (
      SELECT count(*) FROM support_ticket_messages m WHERE m.ticket_id = c.support_ticket_id)
    WHEN 'reservation_dispute' THEN (
      SELECT count(*) FROM reservation_dispute_notes n
       WHERE n.dispute_id = c.reservation_dispute_id AND n.visibility = 'public')
    ELSE (
      SELECT count(*) FROM resolution_case_messages rm
       WHERE rm.case_id = c.id AND rm.visibility = 'participants')
  END AS message_count,
  CASE c.kind
    WHEN 'general_support' THEN 0::bigint
    WHEN 'reservation_dispute' THEN (
      SELECT count(*) FROM reservation_dispute_evidence e
       WHERE e.dispute_id = c.reservation_dispute_id)
    ELSE (
      SELECT count(*) FROM resolution_case_evidence re WHERE re.case_id = c.id)
  END AS evidence_count
`;

export type ListCaseFilters = {
  kinds?: string[];
  statuses?: string[];
  search?: string;
  escalatedOnly?: boolean;
  assignedAdminId?: string;
};

export class HelpResolutionRepository {
  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async findCaseById(caseId: string, client?: PoolClient): Promise<ResolutionCaseListRow | null> {
    const db = client ?? getPool();
    const { rows } = await db.query<ResolutionCaseListRow>(
      `SELECT ${CASE_PROJECTION}
         FROM resolution_cases c
         LEFT JOIN users cp ON cp.id = c.counterparty_id
        WHERE c.id = $1
        LIMIT 1`,
      [caseId],
    );
    return rows[0] ?? null;
  }

  /** Row locked for a status transition. Projection is not needed under lock. */
  async lockCaseById(client: PoolClient, caseId: string): Promise<ResolutionCaseRow | null> {
    const { rows } = await client.query<ResolutionCaseRow>(
      `SELECT * FROM resolution_cases WHERE id = $1 FOR UPDATE`,
      [caseId],
    );
    return rows[0] ?? null;
  }

  async findCaseBySupportTicketId(ticketId: string): Promise<ResolutionCaseListRow | null> {
    const { rows } = await getPool().query<ResolutionCaseListRow>(
      `SELECT ${CASE_PROJECTION}
         FROM resolution_cases c
         LEFT JOIN users cp ON cp.id = c.counterparty_id
        WHERE c.support_ticket_id = $1
        LIMIT 1`,
      [ticketId],
    );
    return rows[0] ?? null;
  }

  async findCaseByReservationDisputeId(disputeId: string): Promise<ResolutionCaseListRow | null> {
    const { rows } = await getPool().query<ResolutionCaseListRow>(
      `SELECT ${CASE_PROJECTION}
         FROM resolution_cases c
         LEFT JOIN users cp ON cp.id = c.counterparty_id
        WHERE c.reservation_dispute_id = $1
        LIMIT 1`,
      [disputeId],
    );
    return rows[0] ?? null;
  }

  private buildFilterClauses(
    filters: ListCaseFilters,
    values: unknown[],
  ): { clauses: string[]; values: unknown[] } {
    const clauses: string[] = [];
    if (filters.kinds?.length) {
      values.push(filters.kinds);
      clauses.push(`c.kind = ANY($${values.length}::text[])`);
    }
    if (filters.statuses?.length) {
      values.push(filters.statuses);
      clauses.push(`c.status = ANY($${values.length}::text[])`);
    }
    if (filters.escalatedOnly) {
      clauses.push(`c.escalated_at IS NOT NULL AND c.status NOT IN ('resolved', 'closed')`);
    }
    if (filters.assignedAdminId) {
      values.push(filters.assignedAdminId);
      clauses.push(`c.assigned_admin_id = $${values.length}`);
    }
    if (filters.search) {
      values.push(`%${filters.search}%`);
      const like = `$${values.length}`;
      clauses.push(`(c.title ILIKE ${like} OR c.reference_code ILIKE ${like})`);
    }
    return { clauses, values };
  }

  /**
   * Cases the user may see.
   *
   * The counterparty arm requires `counterparty_access`, so a case that names a
   * counterparty without granting access never appears in their list — the same
   * rule the detail route applies, expressed once here so the two cannot drift.
   */
  async listCasesForUser(
    userId: string,
    filters: ListCaseFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ResolutionCaseListRow[]; total: number }> {
    const values: unknown[] = [userId];
    const { clauses } = this.buildFilterClauses(filters, values);
    const visibility = `(c.opened_by = $1 OR (c.counterparty_id = $1 AND c.counterparty_access = true))`;
    const where = [visibility, ...clauses].join(' AND ');

    const db = getPool();
    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM resolution_cases c WHERE ${where}`,
      values,
    );
    const listValues = [...values, limit, offset];
    const { rows } = await db.query<ResolutionCaseListRow>(
      `SELECT ${CASE_PROJECTION}
         FROM resolution_cases c
         LEFT JOIN users cp ON cp.id = c.counterparty_id
        WHERE ${where}
        ORDER BY c.last_activity_at DESC, c.created_at DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    return { rows, total: parseInt(countRows[0]?.count ?? '0', 10) };
  }

  async listCasesForAdmin(
    filters: ListCaseFilters,
    limit: number,
    offset: number,
  ): Promise<{ rows: ResolutionCaseListRow[]; total: number }> {
    const values: unknown[] = [];
    const { clauses } = this.buildFilterClauses(filters, values);
    const where = clauses.length ? clauses.join(' AND ') : 'TRUE';

    const db = getPool();
    const { rows: countRows } = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM resolution_cases c WHERE ${where}`,
      values,
    );
    const listValues = [...values, limit, offset];
    const { rows } = await db.query<ResolutionCaseListRow>(
      `SELECT ${CASE_PROJECTION}
         FROM resolution_cases c
         LEFT JOIN users cp ON cp.id = c.counterparty_id
        WHERE ${where}
        ORDER BY (c.escalated_at IS NOT NULL AND c.status NOT IN ('resolved','closed')) DESC,
                 c.last_activity_at DESC
        LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues,
    );
    return { rows, total: parseInt(countRows[0]?.count ?? '0', 10) };
  }

  // -------------------------------------------------------------------------
  // Native case writes
  // -------------------------------------------------------------------------

  async createNativeCase(
    input: {
      kind: string;
      openedBy: string;
      counterpartyId: string | null;
      counterpartyAccess: boolean;
      reportedUserId: string | null;
      subjectType: string | null;
      subjectId: string | null;
      title: string;
      description: string | null;
      reasonCode: string | null;
    },
    client?: PoolClient,
  ): Promise<ResolutionCaseRow> {
    const db = client ?? getPool();
    const { rows } = await db.query<ResolutionCaseRow>(
      `INSERT INTO resolution_cases (
         kind, status, opened_by, counterparty_id, counterparty_access, reported_user_id,
         subject_type, subject_id, title, description, reason_code, last_activity_at
       )
       VALUES ($1, 'open', $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       RETURNING *`,
      [
        input.kind,
        input.openedBy,
        input.counterpartyId,
        input.counterpartyAccess,
        input.reportedUserId,
        input.subjectType,
        input.subjectId,
        input.title,
        input.description,
        input.reasonCode,
      ],
    );
    return rows[0]!;
  }

  async insertNativeMessage(
    input: {
      caseId: string;
      authorId: string;
      body: string;
      visibility: string;
      isStaff: boolean;
    },
    client?: PoolClient,
  ): Promise<ResolutionCaseMessageRow> {
    const db = client ?? getPool();
    const { rows } = await db.query<ResolutionCaseMessageRow>(
      `WITH inserted AS (
         INSERT INTO resolution_case_messages (case_id, author_id, body, visibility, is_staff)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *
       )
       SELECT i.*, u.display_name AS author_name
         FROM inserted i
         LEFT JOIN users u ON u.id = i.author_id`,
      [input.caseId, input.authorId, input.body, input.visibility, input.isStaff],
    );
    return rows[0]!;
  }

  async listNativeMessages(
    caseId: string,
    includeAdminNotes: boolean,
  ): Promise<ResolutionCaseMessageRow[]> {
    const { rows } = await getPool().query<ResolutionCaseMessageRow>(
      `SELECT m.*, u.display_name AS author_name
         FROM resolution_case_messages m
         LEFT JOIN users u ON u.id = m.author_id
        WHERE m.case_id = $1
          AND ($2::boolean OR m.visibility = 'participants')
        ORDER BY m.created_at ASC, m.id ASC`,
      [caseId, includeAdminNotes],
    );
    return rows;
  }

  async insertNativeEvidence(
    input: { caseId: string; uploadedBy: string; uploadId: string; label: string | null },
    client?: PoolClient,
  ): Promise<ResolutionCaseEvidenceRow> {
    const db = client ?? getPool();
    const { rows } = await db.query<ResolutionCaseEvidenceRow>(
      `WITH inserted AS (
         INSERT INTO resolution_case_evidence (case_id, uploaded_by, upload_id, label)
         VALUES ($1, $2, $3, $4)
         RETURNING *
       )
       SELECT i.*, pu.original_name
         FROM inserted i
         JOIN private_uploads pu ON pu.id = i.upload_id`,
      [input.caseId, input.uploadedBy, input.uploadId, input.label],
    );
    return rows[0]!;
  }

  async listNativeEvidence(caseId: string): Promise<ResolutionCaseEvidenceRow[]> {
    const { rows } = await getPool().query<ResolutionCaseEvidenceRow>(
      `SELECT e.*, pu.original_name
         FROM resolution_case_evidence e
         JOIN private_uploads pu ON pu.id = e.upload_id
        WHERE e.case_id = $1
        ORDER BY e.created_at DESC, e.id DESC`,
      [caseId],
    );
    return rows;
  }

  async insertEvent(
    input: {
      caseId: string;
      eventType: string;
      actorId: string | null;
      metadata?: Record<string, unknown>;
    },
    client?: PoolClient,
  ): Promise<void> {
    const db = client ?? getPool();
    await db.query(
      `INSERT INTO resolution_case_events (case_id, event_type, actor_id, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [input.caseId, input.eventType, input.actorId, JSON.stringify(input.metadata ?? {})],
    );
  }

  async listEvents(caseId: string, includeAdminNotes: boolean): Promise<ResolutionCaseEventRow[]> {
    const { rows } = await getPool().query<ResolutionCaseEventRow>(
      `SELECT *
         FROM resolution_case_events
        WHERE case_id = $1
          AND (
            $2::boolean
            OR event_type <> 'staff_message'
            OR COALESCE(metadata->>'visibility', 'participants') <> 'admin'
          )
        ORDER BY created_at ASC, id ASC`,
      [caseId, includeAdminNotes],
    );
    return rows;
  }

  /**
   * Bump activity without letting a slow writer move the clock backwards.
   *
   * Two replies landing out of order would otherwise leave the list sorted by
   * whichever transaction committed last rather than by what actually happened.
   */
  async touchCase(caseId: string, client?: PoolClient): Promise<void> {
    const db = client ?? getPool();
    await db.query(
      `UPDATE resolution_cases SET last_activity_at = GREATEST(last_activity_at, now()) WHERE id = $1`,
      [caseId],
    );
  }

  // -------------------------------------------------------------------------
  // Status transitions
  // -------------------------------------------------------------------------

  async updateStatus(
    client: PoolClient,
    caseId: string,
    status: string,
    terminal: { outcome: string | null; notes: string | null; resolvedBy: string | null } | null,
  ): Promise<ResolutionCaseRow | null> {
    const isTerminal = status === 'resolved' || status === 'closed';
    const { rows } = await client.query<ResolutionCaseRow>(
      `UPDATE resolution_cases
          SET status = $2,
              resolution_outcome = CASE WHEN $3::boolean THEN $4::text ELSE NULL END,
              resolution_notes   = CASE WHEN $3::boolean THEN $5::text ELSE NULL END,
              resolved_by        = CASE WHEN $3::boolean THEN $6::uuid ELSE NULL END,
              resolved_at        = CASE WHEN $3::boolean THEN now() ELSE NULL END,
              last_activity_at   = GREATEST(last_activity_at, now()),
              updated_at        = now()
        WHERE id = $1
        RETURNING *`,
      [
        caseId,
        status,
        isTerminal,
        terminal?.outcome ?? null,
        terminal?.notes ?? null,
        terminal?.resolvedBy ?? null,
      ],
    );
    return rows[0] ?? null;
  }

  async markEscalated(
    client: PoolClient,
    caseId: string,
    userId: string,
    reason: string | null,
  ): Promise<ResolutionCaseRow | null> {
    const { rows } = await client.query<ResolutionCaseRow>(
      `UPDATE resolution_cases
          SET escalated_at = now(),
              escalated_by = $2,
              escalation_reason = $3,
              last_activity_at = GREATEST(last_activity_at, now()),
              updated_at = now()
        WHERE id = $1 AND escalated_at IS NULL
        RETURNING *`,
      [caseId, userId, reason],
    );
    return rows[0] ?? null;
  }

  async assignAdmin(caseId: string, adminId: string | null): Promise<ResolutionCaseRow | null> {
    const { rows } = await getPool().query<ResolutionCaseRow>(
      `UPDATE resolution_cases
          SET assigned_admin_id = $2,
              last_activity_at = GREATEST(last_activity_at, now()),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [caseId, adminId],
    );
    return rows[0] ?? null;
  }

  async setCounterpartyAccess(
    client: PoolClient,
    caseId: string,
    granted: boolean,
  ): Promise<ResolutionCaseRow | null> {
    const { rows } = await client.query<ResolutionCaseRow>(
      `UPDATE resolution_cases
          SET counterparty_access = $2,
              last_activity_at = GREATEST(last_activity_at, now()),
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [caseId, granted],
    );
    return rows[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Legacy projections
  // -------------------------------------------------------------------------

  async listSupportTicketMessages(ticketId: string): Promise<ResolutionCaseMessageRow[]> {
    const { rows } = await getPool().query<ResolutionCaseMessageRow>(
      `SELECT m.id,
              m.ticket_id AS case_id,
              m.author_id,
              u.display_name AS author_name,
              m.body,
              'participants'::text AS visibility,
              m.is_staff,
              m.created_at,
              m.attachment_urls
         FROM support_ticket_messages m
         LEFT JOIN users u ON u.id = m.author_id
        WHERE m.ticket_id = $1
        ORDER BY m.created_at ASC, m.id ASC`,
      [ticketId],
    );
    return rows;
  }

  async listReservationDisputeNotes(
    disputeId: string,
    includeAdminNotes: boolean,
  ): Promise<ResolutionCaseMessageRow[]> {
    const { rows } = await getPool().query<ResolutionCaseMessageRow>(
      `SELECT n.id,
              n.dispute_id AS case_id,
              n.author_id,
              u.display_name AS author_name,
              n.body,
              CASE WHEN n.visibility = 'admin' THEN 'admin' ELSE 'participants' END AS visibility,
              COALESCE(u.is_admin, false) AS is_staff,
              n.created_at
         FROM reservation_dispute_notes n
         LEFT JOIN users u ON u.id = n.author_id
        WHERE n.dispute_id = $1
          AND ($2::boolean OR n.visibility = 'public')
        ORDER BY n.created_at ASC, n.id ASC`,
      [disputeId, includeAdminNotes],
    );
    return rows;
  }

  async listReservationDisputeEvidence(disputeId: string): Promise<ResolutionCaseEvidenceRow[]> {
    const { rows } = await getPool().query<ResolutionCaseEvidenceRow>(
      `SELECT e.id,
              e.dispute_id AS case_id,
              e.uploaded_by,
              e.upload_id,
              e.label,
              pu.original_name,
              e.created_at
         FROM reservation_dispute_evidence e
         JOIN private_uploads pu ON pu.id = e.upload_id
        WHERE e.dispute_id = $1
        ORDER BY e.created_at DESC, e.id DESC`,
      [disputeId],
    );
    return rows;
  }

  async listReservationTimeline(reservationId: string): Promise<ResolutionCaseEventRow[]> {
    const { rows } = await getPool().query<ResolutionCaseEventRow>(
      `SELECT id, reservation_id AS case_id, event_type, actor_id, metadata, created_at
         FROM reservation_events
        WHERE reservation_id = $1
        ORDER BY created_at ASC, id ASC`,
      [reservationId],
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // Ownership and eligibility
  // -------------------------------------------------------------------------

  async privateUploadIsAttachableEvidence(uploadId: string, userId: string): Promise<boolean> {
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM private_uploads pu
          WHERE pu.id = $1
            AND pu.user_id = $2
            AND NOT EXISTS (
              SELECT 1
                FROM identity_documents d
               WHERE d.front_image_url = pu.storage_path
                  OR d.back_image_url = pu.storage_path
                  OR d.selfie_image_url = pu.storage_path
                  OR d.front_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                  OR d.back_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                  OR d.selfie_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
            )
            AND NOT EXISTS (
              SELECT 1
                FROM academic_records a
               WHERE a.certificate_image_url = pu.storage_path
                  OR a.transcript_image_url = pu.storage_path
                  OR a.certificate_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
                  OR a.transcript_image_url LIKE ('%/api/upload/private/' || pu.id::text || '%')
            )
       ) AS ok`,
      [uploadId, userId],
    );
    return rows[0]?.ok === true;
  }

  /**
   * Needs and job applications this user could dispute.
   *
   * A need only qualifies once `activated_at` is set: before activation the
   * provider has not paid and no engagement exists to dispute, and offering the
   * option anyway would produce cases nobody can adjudicate. Job applications
   * qualify once accepted.
   */
  async listDisputableEngagements(userId: string): Promise<EligibleSubjectRow[]> {
    const { rows } = await getPool().query<EligibleSubjectRow>(
      `SELECT 'need'::text AS subject_type,
              n.id::text    AS subject_id,
              n.title       AS label,
              CASE WHEN n.customer_id = $1 THEN b.expert_id ELSE n.customer_id END::text
                            AS counterparty_id,
              CASE WHEN n.customer_id = $1 THEN pu.display_name ELSE cu.display_name END
                            AS counterparty_name
         FROM needs n
         JOIN bids b ON b.id = COALESCE(n.awarded_bid_id, n.pending_award_bid_id)
         LEFT JOIN users pu ON pu.id = b.expert_id
         LEFT JOIN users cu ON cu.id = n.customer_id
        WHERE n.activated_at IS NOT NULL
          AND n.status IN ('awarded', 'in_progress', 'completed')
          AND (n.customer_id = $1 OR b.expert_id = $1)

        UNION ALL

       SELECT 'job_application'::text,
              a.id::text,
              j.title,
              CASE WHEN j.business_id = $1 THEN a.expert_id ELSE j.business_id END::text,
              CASE WHEN j.business_id = $1 THEN eu.display_name ELSE bu.display_name END
         FROM job_applications a
         JOIN jobs j ON j.id = a.job_id
         LEFT JOIN users eu ON eu.id = a.expert_id
         LEFT JOIN users bu ON bu.id = j.business_id
        WHERE a.status = 'accepted'
          AND (j.business_id = $1 OR a.expert_id = $1)
        ORDER BY 3 NULLS LAST`,
      [userId],
    );
    return rows;
  }

  /**
   * Engagements where money changed hands directly between the two parties.
   *
   * Keyed on `mhc_job_activations` for the same reason chat access is: that row
   * is written in the same transaction as the MHC debit, so it cannot claim an
   * engagement that was never paid for.
   */
  async listDirectPaymentEngagements(userId: string): Promise<EligibleSubjectRow[]> {
    const { rows } = await getPool().query<EligibleSubjectRow>(
      `SELECT CASE WHEN a.need_id IS NOT NULL THEN 'need' ELSE 'reservation' END::text
                AS subject_type,
              COALESCE(a.need_id, a.reservation_id)::text AS subject_id,
              COALESCE(n.title, s.title, 'Direct payment')  AS label,
              CASE WHEN a.provider_user_id = $1
                   THEN COALESCE(n.customer_id, r.customer_id)
                   ELSE a.provider_user_id END::text        AS counterparty_id,
              CASE WHEN a.provider_user_id = $1
                   THEN COALESCE(ncu.display_name, rcu.display_name)
                   ELSE pu.display_name END                 AS counterparty_name
         FROM mhc_job_activations a
         LEFT JOIN needs n         ON n.id = a.need_id
         LEFT JOIN reservations r  ON r.id = a.reservation_id
         LEFT JOIN services s      ON s.id = r.service_id
         LEFT JOIN users pu        ON pu.id = a.provider_user_id
         LEFT JOIN users ncu       ON ncu.id = n.customer_id
         LEFT JOIN users rcu       ON rcu.id = r.customer_id
        WHERE COALESCE(a.need_id, a.reservation_id) IS NOT NULL
          AND (
            a.provider_user_id = $1
            OR n.customer_id = $1
            OR r.customer_id = $1
          )
        ORDER BY 3 NULLS LAST`,
      [userId],
    );
    return rows;
  }

  /** The two parties to a disputable engagement, re-read at creation time. */
  async findEngagementParties(
    subjectType: string,
    subjectId: string,
  ): Promise<{ customerId: string; providerId: string; label: string | null } | null> {
    if (subjectType === 'need') {
      const { rows } = await getPool().query<{
        customer_id: string;
        provider_id: string | null;
        label: string | null;
      }>(
        `SELECT n.customer_id, b.expert_id AS provider_id, n.title AS label
           FROM needs n
           LEFT JOIN bids b ON b.id = COALESCE(n.awarded_bid_id, n.pending_award_bid_id)
          WHERE n.id = $1 AND n.activated_at IS NOT NULL
          LIMIT 1`,
        [subjectId],
      );
      const row = rows[0];
      if (!row?.provider_id) return null;
      return { customerId: row.customer_id, providerId: row.provider_id, label: row.label };
    }
    if (subjectType === 'job_application') {
      const { rows } = await getPool().query<{
        customer_id: string;
        provider_id: string;
        label: string | null;
      }>(
        `SELECT j.business_id AS customer_id, a.expert_id AS provider_id, j.title AS label
           FROM job_applications a
           JOIN jobs j ON j.id = a.job_id
          WHERE a.id = $1 AND a.status = 'accepted'
          LIMIT 1`,
        [subjectId],
      );
      const row = rows[0];
      if (!row) return null;
      return { customerId: row.customer_id, providerId: row.provider_id, label: row.label };
    }
    if (subjectType === 'reservation') {
      const { rows } = await getPool().query<{
        customer_id: string;
        provider_id: string;
        label: string | null;
      }>(
        `SELECT r.customer_id, r.provider_id, s.title AS label
           FROM reservations r
           LEFT JOIN services s ON s.id = r.service_id
          WHERE r.id = $1
          LIMIT 1`,
        [subjectId],
      );
      const row = rows[0];
      if (!row) return null;
      return { customerId: row.customer_id, providerId: row.provider_id, label: row.label };
    }
    return null;
  }

  /** True when an MHC activation ties these two users to this engagement. */
  async hasDirectPaymentActivation(subjectType: string, subjectId: string): Promise<boolean> {
    const column = subjectType === 'need' ? 'need_id' : 'reservation_id';
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM mhc_job_activations WHERE ${column} = $1
       ) AS ok`,
      [subjectId],
    );
    return rows[0]?.ok === true;
  }

  async userExists(userId: string): Promise<boolean> {
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1 AND deleted_at IS NULL) AS ok`,
      [userId],
    );
    return rows[0]?.ok === true;
  }

  async authorizedCaseAdminExists(userId: string): Promise<boolean> {
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM users
          WHERE id = $1
            AND deleted_at IS NULL
            AND is_admin = true
            AND (
              admin_permissions ? 'manage_support'
              OR admin_permissions ? 'manage_transactions'
            )
       ) AS ok`,
      [userId],
    );
    return rows[0]?.ok === true;
  }

  async findUserContact(
    userId: string,
  ): Promise<{ email: string | null; display_name: string | null } | null> {
    const { rows } = await getPool().query<{ email: string | null; display_name: string | null }>(
      `SELECT email, display_name FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }
}
