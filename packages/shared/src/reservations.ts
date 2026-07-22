// ---------------------------------------------------------------------------
// Reservation V2 types — shared between API and frontend
// ---------------------------------------------------------------------------

export type ReservationMode = 'online' | 'offline';
export type ReservationOnlineType = 'voice' | 'video';
export type ReservationPurpose = 'service' | 'job_interview';
export type ReservationCancellationActor = 'customer' | 'provider' | 'admin' | 'system';
export type ReservationCancellationReasonCode =
  | 'customer_changed_mind'
  | 'customer_schedule_conflict'
  | 'provider_unavailable'
  | 'provider_schedule_conflict'
  | 'slot_invalidated'
  | 'platform_failure'
  | 'other';
export type ReservationCancellationOutcome =
  | 'none'
  | 'full_refund'
  | 'provider_paid'
  | 'customer_refund_with_provider_penalty'
  | 'cancelled_no_refund'
  | 'platform_refund';
export type ReservationRefundStatus = 'none' | 'pending' | 'succeeded' | 'failed';
export type ReservationSettlementStatus =
  | 'unsettled'
  | 'held'
  | 'released_to_provider'
  | 'refunded_to_customer'
  | 'cancelled_no_refund'
  | 'partially_refunded';

export type ReservationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'awaiting_start'
  | 'in_session'
  | 'waiting_customer_done'
  | 'completed'
  | 'cancelled'
  | 'disputed'
  | 'expired';

export type ReservationSlotStatus = 'available' | 'booked' | 'blocked';

export type ReservationProfile = {
  providerId: string;
  autoAccept: boolean;
  onlineVoicePrice: number;
  onlineVideoPrice: number;
  offlinePrice: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  /** Platform verified (profile complete + 1000 EGP deposited) */
  verificationBadgeEarned?: boolean;
};

