// ---------------------------------------------------------------------------
// Unified Help & Resolution Centre — shared types for API and frontend
// ---------------------------------------------------------------------------
// One case list covers platform support tickets and every marketplace dispute.
// The kinds that already have an engine (general support, reservation disputes)
// are projections of that engine; the rest are native to the case spine.
// ---------------------------------------------------------------------------

export const RESOLUTION_CASE_KINDS = [
  'general_support',
  'reservation_dispute',
  'need_job_dispute',
  'direct_payment',
  'safety_report',
] as const;

export type ResolutionCaseKind = (typeof RESOLUTION_CASE_KINDS)[number];

/** Kinds a user may open directly through the unified centre. */
export const RESOLUTION_CASE_CREATABLE_KINDS = [
  'general_support',
  'need_job_dispute',
  'direct_payment',
  'safety_report',
] as const;

export type ResolutionCaseCreatableKind = (typeof RESOLUTION_CASE_CREATABLE_KINDS)[number];

/**
 * Stored status. `escalated` is not stored — see `ResolutionCaseStatus`.
 */
export type ResolutionCaseStoredStatus =
  | 'open'
  | 'awaiting_user'
  | 'under_review'
  | 'resolved'
  | 'closed';

/**
 * Status as the API reports it. `escalated` is projected from the escalation
 * timestamp so that a legacy-backed case, whose stored status is driven by its
 * own engine, can still be shown as escalated.
 */
export type ResolutionCaseStatus = ResolutionCaseStoredStatus | 'escalated';

export const RESOLUTION_CASE_TERMINAL_STATUSES: readonly ResolutionCaseStatus[] = [
  'resolved',
  'closed',
];

export const isTerminalResolutionCaseStatus = (status: string): boolean =>
  (RESOLUTION_CASE_TERMINAL_STATUSES as readonly string[]).includes(status);

export type ResolutionCaseSubjectType =
  | 'need'
  | 'bid'
  | 'job'
  | 'job_application'
  | 'reservation'
  | 'service'
  | 'user'
  | 'message'
  | 'support_ticket';

export type ResolutionCaseOutcome =
  | 'resolved_for_opener'
  | 'resolved_for_counterparty'
  | 'resolved_partial'
  | 'no_action'
  | 'duplicate'
  | 'withdrawn';

/** How the caller relates to a case. Decided server-side, never by the client. */
export type ResolutionCaseViewerRole = 'opener' | 'counterparty' | 'admin';

export type ResolutionCaseMessageVisibility = 'participants' | 'admin';

export type ResolutionCaseMessage = {
  id: string;
  caseId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  visibility: ResolutionCaseMessageVisibility;
  isStaff: boolean;
  createdAt: string;
  /** Public attachment URLs. Only legacy support-ticket messages carry these. */
  attachmentUrls?: string[];
};

export type ResolutionCaseEvidence = {
  id: string;
  caseId: string;
  uploadedBy: string;
  uploadId: string;
  /**
   * Always the authenticated API path `/api/upload/private/:id`. The storage
   * bucket and object path are never sent to a client.
   */
  fileUrl: string;
  label: string | null;
  createdAt: string;
};

