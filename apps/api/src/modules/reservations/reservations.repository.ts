import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

export type ReservationProfileRow = {
  provider_id: string;
  auto_accept: boolean;
  online_voice_price: string;
  online_video_price: string;
  offline_price: string;
  currency: string;
  created_at: string;
  updated_at: string;
  platform_verified_at?: string | null;
};

export type ReservationSlotRow = {
  id: string;
  provider_id: string;
  start_at: string;
  end_at: string;
  status: string;
  supports_online: boolean;
  supports_offline: boolean;
  created_at: string;
  updated_at: string;
};

export type ReservationRow = {
  id: string;
  customer_id: string;
  provider_id: string;
  service_id: string | null;
  slot_id: string | null;
  mode: string;
  online_type: string | null;
  status: string;
  requested_start_at: string;
  requested_end_at: string;
  expert_price_amount: string;
  currency: string;
  admin_acceptance_fee: string;
  admin_minute_rate: string;
  fixed_price_hold_id: string | null;
  rejection_reason: string | null;
  auto_rejected: boolean;
  suggested_slots: Array<{ startAt: string; endAt: string }>;
  conversation_id: string | null;
  final_location_text: string | null;
  final_location_lat: string | null;
  final_location_lng: string | null;
  accepted_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  completed_at: string | null;
  customer_done_due_at: string | null;
  done_prompted_at: string | null;
  disconnect_auto_release_at: string | null;
  created_at: string;
  updated_at: string;
  provider_name?: string;
  customer_name?: string;
  service_title?: string | null;
};

export type ReservationLocationProposalRow = {
  id: string;
  reservation_id: string;
  proposed_by: string;
  location_text: string;
  lat: string | null;
  lng: string | null;
  status: string;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
};

export type ReservationCheckinCodeRow = {
  id: string;
  reservation_id: string;
  user_id: string;
  code: string;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
};

export type ReservationCallSessionRow = {
  id: string;
  reservation_id: string;
  agora_channel: string;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  paused_at: string | null;
  billing_started_at: string | null;
  billing_paused_at: string | null;
  last_billed_at: string | null;
  billed_minutes: number;
  billed_seconds: number;
  customer_carry_milli_piaster: string;
  provider_carry_milli_piaster: string;
  extension_status: string;
  extension_requested_by: string | null;
  extension_until: string | null;
  created_at: string;
  updated_at: string;
};

