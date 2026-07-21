import { randomInt } from 'node:crypto';

import type {
  ReservationActionFailure,
  ReservationCancellationActor,
  ReservationCancellationOutcome,
  Reservation,
  ReservationCallParticipant,
  ReservationCallSession,
  ReservationDispute,
  ReservationDisputeCase,
  ReservationDisputeEvidence,
  ReservationDisputeListItem,
  ReservationDisputeMoneyEvent,
  ReservationDisputeNote,
  ReservationLocationProposal,
  ReservationPricingBreakdown,
  ReservationProfile,
  ReservationPolicySnapshot,
  ReservationSlot,
  ReservationTimelineEvent,
} from '@mohandishub/shared';
import { canManageReservationAvailability, computeCommissionSplit } from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { buildAgoraRtcToken } from '../../lib/agora-token.js';
import { HttpError } from '../../utils/http-error.js';
import { ChatRepository } from '../chat/chat.repository.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NegotiationsService } from '../negotiations/negotiations.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ServicesRepository } from '../services/services.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { ReservationsRepository } from './reservations.repository.js';
import type {
  ReservationActionFailureRow,
  ReservationCallParticipantRow,
  ReservationCallSessionRow,
  ReservationDisputeEvidenceRow,
  ReservationDisputeListRow,
  ReservationDisputeMoneyEventRow,
  ReservationDisputeNoteRow,
  ReservationDisputeRow,
  ReservationEventRow,
  ReservationLocationProposalRow,
  ReservationProfileRow,
  ReservationRow,
  ReservationSlotRow,
} from './reservations.repository.js';
import type {
  CallExtensionInput,
  CallHeartbeatInput,
  CancelReservationInput,
  CallJoinInput,
  ConfirmCheckinInput,
  CreateReservationInput,
  CreateReservationSlotInput,
  DecideReservationInput,
  EndCallInput,
  FinishReservationInput,
  ProposeLocationInput,
  ResolveDisputeInput,
  RespondLocationInput,
  UpdateReservationSlotInput,
  UpsertReservationProfileInput,
} from './reservations.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';
const CUSTOMER_FREE_CANCEL_HOURS = 24;
const PROVIDER_PENALTY_CANCEL_HOURS = 2;
const CUSTOMER_LATE_CANCEL_PAYOUT_PERCENT = 100;
const DISCONNECT_AUTO_RELEASE_HOURS = 3;
const OFFLINE_DONE_TIMEOUT_HOURS = 6;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const PIASTER_PER_EGP = 100;
const MILLI_PIASTER_PER_PIASTER = 1_000;
const MILLI_PIASTER_PER_EGP = PIASTER_PER_EGP * MILLI_PIASTER_PER_PIASTER;
const AGORA_TOKEN_EXPIRY_SECONDS = 7_200;
const LIFECYCLE_SWEEP_LOCK_KEY = 6_310_019;

type IdempotentReservationAction =
  | 'create_reservation'
  | 'decide_reservation'
  | 'cancel_reservation'
  | 'book_job_interview';

const toNumber = (value: string | number | null | undefined): number => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const toMoney = (value: number): number => Number(value.toFixed(2));

const asDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const reservationDurationMinutes = (
  reservation: Pick<ReservationRow, 'requested_start_at' | 'requested_end_at'>,
) => {
  const start = new Date(reservation.requested_start_at);
  const end = new Date(reservation.requested_end_at);
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / MINUTE_MS));
};

const mapProfile = (row: ReservationProfileRow): ReservationProfile => ({
  providerId: row.provider_id,
  autoAccept: row.auto_accept,
  onlineVoicePrice: toNumber(row.online_voice_price),
  onlineVideoPrice: toNumber(row.online_video_price),
  offlinePrice: toNumber(row.offline_price),
  currency: row.currency,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  verificationBadgeEarned: row.platform_verified_at != null,
});

