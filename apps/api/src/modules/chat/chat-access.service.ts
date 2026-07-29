import { getPool } from '../../db/pool.js';
import { ActivationGateService } from '../mhc/activation-gate.service.js';

// ---------------------------------------------------------------------------
// Who may talk to whom in general chat, and how much they may say.
// ---------------------------------------------------------------------------
// Decision D2. Before this, `POST /api/chat/conversations` accepted any
// `otherUserId` and created a conversation with no relationship requirement and
// no redaction — which made every bid-chat protection pointless, since a
// provider could simply DM the customer instead.
//
// The launch-safe model:
//   * Creating a conversation requires a REASON: an activated job together, or
//     support/admin involvement.
//   * Pre-activation negotiation happens in bid / booking chat, not here.
//   * An existing conversation without an activated job stays readable but
//     redacted and read-only — history is never destroyed.
//   * After activation, everything unlocks.
// ---------------------------------------------------------------------------

export type ChatAccessReason =
  | 'support'
  | 'activated_award'
  | 'activated_booking'
  | 'reservation_pending'
  | 'none';

export type ChatAccess = {
  /** May this conversation exist / accept new messages? */
  allowed: boolean;
  /** May contact details be exchanged and revealed? */
  unlocked: boolean;
  reason: ChatAccessReason;
};

export class ChatAccessService {
  constructor(private readonly activationGate = new ActivationGateService()) {}

  /** Is contact masking switched on? Shared with bid chat so both behave alike. */
  async isMaskingEnabled(): Promise<boolean> {
    return this.activationGate.isContactMaskingEnabled();
  }

  /** Support and admin conversations are always permitted and never redacted. */
  private async involvesStaff(userIds: string[]): Promise<boolean> {
    const { rows } = await getPool().query<{ c: string }>(
      `SELECT count(*)::text AS c FROM users
       WHERE id = ANY($1::uuid[])
         AND (is_admin = true OR primary_role IN ('admin', 'super_admin'))`,
      [userIds],
    );
    return parseInt(rows[0]?.c ?? '0', 10) > 0;
  }

  /**
   * Do these two users share a paid-for job?
   *
   * Awards are matched provider↔need-customer, bookings provider↔reservation-
   * customer. Only an `mhc_job_activations` row counts: that row is written in
   * the same transaction as the MHC debit, so "they have an activated job" and
   * "the provider paid" cannot drift apart.
   */
  private async sharesActivatedJob(
    userA: string,
    userB: string,
  ): Promise<'activated_award' | 'activated_booking' | null> {
    const { rows } = await getPool().query<{ activation_type: string }>(
      `SELECT a.activation_type
       FROM mhc_job_activations a
       LEFT JOIN needs n ON n.id = a.need_id
       LEFT JOIN reservations r ON r.id = a.reservation_id
       WHERE (a.provider_user_id = $1 AND (n.customer_id = $2 OR r.customer_id = $2))
          OR (a.provider_user_id = $2 AND (n.customer_id = $1 OR r.customer_id = $1))
       LIMIT 1`,
      [userA, userB],
    );
    const type = rows[0]?.activation_type;
    if (type === 'award') return 'activated_award';
    if (type === 'booking') return 'activated_booking';
    return null;
  }

  /** Access for a prospective conversation between two users. */
  async resolveForPair(userId: string, otherUserId: string): Promise<ChatAccess> {
    if (userId === otherUserId) {
      return { allowed: false, unlocked: false, reason: 'none' };
    }

    if (await this.involvesStaff([userId, otherUserId])) {
      return { allowed: true, unlocked: true, reason: 'support' };
    }

    // The kill-switch opens everything, as documented for the gate.
    if (!(await this.activationGate.isGateEnabled())) {
      return { allowed: true, unlocked: true, reason: 'support' };
    }

    const shared = await this.sharesActivatedJob(userId, otherUserId);
    if (shared) return { allowed: true, unlocked: true, reason: shared };

    return { allowed: false, unlocked: false, reason: 'none' };
  }

  /**
   * Access for an existing conversation.
   *
   * A reservation-linked conversation is the booking's own chat, so it stays
   * usable while the booking is live — but locked until the provider activates
   * it. That is what keeps booking chat from becoming the bypass that general
   * chat was.
   */
  async resolveForConversation(params: {
    conversationId: string;
    participantA: string;
    participantB: string;
  }): Promise<ChatAccess> {
    const { rows } = await getPool().query<{ id: string; status: string }>(
      `SELECT id, status FROM reservations WHERE conversation_id = $1 LIMIT 1`,
      [params.conversationId],
    );
    const reservation = rows[0];

    if (reservation) {
      if (!(await this.activationGate.isGateEnabled())) {
        return { allowed: true, unlocked: true, reason: 'activated_booking' };
      }
      const activated = await this.activationGate.isBookingActivated(reservation.id);
      return activated
        ? { allowed: true, unlocked: true, reason: 'activated_booking' }
        : // Still usable for arranging the booking, but no contact details.
          { allowed: true, unlocked: false, reason: 'reservation_pending' };
    }

    return this.resolveForPair(params.participantA, params.participantB);
  }
}
