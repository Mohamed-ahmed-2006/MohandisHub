// ---------------------------------------------------------------------------
// Help & Resolution service — one case surface over two engines and three kinds
// ---------------------------------------------------------------------------
// Authorisation rules, in one place because every route depends on them:
//
//   * A case is visible to the person who opened it, to a counterparty that has
//     been EXPLICITLY granted access, and to an authorised admin. Nobody else,
//     and an unrelated caller is told the case does not exist rather than that
//     they may not see it — a safety report's existence is itself sensitive.
//   * Status is moved by this service, never by the client. A request carries
//     what the caller wants to do, not what the case should become.
//   * A case backed by an older engine is written through THAT engine, so the
//     support status machine and the dispute participant checks keep running
//     and there is no second copy of the rules to drift.
// ---------------------------------------------------------------------------

import type {
  ResolutionCaseAvailability,
  ResolutionCaseEvidence,
  ResolutionCaseFile,
  ResolutionCaseKind,
  ResolutionCaseMessage,
  ResolutionCaseOutcome,
  ResolutionCaseStatus,
  ResolutionCaseSubjectType,
  ResolutionCaseSummary,
  ResolutionCaseTimelineEvent,
  ResolutionCaseViewerRole,
} from '@mohandishub/shared';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { SupportService } from '../support/support.service.js';

import type {
  EligibleSubjectRow,
  ListCaseFilters,
  ResolutionCaseEventRow,
  ResolutionCaseEvidenceRow,
  ResolutionCaseListRow,
  ResolutionCaseMessageRow,
  ResolutionCaseRow,
} from './help-resolution.repository.js';
import { HelpResolutionRepository } from './help-resolution.repository.js';
import type {
  AddEvidenceInput,
  CreateCaseInput,
  EscalateInput,
  PostMessageInput,
  ResolveCaseInput,
} from './help-resolution.validation.js';

const TERMINAL_STATUSES = new Set(['resolved', 'closed']);

const NEED_JOB_DISPUTE_TITLES: Record<string, string> = {
  not_delivered: 'Work not delivered',
  partially_delivered: 'Work partially delivered',
  quality: 'Quality of delivered work',
  unresponsive: 'Other party is unresponsive',
  scope_disagreement: 'Disagreement about scope',
  other: 'Engagement dispute',
};

const DIRECT_PAYMENT_TITLES: Record<string, string> = {
  paid_not_acknowledged: 'Payment sent but not acknowledged',
  wrong_amount: 'Wrong amount paid',
  payment_details_invalid: 'Payment details did not work',
  refund_not_received: 'Refund not received',
  other: 'Direct payment issue',
};

const SAFETY_REPORT_TITLES: Record<string, string> = {
  harassment: 'Harassment report',
  fraud: 'Fraud report',
  off_platform_solicitation: 'Off-platform solicitation report',
  impersonation: 'Impersonation report',
  unsafe_behaviour: 'Unsafe behaviour report',
  other: 'Safety report',
};

const toNumber = (value: string | number | null | undefined): number =>
  typeof value === 'number' ? value : parseInt(value ?? '0', 10) || 0;

export type CaseViewer = {
  id: string;
  role: string;
  isAdmin: boolean;
};

export class HelpResolutionService {
  constructor(
    private readonly repo: HelpResolutionRepository = new HelpResolutionRepository(),
    private readonly supportService: SupportService = new SupportService(),
    private readonly reservationsService: ReservationsService = new ReservationsService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
  ) {}

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  /**
   * Status as reported to clients.
   *
   * `escalated` is not a stored status: a legacy-backed case has its stored
   * status overwritten by its engine whenever the engine writes, so an
   * escalation stored there would be silently lost. It lives in `escalated_at`
   * and is folded in here, for every kind, so the two behave the same.
   */
  private projectStatus(row: ResolutionCaseRow): ResolutionCaseStatus {
    if (TERMINAL_STATUSES.has(row.status)) return row.status as ResolutionCaseStatus;
    if (row.escalated_at) return 'escalated';
    return row.status as ResolutionCaseStatus;
  }

  private toSummary(
    row: ResolutionCaseListRow,
    viewerRole: ResolutionCaseViewerRole,
  ): ResolutionCaseSummary {
    return {
      id: row.id,
      referenceCode: row.reference_code,
      kind: row.kind as ResolutionCaseKind,
      status: this.projectStatus(row),
      engineStatus: row.engine_status,
      title: row.title,
      openedBy: row.opened_by,
      counterpartyId: row.counterparty_access ? row.counterparty_id : null,
      counterpartyName: row.counterparty_access ? row.counterparty_name : null,
      subjectType: row.subject_type as ResolutionCaseSubjectType | null,
      subjectId: row.subject_id,
      reasonCode: row.reason_code,
      escalatedAt: row.escalated_at,
      assignedAdminId: row.assigned_admin_id,
      messageCount: toNumber(row.message_count),
      evidenceCount: toNumber(row.evidence_count),
      lastActivityAt: row.last_activity_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      supportTicketId: row.support_ticket_id,
      reservationDisputeId: row.reservation_dispute_id,
      viewerRole,
    };
  }