const mapSlot = (row: ReservationSlotRow): ReservationSlot => ({
  id: row.id,
  providerId: row.provider_id,
  purpose: row.purpose as ReservationSlot['purpose'],
  jobId: row.job_id,
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.status as ReservationSlot['status'],
  supportsOnline: row.supports_online,
  supportsOffline: row.supports_offline,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapReservation = (row: ReservationRow): Reservation => {
  const policySnapshot = (row.policy_snapshot as ReservationPolicySnapshot | null) ?? null;
  const mapped: Reservation = {
    id: row.id,
    customerId: row.customer_id,
    providerId: row.provider_id,
    purpose: row.purpose as Reservation['purpose'],
    jobId: row.job_id,
    jobApplicationId: row.job_application_id,
    serviceId: row.service_id,
    slotId: row.slot_id,
    mode: row.mode as Reservation['mode'],
    onlineType: row.online_type as Reservation['onlineType'],
    status: row.status as Reservation['status'],
    requestedStartAt: row.requested_start_at,
    requestedEndAt: row.requested_end_at,
    expertPriceAmount: toNumber(row.expert_price_amount),
    currency: row.currency,
    adminAcceptanceFee: toNumber(row.admin_acceptance_fee),
    adminMinuteRate: toNumber(row.admin_minute_rate),
    pricingBreakdown: policySnapshot?.pricingBreakdown ?? null,
    policySnapshot,
    fixedPriceHoldId: row.fixed_price_hold_id,
    rejectionReason: row.rejection_reason,
    autoRejected: row.auto_rejected,
    suggestedSlots: Array.isArray(row.suggested_slots) ? row.suggested_slots : [],
    conversationId: row.conversation_id,
    finalLocationText: row.final_location_text,
    finalLocationLat: row.final_location_lat != null ? toNumber(row.final_location_lat) : null,
    finalLocationLng: row.final_location_lng != null ? toNumber(row.final_location_lng) : null,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationActor: row.cancellation_actor as Reservation['cancellationActor'],
    cancellationReasonCode: row.cancellation_reason_code as Reservation['cancellationReasonCode'],
    cancellationEffectiveOutcome:
      row.cancellation_effective_outcome as Reservation['cancellationEffectiveOutcome'],
    refundAmount: toNumber(row.refund_amount),
    capturedAmount: toNumber(row.captured_amount),
    penaltyAmount: toNumber(row.penalty_amount),
    refundStatus: row.refund_status as Reservation['refundStatus'],
    settlementStatus: row.settlement_status as Reservation['settlementStatus'],
    customerDoneDueAt: row.customer_done_due_at,
    donePromptedAt: row.done_prompted_at,
    disconnectAutoReleaseAt: row.disconnect_auto_release_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.provider_name !== undefined) mapped.providerName = row.provider_name;
  if (row.customer_name !== undefined) mapped.customerName = row.customer_name;
  if (row.service_title !== undefined) mapped.serviceTitle = row.service_title;
  return mapped;
};

const mapLocationProposal = (row: ReservationLocationProposalRow): ReservationLocationProposal => ({
  id: row.id,
  reservationId: row.reservation_id,
  proposedBy: row.proposed_by,
  locationText: row.location_text,
  lat: row.lat != null ? toNumber(row.lat) : null,
  lng: row.lng != null ? toNumber(row.lng) : null,
  status: row.status as ReservationLocationProposal['status'],
  respondedBy: row.responded_by,
  respondedAt: row.responded_at,
  createdAt: row.created_at,
});

const mapCallSession = (row: ReservationCallSessionRow): ReservationCallSession => ({
  id: row.id,
  reservationId: row.reservation_id,
  agoraChannel: row.agora_channel,
  status: row.status as ReservationCallSession['status'],
  startedAt: row.started_at,
  endedAt: row.ended_at,
  pausedAt: row.paused_at,
  billingStartedAt: row.billing_started_at,
  billingPausedAt: row.billing_paused_at,
  lastBilledAt: row.last_billed_at,
  billedMinutes: row.billed_minutes,
  billedSeconds: row.billed_seconds ?? row.billed_minutes * 60,
  extensionStatus: row.extension_status as ReservationCallSession['extensionStatus'],
  extensionRequestedBy: row.extension_requested_by,
  extensionUntil: row.extension_until,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapCallParticipant = (row: ReservationCallParticipantRow): ReservationCallParticipant => ({
  id: row.id,
  callSessionId: row.call_session_id,
  userId: row.user_id,
  agoraUid: row.agora_uid,
  joinedAt: row.joined_at,
  leftAt: row.left_at,
  isConnected: row.is_connected,
  lastSeenAt: row.last_seen_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapDispute = (row: ReservationDisputeRow): ReservationDispute => ({
  id: row.id,
  reservationId: row.reservation_id,
  openedBy: row.opened_by,
  reason: row.reason as ReservationDispute['reason'],
  description: row.description,
  status: row.status as ReservationDispute['status'],
  resolutionNotes: row.resolution_notes,
  resolvedBy: row.resolved_by,
  resolvedAt: row.resolved_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapDisputeNote = (row: ReservationDisputeNoteRow): ReservationDisputeNote => ({
  id: row.id,
  disputeId: row.dispute_id,
  authorId: row.author_id,
  authorName: row.author_name,
  body: row.body,
  visibility: row.visibility as ReservationDisputeNote['visibility'],
  createdAt: row.created_at,
});

const mapDisputeEvidence = (row: ReservationDisputeEvidenceRow): ReservationDisputeEvidence => ({
  id: row.id,
  disputeId: row.dispute_id,
  uploadedBy: row.uploaded_by,
  uploadId: row.upload_id,
  fileUrl: `/api/upload/private/${row.upload_id}`,
  label: row.label ?? row.original_name,
  createdAt: row.created_at,
});

const mapDisputeMoneyEvent = (
  row: ReservationDisputeMoneyEventRow,
): ReservationDisputeMoneyEvent => ({
  id: row.id,
  kind: row.kind as ReservationDisputeMoneyEvent['kind'],
  status: row.status,
  amount: toNumber(row.amount),
  currency: row.currency,
  label: row.label,
  referenceType: row.reference_type,
  referenceId: row.reference_id,
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
});

const mapTimelineEvent = (row: ReservationEventRow): ReservationTimelineEvent => ({
  id: row.id,
  reservationId: row.reservation_id,
  eventType: row.event_type as ReservationTimelineEvent['eventType'],
  actorId: row.actor_id,
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
});

const mapActionFailure = (row: ReservationActionFailureRow): ReservationActionFailure => ({
  id: row.id,
  reservationId: row.reservation_id,
  actionType: row.action_type,
  actorId: row.actor_id,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  metadata: row.metadata ?? {},
  resolvedAt: row.resolved_at,
  lastReplayedAt: row.last_replayed_at,
  createdAt: row.created_at,
});

type CallSnapshot = {
  session: ReservationCallSession | null;
  participants: ReservationCallParticipant[];
  reservation: Reservation;
  minimumPrejoinMinutes: number;
  customerRemainingMinutes: number;
  providerRemainingMinutes: number;
};

export class ReservationsService {
  constructor(
    private readonly repo: ReservationsRepository = new ReservationsRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly chatRepo: ChatRepository = new ChatRepository(),
    private readonly jobsRepo: JobsRepository = new JobsRepository(),
    private readonly servicesRepo: ServicesRepository = new ServicesRepository(),
    private readonly negotiationsSvc: NegotiationsService = new NegotiationsService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
    private readonly couponsService: CouponsService = new CouponsService(),
  ) {}

  /** Fire-and-forget in-app notification; never blocks reservation flows. */
  private notifyUser(
    userId: string,
    type: string,
    title: string,
    message: string,
    payload: Record<string, unknown>,
  ): void {
    void this.notificationsService
      .createForUser(userId, { type, title, message, payload })
      .catch(() => {});
  }

  async getMyProfile(userId: string, role: string): Promise<ReservationProfile> {
    this.ensureProviderRole(role);
    let profile = await this.repo.getProfile(userId);
    if (!profile) {
      profile = await this.repo.upsertProfile(userId, {});
    }
    return mapProfile(profile);
  }

  async getProviderProfile(providerId: string): Promise<ReservationProfile> {
    let profile = await this.repo.getProfile(providerId);
    if (!profile) {
      profile = await this.repo.upsertProfile(providerId, {});
    }
    return mapProfile(profile);
  }

  async upsertMyProfile(
    userId: string,
    role: string,
    input: UpsertReservationProfileInput,
  ): Promise<ReservationProfile> {
    this.ensureProviderRole(role);
    const profileUpdates: Parameters<ReservationsRepository['upsertProfile']>[1] = {};
    if (input.autoAccept !== undefined) profileUpdates.autoAccept = input.autoAccept;
    if (input.onlineVoicePrice !== undefined)
      profileUpdates.onlineVoicePrice = input.onlineVoicePrice;
    if (input.onlineVideoPrice !== undefined)
      profileUpdates.onlineVideoPrice = input.onlineVideoPrice;
    if (input.offlinePrice !== undefined) profileUpdates.offlinePrice = input.offlinePrice;
    if (input.currency !== undefined) profileUpdates.currency = input.currency;
    const profile = await this.repo.upsertProfile(userId, profileUpdates);
    return mapProfile(profile);
  }

  async listSlots(params: {
    userId: string;
    role: string;
    providerId?: string;
    from: Date;
    to: Date;
    availableOnly: boolean;
  }): Promise<{ items: ReservationSlot[] }> {
    const providerId = this.resolveProviderIdForSlots(
      params.userId,
      params.role,
      params.providerId,
    );
    const role = params.role ?? 'customer';
    const isSelfProviderView =
      (role === 'expert' || role === 'craftsman' || role === 'business') &&
      providerId === params.userId;
    const availableOnly = isSelfProviderView ? params.availableOnly : true;
    const rows = await this.repo.listSlots(providerId, params.from, params.to, availableOnly, {
      purpose: 'service',
    });
    return { items: rows.map(mapSlot) };
  }

  async createSlot(
    userId: string,
    role: string,
    input: CreateReservationSlotInput,
  ): Promise<ReservationSlot> {
    this.ensureProviderRole(role);
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    try {
      const slot = await this.repo.createSlot(userId, {
        startAt,
        endAt,
        supportsOnline: input.supportsOnline ?? true,
        supportsOffline: input.supportsOffline ?? true,
        purpose: 'service',
      });
      return mapSlot(slot);
    } catch (error) {
      if (this.isSlotOverlapError(error)) {
        const overlappingSlots = await this.repo.listSlots(userId, startAt, endAt, false, {
          purpose: 'service',
        });
        const maxLegacyDurationMs = 30 * 24 * 60 * 60 * 1000;
        const legacyCorruptedOverlaps = overlappingSlots.filter((slot) => {
          if (slot.status !== 'available') return false;
          const durationMs = new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime();
          return Number.isFinite(durationMs) && durationMs > maxLegacyDurationMs;
        });
        if (legacyCorruptedOverlaps.length > 0) {
          for (const legacySlot of legacyCorruptedOverlaps) {
            await this.repo.updateSlot(legacySlot.id, { status: 'blocked' });
          }
          const retriedSlot = await this.repo.createSlot(userId, {
            startAt,
            endAt,
            supportsOnline: input.supportsOnline ?? true,
            supportsOffline: input.supportsOffline ?? true,
            purpose: 'service',
          });
          return mapSlot(retriedSlot);
        }
        throw new HttpError({
          statusCode: 409,
          code: 'SLOT_OVERLAP',
          message: 'This slot overlaps with another active slot for the same provider.',
        });
      }
      throw error;
    }
  }

  async updateSlot(
    userId: string,
    role: string,
    slotId: string,
    input: UpdateReservationSlotInput,
  ): Promise<ReservationSlot> {
    this.ensureProviderRole(role);
    const slot = await this.repo.findSlotById(slotId);
    if (!slot) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Reservation slot not found.',
      });
    }
    if (slot.provider_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You do not own this reservation slot.',
      });
    }
    const slotUpdates: Parameters<ReservationsRepository['updateSlot']>[1] = {};
    if (input.startAt !== undefined) slotUpdates.startAt = new Date(input.startAt);
    if (input.endAt !== undefined) slotUpdates.endAt = new Date(input.endAt);
    if (input.status !== undefined) slotUpdates.status = input.status;
    if (input.supportsOnline !== undefined) slotUpdates.supportsOnline = input.supportsOnline;
    if (input.supportsOffline !== undefined) slotUpdates.supportsOffline = input.supportsOffline;
    try {
      const updated = await this.repo.updateSlot(slotId, slotUpdates);
      if (!updated) {
        throw new HttpError({
          statusCode: 400,
          code: 'SLOT_UPDATE_FAILED',
          message: 'Slot could not be updated.',
        });
      }
      return mapSlot(updated);
    } catch (error) {
      if (this.isSlotOverlapError(error)) {
        throw new HttpError({
          statusCode: 409,
          code: 'SLOT_OVERLAP',
          message: 'This slot overlaps with another active slot for the same provider.',
        });
      }
      throw error;
    }
  }

  async deleteSlot(userId: string, role: string, slotId: string): Promise<{ deleted: boolean }> {
    this.ensureProviderRole(role);
    const slot = await this.repo.findSlotById(slotId);
    if (!slot) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Reservation slot not found.',
      });
    }
    if (slot.provider_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You do not own this reservation slot.',
      });
    }
    if (slot.status === 'booked') {
      throw new HttpError({
        statusCode: 409,
        code: 'SLOT_BOOKED',
        message: 'A booked slot cannot be deleted. Cancel the reservation first.',
      });
    }
    const deleted = await this.repo.deleteSlot(slotId);
    return { deleted };
  }

  async createReservation(
    customerId: string,
    input: CreateReservationInput,
    idempotencyKey?: string,
  ): Promise<Reservation> {
    if (idempotencyKey) {
      const existing = await this.getIdempotentReservationResponse(
        customerId,
        'create_reservation',
        idempotencyKey,
      );
      if (existing) return existing;
      await this.reserveReservationActionIdempotency(
        customerId,
        'create_reservation',
        idempotencyKey,
      );
    }
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Reservations are temporarily unavailable.',
      });
    }
    if (input.providerId === customerId) {
      throw new HttpError({
        statusCode: 400,
        code: 'CANNOT_RESERVE_OWN_SERVICE',
        message: 'You cannot reserve your own service.',
      });
    }

    const slot = await this.repo.findSlotById(input.slotId);
    if (!slot || slot.provider_id !== input.providerId) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Selected slot is not available.',
      });
    }

    if (slot.status !== 'available') {
      throw new HttpError({
        statusCode: 409,
        code: 'SLOT_NOT_AVAILABLE',
        message: 'Selected slot is no longer available.',
      });
    }

    if (slot.purpose !== 'service') {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_TYPE_NOT_SUPPORTED',
        message: 'Selected slot is not available for standard reservations.',
      });
    }

    if (input.mode === 'online' && !slot.supports_online) {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_MODE_NOT_SUPPORTED',
        message: 'This slot does not support online reservations.',
      });
    }
    if (input.mode === 'offline' && !slot.supports_offline) {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_MODE_NOT_SUPPORTED',
        message: 'This slot does not support offline reservations.',
      });
    }

    let profile = await this.repo.getProfile(input.providerId);
    if (!profile) {
      profile = await this.repo.upsertProfile(input.providerId, {});
    }

    const reservationModePrice = this.getExpertPriceByType(profile, input.mode, input.onlineType);
    let servicePrice = 0;
    let reservationCurrency = profile.currency || 'EGP';
    if (input.serviceId) {
      const service = await this.servicesRepo.getActiveServiceById(input.serviceId);
      if (!service) {
        throw new HttpError({
          statusCode: 404,
          code: 'SERVICE_NOT_FOUND',
          message: 'Selected service is not available.',
        });
      }
      if (service.provider_id !== input.providerId) {
        throw new HttpError({
          statusCode: 400,
          code: 'SERVICE_PROVIDER_MISMATCH',
          message: 'Selected service does not belong to this provider.',
        });
      }
      if (input.negotiationId) {
        const { agreedPrice, currency } =
          await this.negotiationsSvc.validateNegotiationForReservation(
            customerId,
            input.negotiationId,
            input.serviceId,
            input.providerId,
          );
        servicePrice = toMoney(agreedPrice);
        reservationCurrency = currency || service.currency || reservationCurrency;
      } else if (service.price != null) {
        servicePrice = toNumber(service.price);
        reservationCurrency = service.currency || reservationCurrency;
      } else {
        reservationCurrency = service.currency || reservationCurrency;
      }
    }
    const originalExpertPrice = Math.max(0, toMoney(servicePrice + reservationModePrice));
    const commissionPreview =
      originalExpertPrice > 0
        ? computeCommissionSplit(
            originalExpertPrice,
            status.commissionPercent,
            status.commissionMinEgp,
          ).commission
        : 0;
    const couponPreview =
      input.couponCode && originalExpertPrice > 0
        ? await this.couponsService.preview(
            {
              code: input.couponCode,
              surface: 'service',
              subtotal: originalExpertPrice,
              commissionAmount: commissionPreview,
              currency: reservationCurrency,
              providerId: input.providerId,
              ...(input.serviceId ? { itemId: input.serviceId } : {}),
            },
            { id: customerId, role: 'customer' },
          )
        : null;
    if (input.couponCode && (!couponPreview || !couponPreview.valid)) {
      throw new HttpError({
        statusCode: 400,
        code: 'COUPON_NOT_APPLICABLE',
        message: couponPreview?.reason ?? 'Coupon is not valid for this reservation.',
      });
    }
    const expertPrice = toMoney(couponPreview?.finalAmount ?? originalExpertPrice);
    const minTransactionEgp = status.minTransactionEgp ?? 0;
    if (minTransactionEgp > 0 && expertPrice > 0 && expertPrice <= minTransactionEgp) {
      throw new HttpError({
        statusCode: 400,
        code: 'RESERVATION_AMOUNT_BELOW_MINIMUM',
        message: `Reservation price must be greater than the minimum transaction amount (${minTransactionEgp} EGP) so the provider payout stays positive after commission.`,
      });
    }
    const adminMinuteRate =
      input.mode === 'online'
        ? input.onlineType === 'video'
          ? status.reservationVideoMinuteRate
          : status.reservationVoiceMinuteRate
        : 0;
    const platformFeeAmount = toMoney(Math.max(0, status.reservationAcceptanceFee));
    const heldTotalAmount = toMoney(expertPrice + platformFeeAmount);
    const policySnapshot = this.buildPolicySnapshot({
      purpose: 'service',
      adminAcceptanceFee: platformFeeAmount,
      pricingBreakdown: {
        servicePriceAmount: toMoney(servicePrice),
        reservationPriceAmount: toMoney(reservationModePrice),
        originalServicePriceAmount: toMoney(servicePrice),
        originalReservationPriceAmount: toMoney(reservationModePrice),
        providerAmount: expertPrice,
        platformFeeAmount,
        heldTotalAmount,
        ...(couponPreview
          ? {
              couponCode: couponPreview.code,
              couponDiscountAmount: couponPreview.discountAmount,
              couponServiceDiscountAmount: couponPreview.serviceDiscountAmount,
              couponCommissionDiscountAmount: couponPreview.commissionDiscountAmount,
              couponProviderFundedAmount: couponPreview.providerFundedAmount,
              couponPlatformFundedAmount: couponPreview.platformFundedAmount,
            }
          : {}),
        totalAmount: heldTotalAmount,
        currency: reservationCurrency,
        deductionTiming: 'on_reserve_hold',
        releaseTiming: 'on_completion_or_policy',
        explanation: couponPreview
          ? 'Discounted provider price plus the platform fee is held when you click Reserve. No extra acceptance debit is taken later; the hold is released by completion or cancellation policy.'
          : 'Provider price plus the platform fee is held when you click Reserve. No extra acceptance debit is taken later; the hold is released by completion or cancellation policy.',
      },
    });

    const createInput: Parameters<ReservationsRepository['createReservation']>[0] = {
      customerId,
      providerId: input.providerId,
      slotId: input.slotId,
      mode: input.mode,
      requestedStartAt: new Date(slot.start_at),
      requestedEndAt: new Date(slot.end_at),
      expertPriceAmount: expertPrice,
      currency: reservationCurrency,
      adminAcceptanceFee: platformFeeAmount,
      adminMinuteRate,
      policySnapshot,
    };
    if (input.serviceId !== undefined) createInput.serviceId = input.serviceId;
    if (input.mode === 'online' && input.onlineType !== undefined) {
      createInput.onlineType = input.onlineType;
    }

    const holdAtCreate = heldTotalAmount > 0;
    let reservation: ReservationRow;

    if (holdAtCreate) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        reservation = await this.repo.createReservation(createInput, client);
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'created',
            actorId: customerId,
            metadata: { purpose: 'service', mode: input.mode },
          },
          client,
        );
        if (couponPreview) {
          const appliedCoupon = await this.couponsService.applyInTransaction(
            client,
            {
              code: input.couponCode,
              surface: 'service',
              subtotal: originalExpertPrice,
              commissionAmount: commissionPreview,
              currency: reservationCurrency,
              providerId: input.providerId,
              itemId: reservation.id,
              sourceReference: `reservation:${reservation.id}`,
            },
            { id: customerId, role: 'customer' },
          );
          policySnapshot.pricingBreakdown = {
            ...policySnapshot.pricingBreakdown!,
            couponRedemptionId: appliedCoupon.redemptionId,
          };
          const updated = await this.repo.updateReservation(
            reservation.id,
            { policySnapshot },
            client,
          );
          reservation = updated ?? reservation;
        }
        await this.ensureFixedPriceHold(client, reservation);
        if (input.negotiationId) {
          await this.negotiationsSvc.markNegotiationConsumed(
            input.negotiationId,
            customerId,
            client,
          );
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
      const refreshed = await this.repo.findReservationById(reservation.id);
      reservation = refreshed ?? reservation;
    } else if (input.negotiationId) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        reservation = await this.repo.createReservation(createInput, client);
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'created',
            actorId: customerId,
            metadata: { purpose: 'service', mode: input.mode },
          },
          client,
        );
        if (couponPreview) {
          const appliedCoupon = await this.couponsService.applyInTransaction(
            client,
            {
              code: input.couponCode,
              surface: 'service',
              subtotal: originalExpertPrice,
              commissionAmount: commissionPreview,
              currency: reservationCurrency,
              providerId: input.providerId,
              itemId: reservation.id,
              sourceReference: `reservation:${reservation.id}`,
            },
            { id: customerId, role: 'customer' },
          );
          policySnapshot.pricingBreakdown = {
            ...policySnapshot.pricingBreakdown!,
            couponRedemptionId: appliedCoupon.redemptionId,
          };
          const updated = await this.repo.updateReservation(
            reservation.id,
            { policySnapshot },
            client,
          );
          reservation = updated ?? reservation;
        }
        await this.negotiationsSvc.markNegotiationConsumed(input.negotiationId, customerId, client);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else if (couponPreview) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        reservation = await this.repo.createReservation(createInput, client);
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'created',
            actorId: customerId,
            metadata: {
              purpose: 'service',
              mode: input.mode,
            },
          },
          client,
        );
        const appliedCoupon = await this.couponsService.applyInTransaction(
          client,
          {
            code: input.couponCode,
            surface: 'service',
            subtotal: originalExpertPrice,
            commissionAmount: commissionPreview,
            currency: reservationCurrency,
            providerId: input.providerId,
            itemId: reservation.id,
            sourceReference: `reservation:${reservation.id}`,
          },
          { id: customerId, role: 'customer' },
        );
        policySnapshot.pricingBreakdown = {
          ...policySnapshot.pricingBreakdown!,
          couponRedemptionId: appliedCoupon.redemptionId,
        };
        const updated = await this.repo.updateReservation(
          reservation.id,
          { policySnapshot },
          client,
        );
        reservation = updated ?? reservation;
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      reservation = await this.repo.createReservation(createInput);
      await this.repo.createEvent({
        reservationId: reservation.id,
        eventType: 'created',
        actorId: customerId,
        metadata: {
          purpose: 'service',
          mode: input.mode,
        },
      });
    }

    if (input.serviceId && !input.negotiationId) {
      await this.negotiationsSvc.cancelPendingForCustomerService(customerId, input.serviceId);
    }

    if (profile.auto_accept) {
      const accepted = await this.decideReservationInternal({
        reservationId: reservation.id,
        providerId: input.providerId,
        decision: 'accept',
        rejectionReason: null,
        autoDecision: true,
      });
      if (idempotencyKey) {
        await this.storeReservationActionIdempotency(
          customerId,
          'create_reservation',
          idempotencyKey,
          accepted.id,
          accepted,
        );
      }
      return accepted;
    }
    const mapped = mapReservation(reservation);
    if (mapped.status === 'pending') {
      this.notifyUser(
        reservation.provider_id,
        'reservation_created',
        'New reservation request',
        'A customer requested a booking with you.',
        { reservationId: mapped.id },
      );
    }
    if (idempotencyKey) {
      await this.storeReservationActionIdempotency(
        customerId,
        'create_reservation',
        idempotencyKey,
        mapped.id,
        mapped,
      );
    }
    return mapped;
  }

  async createJobInterviewReservation(params: {
    expertId: string;
    businessId: string;
    jobId: string;
    jobApplicationId: string;
    slotId: string;
    mode: 'online' | 'offline';
    idempotencyKey?: string;
  }): Promise<Reservation> {
    if (params.idempotencyKey) {
      const existing = await this.getIdempotentReservationResponse(
        params.expertId,
        'book_job_interview',
        params.idempotencyKey,
      );
      if (existing) return existing;
      await this.reserveReservationActionIdempotency(
        params.expertId,
        'book_job_interview',
        params.idempotencyKey,
      );
    }
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Reservations are temporarily unavailable.',
      });
    }

    const slot = await this.repo.findSlotById(params.slotId);
    if (!slot || slot.provider_id !== params.businessId) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Selected interview slot is not available.',
      });
    }
    if (slot.purpose !== 'job_interview' || slot.job_id !== params.jobId) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_INTERVIEW_SLOT',
        message: 'Selected slot is not linked to this hiring post.',
      });
    }
    if (slot.status !== 'available') {
      throw new HttpError({
        statusCode: 409,
        code: 'SLOT_NOT_AVAILABLE',
        message: 'Selected slot is no longer available.',
      });
    }
    if (params.mode === 'online' && !slot.supports_online) {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_MODE_NOT_SUPPORTED',
        message: 'This interview slot does not support online interviews.',
      });
    }
    if (params.mode === 'offline' && !slot.supports_offline) {
      throw new HttpError({
        statusCode: 400,
        code: 'SLOT_MODE_NOT_SUPPORTED',
        message: 'This interview slot does not support offline interviews.',
      });
    }

    const policySnapshot = this.buildPolicySnapshot({
      purpose: 'job_interview',
      adminAcceptanceFee: 0,
    });

    const reservation = await this.repo.createReservation({
      customerId: params.expertId,
      providerId: params.businessId,
      purpose: 'job_interview',
      jobId: params.jobId,
      jobApplicationId: params.jobApplicationId,
      slotId: params.slotId,
      mode: params.mode,
      ...(params.mode === 'online' ? { onlineType: 'video' } : {}),
      requestedStartAt: new Date(slot.start_at),
      requestedEndAt: new Date(slot.end_at),
      expertPriceAmount: status.jobInterviewFeeAmount,
      currency: 'EGP',
      adminAcceptanceFee: 0,
      adminMinuteRate: 0,
      policySnapshot,
    });
    await this.repo.createEvent({
      reservationId: reservation.id,
      eventType: 'created',
      actorId: params.expertId,
      metadata: {
        purpose: 'job_interview',
        mode: params.mode,
        jobId: params.jobId,
        jobApplicationId: params.jobApplicationId,
      },
    });

    const accepted = await this.decideReservationInternal({
      reservationId: reservation.id,
      providerId: params.businessId,
      decision: 'accept',
      rejectionReason: null,
      autoDecision: true,
    });
    if (params.idempotencyKey) {
      await this.storeReservationActionIdempotency(
        params.expertId,
        'book_job_interview',
        params.idempotencyKey,
        accepted.id,
        accepted,
      );
    }
    this.notifyUser(
      params.businessId,
      'reservation_created',
      'Interview scheduled',
      'An expert booked an interview on your calendar.',
      { reservationId: accepted.id, jobId: params.jobId },
    );
    return accepted;
  }

  async listMyReservations(
    userId: string,
    role: string,
    page: number,
    limit: number,
  ): Promise<{
    items: Reservation[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const normalizedRole: 'customer' | 'provider' =
      role === 'provider' || role === 'expert' || role === 'business' || role === 'craftsman'
        ? 'provider'
        : 'customer';
    const { rows, total } = await this.repo.listReservationsByUser(
      userId,
      normalizedRole,
      page,
      limit,
    );
    return {
      items: rows.map(mapReservation),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getReservationById(userId: string, reservationId: string): Promise<Reservation> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    this.ensureReservationParticipant(reservation, userId);

    await this.handleDisconnectAutoReleaseIfDue(reservation.id);
    await this.handleOfflineDonePromptIfDue(reservation.id);
    const refreshed = await this.repo.findReservationById(reservationId);
    return mapReservation(refreshed ?? reservation);
  }

  async decideReservation(
    providerId: string,
    reservationId: string,
    input: DecideReservationInput,
    idempotencyKey?: string,
  ): Promise<Reservation> {
    if (idempotencyKey) {
      const existing = await this.getIdempotentReservationResponse(
        providerId,
        'decide_reservation',
        idempotencyKey,
      );
      if (existing) return existing;
    }
    const reservation = await this.decideReservationInternal({
      reservationId,
      providerId,
      decision: input.decision,
      rejectionReason: input.rejectionReason?.trim() || null,
      autoDecision: false,
    });
    if (idempotencyKey) {
      await this.storeReservationActionIdempotency(
        providerId,
        'decide_reservation',
        idempotencyKey,
        reservation.id,
        reservation,
      );
    }
    return reservation;
  }

  async proposeLocation(
    userId: string,
    reservationId: string,
    input: ProposeLocationInput,
  ): Promise<ReservationLocationProposal> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'offline') {
      throw new HttpError({
        statusCode: 400,
        code: 'OFFLINE_ONLY',
        message: 'Location proposals are only supported for offline reservations.',
      });
    }
    if (
      !['accepted', 'awaiting_start', 'waiting_customer_done', 'in_session'].includes(
        reservation.status,
      )
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RESERVATION_STATE',
        message: 'Location cannot be proposed for this reservation status.',
      });
    }
    const proposalInput: Parameters<ReservationsRepository['createLocationProposal']>[0] = {
      reservationId,
      proposedBy: userId,
      locationText: input.locationText.trim(),
    };
    if (input.lat !== undefined) proposalInput.lat = input.lat;
    if (input.lng !== undefined) proposalInput.lng = input.lng;
    const proposal = await this.repo.createLocationProposal(proposalInput);
    await this.sendReservationMessage(
      reservation,
      `${this.displayNameForParticipant(reservation, userId)} proposed a new meeting location.`,
      userId,
    );
    const otherLoc = this.getOtherParticipantId(reservation, userId);
    this.notifyUser(
      otherLoc,
      'reservation_location_proposed',
      'Location proposal',
      'The other party proposed a meeting location for your reservation.',
      { reservationId },
    );
    return mapLocationProposal(proposal);
  }

  async listLocationProposals(
    userId: string,
    reservationId: string,
  ): Promise<ReservationLocationProposal[]> {
    await this.requireReservationForParticipant(reservationId, userId);
    const proposals = await this.repo.listLocationProposals(reservationId);
    return proposals.map(mapLocationProposal);
  }

  async respondLocation(
    userId: string,
    reservationId: string,
    input: RespondLocationInput,
  ): Promise<{
    proposal: ReservationLocationProposal;
    reservation: Reservation;
  }> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'offline') {
      throw new HttpError({
        statusCode: 400,
        code: 'OFFLINE_ONLY',
        message: 'Location proposals are only supported for offline reservations.',
      });
    }
    const proposal = await this.repo.getLocationProposalById(input.proposalId);
    if (!proposal || proposal.reservation_id !== reservationId) {
      throw new HttpError({
        statusCode: 404,
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Location proposal not found.',
      });
    }
    if (proposal.proposed_by === userId) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_DECISION',
        message: 'You cannot respond to your own proposal.',
      });
    }
    const pool = getPool();
    const client = await pool.connect();
    let decided: ReservationLocationProposalRow | null = null;
    let updatedReservation: ReservationRow = reservation;
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      if (!reservationForUpdate) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }

      decided = await this.repo.respondLocationProposal(
        input.proposalId,
        input.decision,
        userId,
        client,
      );
      if (!decided) {
        const stillExists = await this.repo.getLocationProposalById(input.proposalId);
        throw new HttpError({
          statusCode: stillExists ? 409 : 404,
          code: stillExists ? 'PROPOSAL_ALREADY_DECIDED' : 'PROPOSAL_NOT_FOUND',
          message: stillExists
            ? 'This proposal has already been decided.'
            : 'Location proposal not found.',
        });
      }

      if (input.decision === 'accept') {
        const updated = await this.repo.updateReservation(
          reservationId,
          {
            finalLocationText: decided.location_text,
            finalLocationLat: decided.lat != null ? toNumber(decided.lat) : null,
            finalLocationLng: decided.lng != null ? toNumber(decided.lng) : null,
          },
          client,
        );
        if (updated) updatedReservation = updated;
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (this.isSlotOverlapError(error)) {
        throw new HttpError({
          statusCode: 409,
          code: 'SLOT_OVERLAP',
          message: 'This slot overlaps with another active slot for the same provider.',
        });
      }
      throw error;
    } finally {
      client.release();
    }

    await this.sendReservationMessage(
      updatedReservation,
      input.decision === 'accept'
        ? 'Offline location proposal accepted.'
        : 'Offline location proposal rejected.',
      userId,
    );

    return {
      proposal: mapLocationProposal(decided),
      reservation: mapReservation(updatedReservation),
    };
  }

  async getOfflineCheckinCodes(
    userId: string,
    reservationId: string,
  ): Promise<{
    myCode: string;
    expiresAt: string;
    myVerifiedAt: string | null;
    counterpartyVerifiedAt: string | null;
  }> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'offline') {
      throw new HttpError({
        statusCode: 400,
        code: 'OFFLINE_ONLY',
        message: 'Check-in is only supported for offline reservations.',
      });
    }
    if (
      !['accepted', 'awaiting_start', 'in_session', 'waiting_customer_done'].includes(
        reservation.status,
      )
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RESERVATION_STATE',
        message: 'Check-in codes are not available in this status.',
      });
    }

    const expiresAt = this.computeOfflineCodeExpiry(reservation);
    const myCodeRow = await this.repo.upsertCheckinCode(
      reservationId,
      userId,
      this.generateCheckinCode(),
      expiresAt,
    );
    const otherId = this.getOtherParticipantId(reservation, userId);
    const otherCodeRow = await this.repo.getCheckinCode(reservationId, otherId);

    return {
      myCode: myCodeRow.code,
      expiresAt: myCodeRow.expires_at,
      myVerifiedAt: myCodeRow.verified_at,
      counterpartyVerifiedAt: otherCodeRow?.verified_at ?? null,
    };
  }

  async confirmOfflineCheckin(
    userId: string,
    reservationId: string,
    input: ConfirmCheckinInput,
  ): Promise<{
    reservation: Reservation;
    myVerifiedAt: string | null;
    counterpartyVerifiedAt: string | null;
  }> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'offline') {
      throw new HttpError({
        statusCode: 400,
        code: 'OFFLINE_ONLY',
        message: 'Check-in is only supported for offline reservations.',
      });
    }

    const otherId = this.getOtherParticipantId(reservation, userId);
    const otherCode = await this.repo.getCheckinCodeByCode(
      reservationId,
      input.counterpartyCode.trim(),
    );
    if (!otherCode || otherCode.user_id !== otherId) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_CHECKIN_CODE',
        message: 'Invalid check-in code.',
      });
    }
    if (new Date(otherCode.expires_at).getTime() < Date.now()) {
      throw new HttpError({
        statusCode: 400,
        code: 'CHECKIN_CODE_EXPIRED',
        message: 'This check-in code has expired.',
      });
    }

    await this.repo.markCheckinConfirmed(reservationId, userId);
    const allCodes = await this.repo.getCheckinStates(reservationId);
    const myCode = allCodes.find((c) => c.user_id === userId) ?? null;
    const otherUserCode = allCodes.find((c) => c.user_id === otherId) ?? null;
    const bothVerified = allCodes.length >= 2 && allCodes.every((c) => c.verified_at != null);

    if (bothVerified) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
        if (!reservationForUpdate) {
          throw new HttpError({
            statusCode: 404,
            code: 'RESERVATION_NOT_FOUND',
            message: 'Reservation not found.',
          });
        }
        await this.ensureFixedPriceHold(client, reservationForUpdate);
        const now = new Date();
        const dueAt = new Date(now.getTime() + OFFLINE_DONE_TIMEOUT_HOURS * 60 * MINUTE_MS);
        await this.repo.updateReservation(
          reservationId,
          {
            status: 'waiting_customer_done',
            startedAt: now,
            settlementStatus:
              this.getReservationFixedHoldAmount(reservationForUpdate) > 0 ? 'held' : 'unsettled',
            customerDoneDueAt: dueAt,
            donePromptedAt: null,
          },
          client,
        );
        await this.repo.createEvent(
          {
            reservationId,
            eventType: 'started',
            actorId: userId,
            metadata: { mode: 'offline' },
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
      await this.sendReservationMessage(
        reservation,
        'Offline check-in completed by both participants. Waiting for customer confirmation.',
        userId,
      );
      const otherOffline = this.getOtherParticipantId(reservation, userId);
      this.notifyUser(
        otherOffline,
        'reservation_started',
        'Offline session started',
        'Both parties checked in. The session is in progress.',
        { reservationId },
      );
    }

    const updated = await this.repo.findReservationById(reservationId);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }

    return {
      reservation: mapReservation(updated),
      myVerifiedAt: myCode?.verified_at ?? null,
      counterpartyVerifiedAt: otherUserCode?.verified_at ?? null,
    };
  }

  async finishReservation(
    userId: string,
    reservationId: string,
    input: FinishReservationInput,
  ): Promise<{
    reservation: Reservation;
    dispute?: ReservationDispute;
  }> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    await this.handleDisconnectAutoReleaseIfDue(reservation.id);
    await this.handleOfflineDonePromptIfDue(reservation.id);

    if (input.action === 'report') {
      const existing = await this.repo.getOpenDisputeByReservation(reservationId);
      const disputeInput: Parameters<ReservationsRepository['createDispute']>[0] = {
        reservationId,
        openedBy: userId,
        reason: 'customer_report',
      };
      const trimmedReason = input.reportReason?.trim();
      if (trimmedReason) disputeInput.description = trimmedReason;
      const dispute = existing ?? (await this.repo.createDispute(disputeInput));
      const updatedReservation = await this.repo.updateReservation(reservationId, {
        status: 'disputed',
        customerDoneDueAt: null,
        donePromptedAt: null,
      });
      if (!updatedReservation) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }
      await this.recordReservationEvent(reservationId, 'dispute_opened', userId, {
        disputeId: dispute.id,
        reason: dispute.reason,
      });
      await this.sendReservationMessage(
        updatedReservation,
        'Reservation was reported and moved to dispute.',
        userId,
      );
      const otherDispute = this.getOtherParticipantId(updatedReservation, userId);
      this.notifyUser(
        otherDispute,
        'reservation_disputed',
        'Reservation disputed',
        'A reservation you are part of was reported and is under dispute review.',
        { reservationId, disputeId: dispute.id },
      );
      return {
        reservation: mapReservation(updatedReservation),
        dispute: mapDispute(dispute),
      };
    }

    if (reservation.customer_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the customer can complete a reservation.',
      });
    }
    if (reservation.status !== 'waiting_customer_done') {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_RESERVATION_STATE',
        message: 'Reservation cannot be marked done in its current state.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      if (!reservationForUpdate) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }
      const heldAmount = this.getReservationFixedHoldAmount(reservationForUpdate);
      await this.releaseExpertFixedPayout(
        client,
        reservationForUpdate,
        'Reservation marked done by customer',
      );
      await this.repo.updateReservation(
        reservationId,
        {
          status: 'completed',
          completedAt: new Date(),
          endedAt: new Date(),
          capturedAmount: heldAmount,
          settlementStatus: heldAmount > 0 ? 'released_to_provider' : 'unsettled',
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.syncInterviewApplicationStatus(
        reservationForUpdate,
        'interview_completed',
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'hold_captured',
          actorId: userId,
          metadata: { amount: heldAmount },
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'completed',
          actorId: userId,
          metadata: { source: 'customer_done' },
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

    const updated = await this.repo.findReservationById(reservationId);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    await this.sendReservationMessage(updated, 'Reservation completed by customer.', userId);
    this.notifyUser(
      updated.provider_id,
      'reservation_completed',
      'Reservation completed',
      'The customer marked your reservation as completed.',
      { reservationId },
    );
    return { reservation: mapReservation(updated) };
  }

  async joinCall(
    userId: string,
    reservationId: string,
    input: CallJoinInput,
  ): Promise<{
    token: string;
    appId: string;
    channel: string;
    uid: number;
    tokenExpiresAt: number;
    snapshot: CallSnapshot;
  }> {
    if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) {
      throw new HttpError({
        statusCode: 503,
        code: 'AGORA_NOT_CONFIGURED',
        message: 'Online call provider is not configured.',
      });
    }

    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'online') {
      throw new HttpError({
        statusCode: 400,
        code: 'ONLINE_ONLY',
        message: 'This endpoint is only available for online reservations.',
      });
    }
    if (reservation.online_type !== input.mediaType) {
      throw new HttpError({
        statusCode: 400,
        code: 'MEDIA_TYPE_MISMATCH',
        message: 'Join type does not match reservation online type.',
      });
    }
    const nowMs = Date.now();
    const startMs = new Date(reservation.requested_start_at).getTime();
    const endMs = new Date(reservation.requested_end_at).getTime();
    if (Number.isFinite(startMs) && nowMs < startMs) {
      throw new HttpError({
        statusCode: 409,
        code: 'CALL_NOT_STARTED',
        message: 'Reservation time has not started yet.',
      });
    }
    if (Number.isFinite(endMs) && nowMs > endMs) {
      throw new HttpError({
        statusCode: 409,
        code: 'CALL_WINDOW_PASSED',
        message: 'Reservation time is over.',
      });
    }

    await this.handleDisconnectAutoReleaseIfDue(reservation.id);

    const currentReservation = await this.requireReservationForParticipant(reservationId, userId);
    const settings = await this.settingsService.getAppStatus();
    await this.ensurePrejoinBalances(currentReservation, settings.reservationMinPrejoinMinutes);

    const channel = `reservation_${reservationId.replace(/-/g, '')}`;
    const session = await this.repo.createCallSession(reservationId, channel);
    const uid = this.computeAgoraUid(userId);

    const pool = getPool();
    const client = await pool.connect();
    let transactionCommitted = false;
    try {
      await client.query('BEGIN');
      const sessionForUpdate = await this.findCallSessionForUpdate(client, session.id);
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      if (!sessionForUpdate || !reservationForUpdate) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }

      await this.repo.upsertCallParticipant(session.id, userId, uid, true, client);
      const participants = await this.repo.listCallParticipants(session.id, client);
      const connectedParticipants = participants.filter((p) => p.is_connected);
      const bothConnected =
        connectedParticipants.some((p) => p.user_id === reservationForUpdate.customer_id) &&
        connectedParticipants.some((p) => p.user_id === reservationForUpdate.provider_id);

      if (bothConnected) {
        await this.ensureFixedPriceHold(client, reservationForUpdate);
        const now = new Date();
        await this.repo.updateCallSession(
          session.id,
          {
            status: 'active',
            startedAt: asDate(sessionForUpdate.started_at) ?? now,
            pausedAt: null,
            billingPausedAt: null,
            billingStartedAt: asDate(sessionForUpdate.billing_started_at) ?? now,
            lastBilledAt: now,
          },
          client,
        );
        await this.repo.updateReservation(
          reservationId,
          {
            status: 'in_session',
            startedAt: asDate(reservationForUpdate.started_at) ?? now,
            settlementStatus:
              this.getReservationFixedHoldAmount(reservationForUpdate) > 0 ? 'held' : 'unsettled',
            disconnectAutoReleaseAt: null,
          },
          client,
        );
        await this.repo.createEvent(
          {
            reservationId,
            eventType: 'started',
            actorId: userId,
            metadata: { mode: 'online' },
          },
          client,
        );
      }

      await client.query('COMMIT');
      transactionCommitted = true;

      if (bothConnected) {
        await this.sendReservationMessage(
          reservationForUpdate,
          'Both participants joined the online session. Billing timer started.',
          userId,
        );
        const otherCall = this.getOtherParticipantId(reservationForUpdate, userId);
        this.notifyUser(
          otherCall,
          'reservation_started',
          'Session started',
          'Both participants joined the online session.',
          { reservationId },
        );
      }

      const snapshot = await this.getCallSnapshot(userId, reservationId);
      let token: string;
      try {
        token = buildAgoraRtcToken({
          appId: env.AGORA_APP_ID,
          appCertificate: env.AGORA_APP_CERTIFICATE,
          channelName: channel,
          uid,
          expiresInSeconds: AGORA_TOKEN_EXPIRY_SECONDS,
        });
      } catch {
        throw new HttpError({
          statusCode: 503,
          code: 'AGORA_TOKEN_FAILED',
          message:
            'Could not issue call credentials. Verify AGORA_APP_ID and AGORA_APP_CERTIFICATE on the API match your Agora project.',
        });
      }
      const tokenExpiresAt = Math.floor(Date.now() / 1000) + AGORA_TOKEN_EXPIRY_SECONDS;

      return {
        token,
        appId: env.AGORA_APP_ID,
        channel,
        uid,
        tokenExpiresAt,
        snapshot,
      };
    } catch (error) {
      if (!transactionCommitted) {
        await client.query('ROLLBACK').catch(() => {});
      }
      try {
        await this.recordReservationActionFailure({
          reservationId,
          actionType: 'call_join',
          actorId: userId,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
          errorMessage: error instanceof Error ? error.message : 'Failed to join call.',
          metadata: { mediaType: input.mediaType },
        });
        await this.recordReservationEvent(reservationId, 'call_join_failed', userId, {
          mediaType: input.mediaType,
        });
      } catch {
        // Do not mask the original join error if audit logging fails.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async renewCallToken(
    userId: string,
    reservationId: string,
  ): Promise<{
    token: string;
    appId: string;
    channel: string;
    uid: number;
    tokenExpiresAt: number;
  }> {
    if (!env.AGORA_APP_ID || !env.AGORA_APP_CERTIFICATE) {
      throw new HttpError({
        statusCode: 503,
        code: 'AGORA_NOT_CONFIGURED',
        message: 'Online call provider is not configured.',
      });
    }

    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'online') {
      throw new HttpError({
        statusCode: 400,
        code: 'ONLINE_ONLY',
        message: 'This endpoint is only available for online reservations.',
      });
    }

    const session = await this.repo.getCallSessionByReservation(reservationId);
    if (!session || session.status === 'ended') {
      throw new HttpError({
        statusCode: 404,
        code: 'CALL_SESSION_NOT_FOUND',
        message: 'Call session not found.',
      });
    }

    const participant = (await this.repo.listCallParticipants(session.id)).find(
      (row) => row.user_id === userId,
    );
    if (!participant) {
      throw new HttpError({
        statusCode: 409,
        code: 'CALL_NOT_JOINED',
        message: 'Join the call first before renewing token.',
      });
    }

    const token = buildAgoraRtcToken({
      appId: env.AGORA_APP_ID,
      appCertificate: env.AGORA_APP_CERTIFICATE,
      channelName: session.agora_channel,
      uid: participant.agora_uid,
      expiresInSeconds: AGORA_TOKEN_EXPIRY_SECONDS,
    });
    const tokenExpiresAt = Math.floor(Date.now() / 1000) + AGORA_TOKEN_EXPIRY_SECONDS;

    return {
      token,
      appId: env.AGORA_APP_ID,
      channel: session.agora_channel,
      uid: participant.agora_uid,
      tokenExpiresAt,
    };
  }

  async callHeartbeat(
    userId: string,
    reservationId: string,
    input: CallHeartbeatInput,
  ): Promise<CallSnapshot> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'online') {
      throw new HttpError({
        statusCode: 400,
        code: 'ONLINE_ONLY',
        message: 'This endpoint is only available for online reservations.',
      });
    }
    const session = await this.repo.getCallSessionByReservation(reservationId);
    if (!session) {
      throw new HttpError({
        statusCode: 404,
        code: 'CALL_SESSION_NOT_FOUND',
        message: 'Call session not found.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    let lowBalanceAutoEnded = false;
    let slotBoundaryPrompted = false;
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      const sessionForUpdate = await this.findCallSessionForUpdate(client, session.id);
      if (!reservationForUpdate || !sessionForUpdate) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }

      await this.repo.upsertCallParticipant(
        session.id,
        userId,
        this.computeAgoraUid(userId),
        input.connected,
        client,
      );

      let activeSession = sessionForUpdate;
      if (sessionForUpdate.status === 'active') {
        const billingResult = await this.billMinutesInTransaction(
          client,
          reservationForUpdate,
          sessionForUpdate,
        );
        activeSession = billingResult.session;
        lowBalanceAutoEnded = billingResult.lowBalanceAutoEnded;
      }

      const reachedSlotBoundary =
        !lowBalanceAutoEnded &&
        activeSession.status === 'active' &&
        new Date(reservationForUpdate.requested_end_at).getTime() <= Date.now() &&
        activeSession.extension_status !== 'approved';
      if (reachedSlotBoundary) {
        const now = new Date();
        const pausedForBoundary = await this.repo.updateCallSession(
          session.id,
          {
            status: 'paused',
            pausedAt: now,
            billingPausedAt: now,
            lastBilledAt: now,
            extensionStatus:
              activeSession.extension_status === 'none'
                ? 'pending'
                : activeSession.extension_status,
            extensionRequestedBy:
              activeSession.extension_status === 'none'
                ? userId
                : activeSession.extension_requested_by,
          },
          client,
        );
        activeSession = pausedForBoundary ?? activeSession;
        slotBoundaryPrompted = true;
      }

      const participantsAfterBoundary = await this.repo.listCallParticipants(session.id, client);
      const connectedParticipants = participantsAfterBoundary.filter((p) => p.is_connected);
      const bothConnected =
        connectedParticipants.some((p) => p.user_id === reservationForUpdate.customer_id) &&
        connectedParticipants.some((p) => p.user_id === reservationForUpdate.provider_id);

      if (!lowBalanceAutoEnded) {
        if (!input.connected || !bothConnected) {
          if (activeSession.status === 'active') {
            const now = new Date();
            await this.repo.updateCallSession(
              session.id,
              {
                status: 'paused',
                pausedAt: now,
                billingPausedAt: now,
                lastBilledAt: now,
              },
              client,
            );
            const releaseAt = new Date(
              now.getTime() + DISCONNECT_AUTO_RELEASE_HOURS * 60 * MINUTE_MS,
            );
            await this.repo.updateReservation(
              reservationId,
              {
                disconnectAutoReleaseAt: releaseAt,
                status: 'in_session',
              },
              client,
            );
          }
        } else if (
          (activeSession.status === 'paused' || activeSession.status === 'pending') &&
          activeSession.extension_status !== 'pending' &&
          activeSession.extension_status !== 'rejected'
        ) {
          const now = new Date();
          await this.repo.updateCallSession(
            session.id,
            {
              status: 'active',
              pausedAt: null,
              billingPausedAt: null,
              billingStartedAt: asDate(activeSession.billing_started_at) ?? now,
              lastBilledAt: now,
            },
            client,
          );
          await this.repo.updateReservation(
            reservationId,
            {
              status: 'in_session',
              disconnectAutoReleaseAt: null,
            },
            client,
          );
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (lowBalanceAutoEnded) {
      await this.sendReservationMessage(
        reservation,
        'Call ended automatically because one participant had low balance.',
        userId,
      );
    } else if (slotBoundaryPrompted) {
      await this.sendReservationMessage(
        reservation,
        'Session reached the scheduled slot end. Both participants must approve extension to continue.',
        userId,
      );
    }

    return this.getCallSnapshot(userId, reservationId);
  }

  async decideCallExtension(
    userId: string,
    reservationId: string,
    input: CallExtensionInput,
  ): Promise<CallSnapshot> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'online') {
      throw new HttpError({
        statusCode: 400,
        code: 'ONLINE_ONLY',
        message: 'Call extension is only available for online reservations.',
      });
    }
    const session = await this.repo.getCallSessionByReservation(reservationId);
    if (!session) {
      throw new HttpError({
        statusCode: 404,
        code: 'CALL_SESSION_NOT_FOUND',
        message: 'Call session not found.',
      });
    }

    if (input.decision === 'request') {
      await this.repo.updateCallSession(session.id, {
        extensionStatus: 'pending',
        extensionRequestedBy: userId,
      });
      await this.sendReservationMessage(
        reservation,
        `${this.displayNameForParticipant(reservation, userId)} requested a session extension.`,
        userId,
      );
      return this.getCallSnapshot(userId, reservationId);
    }

    if (session.extension_status !== 'pending' || !session.extension_requested_by) {
      throw new HttpError({
        statusCode: 409,
        code: 'NO_PENDING_EXTENSION',
        message: 'No pending extension request.',
      });
    }

    if (session.extension_requested_by === userId) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_EXTENSION_DECISION',
        message: 'You cannot confirm your own extension request.',
      });
    }

    if (input.decision === 'reject') {
      await this.repo.updateCallSession(session.id, {
        extensionStatus: 'rejected',
        extensionRequestedBy: null,
      });
      await this.sendReservationMessage(reservation, 'Session extension request rejected.', userId);
      return this.getCallSnapshot(userId, reservationId);
    }

    const currentEnd = new Date(reservation.requested_end_at);
    const extendedEnd = new Date(currentEnd.getTime() + 30 * MINUTE_MS);
    await this.repo.updateReservation(reservationId, { requestedEndAt: extendedEnd });
    await this.repo.updateCallSession(session.id, {
      extensionStatus: 'none',
      extensionRequestedBy: null,
      extensionUntil: extendedEnd,
    });
    await this.sendReservationMessage(
      reservation,
      `Session extension approved until ${extendedEnd.toISOString()}.`,
      userId,
    );
    return this.getCallSnapshot(userId, reservationId);
  }

  async endCall(userId: string, reservationId: string, input: EndCallInput): Promise<CallSnapshot> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    if (reservation.mode !== 'online') {
      throw new HttpError({
        statusCode: 400,
        code: 'ONLINE_ONLY',
        message: 'This endpoint is only available for online reservations.',
      });
    }
    const session = await this.repo.getCallSessionByReservation(reservationId);
    if (!session) {
      throw new HttpError({
        statusCode: 404,
        code: 'CALL_SESSION_NOT_FOUND',
        message: 'Call session not found.',
      });
    }

    if (input.action === 'refresh') {
      return this.getCallSnapshot(userId, reservationId);
    }

    const pool = getPool();
    const client = await pool.connect();
    let endedByCustomer = false;
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      const sessionForUpdate = await this.findCallSessionForUpdate(client, session.id);
      if (!reservationForUpdate || !sessionForUpdate) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }

      if (sessionForUpdate.status === 'active') {
        const billed = await this.billMinutesInTransaction(
          client,
          reservationForUpdate,
          sessionForUpdate,
        );
        if (billed.lowBalanceAutoEnded) {
          await client.query('COMMIT');
          return this.getCallSnapshot(userId, reservationId);
        }
      }

      const now = new Date();
      await this.repo.updateCallSession(
        session.id,
        {
          status: 'ended',
          endedAt: now,
          pausedAt: null,
          billingPausedAt: now,
          lastBilledAt: now,
        },
        client,
      );

      endedByCustomer = reservationForUpdate.customer_id === userId;
      const heldAmount = this.getReservationFixedHoldAmount(reservationForUpdate);
      if (endedByCustomer) {
        await this.releaseExpertFixedPayout(client, reservationForUpdate, 'Customer ended call');
      } else {
        await this.refundFixedHold(client, reservationForUpdate, 'Provider ended call');
      }

      await this.repo.updateReservation(
        reservationId,
        {
          status: 'completed',
          endedAt: now,
          completedAt: now,
          refundAmount: endedByCustomer ? 0 : heldAmount,
          capturedAmount: endedByCustomer ? heldAmount : 0,
          refundStatus: endedByCustomer || heldAmount <= 0 ? 'none' : 'succeeded',
          settlementStatus: endedByCustomer
            ? heldAmount > 0
              ? 'released_to_provider'
              : 'unsettled'
            : heldAmount > 0
              ? 'refunded_to_customer'
              : 'unsettled',
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.syncInterviewApplicationStatus(
        reservationForUpdate,
        'interview_completed',
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: endedByCustomer ? 'hold_captured' : 'hold_released',
          actorId: userId,
          metadata: { amount: heldAmount },
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'completed',
          actorId: userId,
          metadata: { endedByCustomer },
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

    await this.sendReservationMessage(
      reservation,
      endedByCustomer
        ? 'Customer ended the call and confirmed completion.'
        : 'Provider ended the call. Fixed reservation hold was returned to customer.',
      userId,
    );
    return this.getCallSnapshot(userId, reservationId);
  }

  async getCallSnapshot(userId: string, reservationId: string): Promise<CallSnapshot> {
    const reservation = await this.requireReservationForParticipant(reservationId, userId);
    const session = await this.repo.getCallSessionByReservation(reservationId);
    const participants = session ? await this.repo.listCallParticipants(session.id) : [];
    const settings = await this.settingsService.getAppStatus();
    const walletState = await this.getWalletMinuteState(
      reservation,
      settings.reservationMinPrejoinMinutes,
    );

    return {
      session: session ? mapCallSession(session) : null,
      participants: participants.map(mapCallParticipant),
      reservation: mapReservation(reservation),
      minimumPrejoinMinutes: settings.reservationMinPrejoinMinutes,
      customerRemainingMinutes: walletState.customerRemainingMinutes,
      providerRemainingMinutes: walletState.providerRemainingMinutes,
    };
  }

  async runLifecycleSweep(): Promise<{
    disconnectReleased: number;
    donePrompted: number;
    expiredPending: number;
  }> {
    const pool = getPool();
    const lock = await pool.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [LIFECYCLE_SWEEP_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      return { disconnectReleased: 0, donePrompted: 0, expiredPending: 0 };
    }

    try {
      const disconnectReleased = await this.processDueDisconnectAutoRelease(100);
      const donePrompted = await this.processDueOfflineDonePrompts(100);
      const expiredPending = await this.processExpiredPendingReservations(50);
      return { disconnectReleased, donePrompted, expiredPending };
    } finally {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [LIFECYCLE_SWEEP_LOCK_KEY]);
    }
  }

  private static readonly PENDING_EXPIRY_DAYS = 7;

  private async processExpiredPendingReservations(limit: number): Promise<number> {
    const cutoff = new Date(
      Date.now() - ReservationsService.PENDING_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.repo.listPendingReservationsCreatedBefore(cutoff, limit);
    if (rows.length === 0) return 0;
    const pool = getPool();
    const client = await pool.connect();
    let processed = 0;
    const expiredRows: ReservationRow[] = [];
    try {
      await client.query('BEGIN');
      for (const row of rows) {
        const locked = await this.repo.findPendingReservationForExpiry(row.id, client);
        if (!locked) continue;
        await this.refundFixedHold(client, locked, 'Reservation expired (pending too long)');
        const updateFields: {
          status: string;
          settlementStatus?: string;
          refundStatus?: string;
        } = {
          status: 'expired',
        };
        if (locked.fixed_price_hold_id) {
          updateFields.settlementStatus = 'refunded_to_customer';
          updateFields.refundStatus = 'succeeded';
        }
        await this.repo.updateReservation(locked.id, updateFields, client);
        await this.repo.createEvent(
          {
            reservationId: locked.id,
            eventType: 'rejected',
            actorId: null,
            metadata: { reason: 'expired_pending' },
          },
          client,
        );
        processed++;
        expiredRows.push(locked);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    for (const row of expiredRows) {
      this.notifyUser(
        row.customer_id,
        'reservation_expired',
        'Reservation expired',
        'A pending reservation request expired before the provider responded.',
        { reservationId: row.id },
      );
    }
    return processed;
  }

  async listDisputes(
    userId: string,
    role: string,
    page: number,
    limit: number,
    status?: string,
  ): Promise<{
    items: ReservationDispute[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    this.ensureAdminRole(userId, role);
    const { rows, total } = await this.repo.listDisputes(page, limit, status);
    return {
      items: rows.map(mapDispute),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listMyDisputeCases(userId: string): Promise<ReservationDisputeListItem[]> {
    const rows = await this.repo.listDisputesForUser(userId);
    return this.mapDisputeListRows(rows);
  }

  async listDisputeCases(
    userId: string,
    role: string,
    page: number,
    limit: number,
    status?: string,
  ): Promise<{
    items: ReservationDisputeListItem[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    this.ensureAdminRole(userId, role);
    const { rows, total } = await this.repo.listDisputes(page, limit, status);
    return {
      items: await this.mapDisputeListRows(rows),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getDisputeCase(
    userId: string,
    role: string,
    disputeId: string,
  ): Promise<ReservationDisputeCase> {
    const isAdmin = role === 'admin';
    const dispute = await this.repo.findDisputeById(disputeId);
    if (!dispute) {
      throw new HttpError({
        statusCode: 404,
        code: 'DISPUTE_NOT_FOUND',
        message: 'Dispute not found.',
      });
    }
    const reservation = await this.repo.findReservationById(dispute.reservation_id);
    if (!reservation) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    if (!isAdmin) this.ensureReservationParticipant(reservation, userId);
    return this.buildDisputeCase(dispute, reservation, isAdmin);
  }

  async addDisputeNote(
    userId: string,
    role: string,
    disputeId: string,
    input: { body: string; visibility?: 'public' | 'admin' | undefined },
  ): Promise<ReservationDisputeNote> {
    const visibility = input.visibility ?? 'public';
    const isAdmin = role === 'admin';
    if (visibility === 'admin' && !isAdmin) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only admins can add internal dispute notes.',
      });
    }
    await this.getDisputeCase(userId, role, disputeId);
    const row = await this.repo.createDisputeNote({
      disputeId,
      authorId: userId,
      body: input.body.trim(),
      visibility,
    });
    return mapDisputeNote(row);
  }

  async addDisputeEvidence(
    userId: string,
    role: string,
    disputeId: string,
    input: { uploadId: string; label?: string | null | undefined },
  ): Promise<ReservationDisputeEvidence> {
    await this.getDisputeCase(userId, role, disputeId);
    const ownsUpload = await this.repo.privateUploadBelongsToUser(input.uploadId, userId);
    if (!ownsUpload) {
      throw new HttpError({
        statusCode: 403,
        code: 'UPLOAD_NOT_OWNED',
        message: 'Evidence upload must belong to the current user.',
      });
    }
    const row = await this.repo.createDisputeEvidence({
      disputeId,
      uploadedBy: userId,
      uploadId: input.uploadId,
      label: input.label?.trim() || null,
    });
    return mapDisputeEvidence(row);
  }

  async resolveDispute(
    userId: string,
    role: string,
    disputeId: string,
    input: ResolveDisputeInput,
  ): Promise<ReservationDispute> {
    this.ensureAdminRole(userId, role);
    const pool = getPool();
    const client = await pool.connect();
    let dispute: ReservationDisputeRow | null = null;
    try {
      await client.query('BEGIN');
      const existingDispute = await this.repo.findDisputeById(disputeId, client);
      if (!existingDispute || existingDispute.status !== 'open') {
        throw new HttpError({
          statusCode: 404,
          code: 'DISPUTE_NOT_FOUND',
          message: 'Open dispute not found.',
        });
      }
      const resRow = await this.findReservationForUpdate(client, existingDispute.reservation_id);
      if (!resRow) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found for dispute.',
        });
      }
      const settlement = await this.applyDisputeSettlement(client, resRow, input);
      await this.repo.updateReservation(
        resRow.id,
        {
          status: 'completed',
          completedAt: new Date(),
          refundAmount: settlement.refundAmount,
          capturedAmount: settlement.capturedAmount,
          refundStatus: settlement.refundAmount > 0 ? 'succeeded' : 'none',
          settlementStatus: settlement.settlementStatus,
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId: resRow.id,
          eventType: 'dispute_resolved',
          actorId: userId,
          metadata: {
            disputeId,
            status: input.status,
            reason: input.resolutionNotes.trim(),
            ...settlement,
          },
        },
        client,
      );
      dispute = await this.repo.resolveDispute(
        disputeId,
        input.status,
        input.resolutionNotes.trim(),
        userId,
        client,
      );
      if (!dispute) {
        throw new HttpError({
          statusCode: 404,
          code: 'DISPUTE_NOT_FOUND',
          message: 'Open dispute not found.',
        });
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const resRow = dispute ? await this.repo.findReservationById(dispute.reservation_id) : null;
    if (resRow) {
      const payloadBase = { reservationId: dispute.reservation_id, disputeId: dispute.id };
      this.notifyUser(
        resRow.customer_id,
        'reservation_dispute_resolved',
        'Dispute resolved',
        'An admin resolved a dispute on your reservation.',
        payloadBase,
      );
      this.notifyUser(
        resRow.provider_id,
        'reservation_dispute_resolved',
        'Dispute resolved',
        'An admin resolved a dispute on your reservation.',
        payloadBase,
      );
    }
    return mapDispute(dispute);
  }

  async cancelReservation(
    userId: string,
    role: string,
    reservationId: string,
    input: CancelReservationInput,
    idempotencyKey?: string,
  ): Promise<Reservation> {
    if (idempotencyKey) {
      const existing = await this.getIdempotentReservationResponse(
        userId,
        'cancel_reservation',
        idempotencyKey,
      );
      if (existing) return existing;
    }

    const current = await this.repo.findReservationById(reservationId);
    if (!current) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }

    const actor = this.resolveCancellationActor(current, userId, role);
    const cancellableStatuses = new Set(['pending', 'accepted', 'awaiting_start']);
    if (!cancellableStatuses.has(current.status)) {
      throw new HttpError({
        statusCode: 409,
        code: 'INVALID_RESERVATION_STATE',
        message: 'Reservation cannot be cancelled in its current state.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservation = await this.findReservationForUpdate(client, reservationId);
      if (!reservation) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }

      const now = new Date();
      const policy = this.getPolicySnapshot(reservation);
      const priceAmount = this.getReservationFixedHoldAmount(reservation);
      let refundAmount = 0;
      let capturedAmount = 0;
      let penaltyAmount = 0;
      let refundStatus: Reservation['refundStatus'] = 'none';
      let settlementStatus: Reservation['settlementStatus'] =
        (reservation.settlement_status as Reservation['settlementStatus']) || 'unsettled';
      let outcome: ReservationCancellationOutcome = 'none';

      if (reservation.slot_id && reservation.status !== 'pending') {
        const slot = await this.findSlotForUpdate(client, reservation.slot_id);
        if (slot?.status === 'booked') {
          await this.updateSlotStatusInTransaction(client, slot.id, 'available');
        }
      }

      if (reservation.purpose === 'job_interview') {
        const shouldRefund =
          actor === 'provider' ||
          actor === 'admin' ||
          input.reasonCode === 'slot_invalidated' ||
          input.reasonCode === 'platform_failure';
        if (shouldRefund) {
          await this.refundFixedHold(client, reservation, 'Interview reservation cancelled');
          if (priceAmount > 0) {
            refundAmount = priceAmount;
            refundStatus = 'succeeded';
            settlementStatus = 'refunded_to_customer';
          }
          outcome = input.reasonCode === 'platform_failure' ? 'platform_refund' : 'full_refund';
          await this.repo.createEvent(
            {
              reservationId,
              eventType: 'hold_released',
              actorId: userId,
              metadata: { reasonCode: input.reasonCode, amount: refundAmount },
            },
            client,
          );
        } else {
          // Customer forfeits the interview fee. Route it to the provider minus
          // platform commission (same split as a completed payout) instead of
          // capturing the hold to nowhere. releaseExpertFixedPayout captures the
          // held funds idempotently and credits provider + platform.
          await this.releaseExpertFixedPayout(
            client,
            reservation,
            'Interview cancellation without refund',
          );
          capturedAmount = priceAmount;
          settlementStatus = priceAmount > 0 ? 'cancelled_no_refund' : settlementStatus;
          outcome = 'cancelled_no_refund';
          await this.repo.createEvent(
            {
              reservationId,
              eventType: 'hold_captured',
              actorId: userId,
              metadata: { reasonCode: input.reasonCode, amount: capturedAmount },
            },
            client,
          );
        }
      } else if (reservation.status === 'pending') {
        outcome = 'none';
        await this.refundFixedHold(client, reservation, 'Reservation cancelled while pending');
        const pendingRefundAmount = priceAmount;
        if (pendingRefundAmount > 0) {
          refundAmount = pendingRefundAmount;
          refundStatus = 'succeeded';
          settlementStatus = 'refunded_to_customer';
          await this.repo.createEvent(
            {
              reservationId,
              eventType: 'hold_released',
              actorId: userId,
              metadata: { reasonCode: input.reasonCode, amount: refundAmount },
            },
            client,
          );
        }
      } else if (actor === 'customer') {
        const hoursUntilStart =
          (new Date(reservation.requested_start_at).getTime() - now.getTime()) / (60 * MINUTE_MS);
        if (hoursUntilStart >= policy.customerFreeCancelHours) {
          await this.refundFixedHold(client, reservation, 'Customer cancelled reservation');
          if (priceAmount > 0) {
            refundAmount = priceAmount;
            refundStatus = 'succeeded';
            settlementStatus = 'refunded_to_customer';
          }
          outcome = 'full_refund';
          await this.repo.createEvent(
            {
              reservationId,
              eventType: 'hold_released',
              actorId: userId,
              metadata: { reasonCode: input.reasonCode, amount: refundAmount },
            },
            client,
          );
        } else {
          await this.releaseExpertFixedPayout(client, reservation, 'Customer late cancellation');
          capturedAmount = priceAmount;
          settlementStatus = priceAmount > 0 ? 'released_to_provider' : settlementStatus;
          outcome = 'provider_paid';
          await this.repo.createEvent(
            {
              reservationId,
              eventType: 'hold_captured',
              actorId: userId,
              metadata: { reasonCode: input.reasonCode, amount: capturedAmount },
            },
            client,
          );
        }
      } else {
        const hoursUntilStart =
          (new Date(reservation.requested_start_at).getTime() - now.getTime()) / (60 * MINUTE_MS);
        await this.refundFixedHold(client, reservation, 'Provider cancelled reservation');
        if (priceAmount > 0) {
          refundAmount = priceAmount;
          refundStatus = 'succeeded';
          settlementStatus = 'refunded_to_customer';
        }
        if (actor === 'provider' && hoursUntilStart < policy.providerPenaltyCancelHours) {
          penaltyAmount = Math.max(0, policy.providerLateCancelPenaltyAmount);
          if (penaltyAmount > 0) {
            try {
              await this.applyProviderLateCancellationPenalty(
                client,
                reservation,
                penaltyAmount,
                input.reasonCode,
              );
              await this.repo.createEvent(
                {
                  reservationId,
                  eventType: 'penalty_applied',
                  actorId: userId,
                  metadata: { amount: penaltyAmount, reasonCode: input.reasonCode },
                },
                client,
              );
            } catch (error) {
              await this.recordReservationActionFailure(
                {
                  reservationId,
                  actionType: 'provider_late_cancel_penalty',
                  actorId: userId,
                  errorCode: error instanceof Error ? error.name : 'UNKNOWN',
                  errorMessage:
                    error instanceof Error ? error.message : 'Failed to apply provider penalty.',
                  metadata: {
                    penaltyAmount,
                    reasonCode: input.reasonCode,
                    reservationId,
                  },
                },
                client,
              );
            }
          }
          outcome = 'customer_refund_with_provider_penalty';
        } else {
          outcome = 'full_refund';
        }
        await this.repo.createEvent(
          {
            reservationId,
            eventType: 'hold_released',
            actorId: userId,
            metadata: { reasonCode: input.reasonCode, amount: refundAmount },
          },
          client,
        );
      }

      await this.repo.updateReservation(
        reservationId,
        {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: userId,
          cancellationActor: actor,
          cancellationReasonCode: input.reasonCode,
          cancellationEffectiveOutcome: outcome,
          refundAmount,
          capturedAmount,
          penaltyAmount,
          refundStatus,
          settlementStatus,
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'cancelled',
          actorId: userId,
          metadata: {
            actor,
            reasonCode: input.reasonCode,
            reasonText: input.reasonText?.trim() || null,
            outcome,
            refundAmount,
            capturedAmount,
            penaltyAmount,
          },
        },
        client,
      );
      await this.syncInterviewApplicationStatus(reservation, 'interview_invited', client, {
        interviewReservationId: null,
      });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const updated = await this.repo.findReservationById(reservationId);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    const mapped = mapReservation(updated);
    if (idempotencyKey) {
      await this.storeReservationActionIdempotency(
        userId,
        'cancel_reservation',
        idempotencyKey,
        mapped.id,
        mapped,
      );
    }
    const otherCancel = updated.customer_id === userId ? updated.provider_id : updated.customer_id;
    this.notifyUser(
      otherCancel,
      'reservation_cancelled',
      'Reservation cancelled',
      'A reservation you are part of was cancelled.',
      { reservationId },
    );
    await this.sendReservationMessage(
      updated,
      `Reservation cancelled${input.reasonText?.trim() ? `: ${input.reasonText.trim()}` : '.'}`,
      userId,
    );
    return mapped;
  }

  async listReservationTimeline(
    userId: string,
    reservationId: string,
  ): Promise<ReservationTimelineEvent[]> {
    await this.requireReservationForParticipant(reservationId, userId);
    const rows = await this.repo.listEvents(reservationId);
    return rows.reverse().map(mapTimelineEvent);
  }

  async listActionFailures(
    userId: string,
    role: string,
    onlyOpen: boolean,
    limit: number,
  ): Promise<ReservationActionFailure[]> {
    this.ensureAdminRole(userId, role);
    const rows = await this.repo.listActionFailures(onlyOpen, limit);
    return rows.map(mapActionFailure);
  }

  async replayActionFailure(
    userId: string,
    role: string,
    failureId: string,
  ): Promise<ReservationActionFailure> {
    this.ensureAdminRole(userId, role);
    const failure = await this.repo.findActionFailureById(failureId);
    if (!failure) {
      throw new HttpError({
        statusCode: 404,
        code: 'ACTION_FAILURE_NOT_FOUND',
        message: 'Reservation action failure not found.',
      });
    }

    await this.repo.markActionFailureReplayed(failureId);
    if (
      failure.action_type === 'provider_late_cancel_penalty' &&
      failure.reservation_id &&
      typeof failure.metadata.penaltyAmount === 'number'
    ) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const reservation = await this.findReservationForUpdate(client, failure.reservation_id);
        if (!reservation) {
          throw new HttpError({
            statusCode: 404,
            code: 'RESERVATION_NOT_FOUND',
            message: 'Reservation not found.',
          });
        }
        await this.applyProviderLateCancellationPenalty(
          client,
          reservation,
          failure.metadata.penaltyAmount,
          typeof failure.metadata.reasonCode === 'string' ? failure.metadata.reasonCode : 'other',
        );
        await this.repo.resolveActionFailure(failureId);
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'worker_replayed',
            actorId: userId,
            metadata: {
              failureId,
              actionType: failure.action_type,
            },
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

    const updated = await this.repo.findActionFailureById(failureId);
    return mapActionFailure(updated ?? failure);
  }

  async reconcileReservationMoney(
    userId: string,
    role: string,
    reservationId: string,
  ): Promise<Reservation> {
    this.ensureAdminRole(userId, role);
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }

    let settlementStatus: Reservation['settlementStatus'] =
      (reservation.settlement_status as Reservation['settlementStatus']) || 'unsettled';
    const holdId = reservation.fixed_price_hold_id;
    if (!holdId) {
      settlementStatus = reservation.status === 'cancelled' ? 'unsettled' : settlementStatus;
    } else {
      const hold = await this.walletRepo.findWalletHoldById(holdId);
      if (hold?.status === 'held') settlementStatus = 'held';
      if (hold?.status === 'released') settlementStatus = 'refunded_to_customer';
      if (hold?.status === 'captured') {
        settlementStatus =
          reservation.cancellation_effective_outcome === 'cancelled_no_refund'
            ? 'cancelled_no_refund'
            : 'released_to_provider';
      }
    }

    const updated = await this.repo.updateReservation(reservationId, {
      settlementStatus,
    });
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    await this.recordReservationEvent(reservationId, 'reconciled', userId, {
      settlementStatus,
    });
    return mapReservation(updated);
  }

  private async getCommissionReceiverId(): Promise<string> {
    const status = await this.settingsService.getAppStatus();
    return status.commissionReceiverId || PLATFORM_USER_ID;
  }

  private buildPolicySnapshot(input: {
    purpose: Reservation['purpose'];
    adminAcceptanceFee: number;
    pricingBreakdown?: ReservationPricingBreakdown | null;
  }): ReservationPolicySnapshot {
    return {
      customerFreeCancelHours: CUSTOMER_FREE_CANCEL_HOURS,
      providerPenaltyCancelHours: PROVIDER_PENALTY_CANCEL_HOURS,
      customerLateCancelPayoutPercent: CUSTOMER_LATE_CANCEL_PAYOUT_PERCENT,
      providerLateCancelPenaltyAmount:
        input.purpose === 'service' ? Math.max(0, input.adminAcceptanceFee) : 0,
      interviewBusinessFailureRefundOnly: input.purpose === 'job_interview',
      pricingBreakdown: input.pricingBreakdown ?? null,
    };
  }

  private getPolicySnapshot(reservation: ReservationRow): ReservationPolicySnapshot {
    return (
      (reservation.policy_snapshot as ReservationPolicySnapshot | null) ??
      this.buildPolicySnapshot({
        purpose: reservation.purpose as Reservation['purpose'],
        adminAcceptanceFee: toNumber(reservation.admin_acceptance_fee),
      })
    );
  }

  private getReservationPlatformFeeAmount(reservation: ReservationRow): number {
    if (reservation.purpose !== 'service') return 0;
    return toMoney(Math.max(0, toNumber(reservation.admin_acceptance_fee)));
  }

  private getReservationFixedHoldAmount(reservation: ReservationRow): number {
    const providerPrice = toMoney(toNumber(reservation.expert_price_amount));
    return toMoney(providerPrice + this.getReservationPlatformFeeAmount(reservation));
  }

  private async getIdempotentReservationResponse(
    actorId: string,
    action: IdempotentReservationAction,
    idempotencyKey: string,
  ): Promise<Reservation | null> {
    const existing = await this.repo.findActionIdempotency(actorId, action, idempotencyKey);
    if (!existing) return null;
    if (existing.reservation_id) {
      const reservation = await this.repo.findReservationById(existing.reservation_id);
      if (reservation) return mapReservation(reservation);
    }
    if (Object.keys(existing.response_json ?? {}).length === 0) {
      throw new HttpError({
        statusCode: 409,
        code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
        message: 'This reservation request is already being processed.',
      });
    }
    return existing.response_json as Reservation;
  }

  private async reserveReservationActionIdempotency(
    actorId: string,
    action: IdempotentReservationAction,
    idempotencyKey: string,
  ): Promise<void> {
    const reserved = await this.repo.reserveActionIdempotency(actorId, action, idempotencyKey);
    if (!reserved) {
      throw new HttpError({
        statusCode: 409,
        code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
        message: 'This reservation request is already being processed.',
      });
    }
  }

  private async storeReservationActionIdempotency(
    actorId: string,
    action: IdempotentReservationAction,
    idempotencyKey: string,
    reservationId: string,
    reservation: Reservation,
    client?: PoolClient,
  ): Promise<void> {
    await this.repo.storeActionIdempotency(
      {
        actorId,
        action,
        idempotencyKey,
        reservationId,
        responseJson: reservation as unknown as Record<string, unknown>,
      },
      client,
    );
  }

  private async recordReservationEvent(
    reservationId: string,
    eventType: ReservationTimelineEvent['eventType'],
    actorId?: string | null,
    metadata?: Record<string, unknown>,
    client?: PoolClient,
  ): Promise<void> {
    const eventInput: Parameters<ReservationsRepository['createEvent']>[0] = {
      reservationId,
      eventType,
      actorId: actorId ?? null,
    };
    if (metadata !== undefined) {
      eventInput.metadata = metadata;
    }
    await this.repo.createEvent(eventInput, client);
  }

  private async recordReservationActionFailure(
    input: Parameters<ReservationsRepository['createActionFailure']>[0],
    client?: PoolClient,
  ): Promise<void> {
    await this.repo.createActionFailure(input, client);
  }

  private ensureProviderRole(role: string): void {
    if (!canManageReservationAvailability(role)) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This action is only available to provider accounts.',
      });
    }
  }

  private resolveCancellationActor(
    reservation: ReservationRow,
    userId: string,
    role: string,
  ): ReservationCancellationActor {
    if (reservation.customer_id === userId) return 'customer';
    if (reservation.provider_id === userId) return 'provider';
    if (role === 'admin') return 'admin';
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'You do not have access to this reservation.',
    });
  }

  private async syncInterviewApplicationStatus(
    reservation: ReservationRow,
    status: 'interview_invited' | 'interview_completed',
    client?: PoolClient,
    overrides?: {
      interviewReservationId?: string | null;
    },
  ): Promise<void> {
    if (reservation.purpose !== 'job_interview' || !reservation.job_application_id) return;
    await this.jobsRepo.updateApplication(
      reservation.job_application_id,
      {
        status,
        ...(overrides?.interviewReservationId !== undefined
          ? { interviewReservationId: overrides.interviewReservationId }
          : {}),
      },
      client,
    );
  }

  private async applyProviderLateCancellationPenalty(
    client: PoolClient,
    reservation: ReservationRow,
    amount: number,
    reasonCode: string,
  ): Promise<void> {
    if (amount <= 0) return;
    const providerWallet = await this.walletRepo.findByUserId(reservation.provider_id);
    if (!providerWallet) {
      throw new Error('Provider wallet not found for penalty.');
    }
    const receiverId = await this.getCommissionReceiverId();
    const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, receiverId);
    await this.walletRepo.debitWalletInTransaction(
      client,
      providerWallet.id,
      reservation.provider_id,
      amount,
      'Provider late cancellation penalty',
      'reservation',
      reservation.id,
    );
    await this.walletRepo.creditWithTypeInTransaction(
      client,
      platformWalletId,
      receiverId,
      amount,
      'commission',
      'Provider late cancellation penalty',
      'reservation',
      reservation.id,
    );
    await this.repo.createEvent(
      {
        reservationId: reservation.id,
        eventType: 'penalty_applied',
        actorId: reservation.provider_id,
        metadata: {
          amount,
          reasonCode,
        },
      },
      client,
    );
  }

  private ensureAdminRole(userId: string, role: string): void {
    void userId;
    if (role !== 'admin') {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Admin access required.',
      });
    }
  }

  private async mapDisputeListRows(
    rows: ReservationDisputeListRow[],
  ): Promise<ReservationDisputeListItem[]> {
    const items = await Promise.all(
      rows.map(async (row) => {
        const reservation = await this.repo.findReservationById(row.reservation_id);
        if (!reservation) return null;
        return {
          dispute: mapDispute(row),
          reservation: mapReservation(reservation),
          evidenceCount: toNumber(row.evidence_count),
          noteCount: toNumber(row.note_count),
          lastActivityAt: row.last_activity_at,
        };
      }),
    );
    return items.filter((item): item is ReservationDisputeListItem => item != null);
  }

  private async buildDisputeCase(
    dispute: ReservationDisputeRow,
    reservation: ReservationRow,
    includeAdmin: boolean,
  ): Promise<ReservationDisputeCase> {
    const [events, evidence, notes, moneyEvents, messages] = await Promise.all([
      this.repo.listEvents(reservation.id),
      this.repo.listDisputeEvidence(dispute.id),
      this.repo.listDisputeNotes(dispute.id, includeAdmin),
      this.repo.listDisputeMoneyEvents(reservation.id),
      reservation.conversation_id
        ? this.chatRepo.getMessages(reservation.conversation_id, 50, 0)
        : Promise.resolve([]),
    ]);
    return {
      dispute: mapDispute(dispute),
      reservation: mapReservation(reservation),
      timeline: events.map(mapTimelineEvent),
      evidence: evidence.map(mapDisputeEvidence),
      notes: notes.map(mapDisputeNote),
      messages: messages.map((message) => ({
        id: message.id,
        senderId: message.sender_id,
        senderName: message.sender_name,
        body: message.body,
        attachmentUrl: message.attachment_url,
        createdAt: message.created_at,
      })),
      moneyEvents: moneyEvents.map(mapDisputeMoneyEvent),
    };
  }

  private resolveProviderIdForSlots(userId: string, role: string, providerId?: string): string {
    if (providerId) return providerId;
    if (role === 'expert' || role === 'business' || role === 'craftsman') return userId;
    throw new HttpError({
      statusCode: 400,
      code: 'PROVIDER_ID_REQUIRED',
      message: 'providerId is required for customer slot queries.',
    });
  }

  private getExpertPriceByType(
    profile: ReservationProfileRow,
    mode: CreateReservationInput['mode'],
    onlineType?: CreateReservationInput['onlineType'],
  ): number {
    if (mode === 'offline') {
      return toNumber(profile.offline_price);
    }
    if (onlineType === 'video') {
      return toNumber(profile.online_video_price);
    }
    return toNumber(profile.online_voice_price);
  }

  private ensureReservationParticipant(reservation: ReservationRow, userId: string): void {
    if (reservation.customer_id !== userId && reservation.provider_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You do not have access to this reservation.',
      });
    }
  }

  private async requireReservationForParticipant(
    reservationId: string,
    userId: string,
  ): Promise<ReservationRow> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }
    this.ensureReservationParticipant(reservation, userId);
    return reservation;
  }

  private getOtherParticipantId(reservation: ReservationRow, userId: string): string {
    return reservation.customer_id === userId ? reservation.provider_id : reservation.customer_id;
  }

  private displayNameForParticipant(
    reservation: ReservationRow | Reservation,
    userId: string,
  ): string {
    if (
      (reservation as ReservationRow).customer_id === userId ||
      (reservation as Reservation).customerId === userId
    ) {
      return (
        (reservation as ReservationRow).customer_name ??
        (reservation as Reservation).customerName ??
        'Customer'
      );
    }
    return (
      (reservation as ReservationRow).provider_name ??
      (reservation as Reservation).providerName ??
      'Provider'
    );
  }

  private computeAgoraUid(userId: string): number {
    const compact = userId.replace(/-/g, '');
    const slice = compact.slice(-9);
    const numeric = Number.parseInt(slice, 16);
    if (Number.isFinite(numeric) && numeric > 0) {
      const maxInt32 = 2_147_483_647;
      return numeric % maxInt32 || 1;
    }
    return randomInt(1, 2_147_483_647);
  }

  private generateCheckinCode(): string {
    return String(randomInt(100000, 999999));
  }

  private computeOfflineCodeExpiry(reservation: ReservationRow): Date {
    const end = new Date(reservation.requested_end_at);
    if (Number.isNaN(end.getTime())) {
      return new Date(Date.now() + 24 * 60 * MINUTE_MS);
    }
    return new Date(end.getTime() + 24 * 60 * MINUTE_MS);
  }

  private async decideReservationInternal(params: {
    reservationId: string;
    providerId: string;
    decision: 'accept' | 'reject';
    rejectionReason: string | null;
    autoDecision: boolean;
  }): Promise<Reservation> {
    const pool = getPool();
    const client = await pool.connect();
    let accepted = false;
    let rejectedBySlotConflict = false;
    let rejectionReason = params.rejectionReason ?? null;
    const slotTakenNotify: { customerId: string; reservationId: string }[] = [];

    try {
      await client.query('BEGIN');
      const reservation = await this.findReservationForUpdate(client, params.reservationId);
      if (!reservation) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }
      if (reservation.provider_id !== params.providerId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Only the reservation provider can decide this request.',
        });
      }
      if (reservation.status !== 'pending') {
        throw new HttpError({
          statusCode: 409,
          code: 'RESERVATION_ALREADY_DECIDED',
          message: 'Reservation has already been decided.',
        });
      }

      if (params.decision === 'reject') {
        await this.refundFixedHold(client, reservation, 'Reservation rejected by provider');
        await this.repo.updateReservation(
          params.reservationId,
          {
            status: 'rejected',
            rejectionReason: rejectionReason ?? 'Rejected by provider',
            autoRejected: params.autoDecision,
          },
          client,
        );
        await this.repo.createEvent(
          {
            reservationId: params.reservationId,
            eventType: 'rejected',
            actorId: params.providerId,
            metadata: {
              autoDecision: params.autoDecision,
              rejectionReason: rejectionReason ?? 'Rejected by provider',
            },
          },
          client,
        );
      } else {
        if (!reservation.slot_id) {
          throw new HttpError({
            statusCode: 400,
            code: 'MISSING_SLOT',
            message: 'Reservation slot is missing.',
          });
        }
        const slot = await this.findSlotForUpdate(client, reservation.slot_id);
        if (!slot || slot.provider_id !== params.providerId || slot.status !== 'available') {
          rejectedBySlotConflict = true;
          rejectionReason =
            'Requested slot is already taken. Please choose one of the suggested alternatives.';
          const suggestions =
            reservation.mode === 'online'
              ? await this.repo.findSuggestedSlots(
                  params.providerId,
                  new Date(reservation.requested_start_at),
                  reservationDurationMinutes(reservation),
                )
              : [];
          await this.refundFixedHold(client, reservation, 'Slot no longer available');
          await this.repo.updateReservation(
            params.reservationId,
            {
              status: 'rejected',
              rejectionReason,
              autoRejected: true,
              suggestedSlots: suggestions,
            },
            client,
          );
          await this.repo.createEvent(
            {
              reservationId: params.reservationId,
              eventType: 'rejected',
              actorId: params.providerId,
              metadata: {
                autoDecision: true,
                rejectionReason,
                reason: 'slot_conflict',
                suggestedSlots: suggestions,
              },
            },
            client,
          );
        } else {
          await this.updateSlotStatusInTransaction(client, slot.id, 'booked');
          await this.ensureFixedPriceHold(client, reservation);
          const heldAmount = this.getReservationFixedHoldAmount(reservation);
          await this.repo.updateReservation(
            params.reservationId,
            {
              status: 'accepted',
              acceptedAt: new Date(),
              rejectionReason: null,
              autoRejected: false,
              settlementStatus: heldAmount > 0 ? 'held' : 'unsettled',
            },
            client,
          );
          await this.repo.createEvent(
            {
              reservationId: params.reservationId,
              eventType: 'hold_created',
              actorId: reservation.customer_id,
              metadata: {
                amount: heldAmount,
              },
            },
            client,
          );
          await this.repo.createEvent(
            {
              reservationId: params.reservationId,
              eventType: 'accepted',
              actorId: params.providerId,
              metadata: {
                autoDecision: params.autoDecision,
              },
            },
            client,
          );
          accepted = true;

          const otherPending = await this.repo.listPendingReservationsBySlot(
            slot.id,
            params.reservationId,
            client,
          );
          const slotTakenReason = 'Slot no longer available. It was accepted for another request.';
          for (const other of otherPending) {
            await this.refundFixedHold(client, other, slotTakenReason);
            await this.repo.updateReservation(
              other.id,
              {
                status: 'rejected',
                rejectionReason: slotTakenReason,
                autoRejected: true,
              },
              client,
            );
            await this.repo.createEvent(
              {
                reservationId: other.id,
                eventType: 'rejected',
                actorId: params.providerId,
                metadata: { reason: 'slot_taken_by_another', rejectionReason: slotTakenReason },
              },
              client,
            );
            slotTakenNotify.push({ customerId: other.customer_id, reservationId: other.id });
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const updated = await this.repo.findReservationById(params.reservationId);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: 'Reservation not found.',
      });
    }

    if (accepted) {
      const conversationId = await this.chatRepo.findOrCreateConversation(
        updated.customer_id,
        updated.provider_id,
      );
      await this.repo.updateReservation(updated.id, { conversationId });
      const refreshed = await this.repo.findReservationById(updated.id);
      const reservation = refreshed ?? updated;
      this.notifyUser(
        updated.customer_id,
        'reservation_accepted',
        'Reservation accepted',
        'Your reservation request was accepted.',
        { reservationId: updated.id },
      );
      for (const { customerId, reservationId } of slotTakenNotify) {
        this.notifyUser(
          customerId,
          'reservation_rejected',
          'Reservation unavailable',
          'Your reservation was declined because the slot was booked by another customer.',
          { reservationId },
        );
      }
      await this.sendReservationMessage(
        reservation,
        reservation.mode === 'online'
          ? `Reservation accepted. Online ${reservation.online_type ?? 'voice'} session ready.`
          : 'Reservation accepted. You can now coordinate offline details in chat.',
        params.providerId,
      );
      return mapReservation(reservation);
    }

    for (const { customerId, reservationId } of slotTakenNotify) {
      this.notifyUser(
        customerId,
        'reservation_rejected',
        'Reservation unavailable',
        'Your reservation was declined because the slot was booked by another customer.',
        { reservationId },
      );
    }

    if (rejectedBySlotConflict) {
      this.notifyUser(
        updated.customer_id,
        'reservation_rejected',
        'Reservation rejected',
        rejectionReason ?? 'Reservation rejected due to slot conflict.',
        { reservationId: updated.id },
      );
      await this.sendReservationMessage(
        updated,
        rejectionReason ?? 'Reservation rejected due to slot conflict.',
        params.providerId,
      );
    } else if (params.decision === 'reject') {
      this.notifyUser(
        updated.customer_id,
        'reservation_rejected',
        'Reservation rejected',
        rejectionReason
          ? `Reason: ${rejectionReason}`
          : 'The provider declined your reservation request.',
        { reservationId: updated.id },
      );
      await this.sendReservationMessage(
        updated,
        `Reservation rejected${rejectionReason ? `: ${rejectionReason}` : '.'}`,
        params.providerId,
      );
    }

    return mapReservation(updated);
  }

  private async ensureFixedPriceHold(
    client: PoolClient,
    reservation: ReservationRow,
  ): Promise<string | null> {
    const holdAmount = this.getReservationFixedHoldAmount(reservation);
    if (holdAmount <= 0) return null;
    if (reservation.fixed_price_hold_id) {
      const hold = await this.walletRepo.findWalletHoldById(reservation.fixed_price_hold_id);
      if (hold && (hold.status === 'held' || hold.status === 'captured')) return hold.id;
    }

    const wallet = await this.walletRepo.findByUserId(reservation.customer_id);
    if (!wallet) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Customer wallet not found for reservation hold.',
      });
    }
    const available = toNumber(wallet.balance);
    if (available < holdAmount) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance to hold reservation amount. Required ${toMoney(holdAmount)} EGP, available ${toMoney(available)} EGP.`,
        details: {
          requiredEgp: toMoney(holdAmount),
          availableEgp: toMoney(available),
          component: 'fixed_price_hold',
          customerId: reservation.customer_id,
          walletId: wallet.id,
        },
      });
    }

    let hold;
    try {
      hold = await this.walletRepo.createHoldInTransaction(
        client,
        wallet.id,
        reservation.customer_id,
        holdAmount,
        reservation.currency,
        'reservation',
        reservation.id,
        {
          reservationId: reservation.id,
          purpose: 'fixed_price',
          providerAmount: toNumber(reservation.expert_price_amount),
          platformFeeAmount: this.getReservationPlatformFeeAmount(reservation),
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance to hold reservation amount. Required ${toMoney(holdAmount)} EGP.`,
          details: {
            requiredEgp: toMoney(holdAmount),
            component: 'fixed_price_hold',
          },
        });
      }
      throw error;
    }
    await this.repo.updateReservation(reservation.id, { fixedPriceHoldId: hold.id }, client);
    return hold.id;
  }

  private async refundFixedHold(
    client: PoolClient,
    reservation: ReservationRow,
    reason: string,
  ): Promise<void> {
    const holdId = reservation.fixed_price_hold_id;
    if (!holdId) return;
    const hold = await this.walletRepo.findWalletHoldById(holdId);
    if (!hold || hold.status !== 'held') return;
    await this.walletRepo.releaseHoldInTransaction(client, holdId, reason, {
      reservationId: reservation.id,
      reason,
    });
  }

  private async applyDisputeSettlement(
    client: PoolClient,
    reservation: ReservationRow,
    input: ResolveDisputeInput,
  ): Promise<{
    settlementOutcome: 'refund' | 'release' | 'split' | 'none';
    refundAmount: number;
    capturedAmount: number;
    providerReleaseAmount: number;
    platformCommissionAmount: number;
    settlementStatus: Reservation['settlementStatus'];
  }> {
    const holdAmount = this.getReservationFixedHoldAmount(reservation);
    const settlementOutcome =
      input.settlementOutcome ?? this.inferDisputeSettlementOutcome(input.status);
    if (settlementOutcome === 'none' && holdAmount > 0 && reservation.fixed_price_hold_id) {
      throw new HttpError({
        statusCode: 400,
        code: 'DISPUTE_SETTLEMENT_REQUIRED',
        message: 'A dispute with held funds must be resolved with refund, release, or split.',
      });
    }
    if (settlementOutcome === 'none' || holdAmount <= 0 || !reservation.fixed_price_hold_id) {
      return {
        settlementOutcome,
        refundAmount: 0,
        capturedAmount: 0,
        providerReleaseAmount: 0,
        platformCommissionAmount: 0,
        settlementStatus: reservation.settlement_status as Reservation['settlementStatus'],
      };
    }
    const currentHold = await this.walletRepo.findWalletHoldById(reservation.fixed_price_hold_id);
    if (!currentHold || currentHold.status !== 'held') {
      throw new HttpError({
        statusCode: 409,
        code: 'RESERVATION_HOLD_ALREADY_SETTLED',
        message: 'Reservation hold is already settled.',
      });
    }

    if (settlementOutcome === 'refund') {
      await this.refundFixedHold(client, reservation, 'Dispute resolved with full customer refund');
      return {
        settlementOutcome,
        refundAmount: holdAmount,
        capturedAmount: 0,
        providerReleaseAmount: 0,
        platformCommissionAmount: 0,
        settlementStatus: 'refunded_to_customer',
      };
    }

    if (settlementOutcome === 'release') {
      const settings = await this.settingsService.getAppStatus();
      const split = computeCommissionSplit(
        holdAmount,
        settings.commissionPercent,
        settings.commissionMinEgp,
      );
      await this.releaseExpertFixedPayout(
        client,
        reservation,
        'Dispute resolved with full provider release',
      );
      return {
        settlementOutcome,
        refundAmount: 0,
        capturedAmount: holdAmount,
        providerReleaseAmount: holdAmount,
        platformCommissionAmount: split.commission,
        settlementStatus: 'released_to_provider',
      };
    }

    const refundAmount = toMoney(input.customerRefundAmount ?? 0);
    const providerReleaseAmount = toMoney(input.providerReleaseAmount ?? 0);
    if (refundAmount <= 0 && providerReleaseAmount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_DISPUTE_SPLIT',
        message:
          'Custom dispute split requires a customer refund amount or provider release amount.',
      });
    }
    if (refundAmount + providerReleaseAmount > holdAmount + 0.01) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_DISPUTE_SPLIT',
        message: 'Custom dispute split cannot exceed the held reservation amount.',
      });
    }

    await this.walletRepo.captureHoldInTransaction(
      client,
      reservation.fixed_price_hold_id,
      'Dispute resolved with custom split',
      {
        reservationId: reservation.id,
        customerRefundAmount: refundAmount,
        providerReleaseAmount,
      },
    );

    if (refundAmount > 0) {
      const customerWallet = await this.walletRepo.getOrCreateUserWalletInTransaction(
        client,
        reservation.customer_id,
      );
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        customerWallet.id,
        reservation.customer_id,
        refundAmount,
        'refund',
        'Reservation dispute split refund',
        'reservation',
        reservation.id,
      );
    }

    let platformCommissionAmount = 0;
    if (providerReleaseAmount > 0) {
      const settings = await this.settingsService.getAppStatus();
      const split = computeCommissionSplit(
        providerReleaseAmount,
        settings.commissionPercent,
        settings.commissionMinEgp,
      );
      platformCommissionAmount = split.commission;
      const providerWallet = await this.walletRepo.getOrCreateUserWalletInTransaction(
        client,
        reservation.provider_id,
      );
      if (split.providerAmount > 0) {
        await this.walletRepo.creditWithTypeInTransaction(
          client,
          providerWallet.id,
          reservation.provider_id,
          split.providerAmount,
          'payment',
          'Reservation dispute split provider release',
          'reservation',
          reservation.id,
        );
      }
      if (split.commission > 0) {
        const receiverId = settings.commissionReceiverId || PLATFORM_USER_ID;
        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          receiverId,
        );
        await this.walletRepo.creditWithTypeInTransaction(
          client,
          platformWalletId,
          receiverId,
          split.commission,
          'commission',
          'Reservation dispute split commission',
          'reservation',
          reservation.id,
        );
      }
    }

    return {
      settlementOutcome,
      refundAmount,
      capturedAmount: providerReleaseAmount,
      providerReleaseAmount,
      platformCommissionAmount,
      settlementStatus:
        refundAmount > 0 && providerReleaseAmount > 0
          ? 'partially_refunded'
          : refundAmount > 0
            ? 'refunded_to_customer'
            : 'released_to_provider',
    };
  }

  private inferDisputeSettlementOutcome(
    status: ResolveDisputeInput['status'],
  ): 'refund' | 'release' | 'split' | 'none' {
    if (status === 'resolved_customer') return 'refund';
    if (status === 'resolved_provider') return 'release';
    if (status === 'resolved_partial') return 'split';
    return 'release';
  }

  private async releaseExpertFixedPayout(
    client: PoolClient,
    reservation: ReservationRow,
    reason: string,
  ): Promise<void> {
    const holdId = reservation.fixed_price_hold_id;
    if (!holdId) return;
    const hold = await this.walletRepo.findWalletHoldById(holdId);
    if (!hold) return;
    // Idempotency: only a hold still in `held` state should ever be captured and
    // paid out. If it is already captured/released/cancelled, the payout has run
    // (or the funds are gone) and re-crediting would mint duplicate payouts.
    if (hold.status !== 'held') return;
    await this.walletRepo.captureHoldInTransaction(client, holdId, reason, {
      reservationId: reservation.id,
    });

    const amount = toMoney(toNumber(hold.amount));
    if (amount <= 0) return;

    let providerWallet = await this.walletRepo.findByUserId(reservation.provider_id);
    if (!providerWallet) {
      providerWallet = await this.walletRepo.createForUser(reservation.provider_id);
    }
    const settings = await this.settingsService.getAppStatus();
    const { commission, providerAmount } = this.computeReservationPayoutSplit(
      reservation,
      amount,
      settings.commissionPercent,
      settings.commissionMinEgp,
    );
    const receiverId = settings.commissionReceiverId || PLATFORM_USER_ID;
    const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, receiverId);

    if (providerAmount > 0) {
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        providerWallet.id,
        reservation.provider_id,
        providerAmount,
        'payment',
        'Reservation fixed payout release',
        'reservation',
        reservation.id,
      );
    }

    if (commission > 0) {
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        platformWalletId,
        receiverId,
        commission,
        'commission',
        'Reservation fixed payout commission',
        'reservation',
        reservation.id,
      );
    }
  }

  private computeReservationPayoutSplit(
    reservation: ReservationRow,
    heldAmount: number,
    commissionPercent: number,
    commissionMinEgp: number,
  ): { commission: number; providerAmount: number } {
    const policy = this.getPolicySnapshot(reservation);
    const pricing = policy.pricingBreakdown;
    const platformFee = toMoney(
      Math.min(heldAmount, this.getReservationPlatformFeeAmount(reservation)),
    );
    const providerGross = toMoney(Math.max(0, heldAmount - platformFee));
    const platformFundedAmount = toMoney(pricing?.couponPlatformFundedAmount ?? 0);
    const originalAmount = toMoney(
      (pricing?.originalServicePriceAmount ?? 0) + (pricing?.originalReservationPriceAmount ?? 0),
    );
    if (!pricing?.couponRedemptionId || originalAmount <= 0) {
      const split = computeCommissionSplit(providerGross, commissionPercent, commissionMinEgp);
      const commission = toMoney(Math.min(heldAmount, split.commission + platformFee));
      return {
        commission,
        providerAmount: toMoney(Math.max(0, heldAmount - commission)),
      };
    }

    const originalSplit = computeCommissionSplit(
      originalAmount,
      commissionPercent,
      commissionMinEgp,
    );
    const serviceCommission = toMoney(Math.max(0, originalSplit.commission - platformFundedAmount));
    const commission = toMoney(Math.min(heldAmount, serviceCommission + platformFee));
    return {
      commission,
      providerAmount: toMoney(Math.max(0, heldAmount - commission)),
    };
  }

  private async ensurePrejoinBalances(
    reservation: ReservationRow,
    minimumMinutes: number,
  ): Promise<{
    customerRemainingMinutes: number;
    providerRemainingMinutes: number;
  }> {
    const walletState = await this.getWalletMinuteState(reservation, minimumMinutes);
    if (!walletState.customerMeetsRequirement || !walletState.providerMeetsRequirement) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_PREJOIN_BALANCE',
        message: 'Both participants must satisfy minimum prejoin wallet requirement.',
        details: {
          minimumMinutes,
          customerRemainingMinutes: walletState.customerRemainingMinutes,
          providerRemainingMinutes: walletState.providerRemainingMinutes,
          customerMeetsRequirement: walletState.customerMeetsRequirement,
          providerMeetsRequirement: walletState.providerMeetsRequirement,
        },
      });
    }
    return {
      customerRemainingMinutes: walletState.customerRemainingMinutes,
      providerRemainingMinutes: walletState.providerRemainingMinutes,
    };
  }

  private async getWalletMinuteState(
    reservation: ReservationRow,
    minimumMinutes: number,
  ): Promise<{
    customerRemainingMinutes: number;
    providerRemainingMinutes: number;
    customerMeetsRequirement: boolean;
    providerMeetsRequirement: boolean;
  }> {
    const customerWallet = await this.walletRepo.findByUserId(reservation.customer_id);
    const providerWallet = await this.walletRepo.findByUserId(reservation.provider_id);
    const sideRate = toNumber(reservation.admin_minute_rate) / 2;
    const customerBalance = toNumber(customerWallet?.balance);
    const providerBalance = toNumber(providerWallet?.balance);
    const holdRequired =
      reservation.fixed_price_hold_id == null ? this.getReservationFixedHoldAmount(reservation) : 0;

    const customerAfterHold = Math.max(0, customerBalance - holdRequired);
    const customerRemainingMinutes =
      sideRate > 0 ? Math.floor(customerAfterHold / sideRate) : Number.MAX_SAFE_INTEGER;
    const providerRemainingMinutes =
      sideRate > 0 ? Math.floor(providerBalance / sideRate) : Number.MAX_SAFE_INTEGER;

    const customerMeetsRequirement = sideRate <= 0 || customerRemainingMinutes >= minimumMinutes;
    const providerMeetsRequirement = sideRate <= 0 || providerRemainingMinutes >= minimumMinutes;

    return {
      customerRemainingMinutes,
      providerRemainingMinutes,
      customerMeetsRequirement,
      providerMeetsRequirement,
    };
  }

  private async billMinutesInTransaction(
    client: PoolClient,
    reservation: ReservationRow,
    session: ReservationCallSessionRow,
  ): Promise<{
    session: ReservationCallSessionRow;
    lowBalanceAutoEnded: boolean;
  }> {
    if (session.status !== 'active') {
      return { session, lowBalanceAutoEnded: false };
    }
    const sideRatePerMinute = toNumber(reservation.admin_minute_rate) / 2;
    if (sideRatePerMinute <= 0) {
      const noChargeSession = await this.repo.updateCallSession(
        session.id,
        { lastBilledAt: new Date() },
        client,
      );
      return {
        session: noChargeSession ?? session,
        lowBalanceAutoEnded: false,
      };
    }

    const lastBilledAt = asDate(session.last_billed_at ?? session.billing_started_at);
    if (!lastBilledAt) {
      return { session, lowBalanceAutoEnded: false };
    }
    const now = new Date();
    const elapsedSeconds = Math.floor((now.getTime() - lastBilledAt.getTime()) / SECOND_MS);
    if (elapsedSeconds <= 0) {
      return { session, lowBalanceAutoEnded: false };
    }

    const wallets = await this.findWalletsForBilling(
      client,
      reservation.customer_id,
      reservation.provider_id,
    );
    const customerBalanceCents = this.egpToCents(toNumber(wallets.customer.balance));
    const providerBalanceCents = this.egpToCents(toNumber(wallets.provider.balance));
    const sideRateMilliPerMinute = Math.round(sideRatePerMinute * MILLI_PIASTER_PER_EGP);
    const customerCarryMilli = this.parseCarryMilliPiaster(session.customer_carry_milli_piaster);
    const providerCarryMilli = this.parseCarryMilliPiaster(session.provider_carry_milli_piaster);

    const customerMaxSeconds = this.maxBillableSecondsForBalance(
      sideRateMilliPerMinute,
      customerCarryMilli,
      customerBalanceCents,
      elapsedSeconds,
    );
    const providerMaxSeconds = this.maxBillableSecondsForBalance(
      sideRateMilliPerMinute,
      providerCarryMilli,
      providerBalanceCents,
      elapsedSeconds,
    );
    const secondsToBill = Math.max(
      0,
      Math.min(elapsedSeconds, customerMaxSeconds, providerMaxSeconds),
    );

    const customerCharge = this.computeSideChargeForSeconds(
      sideRateMilliPerMinute,
      customerCarryMilli,
      secondsToBill,
    );
    const providerCharge = this.computeSideChargeForSeconds(
      sideRateMilliPerMinute,
      providerCarryMilli,
      secondsToBill,
    );

    if (customerCharge.chargeCents > 0 || providerCharge.chargeCents > 0) {
      const customerCost = this.centsToEgp(customerCharge.chargeCents);
      const providerCost = this.centsToEgp(providerCharge.chargeCents);
      const receiverId = await this.getCommissionReceiverId();
      const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
        client,
        receiverId,
      );

      if (customerCharge.chargeCents > 0) {
        await this.walletRepo.debitWalletInTransaction(
          client,
          wallets.customer.id,
          reservation.customer_id,
          customerCost,
          `Online reservation usage fee (${secondsToBill}s)`,
          'reservation',
          reservation.id,
        );
      }
      if (providerCharge.chargeCents > 0) {
        await this.walletRepo.debitWalletInTransaction(
          client,
          wallets.provider.id,
          reservation.provider_id,
          providerCost,
          `Online reservation usage fee (${secondsToBill}s)`,
          'reservation',
          reservation.id,
        );
      }
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        platformWalletId,
        receiverId,
        this.centsToEgp(customerCharge.chargeCents + providerCharge.chargeCents),
        'commission',
        `Online reservation usage fee (${secondsToBill}s)`,
        'reservation',
        reservation.id,
      );
    }

    const billedSecondsTotal =
      (session.billed_seconds ?? session.billed_minutes * 60) + secondsToBill;
    const nextLastBilledAt = new Date(lastBilledAt.getTime() + secondsToBill * SECOND_MS);
    const updatedSession = await this.repo.updateCallSession(
      session.id,
      {
        lastBilledAt: nextLastBilledAt,
        billedSeconds: billedSecondsTotal,
        billedMinutes: Math.floor(billedSecondsTotal / 60),
        customerCarryMilliPiaster: customerCharge.carryMilli,
        providerCarryMilliPiaster: providerCharge.carryMilli,
      },
      client,
    );

    const lowBalanceAutoEnded = secondsToBill < elapsedSeconds;
    if (lowBalanceAutoEnded) {
      const heldAmount = this.getReservationFixedHoldAmount(reservation);
      await this.repo.updateCallSession(
        session.id,
        {
          status: 'ended',
          endedAt: new Date(),
          billingPausedAt: new Date(),
        },
        client,
      );
      await this.releaseExpertFixedPayout(client, reservation, 'Low balance automatic session end');
      await this.repo.updateReservation(
        reservation.id,
        {
          status: 'completed',
          endedAt: new Date(),
          completedAt: new Date(),
          capturedAmount: heldAmount,
          settlementStatus: heldAmount > 0 ? 'released_to_provider' : 'unsettled',
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.syncInterviewApplicationStatus(reservation, 'interview_completed', client);
      await this.repo.createEvent(
        {
          reservationId: reservation.id,
          eventType: 'hold_captured',
          actorId: null,
          metadata: {
            source: 'low_balance_auto_end',
            amount: heldAmount,
          },
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId: reservation.id,
          eventType: 'completed',
          actorId: null,
          metadata: { source: 'low_balance_auto_end' },
        },
        client,
      );
    }

    return {
      session: updatedSession ?? session,
      lowBalanceAutoEnded,
    };
  }

  private async processDueDisconnectAutoRelease(limit: number): Promise<number> {
    const pool = getPool();
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const client = await pool.connect();
      let notifyReservation: ReservationRow | null = null;
      let notifyMessage: string | null = null;
      try {
        await client.query('BEGIN');
        const reservation = await this.findDueDisconnectReservationForUpdate(client);
        if (!reservation) {
          await client.query('COMMIT');
          break;
        }

        const session = await this.findCallSessionByReservationForUpdate(client, reservation.id);
        if (session?.status === 'active') {
          const billed = await this.billMinutesInTransaction(client, reservation, session);
          if (billed.lowBalanceAutoEnded) {
            await client.query('COMMIT');
            processed += 1;
            notifyReservation = reservation;
            notifyMessage = 'Call ended automatically because one participant had low balance.';
            continue;
          }
        }

        const heldAmount = this.getReservationFixedHoldAmount(reservation);
        await this.releaseExpertFixedPayout(client, reservation, 'Disconnect timeout auto release');
        await this.repo.updateReservation(
          reservation.id,
          {
            status: 'completed',
            endedAt: new Date(),
            completedAt: new Date(),
            capturedAmount: heldAmount,
            settlementStatus: heldAmount > 0 ? 'released_to_provider' : 'unsettled',
            customerDoneDueAt: null,
            donePromptedAt: null,
            disconnectAutoReleaseAt: null,
          },
          client,
        );
        await this.syncInterviewApplicationStatus(reservation, 'interview_completed', client);
        if (session && session.status !== 'ended') {
          await this.repo.updateCallSession(
            session.id,
            {
              status: 'ended',
              endedAt: new Date(),
            },
            client,
          );
        }
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'hold_captured',
            actorId: null,
            metadata: {
              source: 'disconnect_timeout',
              amount: heldAmount,
            },
          },
          client,
        );
        await this.repo.createEvent(
          {
            reservationId: reservation.id,
            eventType: 'completed',
            actorId: null,
            metadata: { source: 'disconnect_timeout' },
          },
          client,
        );
        await client.query('COMMIT');
        processed += 1;
        notifyReservation = reservation;
        notifyMessage =
          'Session stayed disconnected for over 3 hours. Reservation auto-completed and fixed payout was released.';
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      if (notifyReservation && notifyMessage) {
        await this.sendReservationMessage(
          notifyReservation,
          notifyMessage,
          notifyReservation.provider_id,
        );
      }
    }
    return processed;
  }

  private async processDueOfflineDonePrompts(limit: number): Promise<number> {
    const pool = getPool();
    let processed = 0;
    for (let i = 0; i < limit; i += 1) {
      const client = await pool.connect();
      let notifyReservation: ReservationRow | null = null;
      try {
        await client.query('BEGIN');
        const reservation = await this.findDueDonePromptReservationForUpdate(client);
        if (!reservation) {
          await client.query('COMMIT');
          break;
        }
        await this.repo.updateReservation(
          reservation.id,
          {
            donePromptedAt: new Date(),
          },
          client,
        );
        await client.query('COMMIT');
        processed += 1;
        notifyReservation = reservation;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }

      if (notifyReservation) {
        await this.sendReservationMessage(
          notifyReservation,
          'Customer confirmation is overdue. Please choose Done or Report now.',
          notifyReservation.provider_id,
        );
      }
    }
    return processed;
  }

  private async handleDisconnectAutoReleaseIfDue(reservationId: string): Promise<void> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation || !reservation.disconnect_auto_release_at) return;
    const dueAt = new Date(reservation.disconnect_auto_release_at);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() > Date.now()) return;

    const session = await this.repo.getCallSessionByReservation(reservationId);
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      if (!reservationForUpdate) {
        await client.query('ROLLBACK');
        return;
      }
      // Guard against re-settling an already-finalized reservation (stale
      // disconnect_auto_release_at). Only active/in-progress reservations should
      // be auto-released here.
      if (
        reservationForUpdate.status === 'completed' ||
        reservationForUpdate.status === 'cancelled' ||
        !reservationForUpdate.disconnect_auto_release_at
      ) {
        await client.query('ROLLBACK');
        return;
      }
      if (session?.status === 'active') {
        await this.billMinutesInTransaction(client, reservationForUpdate, session);
      }
      const heldAmount = this.getReservationFixedHoldAmount(reservationForUpdate);
      await this.releaseExpertFixedPayout(
        client,
        reservationForUpdate,
        'Disconnect timeout auto release',
      );
      await this.repo.updateReservation(
        reservationId,
        {
          status: 'completed',
          completedAt: new Date(),
          endedAt: new Date(),
          capturedAmount: heldAmount,
          settlementStatus: heldAmount > 0 ? 'released_to_provider' : 'unsettled',
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
        client,
      );
      await this.syncInterviewApplicationStatus(
        reservationForUpdate,
        'interview_completed',
        client,
      );
      if (session) {
        await this.repo.updateCallSession(
          session.id,
          {
            status: 'ended',
            endedAt: new Date(),
          },
          client,
        );
      }
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'hold_captured',
          actorId: null,
          metadata: {
            source: 'disconnect_timeout',
            amount: heldAmount,
          },
        },
        client,
      );
      await this.repo.createEvent(
        {
          reservationId,
          eventType: 'completed',
          actorId: null,
          metadata: { source: 'disconnect_timeout' },
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

  private async handleOfflineDonePromptIfDue(reservationId: string): Promise<void> {
    const reservation = await this.repo.findReservationById(reservationId);
    if (!reservation) return;
    const dueAt = reservation.customer_done_due_at
      ? new Date(reservation.customer_done_due_at)
      : null;
    if (!dueAt || Number.isNaN(dueAt.getTime()) || dueAt.getTime() > Date.now()) return;
    if (reservation.status !== 'waiting_customer_done' || reservation.done_prompted_at) return;

    const pool = getPool();
    const client = await pool.connect();
    let promptSent = false;
    try {
      await client.query('BEGIN');
      const reservationForUpdate = await this.findReservationForUpdate(client, reservationId);
      if (!reservationForUpdate) {
        await client.query('COMMIT');
        return;
      }
      const upToDateDueAt = reservationForUpdate.customer_done_due_at
        ? new Date(reservationForUpdate.customer_done_due_at)
        : null;
      const isDue =
        upToDateDueAt != null &&
        !Number.isNaN(upToDateDueAt.getTime()) &&
        upToDateDueAt.getTime() <= Date.now();
      if (
        reservationForUpdate.status !== 'waiting_customer_done' ||
        reservationForUpdate.done_prompted_at ||
        !isDue
      ) {
        await client.query('COMMIT');
        return;
      }
      await this.repo.updateReservation(
        reservationId,
        {
          donePromptedAt: new Date(),
        },
        client,
      );
      await client.query('COMMIT');
      promptSent = true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (promptSent) {
      const refreshed = await this.repo.findReservationById(reservationId);
      if (refreshed) {
        await this.sendReservationMessage(
          refreshed,
          'Customer confirmation is overdue. Please choose Done or Report now.',
          refreshed.provider_id,
        );
      }
    }
  }

  private async findReservationForUpdate(
    client: PoolClient,
    reservationId: string,
  ): Promise<ReservationRow | null> {
    const { rows } = await client.query<ReservationRow>(
      `SELECT * FROM reservations WHERE id = $1 FOR UPDATE`,
      [reservationId],
    );
    return rows[0] ?? null;
  }

  private async findDueDisconnectReservationForUpdate(
    client: PoolClient,
  ): Promise<ReservationRow | null> {
    const { rows } = await client.query<ReservationRow>(
      `SELECT *
       FROM reservations
       WHERE disconnect_auto_release_at IS NOT NULL
         AND disconnect_auto_release_at <= now()
         AND status IN ('in_session', 'waiting_customer_done')
       ORDER BY disconnect_auto_release_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    return rows[0] ?? null;
  }

  private async findDueDonePromptReservationForUpdate(
    client: PoolClient,
  ): Promise<ReservationRow | null> {
    const { rows } = await client.query<ReservationRow>(
      `SELECT *
       FROM reservations
       WHERE status = 'waiting_customer_done'
         AND customer_done_due_at IS NOT NULL
         AND customer_done_due_at <= now()
         AND done_prompted_at IS NULL
       ORDER BY customer_done_due_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    return rows[0] ?? null;
  }

  private async findSlotForUpdate(
    client: PoolClient,
    slotId: string,
  ): Promise<ReservationSlotRow | null> {
    const { rows } = await client.query<ReservationSlotRow>(
      `SELECT * FROM reservation_slots WHERE id = $1 FOR UPDATE`,
      [slotId],
    );
    return rows[0] ?? null;
  }

  private async findCallSessionByReservationForUpdate(
    client: PoolClient,
    reservationId: string,
  ): Promise<ReservationCallSessionRow | null> {
    const { rows } = await client.query<ReservationCallSessionRow>(
      `SELECT *
       FROM reservation_call_sessions
       WHERE reservation_id = $1
       FOR UPDATE`,
      [reservationId],
    );
    return rows[0] ?? null;
  }

  private async updateSlotStatusInTransaction(
    client: PoolClient,
    slotId: string,
    status: 'available' | 'booked' | 'blocked',
  ): Promise<ReservationSlotRow | null> {
    const { rows } = await client.query<ReservationSlotRow>(
      `UPDATE reservation_slots
       SET status = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [slotId, status],
    );
    return rows[0] ?? null;
  }

  private async findCallSessionForUpdate(
    client: PoolClient,
    sessionId: string,
  ): Promise<ReservationCallSessionRow | null> {
    const { rows } = await client.query<ReservationCallSessionRow>(
      `SELECT * FROM reservation_call_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    return rows[0] ?? null;
  }

  private async findWalletsForBilling(
    client: PoolClient,
    customerId: string,
    providerId: string,
  ): Promise<{
    customer: { id: string; balance: string };
    provider: { id: string; balance: string };
  }> {
    const { rows } = await client.query<{ id: string; user_id: string; balance: string }>(
      `SELECT id, user_id, balance::text
       FROM wallets
       WHERE user_id IN ($1, $2)
       FOR UPDATE`,
      [customerId, providerId],
    );
    const customer = rows.find((r) => r.user_id === customerId);
    const provider = rows.find((r) => r.user_id === providerId);

    if (!customer) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Customer wallet is required for online minute billing.',
      });
    }
    if (!provider) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Provider wallet is required for online minute billing.',
      });
    }
    return { customer, provider };
  }

  private parseCarryMilliPiaster(value: string | number | null | undefined): number {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    }
    if (!value) return 0;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, parsed);
  }

  private egpToCents(amount: number): number {
    return Math.max(0, Math.floor(amount * 100 + 1e-6));
  }

  private centsToEgp(cents: number): number {
    return Number((Math.max(0, cents) / 100).toFixed(2));
  }

  private computeSideChargeForSeconds(
    rateMilliPerMinute: number,
    carryMilli: number,
    seconds: number,
  ): { chargeCents: number; carryMilli: number } {
    if (seconds <= 0 || rateMilliPerMinute <= 0) {
      return { chargeCents: 0, carryMilli: Math.max(0, carryMilli) };
    }
    const incrementMilli = Math.round((rateMilliPerMinute * seconds) / 60);
    const totalMilli = Math.max(0, carryMilli + incrementMilli);
    const chargeCents = Math.floor(totalMilli / MILLI_PIASTER_PER_PIASTER);
    const nextCarryMilli = totalMilli - chargeCents * MILLI_PIASTER_PER_PIASTER;
    return { chargeCents, carryMilli: nextCarryMilli };
  }

  private maxBillableSecondsForBalance(
    rateMilliPerMinute: number,
    carryMilli: number,
    balanceCents: number,
    elapsedSeconds: number,
  ): number {
    if (elapsedSeconds <= 0) return 0;
    if (rateMilliPerMinute <= 0) return elapsedSeconds;
    if (balanceCents <= 0) return 0;

    let low = 0;
    let high = elapsedSeconds;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const projected = this.computeSideChargeForSeconds(rateMilliPerMinute, carryMilli, mid);
      if (projected.chargeCents <= balanceCents) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  private isSlotOverlapError(error: unknown): boolean {
    const pgError = error as { code?: string; constraint?: string };
    return (
      pgError?.code === '23P01' || pgError?.constraint === 'reservation_slots_no_overlap_active'
    );
  }

  private async sendReservationMessage(
    reservation: ReservationRow | Reservation,
    body: string,
    actorId: string,
  ): Promise<void> {
    const conversationId =
      'conversation_id' in reservation ? reservation.conversation_id : reservation.conversationId;
    if (!conversationId) return;
    const customerId =
      'customer_id' in reservation ? reservation.customer_id : reservation.customerId;
    const providerId =
      'provider_id' in reservation ? reservation.provider_id : reservation.providerId;
    const senderId = actorId === customerId || actorId === providerId ? actorId : providerId;
    try {
      const payload: Parameters<ChatRepository['sendMessage']>[2] = {
        body: `[Reservation] ${body}`,
        messageType: 'text',
      };
      await this.chatRepo.sendMessage(conversationId, senderId, payload);
    } catch {
      // Messaging should never break reservation state transitions.
    }
  }
}
