// ---------------------------------------------------------------------------
// Verification types — internal types for the verification module
// ---------------------------------------------------------------------------

import type {
  VerificationProvider,
  VerificationRequestStatus,
  VerificationRequestType,
} from '@mohandishub/shared';

/** Row from the `verification_requests` table. */
export type VerificationRequestRow = {
  id: string;
  user_id: string;
  provider: VerificationProvider;
  provider_session_id: string | null;
  request_type: VerificationRequestType;
  status: VerificationRequestStatus;
  document_refs: unknown[];
  provider_response: unknown;
  reviewer_notes: string | null;
  reviewed_by: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

/** Result of creating a verification session with an external provider. */
export type VerificationSession = {
  sessionId: string;
  redirectUrl?: string | undefined; // URL to redirect user to (e.g. Didit verification flow)
  sessionToken?: string | undefined; // Token for SDK/embedded integration
};

/** Result of a provider webhook callback.
 * - Terminal: approved = true | false → profile gets 'verified' | 'rejected'
 * - Non-terminal: status = 'under_review' (e.g. "In Progress", "In Review") → profile gets 'under_review'; request gets 'submitted'
 */
export type VerificationWebhookResult = {
  sessionId: string;
  /** Terminal result: true = verified, false = rejected. When set, we update profile to verified/rejected. */
  approved?: boolean;
  /** Non-terminal: when provider sends "In Progress" / "In Review" etc., set so we update profile to under_review. */
  status?: 'under_review';
  rawPayload: unknown;
};

/** Headers passed from the webhook controller for signature verification. */
export type WebhookHeaders = {
  signatureV2?: string | undefined;
  signatureSimple?: string | undefined;
  timestamp?: string | undefined;
};

// ── Didit-specific types ─────────────────────────────────────────────────

/** Didit create-session API response. */
export type DiditCreateSessionResponse = {
  session_id: string;
  session_number: number;
  session_token: string;
  vendor_data: string | null;
  metadata: Record<string, unknown> | null;
  status: string;
  workflow_id: string;
  callback: string | null;
  url: string; // verification flow URL: https://verify.didit.me/session/TOKEN
};

/** Didit webhook payload (top-level fields). */
export type DiditWebhookPayload = {
  session_id: string;
  status: string; // 'Not Started' | 'In Progress' | 'Approved' | 'Declined' | 'In Review' | 'Abandoned'
  webhook_type: string; // 'status.updated' | 'data.updated'
  created_at: number;
  timestamp: number;
  workflow_id: string;
  vendor_data?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  decision?: DiditDecision | undefined;
};

/** Didit decision object (included when status is Approved/Declined/In Review/Abandoned). */
export type DiditDecision = {
  session_id: string;
  session_number: number;
  session_url: string;
  status: string;
  workflow_id: string;
  features: string[];
  vendor_data: string | null;
  id_verifications?: DiditIdVerification[] | undefined;
  liveness_checks?: DiditLivenessCheck[] | undefined;
  face_matches?: DiditFaceMatch[] | undefined;
  aml_screenings?: unknown[] | undefined;
  reviews?: unknown[] | undefined;
  created_at: string;
};

export type DiditIdVerification = {
  node_id: string;
  status: string;
  document_type?: string | undefined;
  document_number?: string | undefined;
  first_name?: string | undefined;
  last_name?: string | undefined;
  full_name?: string | undefined;
  date_of_birth?: string | undefined;
  nationality?: string | undefined;
  issuing_state?: string | undefined;
  gender?: string | undefined;
  warnings?: unknown[] | undefined;
};

export type DiditLivenessCheck = {
  node_id: string;
  status: string;
  method?: string | undefined;
  score?: number | undefined;
  warnings?: unknown[] | undefined;
};

export type DiditFaceMatch = {
  node_id: string;
  status: string;
  score?: number | undefined;
  warnings?: unknown[] | undefined;
};
