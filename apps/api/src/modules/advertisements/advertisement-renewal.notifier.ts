import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import {
  AdvertisementRenewalRepository,
  MAX_DELIVERY_ATTEMPTS,
} from './advertisement-renewal.repository.js';
import type { AdRenewalEventType, AdvertisementRenewalEventRow } from './advertisements.types.js';

// ---------------------------------------------------------------------------
// Advertisement renewal notifications, delivered from an OUTBOX.
// ---------------------------------------------------------------------------
// The durable record of "this happened at this boundary" is the
// `advertisement_renewal_events` row, written inside the same transaction as
// the charge and the period. Delivery is separate, and happens in three ordered
// steps with the external calls strictly between two transactions:
//
//   1. CLAIM    — lock a deliverable row, write the in-app notification if it
//                 does not exist yet, take a time-limited lease, COMMIT;
//   2. SEND     — push and email, outside every lock and transaction;
//   3. ACKNOWLEDGE — a second transaction marks `delivered`, or releases the
//                 lease with a backoff, or parks the event as `failed` once the
//                 attempt budget is gone.
//
// What that does and does not guarantee — stated exactly, because the previous
// version of this comment overstated it:
//
//   * the EVENT is exactly once. `uq_ad_renewal_event_boundary` enforces it;
//   * the IN-APP notification is exactly once. It is written under the same
//     lock that sets `in_app_notification_id`, and a retry that finds the
//     column populated does not write another;
//   * PUSH and EMAIL are AT-LEAST-ONCE. The Web Push protocol has no
//     idempotency key, and `sendTransactionalEmail` passes none to Resend
//     (which does support one), so a crash after a send but before its
//     acknowledgement will resend when the lease expires. A rare duplicate
//     push or email is the accepted cost of never silently losing one;
//   * a notification failure can never roll back a committed renewal. The
//     financial transaction contains no notification write at all;
//   * a worker that dies mid-delivery cannot strand an event. The lease expires
//     and the sweep re-claims it;
//   * the retry is BOUNDED (`MAX_DELIVERY_ATTEMPTS`) and OBSERVABLE
//     (`attempt_count`, `last_delivery_error`, `delivery_status = 'failed'`).
//
// Nothing is stamped delivered before the external send. Doing that would
// suppress duplicates by losing messages instead, which is the worse failure —
// and was the defect this design replaced.
//
// Web push and email happen only after the claim commits, so no advertisement
// row and no wallet row is ever locked across a network call.
//
// The stored title and message are English. Every client renders these types
// through `dictionary.notificationTemplates`, which interpolates `{adTitle}`
// and `{periodNumber}` from the payload — so Arabic and English are both real
// translations rather than a machine rendering of one stored string.
// ---------------------------------------------------------------------------

/** Notification type per boundary event. One notification kind per event kind. */
const NOTIFICATION_TYPE_BY_EVENT: Record<AdRenewalEventType, string> = {
  initial_activated: 'advertisement_activated',
  renewal_succeeded: 'advertisement_renewed',
  renewal_failed_insufficient_credits: 'advertisement_renewal_failed_credits',
  renewal_failed_pricing_unavailable: 'advertisement_renewal_failed_pricing',
  manual_renewal_required: 'advertisement_renewal_required',
  renewal_reminder: 'advertisement_renewal_reminder',
  auto_renew_stopped_max_weeks: 'advertisement_auto_renew_stopped_max_weeks',
  auto_renew_stopped_end_date: 'advertisement_auto_renew_stopped_end_date',
  auto_renew_enabled: 'advertisement_auto_renew_enabled',
  auto_renew_disabled: 'advertisement_auto_renew_disabled',
};

type EventCopy = { title: string; message: string };

/**
 * English fallback copy. Deliberately says nothing a screen would have to
 * contradict: no currency symbol, no balance, no "per day", no "per campaign".
 */
