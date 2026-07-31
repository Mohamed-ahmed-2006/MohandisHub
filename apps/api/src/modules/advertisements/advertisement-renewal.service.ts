import type { PoolClient } from 'pg';

import { logger } from '../../config/logger.js';
import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { MhcService } from '../mhc/mhc.service.js';

import { AdvertisementBillingService } from './advertisement-billing.service.js';
import { AdvertisementRenewalNotifier } from './advertisement-renewal.notifier.js';
import { AdvertisementRenewalRepository } from './advertisement-renewal.repository.js';
import { AD_PERIOD_HOURS, AdvertisementsRepository } from './advertisements.repository.js';
import type {
  AdAutoRenewPausedReason,
  AdRenewalEventType,
  AdvertisementPeriodRow,
  AdvertisementRow,
} from './advertisements.types.js';
import type { AutoRenewalInput } from './advertisements.validation.js';

// ---------------------------------------------------------------------------
// Automatic weekly advertisement renewal.
// ---------------------------------------------------------------------------
// A standing instruction to debit a provider's credits every week is the most
// dangerous thing in this subsystem, so the whole design is built around one
// question: what stops it charging twice, and what stops it charging forever?
//
// Charging twice is prevented by four database facts, not by this file:
//
//   * the advertisement row is LOCKED for the whole attempt, so two workers
//     cannot both decide the same boundary is due;
//   * `uq_ad_period_number` makes period N unique per campaign;
//   * `uq_ad_period_active` makes at most one week running per campaign, and
//     `ad_period_no_overlap` makes weeks non-overlapping;
//   * `uq_mhc_action_charge_reference` makes the charge idempotent against the
//     period id, which is preallocated BEFORE the charge.
//
// Charging forever is prevented by three:
//
//   * `maximum_weeks` and `renewal_end_date`, at least one of which must exist
//     (`chk_advertisements_auto_renew_bounded`);
//   * `auto_renew_paused_reason`, which takes a failed boundary out of the
//     scheduler's candidate index until an ADVERTISER clears it. There is no
//     timer that clears it, so a failed renewal cannot become a retry loop;
//   * `uq_ad_renewal_event_boundary`, which makes each boundary outcome record
//     exactly once, so even a cleared pause cannot produce a second
//     notification for the same failure.
//
// Nothing here reads a price, a balance, an amount or a period length from a
// caller. The price is resolved by the charging primitive inside the same
// transaction; the period length is a CHECK constraint.
// ---------------------------------------------------------------------------

/**
 * Which wording of the automatic-renewal terms the advertiser is consenting to.
 *
 * Stored with the consent so a later change to what the screen says is
 * distinguishable from what they actually agreed to. Bump it when the terms
 * shown next to the toggle change in substance.
 */
export const AUTO_RENEW_CONSENT_VERSION = '2026-07-31.weekly-168h.v1';

/** Charge failures that mean "pricing is not usable", as opposed to "no credits". */
const PRICING_FAILURE_CODES = new Set([
  'MHC_ACTION_PRICE_MISSING',
  'MHC_ACTION_DISABLED',
  'MHC_ACTION_SCOPE_PRICE_MISSING',
]);

const isInsufficientCredits = (error: unknown): boolean =>
  error instanceof HttpError && error.code === 'MHC_INSUFFICIENT_CREDITS';

const isPricingUnavailable = (error: unknown): boolean =>
  error instanceof HttpError && PRICING_FAILURE_CODES.has(error.code);

/** Why an attempt did nothing. Every value is a normal outcome, not an error. */
export type RenewalSkipReason =
  | 'claimed_elsewhere'
  | 'not_found'
  | 'not_weekly'
  | 'not_automatic'
  | 'paused'
  | 'cancelled_or_rejected'
  | 'period_still_active'
  | 'never_started'
  | 'already_renewed';

export type AutomaticRenewalResult =
  | {
      outcome: 'renewed';
      advertisement: AdvertisementRow;
      period: AdvertisementPeriodRow;
      mhcCharged: number;
    }
  | { outcome: 'skipped'; reason: RenewalSkipReason }
  | {
      outcome: 'paused';
      reason: AdAutoRenewPausedReason;
      advertisement: AdvertisementRow;
      /** What the week would have cost, when that is known. */
      requiredMhc: number | null;
    };