export type ResolutionCaseTimelineEvent = {
  id: string;
  caseId: string;
  eventType: string;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ResolutionCaseSummary = {
  id: string;
  referenceCode: string;
  kind: ResolutionCaseKind;
  status: ResolutionCaseStatus;
  /** Status as the backing engine records it, when there is one. */
  engineStatus: string | null;
  title: string;
  openedBy: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  subjectType: ResolutionCaseSubjectType | null;
  subjectId: string | null;
  reasonCode: string | null;
  escalatedAt: string | null;
  assignedAdminId: string | null;
  messageCount: number;
  evidenceCount: number;
  lastActivityAt: string;
  createdAt: string;
  updatedAt: string;
  /** Legacy identifiers, so historical deep links keep resolving. */
  supportTicketId: string | null;
  reservationDisputeId: string | null;
  viewerRole: ResolutionCaseViewerRole;
};

export type ResolutionCaseFile = {
  case: ResolutionCaseSummary;
  description: string | null;
  resolution: {
    outcome: ResolutionCaseOutcome | null;
    notes: string | null;
    resolvedBy: string | null;
    resolvedAt: string | null;
  };
  escalation: {
    escalatedAt: string | null;
    escalatedBy: string | null;
    reason: string | null;
  };
  messages: ResolutionCaseMessage[];
  evidence: ResolutionCaseEvidence[];
  timeline: ResolutionCaseTimelineEvent[];
  /**
   * What the caller is allowed to do, decided server-side. The client uses this
   * to render controls; it never decides on its own, and every route re-checks.
   */
  capabilities: {
    canPostMessage: boolean;
    canAddEvidence: boolean;
    canEscalate: boolean;
    canResolve: boolean;
    /** Set when resolution belongs to another endpoint (reservation settlement). */
    resolutionHandledBy: 'reservation_dispute_endpoint' | null;
  };
};

export type ResolutionCaseListResponse = {
  items: ResolutionCaseSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type CreateGeneralSupportCaseBody = {
  kind: 'general_support';
  subject: string;
  body: string;
  category?: 'bug' | 'suggestion' | 'error' | 'other';
  /** Public URLs from POST /api/upload. Max 2. */
  attachmentUrls?: string[];
};

export const NEED_JOB_DISPUTE_REASONS = [
  'not_delivered',
  'partially_delivered',
  'quality',
  'unresponsive',
  'scope_disagreement',
  'other',
] as const;

export type NeedJobDisputeReason = (typeof NEED_JOB_DISPUTE_REASONS)[number];

export type CreateNeedJobDisputeCaseBody = {
  kind: 'need_job_dispute';
  /** A need whose award has been activated, or an accepted job application. */
  subjectType: 'need' | 'job_application';
  subjectId: string;
  reason: NeedJobDisputeReason;
  description: string;
  /** Private upload ids from POST /api/upload/private. */
  evidenceUploadIds?: string[];
};

export const DIRECT_PAYMENT_ISSUE_REASONS = [
  'paid_not_acknowledged',
  'wrong_amount',
  'payment_details_invalid',
  'refund_not_received',
  'other',
] as const;

export type DirectPaymentIssueReason = (typeof DIRECT_PAYMENT_ISSUE_REASONS)[number];

export type CreateDirectPaymentCaseBody = {
  kind: 'direct_payment';
  /** The activated award the direct payment belongs to. */
  subjectType: 'need' | 'reservation';
  subjectId: string;
  reason: DirectPaymentIssueReason;
  description: string;
  amount?: number;
  currency?: string;
  evidenceUploadIds?: string[];
};

export const SAFETY_REPORT_REASONS = [
  'harassment',
  'fraud',
  'off_platform_solicitation',
  'impersonation',
  'unsafe_behaviour',
  'other',
] as const;

export type SafetyReportReason = (typeof SAFETY_REPORT_REASONS)[number];

export type CreateSafetyReportCaseBody = {
  kind: 'safety_report';
  reason: SafetyReportReason;
  description: string;
  /** The person being reported. They are never given access to the case. */
  reportedUserId?: string;
  subjectType?: 'service' | 'need' | 'job' | 'reservation' | 'message' | 'user';
  subjectId?: string;
  evidenceUploadIds?: string[];
};

export type CreateResolutionCaseBody =
  | CreateGeneralSupportCaseBody
  | CreateNeedJobDisputeCaseBody
  | CreateDirectPaymentCaseBody
  | CreateSafetyReportCaseBody;

export type PostResolutionCaseMessageBody = {
  body: string;
  /** Admins only. A participant asking for this is refused, not downgraded. */
  visibility?: ResolutionCaseMessageVisibility;
  attachmentUrls?: string[];
};

export type AddResolutionCaseEvidenceBody = {
  uploadId: string;
  label?: string;
};

export type EscalateResolutionCaseBody = {
  reason?: string;
};

export type ResolveResolutionCaseBody = {
  outcome: ResolutionCaseOutcome;
  notes: string;
  /** 'closed' for outcomes that end a case without a finding. */
  status?: 'resolved' | 'closed';
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Whether the caller may open a case of a given kind right now, and why not.
 *
 * The centre offers case kinds the marketplace lifecycle cannot support yet.
 * Rather than hiding them or letting a submission fail late, the server answers
 * honestly and the UI repeats the server's reason.
 */
export type ResolutionCaseAvailability = {
  kind: ResolutionCaseCreatableKind;
  available: boolean;
  /** Machine-readable reason when `available` is false. */
  reasonCode:
    | 'available'
    | 'no_eligible_subject'
    | 'lifecycle_unsupported'
    | 'requires_subject'
    | null;
  /** Human-readable English explanation. The UI localises by reason code. */
  message: string | null;
  /** Subjects the caller could open this kind of case against. */
  eligibleSubjects: Array<{
    subjectType: ResolutionCaseSubjectType;
    subjectId: string;
    label: string;
    counterpartyId: string | null;
    counterpartyName: string | null;
  }>;
};

export type ResolutionCaseAvailabilityResponse = {
  items: ResolutionCaseAvailability[];
};
