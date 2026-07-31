import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  AdAutoRenewPausedReason,
  AdLastRenewalOutcome,
  AdRenewalEventType,
  AdvertisementRenewalEventRow,
  AdvertisementRow,
} from './advertisements.types.js';

/**
 * Database access for automatic advertisement renewal (Wave 2F-B).
 *
 * Split from `AdvertisementsRepository` on purpose: everything here is either a
 * SCHEDULER claim or a write to the boundary event log, and both have
 * concurrency rules the rest of the advertisement queries do not. Keeping them
 * in one file makes those rules readable in one place.
 *
 * Two properties hold across every method below:
 *
 *   * no query here resolves a price, computes an amount, or touches a wallet.
 *     Charging is the generic MHC primitive's job and stays there;
 *   * every claim is expressed against the DATABASE clock (`now()`), never a
 *     timestamp the caller computed. A worker whose host clock has drifted
 *     cannot renew a campaign early or late because of it.
 */

/** One period is exactly seven times 24 hours, in SQL that DST cannot bend. */
const PERIOD_INTERVAL = `interval '168 hours'`;

const EVENT_COLUMNS = `id, advertisement_id, advertiser_id, boundary_period_number,
  event_type, period_id, detail, notified_at, created_at`;

export type RenewalEventInsert = {
  advertisementId: string;
  advertiserId: string;
  boundaryPeriodNumber: number;
  eventType: AdRenewalEventType;
  periodId?: string | null;
  detail?: Record<string, unknown>;
};

export class AdvertisementRenewalRepository {
  // -------------------------------------------------------------------------
  // Scheduler candidate reads
  // -------------------------------------------------------------------------
  // These are UNLOCKED, bounded reads. They produce candidates, never
  // decisions: every predicate below is re-evaluated inside the per-campaign
  // transaction with the row locked, so a candidate that stopped being due
  // between the read and the claim is simply skipped. Reading without a lock is
  // what keeps a slow sweep from holding locks across a whole batch.

