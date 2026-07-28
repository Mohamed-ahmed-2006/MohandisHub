// ---------------------------------------------------------------------------
// Activation gate — the single authority on "is this job unlocked?"
// ---------------------------------------------------------------------------
// Every endpoint that can reveal privileged job data (customer/provider contact
// details, exact address, private attachments, provider direct-payment details,
// unrestricted chat) MUST consult this service. Keeping the rule in one place is
// deliberate: the previous design scattered no checks at all, so the paywall was
// bypassable through any normal awarded-bid endpoint.
//
// Unlocked means: an `mhc_job_activations` row exists for the bid/reservation.
// That row is only written inside the same transaction that debits MHC (see
// MhcRepository.chargeActivation), so "unlocked" and "paid" cannot drift apart.
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

import { MhcRepository } from './mhc.repository.js';

export type JobParticipants = {
  needId: string;
  bidId: string;
  customerUserId: string;
  providerUserId: string;
  needStatus: string;
  bidStatus: string;
  activatedAt: string | null;
};

/** What a caller is allowed to see for a given job. */
export type DisclosureLevel = 'masked' | 'full';

export class ActivationGateService {
  constructor(private readonly mhcRepo: MhcRepository = new MhcRepository()) {}

  /** Is the whole gate switched on? Admin kill-switch for incidents. */
  async isGateEnabled(): Promise<boolean> {
    const { rows } = await getPool().query<{ enabled: boolean | null }>(
      `SELECT mhc_activation_gate_enabled AS enabled FROM app_settings LIMIT 1`,
    );
    // Fail-CLOSED on a missing settings row: the gate stays ON so we never
    // accidentally give away contact details because config is absent.
    return rows[0]?.enabled !== false;
  }

  /** Should pre-activation chat have contact details stripped? */
  async isContactMaskingEnabled(): Promise<boolean> {
    const { rows } = await getPool().query<{ enabled: boolean | null }>(
      `SELECT block_precontact_sharing AS enabled FROM app_settings LIMIT 1`,
    );
    return rows[0]?.enabled !== false;
  }

  /** Admin-configured hours a provider has to accept + pay. 0 = never expires. */
  async getAwardAcceptanceExpiryHours(): Promise<number> {
    const { rows } = await getPool().query<{ hours: number | null }>(
      `SELECT award_acceptance_expiry_hours AS hours FROM app_settings LIMIT 1`,
    );
    const hours = rows[0]?.hours;
    return typeof hours === 'number' && Number.isFinite(hours) && hours >= 0 ? hours : 48;
  }

  /** Load the participants and gate state for a bid-backed job. */
  async loadJobByBid(bidId: string): Promise<JobParticipants | null> {
    const { rows } = await getPool().query<{
      need_id: string;
      bid_id: string;
      customer_id: string;
      expert_id: string;
      need_status: string;
      bid_status: string;
      activated_at: string | null;
    }>(
      `SELECT n.id AS need_id, b.id AS bid_id, n.customer_id, b.expert_id,
              n.status AS need_status, b.status AS bid_status, n.activated_at
       FROM bids b
       JOIN needs n ON n.id = b.need_id
       WHERE b.id = $1
       LIMIT 1`,
      [bidId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      needId: row.need_id,
      bidId: row.bid_id,
      customerUserId: row.customer_id,
      providerUserId: row.expert_id,
      needStatus: row.need_status,
      bidStatus: row.bid_status,
      activatedAt: row.activated_at,
    };
  }

  /** True when the provider has paid the MHC activation price for this bid. */
  async isAwardActivated(bidId: string): Promise<boolean> {
    return this.mhcRepo.isActivated({ activationType: 'award', bidId });
  }

  /** True when the provider has paid the MHC activation price for this booking. */
  async isBookingActivated(reservationId: string): Promise<boolean> {
    return this.mhcRepo.isActivated({ activationType: 'booking', reservationId });
  }

  /**
   * Resolve how much a viewer may see of a bid-backed job.
   *
   * When the gate is disabled by an admin, everything is 'full' — that is the
   * documented kill-switch behaviour, not an oversight.
   */
  async resolveDisclosureLevelForBid(bidId: string): Promise<DisclosureLevel> {
    if (!(await this.isGateEnabled())) return 'full';
    return (await this.isAwardActivated(bidId)) ? 'full' : 'masked';
  }

  /**
   * Throw 402 unless the award has been activated.
   * Use this to guard contact details, exact address, private files, and
   * provider payment details.
   */
  async assertAwardActivated(bidId: string): Promise<void> {
    if (!(await this.isGateEnabled())) return;
    if (await this.isAwardActivated(bidId)) return;
    throw new HttpError({
      statusCode: 402,
      code: 'MHC_ACTIVATION_REQUIRED',
      message:
        'This job is locked. The provider must accept the award and activate it with credits before contact details, files, and payment information are shared.',
      details: { activationType: 'award', bidId },
    });
  }

  /** Throw 402 unless the booking has been activated. */
  async assertBookingActivated(reservationId: string): Promise<void> {
    if (!(await this.isGateEnabled())) return;
    if (await this.isBookingActivated(reservationId)) return;
    throw new HttpError({
      statusCode: 402,
      code: 'MHC_ACTIVATION_REQUIRED',
      message:
        'This booking is locked. The provider must activate it with credits before contact details, files, and payment information are shared.',
      details: { activationType: 'booking', reservationId },
    });
  }

  /** Only the customer or the bidding provider may view a job at all. */
  assertParticipant(job: JobParticipants, userId: string): void {
    if (job.customerUserId !== userId && job.providerUserId !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'You are not a participant in this job.',
      });
    }
  }
}
