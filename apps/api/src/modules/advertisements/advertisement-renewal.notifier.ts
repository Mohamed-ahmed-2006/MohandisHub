import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { NotificationsService } from '../notifications/notifications.service.js';

import { AdvertisementRenewalRepository } from './advertisement-renewal.repository.js';
import type { AdRenewalEventType, AdvertisementRenewalEventRow } from './advertisements.types.js';

// ---------------------------------------------------------------------------
// Advertisement renewal notifications, delivered from an OUTBOX.
// ---------------------------------------------------------------------------
// The durable record of "this happened at this boundary" is the
// `advertisement_renewal_events` row, and it is written inside the same
// transaction as the charge and the period. The in-app notification is that
// row's DELIVERY, and it deliberately happens in a separate, tiny transaction
// afterwards. Three properties follow, and all three were requirements:
//
//   * a notification failure can never roll back a committed renewal. The
//     financial transaction does not contain a notification insert at all;
//   * a crash between the financial commit and the notification cannot lose the
//     notification. The event row survives with `notified_at IS NULL`, and the
//     next sweep delivers it;
//   * a notification cannot be delivered twice. `FOR UPDATE SKIP LOCKED` on an
//     undelivered row means exactly one worker claims it, and the stamp commits
//     with the notification.
//
// Web push and email happen only AFTER that commit, so no advertisement row and
// no wallet row is ever locked across a network call.
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

export class AdvertisementRenewalNotifier {
  constructor(
    private readonly repo: AdvertisementRenewalRepository = new AdvertisementRenewalRepository(),
    private readonly notifications: NotificationsService = new NotificationsService(),
  ) {}

  /**
   * Deliver one event, if it is still undelivered and nobody else has it.
   *
   * Returns false — not an error — when another worker owns the row or it was
   * already delivered. "Somebody else is doing it" is the expected outcome of a
   * race, not a failure to report.
   */
  async deliverEvent(eventId: string): Promise<boolean> {
    const client = await getPool().connect();
    let delivered: {
      userId: string;
      content: AdvertisementNotificationContent;
      persisted: { id: string; createdAt: string } | null;
      email: string | null;
      displayName: string | null;
    } | null = null;
    try {
      await client.query('BEGIN');
      const event = await this.repo.lockUndeliveredEventInTx(client, eventId);
      if (!event) {
        await client.query('COMMIT');
        return false;
      }

      const { rows } = await client.query<{
        title_en: string;
        advertiser_id: string;
        email: string | null;
        display_name: string | null;
      }>(
        `SELECT a.title_en, a.advertiser_id, u.email, u.display_name
         FROM advertisements a
         JOIN users u ON u.id = a.advertiser_id
         WHERE a.id = $1`,
        [event.advertisement_id],
      );
      const ad = rows[0];
      if (!ad) {
        // The campaign was deleted between the event and its delivery. Stamp it
        // so the sweep stops reconsidering an event with no recipient.
        await this.repo.markEventNotifiedInTx(client, event.id);
        await client.query('COMMIT');
        return false;
      }

      const content = buildRenewalNotification(event, ad.title_en);
      // Ownership is taken from the EVENT row, which was written with the
      // advertiser's id inside the financial transaction — never from anything
      // a caller supplied.
      const recipient = event.advertiser_id;
      const persisted = await this.notifications.createDurableInTx(client, recipient, {
        type: content.type,
        title: content.title,
        message: content.message,
        payload: content.payload,
      });
      await this.repo.markEventNotifiedInTx(client, event.id);
      await client.query('COMMIT');

      delivered = {
        userId: recipient,
        content,
        persisted:
          persisted.persisted && persisted.id && persisted.createdAt
            ? { id: persisted.id, createdAt: persisted.createdAt }
            : null,
        email: ad.email,
        displayName: ad.display_name,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    // AFTER the commit, and outside every lock this method took.
    await this.notifications.deliverOutOfBand(
      delivered.userId,
      {
        type: delivered.content.type,
        title: delivered.content.title,
        message: delivered.content.message,
        payload: delivered.content.payload,
        ...(delivered.email ? { recipientEmail: delivered.email } : {}),
        ...(delivered.displayName ? { recipientDisplayName: delivered.displayName } : {}),
      },
      delivered.persisted,
    );
    return true;
  }

  /**
   * Deliver up to `limit` events that were committed but never delivered.
   *
   * The recovery half of the outbox. One failure does not stop the batch: each
   * event is independent, and an event that throws is left undelivered for the
   * next sweep rather than blocking the ones behind it.
   */
  async deliverPending(limit = 50): Promise<{ examined: number; delivered: number }> {
    const ids = await this.repo.listUndeliveredEventIds(limit);
    let delivered = 0;
    for (const id of ids) {
      try {
        if (await this.deliverEvent(id)) delivered += 1;
      } catch (error) {
        logger.warn('Advertisement renewal notification delivery failed', {
          eventId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { examined: ids.length, delivered };
  }

  /** Fire-and-forget delivery for an event this process just committed. */
  deliverSoon(eventId: string | null | undefined): void {
    if (!eventId) return;
    void this.deliverEvent(eventId).catch((error: unknown) => {
      // Deliberately swallowed: the event row survives with notified_at NULL,
      // so the sweep will deliver it. Losing a push is never a reason to fail a
      // request whose financial half already committed.
      logger.warn('Immediate advertisement notification delivery failed', {
        eventId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}
