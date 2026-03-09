// ---------------------------------------------------------------------------
// Reservation V2 types — shared between API and frontend
// ---------------------------------------------------------------------------

export type ReservationMode = 'online' | 'offline';
export type ReservationOnlineType = 'voice' | 'video';

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
};

export type ReservationSlot = {
  id: string;
  providerId: string;
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
  customerDoneDueAt: string | null;
  disconnectAutoReleaseAt: string | null;
  createdAt: string;
  updatedAt: string;
  providerName?: string;
  customerName?: string;
  serviceTitle?: string | null;
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

export type CreateReservationBody = {
  serviceId?: string;
  providerId: string;
  slotId: string;
  mode: ReservationMode;
  onlineType?: ReservationOnlineType;
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