  private toMessage(row: ResolutionCaseMessageRow, caseId: string): ResolutionCaseMessage {
    return {
      id: row.id,
      caseId,
      authorId: row.author_id,
      authorName: row.author_name,
      body: row.body,
      visibility: row.visibility === 'admin' ? 'admin' : 'participants',
      isStaff: row.is_staff,
      createdAt: row.created_at,
      ...(row.attachment_urls?.length ? { attachmentUrls: row.attachment_urls } : {}),
    };
  }

  /**
   * Evidence never carries a storage path or a bucket-signed URL.
   *
   * `fileUrl` is the authenticated API path; opening it goes through
   * GET /api/upload/private/:id, which re-authorises the caller against this
   * case before it mints a short-lived signed URL.
   */
  private toEvidence(row: ResolutionCaseEvidenceRow, caseId: string): ResolutionCaseEvidence {
    return {
      id: row.id,
      caseId,
      uploadedBy: row.uploaded_by,
      uploadId: row.upload_id,
      fileUrl: `/api/upload/private/${row.upload_id}`,
      label: row.label ?? row.original_name,
      createdAt: row.created_at,
    };
  }

  private toTimelineEvent(
    row: ResolutionCaseEventRow,
    caseId: string,
  ): ResolutionCaseTimelineEvent {
    return {
      id: row.id,
      caseId,
      eventType: row.event_type,
      actorId: row.actor_id,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Authorisation
  // -------------------------------------------------------------------------

  private notFound(): HttpError {
    return new HttpError({
      statusCode: 404,
      code: 'CASE_NOT_FOUND',
      message: 'Case not found.',
    });
  }

  /**
   * Resolve the caller's relationship to a case, or refuse.
   *
   * Unrelated callers get 404 rather than 403 on purpose: for a safety report,
   * confirming that a case exists about a given subject is itself the leak.
   */
  private async loadForViewer(
    caseId: string,
    userId: string,
  ): Promise<{ row: ResolutionCaseListRow; viewerRole: ResolutionCaseViewerRole }> {
    const row = await this.repo.findCaseById(caseId);
    if (!row) throw this.notFound();
    if (row.opened_by === userId) return { row, viewerRole: 'opener' };
    if (row.counterparty_id === userId && row.counterparty_access) {
      return { row, viewerRole: 'counterparty' };
    }
    throw this.notFound();
  }

  private async loadForAdmin(caseId: string): Promise<ResolutionCaseListRow> {
    const row = await this.repo.findCaseById(caseId);
    if (!row) throw this.notFound();
    return row;
  }

  private ensureNotTerminal(row: ResolutionCaseRow): void {
    if (TERMINAL_STATUSES.has(row.status)) {
      throw new HttpError({
        statusCode: 409,
        code: 'CASE_NOT_OPEN',
        message: 'This case is closed. Open a new case if you still need help.',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------

  async listCases(
    userId: string,
    filters: ListCaseFilters,
    page: number,
    limit: number,
  ): Promise<{
    items: ResolutionCaseSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { rows, total } = await this.repo.listCasesForUser(
      userId,
      filters,
      limit,
      (page - 1) * limit,
    );
    return {
      items: rows.map((row) =>
        this.toSummary(row, row.opened_by === userId ? 'opener' : 'counterparty'),
      ),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    };
  }

  async listCasesForAdmin(
    filters: ListCaseFilters,
    page: number,
    limit: number,
  ): Promise<{
    items: ResolutionCaseSummary[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const { rows, total } = await this.repo.listCasesForAdmin(filters, limit, (page - 1) * limit);
    return {
      items: rows.map((row) => this.toSummary(row, 'admin')),
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    };
  }

  // -------------------------------------------------------------------------
  // Case file
  // -------------------------------------------------------------------------

  async getCaseFile(caseId: string, userId: string): Promise<ResolutionCaseFile> {
    const { row, viewerRole } = await this.loadForViewer(caseId, userId);
    return this.buildCaseFile(row, viewerRole);
  }

  async getCaseFileForAdmin(caseId: string): Promise<ResolutionCaseFile> {
    const row = await this.loadForAdmin(caseId);
    return this.buildCaseFile(row, 'admin');
  }

  /**
   * Resolve a historical deep link to its unified case.
   *
   * `/app/support?ticketId=…` and `/app/disputes?disputeId=…` are links people
   * already have in their inboxes. Matching them client-side against the loaded
   * page only works while the case is on that page, so the lookup happens here
   * and applies the same visibility rule as every other read.
   */
  async findCaseByLegacyId(
    legacy: { supportTicketId: string } | { reservationDisputeId: string },
    userId: string,
  ): Promise<ResolutionCaseSummary> {
    const row =
      'supportTicketId' in legacy
        ? await this.repo.findCaseBySupportTicketId(legacy.supportTicketId)
        : await this.repo.findCaseByReservationDisputeId(legacy.reservationDisputeId);
    if (!row) throw this.notFound();
    if (row.opened_by === userId) return this.toSummary(row, 'opener');
    if (row.counterparty_id === userId && row.counterparty_access) {
      return this.toSummary(row, 'counterparty');
    }
    throw this.notFound();
  }

  private async buildCaseFile(
    row: ResolutionCaseListRow,
    viewerRole: ResolutionCaseViewerRole,
  ): Promise<ResolutionCaseFile> {
    const isAdmin = viewerRole === 'admin';
    const [messageRows, evidenceRows, eventRows] = await Promise.all([
      this.loadMessages(row, isAdmin),
      this.loadEvidence(row),
      this.loadTimeline(row),
    ]);

    const terminal = TERMINAL_STATUSES.has(row.status);
    const isReservationDispute = row.kind === 'reservation_dispute';

    return {
      case: this.toSummary(row, viewerRole),
      description: row.description,
      resolution: {
        outcome: row.resolution_outcome as ResolutionCaseOutcome | null,
        notes: row.resolution_notes,
        resolvedBy: row.resolved_by,
        resolvedAt: row.resolved_at,
      },
      escalation: {
        escalatedAt: row.escalated_at,
        escalatedBy: row.escalated_by,
        reason: row.escalation_reason,
      },
      messages: messageRows.map((m) => this.toMessage(m, row.id)),
      evidence: evidenceRows.map((e) => this.toEvidence(e, row.id)),
      timeline: eventRows.map((e) => this.toTimelineEvent(e, row.id)),
      capabilities: {
        canPostMessage: !terminal,
        // A general-support case has no private evidence store; its
        // attachments ride on messages through the public upload path, which
        // is what the existing support screen already does.
        canAddEvidence: !terminal && row.kind !== 'general_support',
        canEscalate: !terminal && !row.escalated_at && !isAdmin,
        canResolve: isAdmin && !isReservationDispute,
        resolutionHandledBy: isReservationDispute ? 'reservation_dispute_endpoint' : null,
      },
    };
  }

  private async loadMessages(
    row: ResolutionCaseListRow,
    includeAdminNotes: boolean,
  ): Promise<ResolutionCaseMessageRow[]> {
    if (row.kind === 'general_support' && row.support_ticket_id) {
      return this.repo.listSupportTicketMessages(row.support_ticket_id);
    }
    if (row.kind === 'reservation_dispute' && row.reservation_dispute_id) {
      return this.repo.listReservationDisputeNotes(row.reservation_dispute_id, includeAdminNotes);
    }
    return this.repo.listNativeMessages(row.id, includeAdminNotes);
  }

  private async loadEvidence(row: ResolutionCaseListRow): Promise<ResolutionCaseEvidenceRow[]> {
    if (row.kind === 'reservation_dispute' && row.reservation_dispute_id) {
      return this.repo.listReservationDisputeEvidence(row.reservation_dispute_id);
    }
    if (row.kind === 'general_support') return [];
    return this.repo.listNativeEvidence(row.id);
  }

  private async loadTimeline(row: ResolutionCaseListRow): Promise<ResolutionCaseEventRow[]> {
    if (row.kind === 'reservation_dispute' && row.subject_id) {
      return this.repo.listReservationTimeline(row.subject_id);
    }
    return this.repo.listEvents(row.id);
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  async createCase(viewer: CaseViewer, input: CreateCaseInput): Promise<ResolutionCaseSummary> {
    if (input.kind === 'general_support') {
      return this.createGeneralSupportCase(viewer, input);
    }
    if (input.kind === 'need_job_dispute') {
      return this.createNeedJobDisputeCase(viewer, input);
    }
    if (input.kind === 'direct_payment') {
      return this.createDirectPaymentCase(viewer, input);
    }
    return this.createSafetyReportCase(viewer, input);
  }

  /**
   * General support still goes through the support engine.
   *
   * The ticket is the record of truth; the spine row appears via the sync
   * trigger. Writing a native case instead would have split platform support
   * across two tables and left the existing admin support screen half blind.
   */
  private async createGeneralSupportCase(
    viewer: CaseViewer,
    input: Extract<CreateCaseInput, { kind: 'general_support' }>,
  ): Promise<ResolutionCaseSummary> {
    const ticket = await this.supportService.createTicket(viewer.id, {
      category: input.category ?? 'other',
      body: input.body,
      subject: input.subject,
      ...(input.attachmentUrls?.length ? { attachmentUrls: input.attachmentUrls } : {}),
    });
    const row = await this.repo.findCaseBySupportTicketId(ticket.id);
    if (!row) {
      throw new HttpError({
        statusCode: 500,
        code: 'CASE_SYNC_FAILED',
        message: 'The support ticket was created but its case record is missing.',
      });
    }
    return this.toSummary(row, 'opener');
  }

  private async createNeedJobDisputeCase(
    viewer: CaseViewer,
    input: Extract<CreateCaseInput, { kind: 'need_job_dispute' }>,
  ): Promise<ResolutionCaseSummary> {
    const parties = await this.repo.findEngagementParties(input.subjectType, input.subjectId);
    if (!parties) {
      throw new HttpError({
        statusCode: 409,
        code: 'MARKETPLACE_DISPUTE_UNSUPPORTED',
        message:
          input.subjectType === 'need'
            ? 'This need has no activated award, so there is no engagement to dispute yet.'
            : 'This application has not been accepted, so there is no engagement to dispute yet.',
      });
    }
    const counterpartyId = this.otherParty(parties, viewer.id);
    if (!counterpartyId) throw this.notFound();

    return this.insertNativeCaseWithEvidence(viewer, {
      kind: 'need_job_dispute',
      counterpartyId,
      counterpartyAccess: true,
      reportedUserId: null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: parties.label?.trim()
        ? `${NEED_JOB_DISPUTE_TITLES[input.reason]}: ${parties.label.trim()}`.slice(0, 500)
        : (NEED_JOB_DISPUTE_TITLES[input.reason] ?? 'Engagement dispute'),
      description: input.description,
      reasonCode: input.reason,
      evidenceUploadIds: input.evidenceUploadIds ?? [],
    });
  }

  private async createDirectPaymentCase(
    viewer: CaseViewer,
    input: Extract<CreateCaseInput, { kind: 'direct_payment' }>,
  ): Promise<ResolutionCaseSummary> {
    const activated = await this.repo.hasDirectPaymentActivation(
      input.subjectType,
      input.subjectId,
    );
    if (!activated) {
      throw new HttpError({
        statusCode: 409,
        code: 'DIRECT_PAYMENT_DISPUTE_UNSUPPORTED',
        message:
          'Direct payment cases need an activated engagement. This one has not been activated, so there is no payment arrangement on record.',
      });
    }
    const parties = await this.repo.findEngagementParties(input.subjectType, input.subjectId);
    if (!parties) throw this.notFound();
    const counterpartyId = this.otherParty(parties, viewer.id);
    if (!counterpartyId) throw this.notFound();

    const amountNote =
      input.amount != null ? `\n\nReported amount: ${input.amount} ${input.currency ?? 'EGP'}` : '';

    return this.insertNativeCaseWithEvidence(viewer, {
      kind: 'direct_payment',
      counterpartyId,
      counterpartyAccess: true,
      reportedUserId: null,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      title: parties.label?.trim()
        ? `${DIRECT_PAYMENT_TITLES[input.reason]}: ${parties.label.trim()}`.slice(0, 500)
        : (DIRECT_PAYMENT_TITLES[input.reason] ?? 'Direct payment issue'),
      description: `${input.description}${amountNote}`,
      reasonCode: input.reason,
      evidenceUploadIds: input.evidenceUploadIds ?? [],
    });
  }

  /**
   * A safety report is one-sided by construction.
   *
   * The reported party is recorded so an admin can act, and is given no access
   * and no notification. The schema refuses to store a counterparty on this
   * kind at all, so a later change here cannot quietly open it up.
   */
  private async createSafetyReportCase(
    viewer: CaseViewer,
    input: Extract<CreateCaseInput, { kind: 'safety_report' }>,
  ): Promise<ResolutionCaseSummary> {
    if (input.reportedUserId) {
      if (input.reportedUserId === viewer.id) {
        throw new HttpError({
          statusCode: 400,
          code: 'CANNOT_REPORT_SELF',
          message: 'You cannot report yourself.',
        });
      }
      if (!(await this.repo.userExists(input.reportedUserId))) {
        throw new HttpError({
          statusCode: 404,
          code: 'REPORTED_USER_NOT_FOUND',
          message: 'The reported account does not exist.',
        });
      }
    }

    return this.insertNativeCaseWithEvidence(viewer, {
      kind: 'safety_report',
      counterpartyId: null,
      counterpartyAccess: false,
      reportedUserId: input.reportedUserId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      title: SAFETY_REPORT_TITLES[input.reason] ?? 'Safety report',
      description: input.description,
      reasonCode: input.reason,
      evidenceUploadIds: input.evidenceUploadIds ?? [],
    });
  }

  private otherParty(
    parties: { customerId: string; providerId: string },
    userId: string,
  ): string | null {
    if (parties.customerId === userId) return parties.providerId;
    if (parties.providerId === userId) return parties.customerId;
    return null;
  }

  /**
   * Insert a native case and its opening evidence in one transaction.
   *
   * The duplicate-prevention index does the deciding: two submissions racing
   * for the same engagement both reach the insert and PostgreSQL rejects the
   * loser, which is reported as the conflict it is rather than as a 500.
   */
  private async insertNativeCaseWithEvidence(
    viewer: CaseViewer,
    input: {
      kind: string;
      counterpartyId: string | null;
      counterpartyAccess: boolean;
      reportedUserId: string | null;
      subjectType: string | null;
      subjectId: string | null;
      title: string;
      description: string;
      reasonCode: string;
      evidenceUploadIds: string[];
    },
  ): Promise<ResolutionCaseSummary> {
    const uploadIds = [...new Set(input.evidenceUploadIds)];
    for (const uploadId of uploadIds) {
      if (!(await this.repo.privateUploadBelongsToUser(uploadId, viewer.id))) {
        throw new HttpError({
          statusCode: 403,
          code: 'UPLOAD_NOT_OWNED',
          message: 'Evidence uploads must belong to you.',
        });
      }
    }

    const pool = getPool();
    const client = await pool.connect();
    let created: ResolutionCaseRow;
    try {
      await client.query('BEGIN');
      created = await this.repo.createNativeCase(
        {
          kind: input.kind,
          openedBy: viewer.id,
          counterpartyId: input.counterpartyId,
          counterpartyAccess: input.counterpartyAccess,
          reportedUserId: input.reportedUserId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          title: input.title,
          description: input.description,
          reasonCode: input.reasonCode,
        },
        client,
      );
      for (const uploadId of uploadIds) {
        await this.repo.insertNativeEvidence(
          { caseId: created.id, uploadedBy: viewer.id, uploadId, label: null },
          client,
        );
      }
      await this.repo.insertEvent(
        {
          caseId: created.id,
          eventType: 'case_opened',
          actorId: viewer.id,
          metadata: { kind: input.kind, reason: input.reasonCode },
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw this.translateDuplicate(error, input.kind);
    } finally {
      client.release();
    }

    if (input.counterpartyId && input.counterpartyAccess) {
      this.notify(input.counterpartyId, 'resolution_case_opened', 'A case was opened with you', {
        caseId: created.id,
        referenceCode: created.reference_code,
      });
    }

    const row = await this.repo.findCaseById(created.id);
    return this.toSummary(row ?? { ...created, ...this.emptyProjection() }, 'opener');
  }

  private emptyProjection(): Omit<ResolutionCaseListRow, keyof ResolutionCaseRow> {
    return {
      counterparty_name: null,
      engine_status: null,
      message_count: '0',
      evidence_count: '0',
    };
  }

  private translateDuplicate(error: unknown, kind: string): unknown {
    const pgError = error as { code?: string; constraint?: string };
    if (
      pgError?.code === '23505' &&
      pgError.constraint === 'uq_resolution_cases_live_dispute_subject'
    ) {
      return new HttpError({
        statusCode: 409,
        code: 'DUPLICATE_CASE',
        message: 'You already have an open case about this. Continue in the existing case.',
        details: { kind },
      });
    }
    return error;
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async postMessage(
    caseId: string,
    viewer: CaseViewer,
    input: PostMessageInput,
  ): Promise<ResolutionCaseMessage> {
    // A participant asking for an internal note is refused outright rather than
    // silently downgraded, so a mistaken client never believes staff-only text
    // was hidden when it was not.
    if (input.visibility === 'admin') {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only admins can add internal notes.',
      });
    }
    const { row } = await this.loadForViewer(caseId, viewer.id);
    this.ensureNotTerminal(row);
    return this.writeMessage(row, viewer, input, false);
  }

  async postAdminMessage(
    caseId: string,
    viewer: CaseViewer,
    input: PostMessageInput,
  ): Promise<ResolutionCaseMessage> {
    const row = await this.loadForAdmin(caseId);
    this.ensureNotTerminal(row);
    return this.writeMessage(row, viewer, input, true);
  }

  private async writeMessage(
    row: ResolutionCaseListRow,
    viewer: CaseViewer,
    input: PostMessageInput,
    isStaff: boolean,
  ): Promise<ResolutionCaseMessage> {
    let message: ResolutionCaseMessage;

    // The support engine has no internal-note concept: everything in
    // support_ticket_messages is shown to the ticket owner. Writing an admin's
    // note there would show it to the very person it was hidden from, so this
    // refuses rather than silently publishing it.
    if (isStaff && input.visibility === 'admin' && row.kind === 'general_support') {
      throw new HttpError({
        statusCode: 409,
        code: 'INTERNAL_NOTES_NOT_SUPPORTED',
        message:
          'Support tickets have no internal notes — every message is shown to the ticket owner. Post it as a reply, or record it on a case that supports internal notes.',
      });
    }

    if (row.kind === 'general_support' && row.support_ticket_id) {
      // The support engine owns ticket status and re-checks ownership itself.
      const reply = await this.supportService.reply(
        row.support_ticket_id,
        viewer.id,
        input.body,
        isStaff,
        input.attachmentUrls?.length ? input.attachmentUrls : null,
      );
      message = {
        id: reply.id,
        caseId: row.id,
        authorId: reply.authorId,
        authorName: null,
        body: reply.body,
        visibility: 'participants',
        isStaff: reply.isStaff,
        createdAt: reply.createdAt,
        ...(reply.attachmentUrls?.length ? { attachmentUrls: reply.attachmentUrls } : {}),
      };
    } else if (row.kind === 'reservation_dispute' && row.reservation_dispute_id) {
      // The reservation engine re-checks that the author is a participant.
      const note = await this.reservationsService.addDisputeNote(
        viewer.id,
        isStaff ? 'admin' : viewer.role,
        row.reservation_dispute_id,
        {
          body: input.body,
          visibility: isStaff && input.visibility === 'admin' ? 'admin' : 'public',
        },
      );
      message = {
        id: note.id,
        caseId: row.id,
        authorId: note.authorId,
        authorName: note.authorName,
        body: note.body,
        visibility: note.visibility === 'admin' ? 'admin' : 'participants',
        isStaff,
        createdAt: note.createdAt,
      };
    } else {
      message = this.toMessage(await this.writeNativeMessage(row, viewer, input, isStaff), row.id);
    }

    if (message.visibility === 'participants') {
      this.notifyOtherParticipants(row, viewer.id, 'resolution_case_message', 'New case message');
    }
    return message;
  }

  /**
   * Write a message to a native case: row, timeline entry and status, atomically.
   *
   * This was three separate round trips plus a second pooled connection for the
   * status change. Two things were wrong with that. A crash between the insert
   * and the status update left a case whose thread had moved on and whose
   * status had not; and taking a second connection per message meant ten
   * concurrent replies wanted twenty connections, which is how a pool runs out
   * under exactly the load this is supposed to survive.
   *
   * The `FOR UPDATE` also serialises concurrent writers on the case row, so the
   * status they leave behind is the one the last writer intended rather than
   * whichever transaction happened to commit second.
   *
   * Staff replying puts the ball in the user's court; a user replying puts it
   * back with staff. Nothing here reads the request body for a status — the
   * client says what it wants to post, not what the case should become.
   */
  private async writeNativeMessage(
    row: ResolutionCaseListRow,
    viewer: CaseViewer,
    input: PostMessageInput,
    isStaff: boolean,
  ): Promise<ResolutionCaseMessageRow> {
    const visibility = isStaff && input.visibility === 'admin' ? 'admin' : 'participants';
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.repo.lockCaseById(client, row.id);
      if (!locked) throw this.notFound();
      // Re-checked under the lock: the case may have been resolved between the
      // authorisation read and here.
      if (TERMINAL_STATUSES.has(locked.status)) {
        throw new HttpError({
          statusCode: 409,
          code: 'CASE_NOT_OPEN',
          message: 'This case is closed. Open a new case if you still need help.',
        });
      }

      const inserted = await this.repo.insertNativeMessage(
        {
          caseId: row.id,
          authorId: viewer.id,
          body: input.body,
          visibility,
          isStaff,
        },
        client,
      );
      await this.repo.insertEvent(
        {
          caseId: row.id,
          eventType: isStaff ? 'staff_message' : 'participant_message',
          actorId: viewer.id,
          metadata: { visibility },
        },
        client,
      );

      // An internal note is not a reply. It must not hand the case back to a
      // user who was never asked anything.
      const next = isStaff ? 'awaiting_user' : 'under_review';
      if (visibility === 'participants' && locked.status !== next) {
        await this.repo.updateStatus(client, row.id, next, null);
      } else {
        await this.repo.touchCase(row.id, client);
      }

      await client.query('COMMIT');
      return inserted;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Evidence
  // -------------------------------------------------------------------------

  async addEvidence(
    caseId: string,
    viewer: CaseViewer,
    input: AddEvidenceInput,
  ): Promise<ResolutionCaseEvidence> {
    const { row } = await this.loadForViewer(caseId, viewer.id);
    this.ensureNotTerminal(row);

    if (row.kind === 'general_support') {
      throw new HttpError({
        statusCode: 409,
        code: 'EVIDENCE_NOT_SUPPORTED',
        message: 'Attach files to a support message instead of adding case evidence.',
      });
    }

    if (row.kind === 'reservation_dispute' && row.reservation_dispute_id) {
      const evidence = await this.reservationsService.addDisputeEvidence(
        viewer.id,
        viewer.role,
        row.reservation_dispute_id,
        { uploadId: input.uploadId, label: input.label ?? null },
      );
      return {
        id: evidence.id,
        caseId: row.id,
        uploadedBy: evidence.uploadedBy,
        uploadId: evidence.uploadId,
        fileUrl: `/api/upload/private/${evidence.uploadId}`,
        label: evidence.label,
        createdAt: evidence.createdAt,
      };
    }

    if (!(await this.repo.privateUploadBelongsToUser(input.uploadId, viewer.id))) {
      throw new HttpError({
        statusCode: 403,
        code: 'UPLOAD_NOT_OWNED',
        message: 'Evidence uploads must belong to you.',
      });
    }

    let inserted: ResolutionCaseEvidenceRow;
    try {
      inserted = await this.repo.insertNativeEvidence({
        caseId: row.id,
        uploadedBy: viewer.id,
        uploadId: input.uploadId,
        label: input.label ?? null,
      });
    } catch (error) {
      // Two tabs attaching the same file race to the same (case, upload) pair;
      // the unique index decides and the loser is told plainly.
      if ((error as { code?: string })?.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'EVIDENCE_ALREADY_ATTACHED',
          message: 'That file is already attached to this case.',
        });
      }
      throw error;
    }

    await this.repo.touchCase(row.id);
    await this.repo.insertEvent({
      caseId: row.id,
      eventType: 'evidence_added',
      actorId: viewer.id,
      metadata: { evidenceId: inserted.id },
    });
    this.notifyOtherParticipants(row, viewer.id, 'resolution_case_message', 'New case evidence');
    return this.toEvidence(inserted, row.id);
  }

  // -------------------------------------------------------------------------
  // Escalation
  // -------------------------------------------------------------------------

  async escalate(
    caseId: string,
    viewer: CaseViewer,
    input: EscalateInput,
  ): Promise<ResolutionCaseSummary> {
    const { row, viewerRole } = await this.loadForViewer(caseId, viewer.id);
    this.ensureNotTerminal(row);
    if (row.escalated_at) {
      throw new HttpError({
        statusCode: 409,
        code: 'ALREADY_ESCALATED',
        message: 'This case has already been escalated.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.repo.lockCaseById(client, caseId);
      if (!locked) throw this.notFound();
      if (TERMINAL_STATUSES.has(locked.status)) {
        throw new HttpError({
          statusCode: 409,
          code: 'CASE_NOT_OPEN',
          message: 'This case is closed and cannot be escalated.',
        });
      }
      // `escalated_at IS NULL` in the UPDATE is what actually makes this
      // once-only; the read above is a courtesy, not the guard.
      const escalated = await this.repo.markEscalated(
        client,
        caseId,
        viewer.id,
        input.reason ?? null,
      );
      if (!escalated) {
        throw new HttpError({
          statusCode: 409,
          code: 'ALREADY_ESCALATED',
          message: 'This case has already been escalated.',
        });
      }
      if (locked.status === 'open' || locked.status === 'awaiting_user') {
        await this.repo.updateStatus(client, caseId, 'under_review', null);
      }
      await this.repo.insertEvent(
        {
          caseId,
          eventType: 'case_escalated',
          actorId: viewer.id,
          ...(input.reason ? { metadata: { reason: input.reason } } : {}),
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    this.notifyOtherParticipants(
      row,
      viewer.id,
      'resolution_case_escalated',
      'A case was escalated',
    );
    const refreshed = await this.repo.findCaseById(caseId);
    if (!refreshed) throw this.notFound();
    return this.toSummary(refreshed, viewerRole);
  }

  // -------------------------------------------------------------------------
  // Admin actions
  // -------------------------------------------------------------------------

  async assign(caseId: string, adminId: string | null): Promise<ResolutionCaseSummary> {
    await this.loadForAdmin(caseId);
    if (adminId && !(await this.repo.userExists(adminId))) {
      throw new HttpError({
        statusCode: 404,
        code: 'ADMIN_NOT_FOUND',
        message: 'That admin account does not exist.',
      });
    }
    const updated = await this.repo.assignAdmin(caseId, adminId);
    if (!updated) throw this.notFound();
    const refreshed = await this.repo.findCaseById(caseId);
    if (!refreshed) throw this.notFound();
    return this.toSummary(refreshed, 'admin');
  }

  async setAdminStatus(
    caseId: string,
    viewer: CaseViewer,
    status: 'open' | 'awaiting_user' | 'under_review',
  ): Promise<ResolutionCaseSummary> {
    const row = await this.loadForAdmin(caseId);
    this.ensureAdminMayWriteStatus(row);

    if (row.kind === 'general_support' && row.support_ticket_id) {
      const engineStatus = status === 'awaiting_user' ? 'waiting_reply' : 'in_progress';
      await this.supportService.updateStatus(
        row.support_ticket_id,
        status === 'open' ? 'open' : engineStatus,
        viewer.id,
      );
    } else {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await this.repo.lockCaseById(client, caseId);
        if (!locked) throw this.notFound();
        await this.repo.updateStatus(client, caseId, status, null);
        await this.repo.insertEvent(
          {
            caseId,
            eventType: 'status_changed',
            actorId: viewer.id,
            metadata: { from: locked.status, to: status },
          },
          client,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const refreshed = await this.repo.findCaseById(caseId);
    if (!refreshed) throw this.notFound();
    this.notifyParticipants(refreshed, null, 'resolution_case_status_changed', 'Case updated');
    return this.toSummary(refreshed, 'admin');
  }

  /**
   * Reservation disputes are settled by the reservation endpoint, not here.
   *
   * That path refunds, captures and releases inside one transaction. A second
   * resolver that only stamped a status would let a dispute read as resolved
   * while the money sat untouched, so this refuses and names the route that can
   * actually do it.
   */
  private ensureAdminMayWriteStatus(row: ResolutionCaseListRow): void {
    if (row.kind === 'reservation_dispute') {
      throw new HttpError({
        statusCode: 409,
        code: 'RESOLUTION_HANDLED_ELSEWHERE',
        message:
          'Reservation disputes are resolved through POST /api/reservations/disputes/:disputeId/resolve, which settles the money in the same transaction.',
        details: {
          route: `/api/reservations/disputes/${row.reservation_dispute_id}/resolve`,
        },
      });
    }
  }

  async resolve(
    caseId: string,
    viewer: CaseViewer,
    input: ResolveCaseInput,
  ): Promise<ResolutionCaseSummary> {
    const row = await this.loadForAdmin(caseId);
    this.ensureAdminMayWriteStatus(row);

    const status = input.status ?? (input.outcome === 'no_action' ? 'closed' : 'resolved');

    if (row.kind === 'general_support' && row.support_ticket_id) {
      // The ticket is the record of truth; the sync trigger mirrors it here,
      // and the resolution note is posted as a staff reply so the user sees it.
      await this.supportService.reply(row.support_ticket_id, viewer.id, input.notes, true, null);
      await this.supportService.updateStatus(
        row.support_ticket_id,
        status === 'closed' ? 'closed' : 'resolved',
        viewer.id,
      );
    } else {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await this.repo.lockCaseById(client, caseId);
        if (!locked) throw this.notFound();
        if (TERMINAL_STATUSES.has(locked.status)) {
          throw new HttpError({
            statusCode: 409,
            code: 'CASE_ALREADY_RESOLVED',
            message: 'This case has already been resolved.',
          });
        }
        await this.repo.updateStatus(client, caseId, status, {
          outcome: input.outcome,
          notes: input.notes,
          resolvedBy: viewer.id,
        });
        await this.repo.insertEvent(
          {
            caseId,
            eventType: 'case_resolved',
            actorId: viewer.id,
            metadata: { outcome: input.outcome, status },
          },
          client,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const refreshed = await this.repo.findCaseById(caseId);
    if (!refreshed) throw this.notFound();
    this.notifyParticipants(refreshed, null, 'resolution_case_resolved', 'Your case was resolved');
    return this.toSummary(refreshed, 'admin');
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * What this caller may open right now, and why not when they may not.
   *
   * The centre lists five case kinds. Two of them need an engagement the caller
   * may simply not have, and the frontend used to guess. Guessing produced a
   * form that accepted input and then failed, so the server answers instead and
   * the UI repeats what it is told.
   */
  async getAvailability(userId: string): Promise<ResolutionCaseAvailability[]> {
    const [engagements, payments] = await Promise.all([
      this.repo.listDisputableEngagements(userId),
      this.repo.listDirectPaymentEngagements(userId),
    ]);

    return [
      {
        kind: 'general_support',
        available: true,
        reasonCode: 'available',
        message: null,
        eligibleSubjects: [],
      },
      this.availabilityFor(
        'need_job_dispute',
        engagements,
        'You have no activated need or accepted job engagement to dispute. A dispute can only be opened once the provider has accepted and activated the work.',
      ),
      this.availabilityFor(
        'direct_payment',
        payments,
        'You have no activated engagement with a direct payment arrangement, so there is no payment to raise an issue about.',
      ),
      {
        kind: 'safety_report',
        available: true,
        reasonCode: 'available',
        message: null,
        eligibleSubjects: [],
      },
    ];
  }

  private availabilityFor(
    kind: 'need_job_dispute' | 'direct_payment',
    rows: EligibleSubjectRow[],
    unavailableMessage: string,
  ): ResolutionCaseAvailability {
    if (rows.length === 0) {
      return {
        kind,
        available: false,
        reasonCode: 'no_eligible_subject',
        message: unavailableMessage,
        eligibleSubjects: [],
      };
    }
    return {
      kind,
      available: true,
      reasonCode: 'available',
      message: null,
      eligibleSubjects: rows.map((row) => ({
        subjectType: row.subject_type as ResolutionCaseSubjectType,
        subjectId: row.subject_id,
        label: row.label ?? 'Engagement',
        counterpartyId: row.counterparty_id,
        counterpartyName: row.counterparty_name,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  private notify(userId: string, type: string, title: string, payload: Record<string, unknown>) {
    void this.notificationsService
      .createForUser(userId, {
        type,
        title,
        message: 'Open the Help & Resolution centre to see the latest on this case.',
        payload,
      })
      .catch(() => {});
  }

  private notifyOtherParticipants(
    row: ResolutionCaseListRow,
    actorId: string,
    type: string,
    title: string,
  ): void {
    this.notifyParticipants(row, actorId, type, title);
  }

  /**
   * Notify the case's participants, skipping the actor.
   *
   * `reported_user_id` is deliberately absent: telling somebody a safety report
   * about them exists is the one notification this system must never send.
   */
  private notifyParticipants(
    row: ResolutionCaseListRow,
    actorId: string | null,
    type: string,
    title: string,
  ): void {
    const payload = {
      caseId: row.id,
      referenceCode: row.reference_code,
      kind: row.kind,
    };
    const recipients = new Set<string>([row.opened_by]);
    if (row.counterparty_id && row.counterparty_access) recipients.add(row.counterparty_id);
    for (const recipient of recipients) {
      if (recipient === actorId) continue;
      this.notify(recipient, type, title, payload);
    }
  }
}