export type AutoRenewalStateView = {
  advertisementId: string;
  renewalMode: 'manual' | 'automatic';
  autoRenewEnabled: boolean;
  maximumWeeks: number | null;
  renewalEndDate: string | null;
  autoRenewEnabledAt: string | null;
  autoRenewConsentVersion: string | null;
  autoRenewPausedReason: AdAutoRenewPausedReason | null;
  autoRenewPausedAt: string | null;
  lastRenewalOutcome: string | null;
  lastRenewalAttemptAt: string | null;
  periodsUsed: number;
  nextRenewalAt: string | null;
  /** Whether the provider may switch this campaign to automatic renewal at all. */
  autoRenewalAvailable: boolean;
  consentVersion: string;
};

export class AdvertisementRenewalService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    private readonly renewalRepo: AdvertisementRenewalRepository = new AdvertisementRenewalRepository(),
    private readonly billing: AdvertisementBillingService = new AdvertisementBillingService(),
    private readonly notifier: AdvertisementRenewalNotifier = new AdvertisementRenewalNotifier(),
    private readonly mhc: MhcService = new MhcService(),
  ) {}

  // =========================================================================
  // Provider configuration
  // =========================================================================

  /**
   * Switch a campaign between manual and automatic renewal, or update its
   * bounds.
   *
   * This method NEVER charges. It cannot: no branch below reaches the charging
   * primitive, so "changing your renewal settings does not cost credits" is a
   * property of the call graph rather than of a guard somebody could remove.
   * It also never touches the running period — the week the advertiser already
   * paid for keeps running to its end whatever they choose here.
   *
   * Repeating an identical request is a no-op that reports the stored state and
   * sends no second acknowledgement.
   */
  async configureAutoRenewal(params: {
    advertisementId: string;
    providerId: string;
    input: AutoRenewalInput;
  }): Promise<AutoRenewalStateView> {
    const client = await getPool().connect();
    let eventId: string | null = null;
    let view: AutoRenewalStateView;
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, params.advertisementId);
      if (!ad) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (ad.advertiser_id !== params.providerId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'This ad does not belong to you.',
        });
      }
      // A campaign that predates weekly billing has no periods and is never
      // charged in credits. Letting one carry an automatic-renewal instruction
      // would be a setting that can never take effect.
      if (ad.billing_model !== 'weekly') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_WEEKLY',
          message:
            'This campaign predates weekly billing and cannot renew automatically.',
          details: { billingModel: ad.billing_model },
        });
      }
      if (ad.status === 'cancelled' || ad.status === 'rejected' || ad.billing_status === 'cancelled') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_AUTO_RENEWAL_NOT_CONFIGURABLE',
          message: 'A cancelled or rejected advertisement cannot renew.',
          details: { status: ad.status },
        });
      }

      const periodsUsed = await this.repo.getMaxPeriodNumberInTx(client, ad.id);
      const now = await this.renewalRepo.now(client);

      const requested = params.input.enabled
        ? await this.validateEnable(client, ad, params.input, periodsUsed, now)
        : {
            maximumWeeks: params.input.maximumWeeks ?? ad.maximum_weeks,
            renewalEndDate: params.input.renewalEndDate ?? ad.renewal_end_date,
          };

      // Idempotency, checked against the STORED row rather than remembered.
      // A retried request — a double click, a lost response — reports the same
      // configuration and acknowledges it once.
      const unchanged =
        ad.auto_renew_enabled === params.input.enabled &&
        ad.renewal_mode === (params.input.enabled ? 'automatic' : 'manual') &&
        (ad.maximum_weeks ?? null) === (requested.maximumWeeks ?? null) &&
        sameInstant(ad.renewal_end_date, requested.renewalEndDate) &&
        // A paused campaign is NOT unchanged: re-submitting the same
        // configuration is the advertiser's way of saying "try again".
        ad.auto_renew_paused_reason === null;

      if (unchanged) {
        await client.query('COMMIT');
        return this.toStateView(ad, periodsUsed);
      }

      const updated = await this.renewalRepo.writeAutoRenewalConfigInTx(client, {
        advertisementId: ad.id,
        enabled: params.input.enabled,
        maximumWeeks: requested.maximumWeeks ?? null,
        renewalEndDate: requested.renewalEndDate ?? null,
        consentBy: params.input.enabled ? params.providerId : null,
        consentVersion: params.input.enabled ? AUTO_RENEW_CONSENT_VERSION : null,
      });

      // Only acknowledge a real transition, so re-submitting bounds does not
      // announce "automatic renewal is on" again.
      if (ad.auto_renew_enabled !== params.input.enabled) {
        const event = await this.renewalRepo.insertEventInTx(client, {
          advertisementId: ad.id,
          advertiserId: ad.advertiser_id,
          boundaryPeriodNumber: periodsUsed + 1,
          eventType: params.input.enabled ? 'auto_renew_enabled' : 'auto_renew_disabled',
          detail: {
            ...(requested.maximumWeeks != null ? { maximumWeeks: requested.maximumWeeks } : {}),
            ...(requested.renewalEndDate ? { renewalEndDate: requested.renewalEndDate } : {}),
          },
        });
        eventId = event.id;
      }

      view = this.toStateView(updated, periodsUsed);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    this.notifier.deliverSoon(eventId);
    return view;
  }

  /**
   * Everything `enabled: true` has to satisfy before a single column is written.
   *
   * Each rejection is a distinct, stable code, because each has a different
   * remedy: agree to the terms, choose a bound, raise the week count, or move
   * the end date.
   */
  private async validateEnable(
    client: PoolClient,
    ad: AdvertisementRow,
    input: AutoRenewalInput,
    periodsUsed: number,
    now: Date,
  ): Promise<{ maximumWeeks: number | null; renewalEndDate: string | null }> {
    if (input.consentAccepted !== true) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_AUTO_RENEWAL_CONSENT_REQUIRED',
        message:
          'Automatic renewal charges credits every week without asking again, so it needs your explicit agreement.',
        details: { consentVersion: AUTO_RENEW_CONSENT_VERSION },
      });
    }

    // `undefined` means "leave what is stored"; `null` means "clear it". The
    // distinction matters, because clearing BOTH bounds is the one shape an
    // automatic campaign may never have.
    const maximumWeeks =
      input.maximumWeeks === undefined ? ad.maximum_weeks : (input.maximumWeeks ?? null);
    const renewalEndDate =
      input.renewalEndDate === undefined ? ad.renewal_end_date : (input.renewalEndDate ?? null);

    if (maximumWeeks === null && renewalEndDate === null) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_AUTO_RENEWAL_BOUND_REQUIRED',
        message:
          'Set a maximum number of weeks, an end date, or both. Automatic renewal is never open-ended.',
      });
    }

    // Both bounds may be supplied; whichever is reached FIRST stops the
    // campaign, because each is checked independently at every boundary.
    if (maximumWeeks !== null && maximumWeeks <= periodsUsed) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_AUTO_RENEWAL_MAX_WEEKS_TOO_LOW',
        message:
          'This campaign has already used that many weeks, so automatic renewal could never buy another one.',
        details: { maximumWeeks, periodsUsed },
      });
    }

    if (renewalEndDate !== null) {
      // Measured from the end of the week the advertiser has already paid for,
      // because that is when the next one would start. Compared against the
      // DATABASE clock, never the caller's.
      const nextStart = ad.current_period_ends_at ? new Date(ad.current_period_ends_at) : now;
      const from = nextStart.getTime() > now.getTime() ? nextStart : now;
      if (!(await this.renewalRepo.periodFitsBeforeBoundary(client, from, renewalEndDate))) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_AUTO_RENEWAL_END_DATE_TOO_SOON',
          message: `A full ${AD_PERIOD_HOURS}-hour week would not fit before that end date. Advertisement weeks are never shortened or prorated.`,
          details: { renewalEndDate },
        });
      }
    }

    return { maximumWeeks, renewalEndDate };
  }

  // =========================================================================
  // The exactly-once renewal
  // =========================================================================

  /**
   * Buy the next week for one automatic campaign, or record exactly why not.
   *
   * The single entry point for automatic renewal. The scheduler calls it with
   * `blocking: false` so a worker that finds the row claimed moves on; the
   * advertiser's explicit retry calls it with `blocking: true` and
   * `clearPause: true`, so a human pressing a button gets an answer about
   * committed state rather than a silent skip.
   *
   * Everything that could have changed since the candidate read — the mode, the
   * consent, the bounds, the cancellation, the period — is re-read UNDER THE
   * LOCK. A campaign the advertiser cancelled or switched to manual a
   * millisecond before this transaction acquired the row is not renewed, and a
   * campaign that was renewed by the manual endpoint a millisecond before is
   * not renewed twice.
   */
  async renewAutomatically(
    advertisementId: string,
    options: {
      blocking?: boolean;
      clearPause?: boolean;
      requireAdvertiserId?: string | null;
      actorUserId?: string | null;
    } = {},
  ): Promise<AutomaticRenewalResult> {
    const client = await getPool().connect();
    let committed: { result: AutomaticRenewalResult; eventId: string | null } | null = null;
    try {
      await client.query('BEGIN');
      // A worker must never sit on a lock. Five seconds is far longer than any
      // renewal takes and far shorter than a sweep interval, so a contended row
      // fails this attempt and is retried on the next tick rather than pinning
      // a connection.
      await client.query(`SET LOCAL lock_timeout = '5s'`);

      const ad = options.blocking
        ? await this.repo.findAdForUpdate(client, advertisementId)
        : await this.renewalRepo.claimAdForUpdate(client, advertisementId);

      if (!ad) {
        await client.query('COMMIT');
        // With SKIP LOCKED these are indistinguishable, and deliberately so:
        // both mean "do nothing", and the interactive path uses the blocking
        // read precisely so it can tell them apart.
        if (options.blocking) {
          throw new HttpError({
            statusCode: 404,
            code: 'AD_NOT_FOUND',
            message: 'Advertisement not found.',
          });
        }
        return { outcome: 'skipped', reason: 'claimed_elsewhere' };
      }

      if (options.requireAdvertiserId && ad.advertiser_id !== options.requireAdvertiserId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'This ad does not belong to you.',
        });
      }

      const guard = this.guardRenewalPreconditions(ad, options.clearPause === true);
      if (guard) {
        await client.query('COMMIT');
        return guard;
      }

      const now = await this.renewalRepo.now(client);

      // A week that is still running is not a boundary. Checked from the PERIOD
      // table, which is authoritative — a stale mirror column cannot make the
      // scheduler buy a week early, and cannot make it skip one.
      const active = await this.repo.findActivePeriodInTx(client, ad.id);
      if (active) {
        if (new Date(active.ends_at).getTime() > now.getTime()) {
          await client.query('COMMIT');
          return { outcome: 'skipped', reason: 'period_still_active' };
        }
        // The week ended but the expiry sweep has not run. Close it here, in
        // the same transaction that opens the next one, so the campaign has no
        // gap between the week it paid for and the week it is about to buy.
        await this.renewalRepo.closeElapsedPeriodInTx(client, ad.id);
      }

      const nextPeriodNumber = (await this.repo.getMaxPeriodNumberInTx(client, ad.id)) + 1;

      // A campaign that has never bought a week is not renewing — it is
      // STARTING, which is a different operation with its own approval checks,
      // its own scheduled-start check and its own `renewal_source = 'initial'`.
      // Without this, the explicit retry could open period 1 through the renewal
      // path, label the first week 'automatic' and count it as a renewal.
      if (nextPeriodNumber === 1) {
        await client.query('COMMIT');
        return { outcome: 'skipped', reason: 'never_started' };
      }

      // ---- Bounds. Checked BEFORE the charge, so a campaign that has finished
      // ---- is never debited for the week that finished it.
      if (ad.maximum_weeks !== null && nextPeriodNumber > ad.maximum_weeks) {
        const result = await this.stopAtBoundary(client, ad, {
          boundary: nextPeriodNumber,
          reason: 'max_weeks_reached',
          eventType: 'auto_renew_stopped_max_weeks',
          detail: { maximumWeeks: ad.maximum_weeks },
          stopAutomatic: true,
        });
        await client.query('COMMIT');
        committed = result;
        return result.result;
      }

      if (
        ad.renewal_end_date !== null &&
        !(await this.renewalRepo.periodFitsBeforeBoundary(client, now, ad.renewal_end_date))
      ) {
        // No shortened week and no prorated charge: a period that does not fit
        // completely is simply not bought.
        const result = await this.stopAtBoundary(client, ad, {
          boundary: nextPeriodNumber,
          reason: 'end_date_reached',
          eventType: 'auto_renew_stopped_end_date',
          detail: { renewalEndDate: ad.renewal_end_date },
          stopAutomatic: true,
        });
        await client.query('COMMIT');
        committed = result;
        return result.result;
      }

      // ---- The charge and the week, in that order, in this transaction.
      let opened;
      try {
        opened = await this.billing.chargeAndOpenPeriodInTx(client, ad, {
          periodNumber: nextPeriodNumber,
          startsAt: now,
          renewalSource: 'automatic',
          countsAsRenewal: true,
          // No human acted. Attributing an automatic charge to the advertiser
          // would make the audit trail claim they pressed something.
          actorUserId: null,
        });
      } catch (error) {
        // The charge primitive unwound to its OWN savepoint, so this
        // transaction is still usable and the closed week above survives.
        if (isInsufficientCredits(error) || isPricingUnavailable(error)) {
          const insufficient = isInsufficientCredits(error);
          const required =
            error instanceof HttpError && typeof error.details === 'object' && error.details
              ? Number((error.details as { required?: unknown }).required)
              : NaN;
          const result = await this.stopAtBoundary(client, ad, {
            boundary: nextPeriodNumber,
            reason: insufficient ? 'insufficient_credits' : 'pricing_unavailable',
            eventType: insufficient
              ? 'renewal_failed_insufficient_credits'
              : 'renewal_failed_pricing_unavailable',
            detail: Number.isFinite(required) ? { requiredMhc: required } : {},
            // The preference is PRESERVED. The advertiser still wants weekly
            // renewal; they are out of credits, or the price is unset. Clearing
            // the pause is what resumes it, and only they can do that.
            stopAutomatic: false,
            requiredMhc: Number.isFinite(required) ? required : null,
          });
          await client.query('COMMIT');
          committed = result;
          return result.result;
        }
        throw error;
      }

      const advertisement = await this.renewalRepo.recordRenewalSuccessInTx(client, ad.id);
      const event = await this.renewalRepo.insertEventInTx(client, {
        advertisementId: ad.id,
        advertiserId: ad.advertiser_id,
        boundaryPeriodNumber: nextPeriodNumber,
        eventType: 'renewal_succeeded',
        periodId: opened.period?.id ?? null,
        detail: {
          mhcCharged: opened.mhcCharged,
          ...(opened.period ? { periodEndsAt: opened.period.ends_at } : {}),
        },
      });

      await client.query('COMMIT');
      committed = {
        result: {
          outcome: 'renewed',
          advertisement,
          period: opened.period!,
          mhcCharged: opened.mhcCharged,
        },
        eventId: event.id,
      };
      return committed.result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      // After the commit and after the connection is back in the pool: no
      // advertisement row, no wallet row and no connection is held while a push
      // is sent.
      if (committed) this.notifier.deliverSoon(committed.eventId);
    }
  }

  /**
   * Everything that disqualifies a campaign, evaluated on the LOCKED row.
   *
   * Returns a skip rather than throwing: none of these is an error. A campaign
   * the advertiser cancelled, or switched to manual, or that is paused awaiting
   * their decision, is simply not the scheduler's business.
   */
  private guardRenewalPreconditions(
    ad: AdvertisementRow,
    clearPause: boolean,
  ): { outcome: 'skipped'; reason: RenewalSkipReason } | null {
    if (ad.billing_model !== 'weekly') return { outcome: 'skipped', reason: 'not_weekly' };
    if (ad.status === 'cancelled' || ad.status === 'rejected' || ad.billing_status === 'cancelled') {
      return { outcome: 'skipped', reason: 'cancelled_or_rejected' };
    }
    if (!ad.auto_renew_enabled || ad.renewal_mode !== 'automatic') {
      return { outcome: 'skipped', reason: 'not_automatic' };
    }
    // The consent CHECK guarantees this, but reading it here means the
    // guarantee is visible at the point the money would move.
    if (!ad.auto_renew_enabled_at || !ad.auto_renew_enabled_by) {
      return { outcome: 'skipped', reason: 'not_automatic' };
    }
    if (ad.auto_renew_paused_reason !== null && !clearPause) {
      return { outcome: 'skipped', reason: 'paused' };
    }
    return null;
  }

  /**
   * Stop the scheduler at this boundary, record why exactly once, and charge
   * nothing.
   *
   * The event is written only if this boundary has not already recorded this
   * outcome. Reading first rather than relying on the unique index is
   * deliberate: a duplicate INSERT would abort the transaction and lose the
   * pause with it, and the campaign would be reconsidered on the next tick —
   * which is precisely the retry loop this whole design exists to prevent.
   */
  private async stopAtBoundary(
    client: PoolClient,
    ad: AdvertisementRow,
    params: {
      boundary: number;
      reason: AdAutoRenewPausedReason;
      eventType: AdRenewalEventType;
      detail: Record<string, unknown>;
      stopAutomatic: boolean;
      requiredMhc?: number | null;
    },
  ): Promise<{ result: AutomaticRenewalResult; eventId: string | null }> {
    const advertisement = await this.renewalRepo.pauseAutomaticRenewalInTx(client, {
      advertisementId: ad.id,
      reason: params.reason,
      outcome: params.reason,
      stopAutomatic: params.stopAutomatic,
    });

    const existing = await this.renewalRepo.findEventInTx(client, {
      advertisementId: ad.id,
      boundaryPeriodNumber: params.boundary,
      eventType: params.eventType,
    });
    let eventId: string | null = null;
    if (!existing) {
      const event = await this.renewalRepo.insertEventInTx(client, {
        advertisementId: ad.id,
        advertiserId: ad.advertiser_id,
        boundaryPeriodNumber: params.boundary,
        eventType: params.eventType,
        detail: params.detail,
      });
      eventId = event.id;
    }

    return {
      result: {
        outcome: 'paused',
        reason: params.reason,
        advertisement,
        requiredMhc: params.requiredMhc ?? null,
      },
      eventId,
    };
  }

  // =========================================================================
  // Reminders
  // =========================================================================

  /**
   * Tell the advertiser their week is about to renew, once per boundary.
   *
   * Its own tiny transaction, holding nothing financial. A reminder that is not
   * sent costs the advertiser a surprise; a reminder sent twice costs them
   * trust, so the boundary event log guards it exactly as it guards a charge.
   */
  async remindUpcomingRenewal(advertisementId: string): Promise<boolean> {
    const client = await getPool().connect();
    let eventId: string | null = null;
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '5s'`);
      const ad = await this.renewalRepo.claimAdForUpdate(client, advertisementId);
      if (!ad || this.guardRenewalPreconditions(ad, false)) {
        await client.query('COMMIT');
        return false;
      }
      const active = await this.repo.findActivePeriodInTx(client, ad.id);
      if (!active) {
        await client.query('COMMIT');
        return false;
      }
      const boundary = active.period_number + 1;
      const existing = await this.renewalRepo.findEventInTx(client, {
        advertisementId: ad.id,
        boundaryPeriodNumber: boundary,
        eventType: 'renewal_reminder',
      });
      if (existing) {
        await client.query('COMMIT');
        return false;
      }
      const event = await this.renewalRepo.insertEventInTx(client, {
        advertisementId: ad.id,
        advertiserId: ad.advertiser_id,
        boundaryPeriodNumber: boundary,
        eventType: 'renewal_reminder',
        detail: { periodEndsAt: active.ends_at },
      });
      eventId = event.id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    this.notifier.deliverSoon(eventId);
    return true;
  }

  // =========================================================================
  // The bounded lifecycle sweep
  // =========================================================================

  /**
   * One pass over everything the advertisement billing lifecycle owes.
   *
   * Five independent, bounded stages, deliberately in this order:
   *
   *   1. approved campaigns whose scheduled start has arrived;
   *   2. automatic campaigns whose week has ended — BEFORE the generic expiry
   *      sweep, so an automatic campaign closes its old week and opens the new
   *      one in a single transaction and never spends a tick not serving;
   *   3. the generic expiry sweep, which closes every remaining elapsed week
   *      and tells manual advertisers theirs has ended;
   *   4. reminders for automatic weeks that end soon;
   *   5. the notification outbox, last, so events this tick created — including
   *      the ones stage 3 wrote in bulk — go out in this tick.
   *
   * Every stage is independently bounded and independently failure-isolated:
   * each advertisement is its own transaction, so one campaign that throws
   * cannot roll back, block or skip another. A stage that throws entirely is
   * logged and the remaining stages still run.
   *
   * Safe to run in two or more processes at once. Nothing here relies on being
   * the only sweeper: stage 1 and 3 use `SKIP LOCKED` claims, stage 2 and 4
   * lock the advertisement with `SKIP LOCKED`, and stage 5 claims each event
   * row the same way.
   */
  async runLifecycleSweep(options: {
    batchSize?: number;
    reminderWindowHours?: number;
    /** Checked between campaigns so a shutdown does not wait out a whole batch. */
    shouldStop?: () => boolean;
  } = {}): Promise<{
    started: number;
    renewed: number;
    paused: number;
    expiredPeriods: number;
    expiredCampaigns: number;
    reminded: number;
    notified: number;
    /** Deliveries that failed and will be retried after a backoff. */
    notifyRetrying: number;
    /** Deliveries that exhausted their retry budget. Alert on this. */
    notifyExhausted: number;
    failures: number;
  }> {
    const batchSize = options.batchSize ?? 25;
    const shouldStop = options.shouldStop ?? (() => false);
    const summary = {
      started: 0,
      renewed: 0,
      paused: 0,
      expiredPeriods: 0,
      expiredCampaigns: 0,
      reminded: 0,
      notified: 0,
      notifyRetrying: 0,
      notifyExhausted: 0,
      failures: 0,
    };

    // -- 1. Approved campaigns whose start has arrived ------------------------
    // One attempt each, ever. A campaign that could not pay drops to
    // `awaiting_credits` and out of this read — see listDueInitialStartAdIds.
    try {
      const dueStarts = await this.renewalRepo.listDueInitialStartAdIds(batchSize);
      for (const id of dueStarts) {
        if (shouldStop()) return summary;
        try {
          const result = await this.billing.activateDuePeriod(id, { actorUserId: null });
          if (result.created) summary.started += 1;
        } catch (error) {
          // A campaign whose advertiser has no credits throws 402 here. That is
          // an expected outcome, already recorded as `awaiting_credits` by the
          // activation service's own committed write — not a sweep failure.
          if (!isInsufficientCredits(error)) summary.failures += 1;
          this.logStageError('activate due start', id, error);
        }
      }
    } catch (error) {
      summary.failures += 1;
      this.logStageError('list due starts', null, error);
    }

    // -- 2. Automatic renewals -----------------------------------------------
    try {
      const dueRenewals = await this.renewalRepo.listDueAutomaticRenewalAdIds(batchSize);
      for (const id of dueRenewals) {
        if (shouldStop()) return summary;
        try {
          const result = await this.renewAutomatically(id, { blocking: false, actorUserId: null });
          if (result.outcome === 'renewed') summary.renewed += 1;
          if (result.outcome === 'paused') summary.paused += 1;
        } catch (error) {
          summary.failures += 1;
          this.logStageError('automatic renewal', id, error);
        }
      }
    } catch (error) {
      summary.failures += 1;
      this.logStageError('list due renewals', null, error);
    }

    // -- 3. Everything else whose week has elapsed ----------------------------
    if (shouldStop()) return summary;
    try {
      const expired = await this.billing.expireDuePeriods(batchSize * 4);
      summary.expiredPeriods = expired.periods;
      summary.expiredCampaigns = expired.campaigns;
    } catch (error) {
      summary.failures += 1;
      this.logStageError('expire due periods', null, error);
    }

    // -- 4. Upcoming-renewal reminders ---------------------------------------
    try {
      const reminderHours = options.reminderWindowHours ?? 24;
      const dueReminders = await this.renewalRepo.listDueRenewalReminderAdIds(
        batchSize,
        reminderHours,
      );
      for (const id of dueReminders) {
        if (shouldStop()) return summary;
        try {
          if (await this.remindUpcomingRenewal(id)) summary.reminded += 1;
        } catch (error) {
          summary.failures += 1;
          this.logStageError('renewal reminder', id, error);
        }
      }
    } catch (error) {
      summary.failures += 1;
      this.logStageError('list due reminders', null, error);
    }

    // -- 5. The notification outbox ------------------------------------------
    if (shouldStop()) return summary;
    try {
      const delivered = await this.notifier.deliverPending(batchSize * 4);
      summary.notified = delivered.delivered;
      summary.notifyRetrying = delivered.retrying;
      summary.notifyExhausted = delivered.exhausted;
    } catch (error) {
      summary.failures += 1;
      this.logStageError('deliver pending notifications', null, error);
    }

    return summary;
  }

  private logStageError(stage: string, advertisementId: string | null, error: unknown): void {
    logger.warn('Advertisement billing sweep stage failed', {
      stage,
      ...(advertisementId ? { advertisementId } : {}),
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof HttpError ? { code: error.code } : {}),
    });
  }

  // =========================================================================
  // Reads
  // =========================================================================

  /** The provider's automatic-renewal configuration, for a screen. */
  async getAutoRenewalState(
    advertisementId: string,
    requester: { id: string; isAdmin: boolean },
  ): Promise<AutoRenewalStateView> {
    const ad = await this.repo.getAdById(advertisementId);
    if (!ad) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    if (!requester.isAdmin && ad.advertiser_id !== requester.id) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This ad does not belong to you.',
      });
    }
    return this.toStateView(ad, await this.repo.countPeriods(advertisementId));
  }

  /** The provider's own credit balance, for the renewal screen. */
  async getBalanceFor(userId: string): Promise<number> {
    return this.mhc.getBalanceFor(userId);
  }

  async listRenewalHistory(advertisementId: string, limit = 10) {
    const events = await this.renewalRepo.listEvents(advertisementId, limit);
    return events.map((event) => ({
      id: event.id,
      eventType: event.event_type,
      periodNumber: event.boundary_period_number,
      createdAt: event.created_at,
      // `detail` is deliberately re-shaped rather than passed through: it is a
      // JSONB column, and a future writer must not be able to leak a new key
      // onto a provider's screen by adding it there.
      mhcCharged: typeof event.detail?.mhcCharged === 'number' ? event.detail.mhcCharged : null,
      requiredMhc: typeof event.detail?.requiredMhc === 'number' ? event.detail.requiredMhc : null,
    }));
  }

  private toStateView(ad: AdvertisementRow, periodsUsed: number): AutoRenewalStateView {
    return {
      advertisementId: ad.id,
      renewalMode: ad.renewal_mode,
      autoRenewEnabled: ad.auto_renew_enabled,
      maximumWeeks: ad.maximum_weeks,
      renewalEndDate: ad.renewal_end_date,
      autoRenewEnabledAt: ad.auto_renew_enabled_at,
      autoRenewConsentVersion: ad.auto_renew_consent_version,
      autoRenewPausedReason: ad.auto_renew_paused_reason,
      autoRenewPausedAt: ad.auto_renew_paused_at,
      lastRenewalOutcome: ad.last_renewal_outcome,
      lastRenewalAttemptAt: ad.last_renewal_attempt_at,
      periodsUsed,
      nextRenewalAt: ad.next_renewal_at,
      // Legacy campaigns and campaigns nobody can renew are excluded here, so a
      // screen never offers a toggle the server would refuse.
      autoRenewalAvailable:
        ad.billing_model === 'weekly' &&
        ad.status !== 'cancelled' &&
        ad.status !== 'rejected' &&
        ad.billing_status !== 'cancelled',
      consentVersion: AUTO_RENEW_CONSENT_VERSION,
    };
  }
}

/** Two nullable timestamps that denote the same instant, or are both absent. */
function sameInstant(a: string | null, b: string | null | undefined): boolean {
  const left = a ? new Date(a).getTime() : null;
  const right = b ? new Date(b).getTime() : null;
  return left === right;
}
