import { randomInt } from 'node:crypto';

import type {
  Reservation,
  ReservationCallParticipant,
  ReservationCallSession,
  ReservationDispute,
  ReservationLocationProposal,
  ReservationProfile,
  ReservationSlot,
} from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { buildAgoraRtcToken } from '../../lib/agora-token.js';
import { HttpError } from '../../utils/http-error.js';

import { ChatRepository } from '../chat/chat.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { ReservationsRepository } from './reservations.repository.js';
import type {
  ReservationCallParticipantRow,
  ReservationCallSessionRow,
  ReservationDisputeRow,
  ReservationLocationProposalRow,
  ReservationProfileRow,
  ReservationRow,
  ReservationSlotRow,
} from './reservations.repository.js';
import type {
  CallExtensionInput,
  CallHeartbeatInput,
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
const DISCONNECT_AUTO_RELEASE_HOURS = 3;
const OFFLINE_DONE_TIMEOUT_HOURS = 6;
const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;
const PIASTER_PER_EGP = 100;
const MILLI_PIASTER_PER_PIASTER = 1_000;
const MILLI_PIASTER_PER_EGP = PIASTER_PER_EGP * MILLI_PIASTER_PER_PIASTER;
const AGORA_TOKEN_EXPIRY_SECONDS = 7_200;
const LIFECYCLE_SWEEP_LOCK_KEY = 6_310_019;

const toNumber = (value: string | number | null | undefined): number => {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

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
});