export type ReservationCallParticipantRow = {
  id: string;
  call_session_id: string;
  user_id: string;
  agora_uid: number;
  joined_at: string | null;
  left_at: string | null;
  is_connected: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReservationDisputeRow = {
  id: string;
  reservation_id: string;
  opened_by: string | null;
  reason: string;
  description: string | null;
  status: string;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export class ReservationsRepository {
  async getProfile(providerId: string): Promise<ReservationProfileRow | null> {
    const { rows } = await getPool().query<ReservationProfileRow>(
      `SELECT rp.*, u.platform_verified_at
       FROM reservation_profiles rp
       JOIN users u ON u.id = rp.provider_id
       WHERE rp.provider_id = $1`,
      [providerId],
    );
    return rows[0] ?? null;
  }

  async upsertProfile(
    providerId: string,
    input: Partial<{
      autoAccept: boolean;
      onlineVoicePrice: number;
      onlineVideoPrice: number;
      offlinePrice: number;
      currency: string;
    }>,
  ): Promise<ReservationProfileRow> {
    const { rows } = await getPool().query<ReservationProfileRow>(
      `INSERT INTO reservation_profiles (provider_id, auto_accept, online_voice_price, online_video_price, offline_price, currency)
        VALUES ($1, COALESCE($2, false), COALESCE($3, 0), COALESCE($4, 0), COALESCE($5, 0), COALESCE($6, 'USD'))
       ON CONFLICT (provider_id)
       DO UPDATE SET
         auto_accept = COALESCE($2, reservation_profiles.auto_accept),
         online_voice_price = COALESCE($3, reservation_profiles.online_voice_price),
         online_video_price = COALESCE($4, reservation_profiles.online_video_price),
         offline_price = COALESCE($5, reservation_profiles.offline_price),
         currency = COALESCE($6, reservation_profiles.currency),
         updated_at = now()
       RETURNING *`,
      [
        providerId,
        input.autoAccept,
        input.onlineVoicePrice,
        input.onlineVideoPrice,
        input.offlinePrice,
        input.currency,
      ],
    );
    return rows[0]!;
  }

  async listSlots(
    providerId: string,
    from: Date,
    to: Date,
    availableOnly: boolean,
  ): Promise<ReservationSlotRow[]> {
    const { rows } = await getPool().query<ReservationSlotRow>(
      `SELECT * FROM reservation_slots
       WHERE provider_id = $1
         AND start_at < $3
         AND end_at > $2
         ${availableOnly ? `AND status = 'available'` : ''}
       ORDER BY start_at ASC`,
      [providerId, from, to],
    );
    return rows;
  }

  async findSlotById(id: string): Promise<ReservationSlotRow | null> {
    const { rows } = await getPool().query<ReservationSlotRow>(
      `SELECT * FROM reservation_slots WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createSlot(
    providerId: string,
    input: {
      startAt: Date;
      endAt: Date;
      supportsOnline: boolean;
      supportsOffline: boolean;
    },
  ): Promise<ReservationSlotRow> {
    const { rows } = await getPool().query<ReservationSlotRow>(
      `INSERT INTO reservation_slots (provider_id, start_at, end_at, status, supports_online, supports_offline)
       VALUES ($1, $2, $3, 'available', $4, $5)
       RETURNING *`,
      [providerId, input.startAt, input.endAt, input.supportsOnline, input.supportsOffline],
    );
    return rows[0]!;
  }

  async updateSlot(
    id: string,
    updates: Partial<{
      startAt: Date;
      endAt: Date;
      status: string;
      supportsOnline: boolean;
      supportsOffline: boolean;
    }>,
  ): Promise<ReservationSlotRow | null> {
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    let idx = 1;
    if (updates.startAt !== undefined) {
      setClauses.push(`start_at = $${idx++}`);
      params.push(updates.startAt);
    }
    if (updates.endAt !== undefined) {
      setClauses.push(`end_at = $${idx++}`);
      params.push(updates.endAt);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.supportsOnline !== undefined) {
      setClauses.push(`supports_online = $${idx++}`);
      params.push(updates.supportsOnline);
    }
    if (updates.supportsOffline !== undefined) {
      setClauses.push(`supports_offline = $${idx++}`);
      params.push(updates.supportsOffline);
    }
    params.push(id);
    const { rows } = await getPool().query<ReservationSlotRow>(
      `UPDATE reservation_slots SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async deleteSlot(id: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
      `DELETE FROM reservation_slots WHERE id = $1 AND status IN ('available', 'blocked')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  async createReservation(
    data: {
      customerId: string;
      providerId: string;
      serviceId?: string;
      slotId: string;
      mode: string;
      onlineType?: string;
      requestedStartAt: Date;
      requestedEndAt: Date;
      expertPriceAmount: number;
      currency: string;
      adminAcceptanceFee: number;
      adminMinuteRate: number;
    },
  ): Promise<ReservationRow> {
    const { rows } = await getPool().query<ReservationRow>(
      `INSERT INTO reservations (
         customer_id, provider_id, service_id, slot_id, mode, online_type, status,
         requested_start_at, requested_end_at, expert_price_amount, currency,
         admin_acceptance_fee, admin_minute_rate
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        data.customerId,
        data.providerId,
        data.serviceId ?? null,
        data.slotId,
        data.mode,
        data.onlineType ?? null,
        data.requestedStartAt,
        data.requestedEndAt,
        data.expertPriceAmount,
        data.currency,
        data.adminAcceptanceFee,
        data.adminMinuteRate,
      ],
    );
    return rows[0]!;
  }

  async findReservationById(id: string): Promise<ReservationRow | null> {
    const { rows } = await getPool().query<ReservationRow>(
      `SELECT r.*,
              COALESCE(up.display_name, up.email) AS provider_name,
              COALESCE(uc.display_name, uc.email) AS customer_name,
              s.title AS service_title
       FROM reservations r
       JOIN users up ON up.id = r.provider_id
       JOIN users uc ON uc.id = r.customer_id
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listReservationsByUser(
    userId: string,
    role: 'customer' | 'provider',
    page: number,
    limit: number,
  ): Promise<{ rows: ReservationRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const column = role === 'customer' ? 'customer_id' : 'provider_id';
    const { rows } = await getPool().query<ReservationRow>(
      `SELECT r.*,
              COALESCE(up.display_name, up.email) AS provider_name,
              COALESCE(uc.display_name, uc.email) AS customer_name,
              s.title AS service_title
       FROM reservations r
       JOIN users up ON up.id = r.provider_id
       JOIN users uc ON uc.id = r.customer_id
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.${column} = $1
       ORDER BY r.created_at DESC
       LIMIT $2::int OFFSET $3::int`,
      [userId, limit, offset],
    );

    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reservations WHERE ${column} = $1`,
      [userId],
    );

    return { rows, total: parseInt(countRows[0]!.count, 10) };
  }

  async updateReservation(
    id: string,
    updates: Partial<{
      status: string;
      rejectionReason: string | null;
      autoRejected: boolean;
      suggestedSlots: unknown;
      conversationId: string | null;
      acceptedAt: Date | null;
      startedAt: Date | null;
      endedAt: Date | null;
      completedAt: Date | null;
      fixedPriceHoldId: string | null;
      customerDoneDueAt: Date | null;
      donePromptedAt: Date | null;
      disconnectAutoReleaseAt: Date | null;
      finalLocationText: string | null;
      finalLocationLat: number | null;
      finalLocationLng: number | null;
      requestedEndAt: Date;
    }>,
    client?: PoolClient,
  ): Promise<ReservationRow | null> {
    const db = client ?? getPool();
    const map: Record<string, string> = {
      status: 'status',
      rejectionReason: 'rejection_reason',
      autoRejected: 'auto_rejected',
      suggestedSlots: 'suggested_slots',
      conversationId: 'conversation_id',
      acceptedAt: 'accepted_at',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      completedAt: 'completed_at',
      fixedPriceHoldId: 'fixed_price_hold_id',
      customerDoneDueAt: 'customer_done_due_at',
      donePromptedAt: 'done_prompted_at',
      disconnectAutoReleaseAt: 'disconnect_auto_release_at',
      finalLocationText: 'final_location_text',
      finalLocationLat: 'final_location_lat',
      finalLocationLng: 'final_location_lng',
      requestedEndAt: 'requested_end_at',
    };

    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.findReservationById(id);

    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of entries) {
      const col = map[key];
      if (!col) continue;
      setClauses.push(`${col} = $${idx++}`);
      values.push(key === 'suggestedSlots' ? JSON.stringify(value) : value);
    }
    values.push(id);
    const { rows } = await db.query<ReservationRow>(
      `UPDATE reservations SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async findSuggestedSlots(
    providerId: string,
    requestedStart: Date,
    durationMinutes: number,
  ): Promise<Array<{ startAt: string; endAt: string }>> {
    const to = new Date(requestedStart);
    to.setDate(to.getDate() + 14);
    const { rows } = await getPool().query<{ start_at: string; end_at: string }>(
      `SELECT start_at, end_at
       FROM reservation_slots
       WHERE provider_id = $1
         AND status = 'available'
         AND start_at >= $2
         AND start_at <= $3
         AND EXTRACT(EPOCH FROM (end_at - start_at)) / 60 = $4
       ORDER BY start_at ASC
       LIMIT 3`,
      [providerId, requestedStart, to, durationMinutes],
    );
    return rows.map((r) => ({ startAt: r.start_at, endAt: r.end_at }));
  }

  async createLocationProposal(input: {
    reservationId: string;
    proposedBy: string;
    locationText: string;
    lat?: number;
    lng?: number;
  }): Promise<ReservationLocationProposalRow> {
    const { rows } = await getPool().query<ReservationLocationProposalRow>(
      `INSERT INTO reservation_location_proposals (reservation_id, proposed_by, location_text, lat, lng)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.reservationId, input.proposedBy, input.locationText, input.lat ?? null, input.lng ?? null],
    );
    return rows[0]!;
  }

  async listLocationProposals(reservationId: string): Promise<ReservationLocationProposalRow[]> {
    const { rows } = await getPool().query<ReservationLocationProposalRow>(
      `SELECT * FROM reservation_location_proposals
       WHERE reservation_id = $1
       ORDER BY created_at DESC`,
      [reservationId],
    );
    return rows;
  }

  async getLocationProposalById(id: string): Promise<ReservationLocationProposalRow | null> {
    const { rows } = await getPool().query<ReservationLocationProposalRow>(
      `SELECT * FROM reservation_location_proposals WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async respondLocationProposal(
    id: string,
    decision: 'accept' | 'reject',
    responderId: string,
    client?: PoolClient,
  ): Promise<ReservationLocationProposalRow | null> {
    const db = client ?? getPool();
    const mapped = decision === 'accept' ? 'accepted' : 'rejected';
    const { rows } = await db.query<ReservationLocationProposalRow>(
      `UPDATE reservation_location_proposals
       SET status = $2, responded_by = $3, responded_at = now()
       WHERE id = $1
         AND status = 'pending'
       RETURNING *`,
      [id, mapped, responderId],
    );
    return rows[0] ?? null;
  }

  async upsertCheckinCode(
    reservationId: string,
    userId: string,
    code: string,
    expiresAt: Date,
  ): Promise<ReservationCheckinCodeRow> {
    const { rows } = await getPool().query<ReservationCheckinCodeRow>(
      `INSERT INTO reservation_checkin_codes (reservation_id, user_id, code, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (reservation_id, user_id)
       DO UPDATE SET code = $3, expires_at = $4, verified_at = NULL
       RETURNING *`,
      [reservationId, userId, code, expiresAt],
    );
    return rows[0]!;
  }

  async getCheckinCode(
    reservationId: string,
    userId: string,
  ): Promise<ReservationCheckinCodeRow | null> {
    const { rows } = await getPool().query<ReservationCheckinCodeRow>(
      `SELECT * FROM reservation_checkin_codes WHERE reservation_id = $1 AND user_id = $2`,
      [reservationId, userId],
    );
    return rows[0] ?? null;
  }

  async getCheckinCodeByCode(
    reservationId: string,
    code: string,
  ): Promise<ReservationCheckinCodeRow | null> {
    const { rows } = await getPool().query<ReservationCheckinCodeRow>(
      `SELECT * FROM reservation_checkin_codes WHERE reservation_id = $1 AND code = $2`,
      [reservationId, code],
    );
    return rows[0] ?? null;
  }

  async markCheckinConfirmed(
    reservationId: string,
    userId: string,
  ): Promise<ReservationCheckinCodeRow | null> {
    const { rows } = await getPool().query<ReservationCheckinCodeRow>(
      `UPDATE reservation_checkin_codes
       SET verified_at = now()
       WHERE reservation_id = $1 AND user_id = $2
       RETURNING *`,
      [reservationId, userId],
    );
    return rows[0] ?? null;
  }

  async getCheckinStates(
    reservationId: string,
  ): Promise<ReservationCheckinCodeRow[]> {
    const { rows } = await getPool().query<ReservationCheckinCodeRow>(
      `SELECT * FROM reservation_checkin_codes WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows;
  }

  async getCallSessionByReservation(
    reservationId: string,
  ): Promise<ReservationCallSessionRow | null> {
    const { rows } = await getPool().query<ReservationCallSessionRow>(
      `SELECT * FROM reservation_call_sessions WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows[0] ?? null;
  }

  async createCallSession(
    reservationId: string,
    channelName: string,
  ): Promise<ReservationCallSessionRow> {
    const { rows } = await getPool().query<ReservationCallSessionRow>(
      `INSERT INTO reservation_call_sessions (reservation_id, agora_channel)
       VALUES ($1, $2)
       ON CONFLICT (reservation_id) DO UPDATE SET agora_channel = reservation_call_sessions.agora_channel
       RETURNING *`,
      [reservationId, channelName],
    );
    return rows[0]!;
  }

  async updateCallSession(
    sessionId: string,
    updates: Partial<{
      status: string;
      startedAt: Date | null;
      endedAt: Date | null;
      pausedAt: Date | null;
      billingStartedAt: Date | null;
      billingPausedAt: Date | null;
      lastBilledAt: Date | null;
      billedMinutes: number;
      billedSeconds: number;
      customerCarryMilliPiaster: number;
      providerCarryMilliPiaster: number;
      extensionStatus: string;
      extensionRequestedBy: string | null;
      extensionUntil: Date | null;
    }>,
    client?: PoolClient,
  ): Promise<ReservationCallSessionRow | null> {
    const db = client ?? getPool();
    const map: Record<string, string> = {
      status: 'status',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      pausedAt: 'paused_at',
      billingStartedAt: 'billing_started_at',
      billingPausedAt: 'billing_paused_at',
      lastBilledAt: 'last_billed_at',
      billedMinutes: 'billed_minutes',
      billedSeconds: 'billed_seconds',
      customerCarryMilliPiaster: 'customer_carry_milli_piaster',
      providerCarryMilliPiaster: 'provider_carry_milli_piaster',
      extensionStatus: 'extension_status',
      extensionRequestedBy: 'extension_requested_by',
      extensionUntil: 'extension_until',
    };

    const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return null;
    const setClauses: string[] = ['updated_at = now()'];
    const values: unknown[] = [];
    let idx = 1;
    for (const [key, value] of entries) {
      const col = map[key];
      if (!col) continue;
      setClauses.push(`${col} = $${idx++}`);
      values.push(value);
    }
    values.push(sessionId);
    const { rows } = await db.query<ReservationCallSessionRow>(
      `UPDATE reservation_call_sessions
       SET ${setClauses.join(', ')}
       WHERE id = $${idx}
       RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async upsertCallParticipant(
    callSessionId: string,
    userId: string,
    agoraUid: number,
    connected: boolean,
  ): Promise<ReservationCallParticipantRow> {
    const { rows } = await getPool().query<ReservationCallParticipantRow>(
      `INSERT INTO reservation_call_participants (
         call_session_id, user_id, agora_uid, joined_at, is_connected, last_seen_at
       )
       VALUES ($1, $2, $3, now(), $4, now())
       ON CONFLICT (call_session_id, user_id)
       DO UPDATE SET
         agora_uid = EXCLUDED.agora_uid,
         is_connected = EXCLUDED.is_connected,
         joined_at = CASE
            WHEN reservation_call_participants.joined_at IS NULL THEN now()
            ELSE reservation_call_participants.joined_at
         END,
         left_at = CASE WHEN EXCLUDED.is_connected = false THEN now() ELSE NULL END,
         last_seen_at = now(),
         updated_at = now()
       RETURNING *`,
      [callSessionId, userId, agoraUid, connected],
    );
    return rows[0]!;
  }

  async listCallParticipants(callSessionId: string): Promise<ReservationCallParticipantRow[]> {
    const { rows } = await getPool().query<ReservationCallParticipantRow>(
      `SELECT * FROM reservation_call_participants WHERE call_session_id = $1`,
      [callSessionId],
    );
    return rows;
  }

  async createDispute(input: {
    reservationId: string;
    openedBy: string | null;
    reason: string;
    description?: string;
  }): Promise<ReservationDisputeRow> {
    const { rows } = await getPool().query<ReservationDisputeRow>(
      `INSERT INTO reservation_disputes (reservation_id, opened_by, reason, description)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.reservationId, input.openedBy, input.reason, input.description ?? null],
    );
    return rows[0]!;
  }

  async getOpenDisputeByReservation(
    reservationId: string,
  ): Promise<ReservationDisputeRow | null> {
    const { rows } = await getPool().query<ReservationDisputeRow>(
      `SELECT * FROM reservation_disputes
       WHERE reservation_id = $1 AND status = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
      [reservationId],
    );
    return rows[0] ?? null;
  }

  async listDisputes(
    page: number,
    limit: number,
    status?: string,
  ): Promise<{ rows: ReservationDisputeRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $1`;
    }
    params.push(limit, offset);
    const limitIdx = status ? 2 : 1;
    const offsetIdx = status ? 3 : 2;
    const { rows } = await getPool().query<ReservationDisputeRow>(
      `SELECT * FROM reservation_disputes
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitIdx}::int OFFSET $${offsetIdx}::int`,
      params,
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM reservation_disputes ${where}`,
      status ? [status] : [],
    );
    return { rows, total: parseInt(countRows[0]!.count, 10) };
  }

  async resolveDispute(
    disputeId: string,
    status: string,
    resolutionNotes: string | null,
    resolvedBy: string,
  ): Promise<ReservationDisputeRow | null> {
    const { rows } = await getPool().query<ReservationDisputeRow>(
      `UPDATE reservation_disputes
       SET status = $2, resolution_notes = $3, resolved_by = $4, resolved_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [disputeId, status, resolutionNotes, resolvedBy],
    );
    return rows[0] ?? null;
  }
}