  /**
   * Automatic campaigns whose paid week has ended (or ends this instant).
   *
   * Deliberately matches BOTH `renewal_required` — the expiry sweep already
   * closed the week — and an `active` campaign whose mirrored window has
   * elapsed. The renewal transaction closes a lapsed week itself, so a renewal
   * never has to wait for a separate expiry pass and the campaign never has a
   * gap between the week it paid for and the week it just bought.
   *
   * `auto_renew_paused_reason IS NULL` is the no-retry-loop gate: a boundary
   * that already failed is outside this read until an advertiser clears it.
   */
  async listDueAutomaticRenewalAdIds(limit: number): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id
       FROM advertisements
       WHERE billing_model = 'weekly'
         AND auto_renew_enabled = true
         AND renewal_mode = 'automatic'
         AND auto_renew_paused_reason IS NULL
         AND status NOT IN ('cancelled', 'rejected')
         AND (
           billing_status = 'renewal_required'
           OR (
             billing_status = 'active'
             AND current_period_ends_at IS NOT NULL
             AND current_period_ends_at <= now()
           )
         )
       ORDER BY COALESCE(current_period_ends_at, updated_at)
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Approved campaigns whose scheduled start has arrived and which have never
   * been attempted.
   *
   * Deliberately narrower than `AdvertisementsRepository.listDueScheduledAdIds`,
   * which also returns `awaiting_credits`. That is right for an admin invoking
   * activation deliberately and for the advertiser's own "start now" button, and
   * wrong for a timer: a campaign whose advertiser has no credits would be
   * re-attempted every sweep forever. It would never charge anything — the
   * balance check fails first — but it would write an UPDATE per campaign per
   * minute for as long as the campaign sat there.
   *
   * So the scheduler makes exactly ONE attempt per campaign. A campaign that
   * could not pay drops to `awaiting_credits`, out of this read, and waits for
   * its advertiser — the same shape as a failed renewal boundary.
   */
  async listDueInitialStartAdIds(limit: number): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id
       FROM advertisements
       WHERE billing_model = 'weekly'
         AND status = 'scheduled'
         AND billing_status = 'awaiting_start'
         AND reviewed_at IS NOT NULL
         AND COALESCE(starts_at, now()) <= now()
       ORDER BY COALESCE(starts_at, created_at)
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Automatic campaigns whose running week ends within the reminder window and
   * which have not been reminded about that boundary yet.
   *
   * The NOT EXISTS is an optimisation only. `uq_ad_renewal_event_boundary` is
   * what actually guarantees one reminder per boundary; two workers that both
   * pass this read still produce one row.
   */
  async listDueRenewalReminderAdIds(limit: number, windowHours: number): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT a.id
       FROM advertisements a
       WHERE a.billing_model = 'weekly'
         AND a.auto_renew_enabled = true
         AND a.renewal_mode = 'automatic'
         AND a.auto_renew_paused_reason IS NULL
         AND a.status = 'active'
         AND a.billing_status = 'active'
         AND a.current_period_ends_at IS NOT NULL
         AND a.current_period_ends_at > now()
         AND a.current_period_ends_at <= now() + make_interval(hours => $2::int)
         AND NOT EXISTS (
           SELECT 1 FROM advertisement_renewal_events e
           WHERE e.advertisement_id = a.id
             AND e.event_type = 'renewal_reminder'
         )
       ORDER BY a.current_period_ends_at
       LIMIT $1::int`,
      [limit, windowHours],
    );
    return rows.map((row) => row.id);
  }

  /**
   * Claim one advertisement for scheduler work.
   *
   * `SKIP LOCKED` rather than a plain `FOR UPDATE`: a second worker that finds
   * this row already claimed must move on to the next campaign, not queue
   * behind it. Returning null therefore means "someone else owns this right
   * now", and the caller's correct response is to do nothing at all — the
   * holder is about to do the same work.
   *
   * The interactive paths keep blocking `FOR UPDATE` (see
   * `AdvertisementsRepository.findAdForUpdate`), because a provider pressing a
   * button deserves an answer about the committed state rather than a silent
   * skip.
   */
  async claimAdForUpdate(client: PoolClient, id: string): Promise<AdvertisementRow | null> {
    const { rows } = await client.query<AdvertisementRow>(
      `SELECT * FROM advertisements WHERE id = $1 FOR UPDATE SKIP LOCKED`,
      [id],
    );
    return rows[0] ?? null;
  }

  /** The database's own clock, inside the caller's transaction. */
  async now(client: PoolClient): Promise<Date> {
    const { rows } = await client.query<{ now: string }>(`SELECT now()::text AS now`);
    return new Date(rows[0]!.now);
  }

  /**
   * Would a full 168-hour period starting now still end on or before the
   * configured boundary? Evaluated in SQL so the interval arithmetic is the same
   * one `chk_ad_period_exact_week` verifies, and so no JavaScript date rounding
   * can decide whether a provider is charged.
   */
  async periodFitsBeforeBoundary(
    client: PoolClient,
    startsAt: Date,
    renewalEndDate: string,
  ): Promise<boolean> {
    const { rows } = await client.query<{ fits: boolean }>(
      `SELECT ($1::timestamptz + ${PERIOD_INTERVAL}) <= $2::timestamptz AS fits`,
      [startsAt.toISOString(), renewalEndDate],
    );
    return rows[0]?.fits === true;
  }

  // -------------------------------------------------------------------------
  // Campaign state writes
  // -------------------------------------------------------------------------

  /**
   * Close a week whose 168 hours have elapsed, for ONE campaign, inside the
   * caller's transaction.
   *
   * The bulk sweep in `AdvertisementsRepository.expireDuePeriods` does the same
   * thing for everybody; this exists so a renewal can close the old week and
   * open the new one in a single transaction. Guarded on `ends_at <= now()` so
   * it can never close a week the advertiser has already paid for and is still
   * inside.
   */
  async closeElapsedPeriodInTx(client: PoolClient, advertisementId: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `UPDATE advertisement_campaign_periods
       SET status = 'expired', updated_at = now()
       WHERE advertisement_id = $1
         AND status = 'active'
         AND ends_at <= now()`,
      [advertisementId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await client.query(
      `UPDATE advertisements
       SET status = CASE WHEN status = 'active' THEN 'expired' ELSE status END,
           billing_status = CASE WHEN billing_status = 'active' THEN 'renewal_required' ELSE billing_status END,
           manual_renewal_required = true,
           current_period_starts_at = NULL,
           current_period_ends_at = NULL,
           next_renewal_at = NULL,
           updated_at = now()
       WHERE id = $1
         AND billing_model = 'weekly'`,
      [advertisementId],
    );
    return true;
  }

  /**
   * Write the advertiser's automatic-renewal configuration.
   *
   * Every column that can make the scheduler act is set in ONE statement, so
   * there is no window in which a campaign is enabled without its bound or
   * without its consent record. `chk_advertisements_auto_renew_bounded`,
   * `chk_advertisements_auto_renew_mode` and
   * `chk_advertisements_auto_renew_consent` all evaluate against the finished
   * row.
   *
   * Reconfiguring always clears `auto_renew_paused_reason`: changing the
   * configuration is the explicit advertiser action that re-opens the gate.
   */
  async writeAutoRenewalConfigInTx(
    client: PoolClient,
    params: {
      advertisementId: string;
      enabled: boolean;
      maximumWeeks: number | null;
      renewalEndDate: string | null;
      consentBy: string | null;
      consentVersion: string | null;
    },
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET auto_renew_enabled = $2::boolean,
           renewal_mode = CASE WHEN $2::boolean THEN 'automatic' ELSE 'manual' END,
           maximum_weeks = $3::int,
           renewal_end_date = $4::timestamptz,
           -- Consent is stamped when it is GIVEN and kept afterwards. An audit
           -- trail that is erased when the advertiser changes their mind is not
           -- an audit trail.
           auto_renew_enabled_at = CASE WHEN $2::boolean THEN now() ELSE auto_renew_enabled_at END,
           auto_renew_enabled_by = CASE WHEN $2::boolean THEN $5::uuid ELSE auto_renew_enabled_by END,
           auto_renew_consent_version =
             CASE WHEN $2::boolean THEN $6::varchar ELSE auto_renew_consent_version END,
           auto_renew_paused_reason = NULL,
           auto_renew_paused_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [
        params.advertisementId,
        params.enabled,
        params.maximumWeeks,
        params.renewalEndDate,
        params.consentBy,
        params.consentVersion,
      ],
    );
    return rows[0]!;
  }

  /**
   * Stop the scheduler acting on this campaign, and record why.
   *
   * `stopAutomatic` is true for a boundary that has been REACHED — the campaign
   * bought every week it was ever going to — and false for a failure the
   * advertiser can fix, where the preference is preserved so that clearing the
   * pause resumes automatic renewal rather than requiring re-consent.
   */
  async pauseAutomaticRenewalInTx(
    client: PoolClient,
    params: {
      advertisementId: string;
      reason: AdAutoRenewPausedReason;
      outcome: AdLastRenewalOutcome;
      stopAutomatic: boolean;
    },
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET auto_renew_paused_reason = $2::varchar,
           auto_renew_paused_at = now(),
           last_renewal_outcome = $3::varchar,
           last_renewal_attempt_at = now(),
           auto_renew_enabled = CASE WHEN $4::boolean THEN false ELSE auto_renew_enabled END,
           renewal_mode = CASE WHEN $4::boolean THEN 'manual' ELSE renewal_mode END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [params.advertisementId, params.reason, params.outcome, params.stopAutomatic],
    );
    return rows[0]!;
  }

  /** Record a successful attempt, and clear any pause it just recovered from. */
  async recordRenewalSuccessInTx(
    client: PoolClient,
    advertisementId: string,
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET last_renewal_outcome = 'succeeded',
           last_renewal_attempt_at = now(),
           auto_renew_paused_reason = NULL,
           auto_renew_paused_at = NULL,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [advertisementId],
    );
    return rows[0]!;
  }

  // -------------------------------------------------------------------------
  // The boundary event log
  // -------------------------------------------------------------------------

  /**
   * Record one boundary outcome.
   *
   * A 23505 from `uq_ad_renewal_event_boundary` means another transaction
   * already committed this exact event, and it deliberately propagates: the
   * caller's whole transaction unwinds, so a duplicate attempt charges nothing
   * and notifies nobody. That is the exactly-once guarantee, expressed as an
   * index rather than as a code path.
   */
  async insertEventInTx(
    client: PoolClient,
    input: RenewalEventInsert,
  ): Promise<AdvertisementRenewalEventRow> {
    const { rows } = await client.query<AdvertisementRenewalEventRow>(
      `INSERT INTO advertisement_renewal_events (
         advertisement_id, advertiser_id, boundary_period_number, event_type, period_id, detail
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING ${EVENT_COLUMNS}`,
      [
        input.advertisementId,
        input.advertiserId,
        input.boundaryPeriodNumber,
        input.eventType,
        input.periodId ?? null,
        JSON.stringify(input.detail ?? {}),
      ],
    );
    return rows[0]!;
  }

  /** Has this exact boundary outcome already been recorded? */
  async findEventInTx(
    client: PoolClient,
    params: { advertisementId: string; boundaryPeriodNumber: number; eventType: AdRenewalEventType },
  ): Promise<AdvertisementRenewalEventRow | null> {
    const { rows } = await client.query<AdvertisementRenewalEventRow>(
      `SELECT ${EVENT_COLUMNS}
       FROM advertisement_renewal_events
       WHERE advertisement_id = $1
         AND boundary_period_number = $2
         AND event_type = $3
       LIMIT 1`,
      [params.advertisementId, params.boundaryPeriodNumber, params.eventType],
    );
    return rows[0] ?? null;
  }

  /** Stamp the outbox: the durable in-app notification for this event exists. */
  async markEventNotifiedInTx(client: PoolClient, eventId: string): Promise<void> {
    await client.query(
      `UPDATE advertisement_renewal_events SET notified_at = now() WHERE id = $1`,
      [eventId],
    );
  }

  /**
   * Claim ONE undelivered event, inside the caller's transaction.
   *
   * `SKIP LOCKED` plus `notified_at IS NULL` is the whole concurrency story: of
   * ten workers sweeping the same event, one takes the row and the other nine
   * get nothing back. Because the claim, the notification insert and the stamp
   * all commit together, a crash mid-delivery leaves the event undelivered
   * rather than half-delivered, and the next sweep picks it up.
   */
  async lockUndeliveredEventInTx(
    client: PoolClient,
    eventId: string,
  ): Promise<AdvertisementRenewalEventRow | null> {
    const { rows } = await client.query<AdvertisementRenewalEventRow>(
      `SELECT ${EVENT_COLUMNS}
       FROM advertisement_renewal_events
       WHERE id = $1 AND notified_at IS NULL
       FOR UPDATE SKIP LOCKED`,
      [eventId],
    );
    return rows[0] ?? null;
  }

  /** Committed but undelivered events, oldest first. */
  async listUndeliveredEventIds(limit: number): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id
       FROM advertisement_renewal_events
       WHERE notified_at IS NULL
       ORDER BY created_at
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((row) => row.id);
  }

  /** Provider-facing renewal history, newest first. */
  async listEvents(advertisementId: string, limit: number): Promise<AdvertisementRenewalEventRow[]> {
    const { rows } = await getPool().query<AdvertisementRenewalEventRow>(
      `SELECT ${EVENT_COLUMNS}
       FROM advertisement_renewal_events
       WHERE advertisement_id = $1
       ORDER BY created_at DESC, boundary_period_number DESC
       LIMIT $2::int`,
      [advertisementId, limit],
    );
    return rows;
  }

  // -------------------------------------------------------------------------
  // Period history
  // -------------------------------------------------------------------------

  /**
   * One page of a campaign's weeks.
   *
   * `action_charge_id` is reduced to a boolean by the caller: a provider needs
   * to know whether a week was paid for, not the identifier of the ledger row
   * that paid for it.
   */
  async listPeriodsPaged(
    advertisementId: string,
    page: number,
    limit: number,
  ): Promise<{
    rows: {
      id: string;
      period_number: number;
      starts_at: string;
      ends_at: string;
      mhc_price_snapshot: string;
      status: string;
      renewal_source: string;
      action_charge_id: string | null;
      created_at: string;
    }[];
    total: number;
  }> {
    const offset = (page - 1) * limit;
    const { rows } = await getPool().query<{
      id: string;
      period_number: number;
      starts_at: string;
      ends_at: string;
      mhc_price_snapshot: string;
      status: string;
      renewal_source: string;
      action_charge_id: string | null;
      created_at: string;
    }>(
      `SELECT id, period_number, starts_at, ends_at, mhc_price_snapshot::text,
              status, renewal_source, action_charge_id, created_at
       FROM advertisement_campaign_periods
       WHERE advertisement_id = $1
       ORDER BY period_number DESC
       LIMIT $2::int OFFSET $3::int`,
      [advertisementId, limit, offset],
    );
    const { rows: countRows } = await getPool().query<{ c: string }>(
      `SELECT count(*)::text AS c FROM advertisement_campaign_periods WHERE advertisement_id = $1`,
      [advertisementId],
    );
    return { rows, total: parseInt(countRows[0]?.c ?? '0', 10) };
  }
}