const mapSlot = (row: ReservationSlotRow): ReservationSlot => ({
  id: row.id,
  providerId: row.provider_id,
  startAt: row.start_at,
  endAt: row.end_at,
  status: row.status as ReservationSlot['status'],
  supportsOnline: row.supports_online,
  supportsOffline: row.supports_offline,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapReservation = (row: ReservationRow): Reservation => {
  const mapped: Reservation = {
    id: row.id,
    customerId: row.customer_id,
    providerId: row.provider_id,
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
  ) {}

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
    if (input.onlineVoicePrice !== undefined) profileUpdates.onlineVoicePrice = input.onlineVoicePrice;
    if (input.onlineVideoPrice !== undefined) profileUpdates.onlineVideoPrice = input.onlineVideoPrice;
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
    const providerId = this.resolveProviderIdForSlots(params.userId, params.role, params.providerId);
    const rows = await this.repo.listSlots(providerId, params.from, params.to, params.availableOnly);
    return { items: rows.map(mapSlot) };
  }

  async createSlot(
    userId: string,
    role: string,
    input: CreateReservationSlotInput,
  ): Promise<ReservationSlot> {
    this.ensureProviderRole(role);
    try {
      const slot = await this.repo.createSlot(userId, {
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        supportsOnline: input.supportsOnline ?? true,
        supportsOffline: input.supportsOffline ?? true,
      });
      return mapSlot(slot);
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

  async updateSlot(
    userId: string,
    role: string,
    slotId: string,
    input: UpdateReservationSlotInput,
  ): Promise<ReservationSlot> {
    this.ensureProviderRole(role);
    const slot = await this.repo.findSlotById(slotId);
    if (!slot || slot.provider_id !== userId) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Reservation slot not found.',
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
    if (!slot || slot.provider_id !== userId) {
      throw new HttpError({
        statusCode: 404,
        code: 'SLOT_NOT_FOUND',
        message: 'Reservation slot not found.',
      });
    }
    const deleted = await this.repo.deleteSlot(slotId);
    return { deleted };
  }

  async createReservation(customerId: string, input: CreateReservationInput): Promise<Reservation> {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Reservations are temporarily unavailable.',
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

    const expertPrice = this.getExpertPriceByType(profile, input.mode, input.onlineType);
    const adminMinuteRate =
      input.mode === 'online'
        ? input.onlineType === 'video'
          ? status.reservationVideoMinuteRate
          : status.reservationVoiceMinuteRate
        : 0;

    const createInput: Parameters<ReservationsRepository['createReservation']>[0] = {
      customerId,
      providerId: input.providerId,
      slotId: input.slotId,
      mode: input.mode,
      requestedStartAt: new Date(slot.start_at),
      requestedEndAt: new Date(slot.end_at),
      expertPriceAmount: expertPrice,
      currency: profile.currency || 'EGP',
      adminAcceptanceFee: status.reservationAcceptanceFee,
      adminMinuteRate,
    };
    if (input.serviceId !== undefined) createInput.serviceId = input.serviceId;
    if (input.mode === 'online' && input.onlineType !== undefined) {
      createInput.onlineType = input.onlineType;
    }
    const reservation = await this.repo.createReservation(createInput);

    if (profile.auto_accept) {
      return this.decideReservationInternal({
        reservationId: reservation.id,
        providerId: input.providerId,
        decision: 'accept',
        rejectionReason: null,
        autoDecision: true,
      });
    }

    return mapReservation(reservation);
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
      role === 'provider' || role === 'expert' || role === 'business' ? 'provider' : 'customer';
    const { rows, total } = await this.repo.listReservationsByUser(userId, normalizedRole, page, limit);
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
  ): Promise<Reservation> {
    return this.decideReservationInternal({
      reservationId,
      providerId,
      decision: input.decision,
      rejectionReason: input.rejectionReason?.trim() || null,
      autoDecision: false,
    });
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
    if (!['accepted', 'awaiting_start', 'waiting_customer_done', 'in_session'].includes(reservation.status)) {
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
    return mapLocationProposal(proposal);
  }

  async listLocationProposals(userId: string, reservationId: string): Promise<ReservationLocationProposal[]> {
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

      decided = await this.repo.respondLocationProposal(input.proposalId, input.decision, userId, client);
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
      proposal: mapLocationProposal(decided!),
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
    if (!['accepted', 'awaiting_start', 'in_session', 'waiting_customer_done'].includes(reservation.status)) {
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
    const otherCode = await this.repo.getCheckinCodeByCode(reservationId, input.counterpartyCode.trim());
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
            customerDoneDueAt: dueAt,
            donePromptedAt: null,
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
      await this.sendReservationMessage(updatedReservation, 'Reservation was reported and moved to dispute.', userId);
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
      await this.releaseExpertFixedPayout(client, reservationForUpdate, 'Reservation marked done by customer');
      await this.repo.updateReservation(
        reservationId,
        {
          status: 'completed',
          completedAt: new Date(),
          endedAt: new Date(),
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
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

    await this.handleDisconnectAutoReleaseIfDue(reservation.id);

    const currentReservation = await this.requireReservationForParticipant(reservationId, userId);
    const settings = await this.settingsService.getAppStatus();
    await this.ensurePrejoinBalances(currentReservation, settings.reservationMinPrejoinMinutes);

    const channel = `reservation_${reservationId.replace(/-/g, '')}`;
    const session = await this.repo.createCallSession(reservationId, channel);
    const uid = this.computeAgoraUid(userId);

    const pool = getPool();
    const client = await pool.connect();
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

      await this.repo.upsertCallParticipant(session.id, userId, uid, true);
      const participants = await this.repo.listCallParticipants(session.id);
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
            disconnectAutoReleaseAt: null,
          },
          client,
        );
      }

      await client.query('COMMIT');

      if (bothConnected) {
        await this.sendReservationMessage(
          reservationForUpdate,
          'Both participants joined the online session. Billing timer started.',
          userId,
        );
      }

      const snapshot = await this.getCallSnapshot(userId, reservationId);
      const token = buildAgoraRtcToken({
        appId: env.AGORA_APP_ID,
        appCertificate: env.AGORA_APP_CERTIFICATE,
        channelName: channel,
        uid,
        expiresInSeconds: AGORA_TOKEN_EXPIRY_SECONDS,
      });
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
      await client.query('ROLLBACK');
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
      );

      let activeSession = sessionForUpdate;
      if (sessionForUpdate.status === 'active') {
        const billingResult = await this.billMinutesInTransaction(client, reservationForUpdate, sessionForUpdate);
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
              activeSession.extension_status === 'none' ? 'pending' : activeSession.extension_status,
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

      const participants = await this.repo.listCallParticipants(session.id);
      const connectedParticipants = participants.filter((p) => p.is_connected);
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
            const releaseAt = new Date(now.getTime() + DISCONNECT_AUTO_RELEASE_HOURS * 60 * MINUTE_MS);
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
      await this.sendReservationMessage(
        reservation,
        'Session extension request rejected.',
        userId,
      );
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
        const billed = await this.billMinutesInTransaction(client, reservationForUpdate, sessionForUpdate);
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
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
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
    const walletState = await this.getWalletMinuteState(reservation, settings.reservationMinPrejoinMinutes);

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
  }> {
    const pool = getPool();
    const lock = await pool.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS locked`,
      [LIFECYCLE_SWEEP_LOCK_KEY],
    );
    if (!lock.rows[0]?.locked) {
      return { disconnectReleased: 0, donePrompted: 0 };
    }

    try {
      const disconnectReleased = await this.processDueDisconnectAutoRelease(100);
      const donePrompted = await this.processDueOfflineDonePrompts(100);
      return { disconnectReleased, donePrompted };
    } finally {
      await pool.query(`SELECT pg_advisory_unlock($1)`, [LIFECYCLE_SWEEP_LOCK_KEY]);
    }
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

  async resolveDispute(
    userId: string,
    role: string,
    disputeId: string,
    input: ResolveDisputeInput,
  ): Promise<ReservationDispute> {
    this.ensureAdminRole(userId, role);
    const dispute = await this.repo.resolveDispute(
      disputeId,
      input.status,
      input.resolutionNotes?.trim() || null,
      userId,
    );
    if (!dispute) {
      throw new HttpError({
        statusCode: 404,
        code: 'DISPUTE_NOT_FOUND',
        message: 'Dispute not found.',
      });
    }
    return mapDispute(dispute);
  }

  private async getCommissionReceiverId(): Promise<string> {
    const status = await this.settingsService.getAppStatus();
    return status.commissionReceiverId || PLATFORM_USER_ID;
  }

  private ensureProviderRole(role: string): void {
    if (role !== 'expert' && role !== 'business') {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This action is only available to experts and businesses.',
      });
    }
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

  private resolveProviderIdForSlots(
    userId: string,
    role: string,
    providerId?: string,
  ): string {
    if (providerId) return providerId;
    if (role === 'expert' || role === 'business') return userId;
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

  private displayNameForParticipant(reservation: ReservationRow | Reservation, userId: string): string {
    if ((reservation as ReservationRow).customer_id === userId || (reservation as Reservation).customerId === userId) {
      return (reservation as ReservationRow).customer_name ?? (reservation as Reservation).customerName ?? 'Customer';
    }
    return (reservation as ReservationRow).provider_name ?? (reservation as Reservation).providerName ?? 'Provider';
  }

  private computeAgoraUid(userId: string): number {
    const compact = userId.replace(/-/g, '');
    const slice = compact.slice(-9);
    const numeric = Number.parseInt(slice, 16);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
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
        await this.repo.updateReservation(
          params.reservationId,
          {
            status: 'rejected',
            rejectionReason: rejectionReason ?? 'Rejected by provider',
            autoRejected: params.autoDecision,
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
        } else {
          await this.updateSlotStatusInTransaction(client, slot.id, 'booked');
          await this.chargeAcceptanceFee(client, reservation);
          await this.repo.updateReservation(
            params.reservationId,
            {
              status: 'accepted',
              acceptedAt: new Date(),
              rejectionReason: null,
              autoRejected: false,
            },
            client,
          );
          accepted = true;
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
      await this.sendReservationMessage(
        reservation,
        reservation.mode === 'online'
          ? `Reservation accepted. Online ${reservation.online_type ?? 'voice'} session ready.`
          : 'Reservation accepted. You can now coordinate offline details in chat.',
        params.providerId,
      );
      return mapReservation(reservation);
    }

    if (rejectedBySlotConflict) {
      await this.sendReservationMessage(
        updated,
        rejectionReason ?? 'Reservation rejected due to slot conflict.',
        params.providerId,
      );
    } else if (params.decision === 'reject') {
      await this.sendReservationMessage(
        updated,
        `Reservation rejected${rejectionReason ? `: ${rejectionReason}` : '.'}`,
        params.providerId,
      );
    }

    return mapReservation(updated);
  }

  private async chargeAcceptanceFee(client: PoolClient, reservation: ReservationRow): Promise<void> {
    const fee = toNumber(reservation.admin_acceptance_fee);
    if (fee <= 0) return;

    const customerWallet = await this.walletRepo.findByUserId(reservation.customer_id);
    if (!customerWallet) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Customer wallet is required to pay reservation acceptance fee.',
      });
    }

    const receiverId = await this.getCommissionReceiverId();

    const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, receiverId);
    await this.walletRepo.debitWalletInTransaction(
      client,
      customerWallet.id,
      reservation.customer_id,
      fee,
      'Reservation acceptance fee',
      'reservation',
      reservation.id,
    );
    await this.walletRepo.creditWithTypeInTransaction(
      client,
      platformWalletId,
      receiverId,
      fee,
      'commission',
      'Reservation acceptance fee',
      'reservation',
      reservation.id,
    );
  }

  private async ensureFixedPriceHold(
    client: PoolClient,
    reservation: ReservationRow,
  ): Promise<string | null> {
    const holdAmount = toNumber(reservation.expert_price_amount);
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

    const hold = await this.walletRepo.createHoldInTransaction(
      client,
      wallet.id,
      reservation.customer_id,
      holdAmount,
      reservation.currency,
      'reservation',
      reservation.id,
      { reservationId: reservation.id, purpose: 'fixed_price' },
    );
    await this.repo.updateReservation(
      reservation.id,
      { fixedPriceHoldId: hold.id },
      client,
    );
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

  private async releaseExpertFixedPayout(
    client: PoolClient,
    reservation: ReservationRow,
    reason: string,
  ): Promise<void> {
    const holdId = reservation.fixed_price_hold_id;
    if (!holdId) return;
    const hold = await this.walletRepo.findWalletHoldById(holdId);
    if (!hold) return;
    if (hold.status === 'released' || hold.status === 'cancelled') return;
    if (hold.status === 'held') {
      await this.walletRepo.captureHoldInTransaction(client, holdId, reason, {
        reservationId: reservation.id,
      });
    }

    const amount = toNumber(reservation.expert_price_amount);
    if (amount <= 0) return;

    let providerWallet = await this.walletRepo.findByUserId(reservation.provider_id);
    if (!providerWallet) {
      providerWallet = await this.walletRepo.createForUser(reservation.provider_id);
    }
    const settings = await this.settingsService.getAppStatus();
    const commission = Math.max(
      amount * (settings.commissionPercent / 100),
      settings.commissionMinEgp,
    );
    const providerAmount = Math.max(0, amount - commission);
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
      reservation.fixed_price_hold_id == null ? toNumber(reservation.expert_price_amount) : 0;

    const customerAfterHold = Math.max(0, customerBalance - holdRequired);
    const customerRemainingMinutes =
      sideRate > 0 ? Math.floor(customerAfterHold / sideRate) : Number.MAX_SAFE_INTEGER;
    const providerRemainingMinutes =
      sideRate > 0 ? Math.floor(providerBalance / sideRate) : Number.MAX_SAFE_INTEGER;

    const customerMeetsRequirement =
      sideRate <= 0 || customerRemainingMinutes >= minimumMinutes;
    const providerMeetsRequirement =
      sideRate <= 0 || providerRemainingMinutes >= minimumMinutes;

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

    const wallets = await this.findWalletsForBilling(client, reservation.customer_id, reservation.provider_id);
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
    const secondsToBill = Math.max(0, Math.min(elapsedSeconds, customerMaxSeconds, providerMaxSeconds));

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
      const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, receiverId);

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

    const billedSecondsTotal = (session.billed_seconds ?? session.billed_minutes * 60) + secondsToBill;
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
      await this.repo.updateCallSession(
        session.id,
        {
          status: 'ended',
          endedAt: new Date(),
          billingPausedAt: new Date(),
        },
        client,
      );
      await this.releaseExpertFixedPayout(
        client,
        reservation,
        'Low balance automatic session end',
      );
      await this.repo.updateReservation(
        reservation.id,
        {
          status: 'completed',
          endedAt: new Date(),
          completedAt: new Date(),
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
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

        await this.releaseExpertFixedPayout(client, reservation, 'Disconnect timeout auto release');
        await this.repo.updateReservation(
          reservation.id,
          {
            status: 'completed',
            endedAt: new Date(),
            completedAt: new Date(),
            customerDoneDueAt: null,
            donePromptedAt: null,
            disconnectAutoReleaseAt: null,
          },
          client,
        );
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
        await this.sendReservationMessage(notifyReservation, notifyMessage, notifyReservation.provider_id);
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
      if (session?.status === 'active') {
        await this.billMinutesInTransaction(client, reservationForUpdate, session);
      }
      await this.releaseExpertFixedPayout(client, reservationForUpdate, 'Disconnect timeout auto release');
      await this.repo.updateReservation(
        reservationId,
        {
          status: 'completed',
          completedAt: new Date(),
          endedAt: new Date(),
          customerDoneDueAt: null,
          donePromptedAt: null,
          disconnectAutoReleaseAt: null,
        },
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
    const dueAt = reservation.customer_done_due_at ? new Date(reservation.customer_done_due_at) : null;
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

  private async findSlotForUpdate(client: PoolClient, slotId: string): Promise<ReservationSlotRow | null> {
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
      pgError?.code === '23P01' ||
      pgError?.constraint === 'reservation_slots_no_overlap_active'
    );
  }

  private async sendReservationMessage(
    reservation: ReservationRow | Reservation,
    body: string,
    actorId: string,
  ): Promise<void> {
    const conversationId = 'conversation_id' in reservation ? reservation.conversation_id : reservation.conversationId;
    if (!conversationId) return;
    const customerId = 'customer_id' in reservation ? reservation.customer_id : reservation.customerId;
    const providerId = 'provider_id' in reservation ? reservation.provider_id : reservation.providerId;
    const senderId = actorId === customerId || actorId === providerId ? actorId : providerId;
    try {
      await this.chatRepo.sendMessage(conversationId, senderId, `[Reservation] ${body}`);
    } catch {
      // Messaging should never break reservation state transitions.
    }
  }
}