const COPY_BY_EVENT: Record<AdRenewalEventType, EventCopy> = {
  initial_activated: {
    title: 'Your advertisement is live',
    message: 'Your first advertisement week has started and runs for 168 hours.',
  },
  renewal_succeeded: {
    title: 'Advertisement renewed',
    message: 'Another advertisement week was renewed automatically and runs for 168 hours.',
  },
  renewal_failed_insufficient_credits: {
    title: 'Advertisement paused — not enough credits',
    message:
      'Automatic renewal could not run because your credit balance was too low. Nothing was charged. Add credits and retry to start another week.',
  },
  renewal_failed_pricing_unavailable: {
    title: 'Advertisement paused',
    message:
      'Automatic renewal could not run because advertisement pricing is unavailable. Nothing was charged.',
  },
  manual_renewal_required: {
    title: 'Advertisement week ended',
    message: 'The week you paid for has ended. Renew to run for another 168 hours.',
  },
  renewal_reminder: {
    title: 'Advertisement renews soon',
    message:
      'Your advertisement week ends soon and will renew automatically. Make sure you have enough credits.',
  },
  auto_renew_stopped_max_weeks: {
    title: 'Automatic renewal finished',
    message:
      'Your campaign reached the maximum number of weeks you set, so automatic renewal has stopped. Nothing was charged.',
  },
  auto_renew_stopped_end_date: {
    title: 'Automatic renewal finished',
    message:
      'A full week would not fit before the end date you set, so automatic renewal has stopped. Nothing was charged.',
  },
  auto_renew_enabled: {
    title: 'Automatic renewal is on',
    message: 'Your advertisement will renew itself each week within the limits you set.',
  },
  auto_renew_disabled: {
    title: 'Automatic renewal is off',
    message:
      'Your advertisement will not renew itself. The week you already paid for keeps running to the end.',
  },
};

export type AdvertisementNotificationContent = {
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
};

/**
 * Build what the advertiser is told about one boundary event.
 *
 * Exported for tests, and deliberately pure: given an event row it returns the
 * notification with no database access, so what a provider receives can be
 * asserted without a server.
 *
 * The payload carries only the campaign's own identifiers and the figures the
 * provider was already shown: no balance, no wallet id, no charge id, no ledger
 * reference and no identifier belonging to anybody else.
 */
export function buildRenewalNotification(
  event: Pick<
    AdvertisementRenewalEventRow,
    'advertisement_id' | 'event_type' | 'boundary_period_number' | 'detail'
  >,
  adTitle: string,
): AdvertisementNotificationContent {
  const copy = COPY_BY_EVENT[event.event_type];
  const detail = event.detail ?? {};
  const payload: Record<string, unknown> = {
    advertisementId: event.advertisement_id,
    adTitle,
    periodNumber: event.boundary_period_number,
  };
  if (typeof detail.mhcCharged === 'number') payload.mhcCharged = detail.mhcCharged;
  if (typeof detail.requiredMhc === 'number') payload.requiredMhc = detail.requiredMhc;
  if (typeof detail.maximumWeeks === 'number') payload.maximumWeeks = detail.maximumWeeks;
  if (typeof detail.renewalEndDate === 'string') payload.renewalEndDate = detail.renewalEndDate;
  if (typeof detail.periodEndsAt === 'string') payload.periodEndsAt = detail.periodEndsAt;

  return {
    type: NOTIFICATION_TYPE_BY_EVENT[event.event_type],
    title: copy.title,
    message: copy.message,
    payload,
  };
}

/**
 * Sentinel written into `in_app_notification_id` when the recipient has
 * switched the in-app channel off.
 *
 * A completed decision needs to be distinguishable from "not written yet", or
 * every retry would reconsider the preference and the column would stay null
 * forever. The all-zero UUID points at no notification, which is exactly true.
 */
const SUPPRESSED_IN_APP = '00000000-0000-0000-0000-000000000000';