export type ReservationSlot = {
  id: string;
  providerId: string;
  purpose: ReservationPurpose;
  jobId: string | null;
  startAt: string;
  endAt: string;
  status: ReservationSlotStatus;
  supportsOnline: boolean;
  supportsOffline: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Reservation = {
  id: string;
  customerId: string;
  providerId: string;
  purpose: ReservationPurpose;
  jobId: string | null;
  jobApplicationId: string | null;
  serviceId: string | null;
  slotId: string | null;
  mode: ReservationMode;
  onlineType: ReservationOnlineType | null;
  status: ReservationStatus;
  requestedStartAt: string;
  requestedEndAt: string;
  expertPriceAmount: number;
  currency: string;
  adminAcceptanceFee: number;
  adminMinuteRate: number;
  pricingBreakdown: ReservationPricingBreakdown | null;
  policySnapshot: ReservationPolicySnapshot | null;
  fixedPriceHoldId: string | null;
  rejectionReason: string | null;
  autoRejected: boolean;
  suggestedSlots: Array<{ startAt: string; endAt: string }>;
  conversationId: string | null;
  finalLocationText: string | null;
  finalLocationLat: number | null;
  finalLocationLng: number | null;
  acceptedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationActor: ReservationCancellationActor | null;
  cancellationReasonCode: ReservationCancellationReasonCode | null;
  cancellationEffectiveOutcome: ReservationCancellationOutcome | null;
  refundAmount: number;
  capturedAmount: number;
  penaltyAmount: number;
  refundStatus: ReservationRefundStatus;
  settlementStatus: ReservationSettlementStatus;
  customerDoneDueAt: string | null;
  donePromptedAt: string | null;
  disconnectAutoReleaseAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerName?: string;
  customerName?: string;
  serviceTitle?: string | null;
};

export type ReservationPricingBreakdown = {
  servicePriceAmount: number;
  reservationPriceAmount: number;
  originalServicePriceAmount?: number;
  originalReservationPriceAmount?: number;
  providerAmount?: number;
  platformFeeAmount?: number;
  heldTotalAmount?: number;
  couponCode?: string | null;
  couponRedemptionId?: string | null;
  couponDiscountAmount?: number;
  couponServiceDiscountAmount?: number;
  couponCommissionDiscountAmount?: number;
  couponProviderFundedAmount?: number;
  couponPlatformFundedAmount?: number;
  commissionPercent?: number;
  commissionMinEgp?: number;
  totalAmount: number;
  currency: string;
  deductionTiming: 'on_reserve_hold';
  releaseTiming: 'on_completion_or_policy';
  explanation: string;
};

export type ReservationPolicySnapshot = {
  customerFreeCancelHours: number;
  providerPenaltyCancelHours: number;
  customerLateCancelPayoutPercent: number;
  providerLateCancelPenaltyAmount: number;
  interviewBusinessFailureRefundOnly: boolean;
  pricingBreakdown?: ReservationPricingBreakdown | null;
};

export type ReservationTimelineEventType =
  | 'created'
  | 'accepted'
  | 'rejected'
  | 'cancelled'
  | 'started'
  | 'ended'
  | 'completed'
  | 'dispute_opened'
  | 'dispute_resolved'
  | 'hold_created'
  | 'hold_released'
  | 'hold_captured'
  | 'refund_applied'
  | 'penalty_applied'
  | 'call_join_failed'
  | 'reconciled'
  | 'worker_replayed';

export type ReservationTimelineEvent = {
  id: string;
  reservationId: string;
  eventType: ReservationTimelineEventType;
  actorId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ReservationActionFailure = {
  id: string;
  reservationId: string | null;
  actionType: string;
  actorId: string | null;
  errorCode: string | null;
  errorMessage: string;
  metadata: Record<string, unknown>;
  resolvedAt: string | null;
  lastReplayedAt: string | null;
  createdAt: string;
};

export type ReservationLocationProposalStatus = 'pending' | 'accepted' | 'rejected';

export type ReservationLocationProposal = {
  id: string;
  reservationId: string;
  proposedBy: string;
  locationText: string;
  lat: number | null;
  lng: number | null;
  status: ReservationLocationProposalStatus;
  respondedBy: string | null;
  respondedAt: string | null;
  createdAt: string;
};

export type ReservationCallSessionStatus = 'pending' | 'active' | 'paused' | 'ended';
export type ReservationCallExtensionStatus = 'none' | 'pending' | 'approved' | 'rejected';

export type ReservationCallSession = {
  id: string;
  reservationId: string;
  agoraChannel: string;
  status: ReservationCallSessionStatus;
  startedAt: string | null;
  endedAt: string | null;
  pausedAt: string | null;
  billingStartedAt: string | null;
  billingPausedAt: string | null;
  lastBilledAt: string | null;
  billedMinutes: number;
  billedSeconds: number;
  extensionStatus: ReservationCallExtensionStatus;
  extensionRequestedBy: string | null;
  extensionUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReservationCallParticipant = {
  id: string;
  callSessionId: string;
  userId: string;
  agoraUid: number;
  joinedAt: string | null;
  leftAt: string | null;
  isConnected: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReservationCallSnapshot = {
  session: ReservationCallSession | null;
  participants: ReservationCallParticipant[];
  reservation: Reservation;
  minimumPrejoinMinutes: number;
  customerRemainingMinutes: number;
  providerRemainingMinutes: number;
};

export type ReservationDisputeStatus =
  | 'open'
  | 'resolved_customer'
  | 'resolved_provider'
  | 'resolved_partial'
  | 'dismissed';
export type ReservationDisputeSettlementOutcome = 'refund' | 'release' | 'split' | 'none';

export type ReservationDisputeReason = 'customer_report' | 'timeout_no_done' | 'manual' | 'system';

export type ReservationDispute = {
  id: string;
  reservationId: string;
  openedBy: string | null;
  reason: ReservationDisputeReason;
  description: string | null;
  status: ReservationDisputeStatus;
  resolutionNotes: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReservationDisputeEvidence = {
  id: string;
  disputeId: string;
  uploadedBy: string;
  uploadId: string;
  fileUrl: string;
  label: string | null;
  createdAt: string;
};

export type ReservationDisputeNoteVisibility = 'public' | 'admin';

export type ReservationDisputeNote = {
  id: string;
  disputeId: string;
  authorId: string;
  authorName: string | null;
  body: string;
  visibility: ReservationDisputeNoteVisibility;
  createdAt: string;
};

export type ReservationDisputeMoneyEvent = {
  id: string;
  kind: 'transaction' | 'hold' | 'deposit' | 'withdrawal' | 'failure';
  status: string;
  amount: number;
  currency: string;
  label: string;
  referenceType: string | null;
  referenceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ReservationDisputeCase = {
  dispute: ReservationDispute;
  reservation: Reservation;
  timeline: ReservationTimelineEvent[];
  evidence: ReservationDisputeEvidence[];
  notes: ReservationDisputeNote[];
  messages: Array<{
    id: string;
    senderId: string;
    senderName: string | null;
    body: string | null;
    attachmentUrl: string | null;
    createdAt: string;
  }>;
  moneyEvents: ReservationDisputeMoneyEvent[];
};

export type AddReservationDisputeNoteBody = {
  body: string;
  visibility?: ReservationDisputeNoteVisibility;
};

export type AddReservationDisputeEvidenceBody = {
  uploadId: string;
  label?: string;
};

export type ReservationDisputeListItem = {
  dispute: ReservationDispute;
  reservation: Reservation;
  evidenceCount: number;
  noteCount: number;
  lastActivityAt: string;
};

export type CreateReservationBody = {
  serviceId?: string;
  providerId: string;
  slotId: string;
  mode: ReservationMode;
  onlineType?: ReservationOnlineType;
  /** When set, service price comes from accepted negotiation (single use). */
  negotiationId?: string;
  couponCode?: string;
};

export type DecideReservationBody = {
  decision: 'accept' | 'reject';
  rejectionReason?: string;
};

export type UpdateReservationProfileBody = Partial<{
  autoAccept: boolean;
  onlineVoicePrice: number;
  onlineVideoPrice: number;
  offlinePrice: number;
  currency: string;
}>;

export type CreateReservationSlotBody = {
  startAt: string;
  endAt: string;
  supportsOnline?: boolean;
  supportsOffline?: boolean;
};

export type UpdateReservationSlotBody = Partial<{
  startAt: string;
  endAt: string;
  status: ReservationSlotStatus;
  supportsOnline: boolean;
  supportsOffline: boolean;
}>;

export type ProposeLocationBody = {
  locationText: string;
  lat?: number;
  lng?: number;
};

export type RespondLocationBody = {
  proposalId: string;
  decision: 'accept' | 'reject';
};

export type ConfirmCheckInBody = {
  counterpartyCode: string;
};

export type FinishReservationBody = {
  action: 'done' | 'report';
  reportReason?: string;
};

export type CancelReservationBody = {
  reasonCode: ReservationCancellationReasonCode;
  reasonText?: string;
};

export type ResolveReservationDisputeBody = {
  status: Exclude<ReservationDisputeStatus, 'open'>;
  resolutionNotes: string;
  settlementOutcome?: ReservationDisputeSettlementOutcome;
  customerRefundAmount?: number;
  providerReleaseAmount?: number;
};

export type CallJoinBody = {
  mediaType: ReservationOnlineType;
};

export type CallHeartbeatBody = {
  connected: boolean;
};

export type CallExtensionBody = {
  decision: 'request' | 'approve' | 'reject';
};

export type EndCallBody = {
  action: 'end' | 'refresh';
};

export type RenewCallTokenBody = Record<string, never>;