/** What one delivery attempt did. Every value is a normal outcome. */
export type DeliveryOutcome =
  /** Another worker holds the lease, or it is already delivered or failed. */
  | 'not_claimable'
  /** The campaign is gone; there is nobody to tell. */
  | 'orphaned'
  | 'delivered'
  /** A channel failed and the lease was released with a backoff. */
  | 'retry_scheduled'
  /** The retry budget is gone. An operator's problem now. */
  | 'exhausted'
  /** The send happened but the acknowledgement did not. The lease expires. */
  | 'ack_failed';

type ClaimedDelivery =
  | { kind: 'orphaned' }
  | {
      kind: 'claimed';
      userId: string;
      attemptCount: number;
      persisted: { id: string; createdAt: string } | null;
      input: {
        type: string;
        title: string;
        message: string;
        payload: Record<string, unknown>;
        recipientEmail?: string;
        recipientDisplayName?: string;
      };
    };

export class AdvertisementRenewalNotifier {
  constructor(
    private readonly repo: AdvertisementRenewalRepository = new AdvertisementRenewalRepository(),
    private readonly notifications: NotificationsService = new NotificationsService(),
  ) {}

  /**
   * Deliver one event: claim, send, acknowledge — three ordered steps, two
   * transactions, with the external calls strictly between them.
   *
   * Returns false — not an error — when another worker holds the lease or the
   * event is already delivered. "Somebody else is doing it" is the expected
   * outcome of a race, not a failure to report.
   */
  async deliverEvent(eventId: string): Promise<DeliveryOutcome> {
    // ---- 1. CLAIM ---------------------------------------------------------
    // Writes the in-app notification (once, ever) and takes a lease. Commits
    // BEFORE any external call, so nothing is marked delivered on the strength
    // of a send that has not happened.
    const claim = await this.claim(eventId);
    if (!claim) return 'not_claimable';
    if (claim.kind === 'orphaned') return 'orphaned';

    // ---- 2. SEND ----------------------------------------------------------
    // Outside every lock and every transaction. Only the channels that have not
    // already succeeded on an earlier attempt are attempted again.
    const result = await this.notifications.deliverChannels(
      claim.userId,
      claim.input,
      claim.persisted,
    );

    // ---- 3. ACKNOWLEDGE ---------------------------------------------------
    const failed = result.email === 'failed' || result.push === 'failed';
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '3s'`);
      if (failed) {
        const settled = await this.repo.recordDeliveryFailureInTx(client, {
          eventId,
          attemptCount: claim.attemptCount,
          error: result.error ?? 'unknown delivery failure',
        });
        await client.query('COMMIT');
        logger[settled === 'failed' ? 'error' : 'warn'](
          settled === 'failed'
            ? 'Advertisement notification delivery gave up'
            : 'Advertisement notification delivery will retry',
          {
            eventId,
            attempt: claim.attemptCount,
            maxAttempts: MAX_DELIVERY_ATTEMPTS,
            channels: { email: result.email, push: result.push },
            error: result.error,
          },
        );
        return settled === 'failed' ? 'exhausted' : 'retry_scheduled';
      }
      await this.repo.markEventDeliveredInTx(client, eventId);
      await client.query('COMMIT');
      return 'delivered';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // The lease is still held and will expire on its own, so the event is
      // retried rather than stranded. Nothing financial is involved here.
      logger.warn('Advertisement notification acknowledgement failed', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'ack_failed';
    } finally {
      client.release();
    }
  }

  /**
   * Take the lease and make sure the in-app notification exists — in one
   * transaction, committed before anything leaves the process.
   *
   * The in-app row is written only when `in_app_notification_id` is still null,
   * so a retry of the external channels never writes the advertiser a second
   * copy of the same message.
   */
  private async claim(eventId: string): Promise<ClaimedDelivery | null> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // A delivery must never sit behind an unrelated write. This transaction
      // takes a row lock on the event and then touches `notifications`, while
      // anything that deletes an advertisement cascades INTO the event table —
      // opposite lock order, so the two can genuinely deadlock. Bounding the
      // wait turns that from a stuck delivery into a failed attempt, and a
      // failed attempt is already a retry: the claim rolls back, the event
      // stays `pending`, and the next sweep picks it up.
      await client.query(`SET LOCAL lock_timeout = '3s'`);
      const event = await this.repo.lockDeliverableEventInTx(client, eventId);
      if (!event) {
        await client.query('COMMIT');
        return null;
      }

      const { rows } = await client.query<{
        title_en: string;
        email: string | null;
        display_name: string | null;
      }>(
        `SELECT a.title_en, u.email, u.display_name
         FROM advertisements a
         JOIN users u ON u.id = a.advertiser_id
         WHERE a.id = $1`,
        [event.advertisement_id],
      );
      const ad = rows[0];
      if (!ad) {
        // The campaign was deleted between the event and its delivery. There is
        // nobody to tell, so settle it as delivered rather than retrying an
        // event with no recipient five times.
        await this.repo.markEventDeliveredInTx(client, event.id);
        await client.query('COMMIT');
        return { kind: 'orphaned' } as ClaimedDelivery;
      }

      const content = buildRenewalNotification(event, ad.title_en);
      // Ownership comes from the EVENT row, written with the advertiser's id
      // inside the financial transaction — never from anything a caller
      // supplied, and never from this lookup.
      const recipient = event.advertiser_id;

      let persisted: { id: string; createdAt: string } | null = null;
      if (event.in_app_notification_id === null) {
        const created = await this.notifications.createDurableInTx(client, recipient, {
          type: content.type,
          title: content.title,
          message: content.message,
          payload: content.payload,
        });
        if (created.persisted && created.id && created.createdAt) {
          persisted = { id: created.id, createdAt: created.createdAt };
          await this.repo.attachInAppNotificationInTx(client, event.id, created.id);
        } else {
          // The recipient switched the in-app channel off. That is a completed
          // decision, and marking it so stops a later retry reconsidering it.
          await this.repo.attachInAppNotificationInTx(client, event.id, SUPPRESSED_IN_APP);
        }
      }

      const attemptCount = await this.repo.markEventClaimedInTx(client, event.id);
      await client.query('COMMIT');

      return {
        kind: 'claimed',
        userId: recipient,
        attemptCount,
        persisted,
        input: {
          type: content.type,
          title: content.title,
          message: content.message,
          payload: content.payload,
          ...(ad.email ? { recipientEmail: ad.email } : {}),
          ...(ad.display_name ? { recipientDisplayName: ad.display_name } : {}),
        },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Deliver up to `limit` events that nobody is currently delivering.
   *
   * The recovery half of the outbox, and the only thing that retries a lease
   * whose worker died. One failure does not stop the batch: each event is
   * independent, and an event that throws keeps its lease until it expires
   * rather than blocking the ones behind it.
   */
  async deliverPending(limit = 50): Promise<{
    examined: number;
    delivered: number;
    retrying: number;
    exhausted: number;
  }> {
    const ids = await this.repo.listDeliverableEventIds(limit);
    const tally = { examined: ids.length, delivered: 0, retrying: 0, exhausted: 0 };
    for (const id of ids) {
      try {
        const outcome = await this.deliverEvent(id);
        if (outcome === 'delivered') tally.delivered += 1;
        if (outcome === 'retry_scheduled' || outcome === 'ack_failed') tally.retrying += 1;
        if (outcome === 'exhausted') tally.exhausted += 1;
      } catch (error) {
        tally.retrying += 1;
        logger.warn('Advertisement renewal notification delivery failed', {
          eventId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return tally;
  }

  /** Fire-and-forget delivery for an event this process just committed. */
  deliverSoon(eventId: string | null | undefined): void {
    if (!eventId) return;
    void this.deliverEvent(eventId).catch((error: unknown) => {
      // Deliberately swallowed: the event row survives as pending (or leased,
      // and the lease expires), so the sweep will deliver it. Losing a push is
      // never a reason to fail a request whose financial half already committed.
      logger.warn('Immediate advertisement notification delivery failed', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
