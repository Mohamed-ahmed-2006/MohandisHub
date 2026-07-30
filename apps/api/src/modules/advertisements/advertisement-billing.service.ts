import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { MhcService } from '../mhc/mhc.service.js';

import { AdvertisementsRepository } from './advertisements.repository.js';
import type {
  AdRenewalSource,
  AdvertisementPeriodResult,
  AdvertisementRow,
} from './advertisements.types.js';

/**
 * `mhc_action_prices` key. Its value is the price of ONE seven-day advertisement
 * week — the period length is fixed by `chk_ad_period_exact_week`, so a single
 * price per action expresses a weekly price exactly.
 */
export const AD_ACTION_KEY = 'advertisement';

/**
 * The charge's business reference is the PERIOD, not the campaign. That is what
 * makes `uq_mhc_action_charge_reference` idempotent per week: renewing buys a new
 * period id, so it is a new chargeable reference, while retrying the same
 * renewal reuses the period id and cannot charge twice.
 */
export const AD_PERIOD_REFERENCE_TYPE = 'advertisement_period';

const isInsufficientCredits = (error: unknown): boolean =>
  error instanceof HttpError && error.code === 'MHC_INSUFFICIENT_CREDITS';

/**
 * Weekly advertisement billing.
 *
 * Every method here owns exactly one database transaction, or runs inside one
 * its caller owns. The invariant they all preserve: a campaign is serving if and
 * only if it holds an `active` period that was paid for, and no period is ever
 * created without its charge succeeding first in the same transaction.
 *
 * Nothing in this file schedules anything. Automatic renewal has no
 * implementation in this wave — see `docs/release/ADVERTISEMENT_BILLING.md`.
 */
export class AdvertisementBillingService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    private readonly mhc: MhcService = new MhcService(),
  ) {}

  /**
   * Create and charge one seven-day period, inside the caller's transaction.
   *
   * The order is deliberate and is the whole safety argument:
   *
   *   1. the caller has already locked the advertisement row, so two concurrent
   *      callers are serialised and the second sees the first's committed state;
   *   2. the period id is preallocated, so it can be the charge's reference
   *      before the period row exists;
   *   3. the price is resolved by the charging primitive itself, from
   *      `mhc_action_prices` — there is no parameter by which a caller could
   *      pass an amount;
   *   4. the charge happens BEFORE the period row is inserted, so an
   *      insufficient balance leaves no period behind;
   *   5. the period row insert then hits `uq_ad_period_number`,
   *      `uq_ad_period_active` and `ad_period_no_overlap`. A collision aborts
   *      the caller's transaction, which unwinds the charge with it.
   *
   * `startsAt` is the activation instant, never a backdated schedule: an
   * advertiser who pays for a week gets a full week of serving from the moment
   * the credits leave their balance.
   */
  private async chargeAndOpenPeriodInTx(
    client: PoolClient,
    ad: AdvertisementRow,
    options: {
      periodNumber: number;
      startsAt: Date;
      renewalSource: AdRenewalSource;
      clientIdempotencyKey?: string | null;
      countsAsRenewal: boolean;
      actorUserId?: string | null;
    },
  ): Promise<AdvertisementPeriodResult> {
    const periodId = randomUUID();

    const charge = await this.mhc.chargeAction({
      client,
      userId: ad.advertiser_id,
      actionKey: AD_ACTION_KEY,
      referenceType: AD_PERIOD_REFERENCE_TYPE,
      referenceId: periodId,
      idempotencyKey: `advertisement_period:${periodId}`,
      description: `Advertisement week ${options.periodNumber}: ${ad.title_en}`,
      metadata: {
        advertisement_id: ad.id,
        period_number: options.periodNumber,
        period_hours: 168,
        renewal_source: options.renewalSource,
      },
      ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
    });

    // A zero-price week writes no charge row at all — that is the established
    // behaviour of the generic primitive, and `chk_ad_period_charge_shape`
    // encodes the same rule on the period: snapshot 0 means no charge link.
    const period = await this.repo.insertActivePeriodInTx(client, {
      id: periodId,
      advertisementId: ad.id,
      periodNumber: options.periodNumber,
      startsAt: options.startsAt,
      mhcPriceSnapshot: charge.mhcCharged,
      actionChargeId: charge.chargeId,
      renewalSource: options.renewalSource,
      clientIdempotencyKey: options.clientIdempotencyKey ?? null,
    });

    const advertisement = await this.repo.applyActivePeriodInTx(
      client,
      ad.id,
      { startsAt: period.starts_at, endsAt: period.ends_at },
      options.countsAsRenewal,
    );

    return { advertisement, period, mhcCharged: charge.mhcCharged, created: true };
  }

  /**
   * Open the FIRST period of an approved campaign, inside the caller's
   * transaction. Used by admin approval of an immediate campaign, and by the
   * due-start path below.
   *
   * Refuses if any period already exists: the first week is period 1 and there
   * is exactly one of it.
   */
  async openFirstPeriodInTx(
    client: PoolClient,
    ad: AdvertisementRow,
    options: { startsAt: Date; actorUserId?: string | null },
  ): Promise<AdvertisementPeriodResult> {
    const maxPeriod = await this.repo.getMaxPeriodNumberInTx(client, ad.id);
    if (maxPeriod > 0) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_PERIOD_ALREADY_EXISTS',
        message: 'This advertisement has already been activated.',
      });
    }
    return this.chargeAndOpenPeriodInTx(client, ad, {
      periodNumber: 1,
      startsAt: options.startsAt,
      renewalSource: 'initial',
      countsAsRenewal: false,
      ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
    });
  }

  /**
   * Activate an approved campaign whose start has become due, in its own
   * transaction.
   *
   * This is the reusable service the Wave 2F-B scheduler will call, and the same
   * one a provider's "activate now" retry calls after topping up credits. It is
   * safe to call repeatedly, concurrently, and after a crash that lost the
   * response: the advertisement row lock serialises callers, and a caller that
   * arrives second finds the period the winner created and reports it rather
   * than buying a second one.
   *
   * There is deliberately no unauthenticated route onto this method. Callers are
   * either an admin (`manage_ads`) or the campaign's own advertiser.
   */
  async activateDuePeriod(
    advertisementId: string,
    options: { requireAdvertiserId?: string | null; actorUserId?: string | null } = {},
  ): Promise<AdvertisementPeriodResult> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, advertisementId);
      if (!ad) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (options.requireAdvertiserId && ad.advertiser_id !== options.requireAdvertiserId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'This ad does not belong to you.',
        });
      }
      this.assertWeekly(ad);

      // Idempotent: a campaign that already holds a paid week is reported, not
      // charged again. This is the branch every loser of a concurrent race and
      // every retry after a lost response lands on.
      const existingActive = await this.repo.findActivePeriodInTx(client, ad.id);
      if (existingActive) {
        await client.query('COMMIT');
        return { advertisement: ad, period: existingActive, mhcCharged: 0, created: false };
      }

      if (ad.status === 'cancelled' || ad.status === 'rejected') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_ACTIVATABLE',
          message: 'A cancelled or rejected advertisement cannot be activated.',
        });
      }
      // Approval is a precondition, and it is checked from the moderation
      // columns rather than inferred from billing state.
      if (ad.status !== 'scheduled' || !ad.reviewed_at) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_APPROVED',
          message: 'This advertisement has not been approved for activation yet.',
        });
      }
      if (ad.billing_status !== 'awaiting_start' && ad.billing_status !== 'awaiting_credits') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_AWAITING_ACTIVATION',
          message: 'This advertisement is not awaiting activation.',
        });
      }

      // Re-checked inside the transaction, against the database clock, so a
      // scheduler that read a stale list cannot start a campaign early.
      const scheduledStart = ad.starts_at ? new Date(ad.starts_at) : null;
      const { rows: nowRows } = await client.query<{ now: string }>(`SELECT now()::text AS now`);
      const now = new Date(nowRows[0]!.now);
      if (scheduledStart && scheduledStart.getTime() > now.getTime()) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_START_NOT_DUE',
          message: 'This advertisement is not due to start yet.',
          details: { startsAt: ad.starts_at },
        });
      }

      let result: AdvertisementPeriodResult;
      try {
        result = await this.openFirstPeriodInTx(client, ad, {
          startsAt: now,
          ...(options.actorUserId !== undefined ? { actorUserId: options.actorUserId } : {}),
        });
      } catch (error) {
        if (isInsufficientCredits(error)) {
          // The charge primitive unwound to its own savepoint, so this write is
          // clean. Commit the honest state — approved, not serving, no credits —
          // and let the 402 reach the provider with its Credits deep link.
          await this.repo.markAwaitingCreditsInTx(client, ad.id);
          await client.query('COMMIT');
        }
        throw error;
      }

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Buy one more seven-day week, deliberately, at the advertiser's request.
   *
   * Only reachable once the paid week has ended. A queued prepaid future week is
   * NOT sold in this wave: `ad_period_no_overlap` would reject it anyway, and
   * nobody has decided what a refund would mean for a week that never ran.
   */
  async renewManually(params: {
    advertisementId: string;
    providerId: string;
    idempotencyKey?: string | null;
  }): Promise<AdvertisementPeriodResult> {
    const idempotencyKey = params.idempotencyKey?.trim() || null;
    const client = await getPool().connect();
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
      this.assertWeekly(ad);

      // Idempotency is checked FIRST, after the lock and before eligibility.
      // A retry of a renewal that already succeeded must reach the week it
      // bought — not a 409 saying the campaign is already active.
      if (idempotencyKey) {
        const existing = await this.repo.findPeriodByIdempotencyKey(client, ad.id, idempotencyKey);
        if (existing) {
          await client.query('COMMIT');
          return { advertisement: ad, period: existing, mhcCharged: 0, created: false };
        }
      }

      if (ad.status === 'cancelled' || ad.billing_status === 'cancelled') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_RENEWABLE',
          message: 'A cancelled advertisement cannot be renewed.',
        });
      }
      if (ad.status === 'rejected') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_RENEWABLE',
          message: 'A rejected advertisement cannot be renewed.',
        });
      }
      if (await this.repo.findActivePeriodInTx(client, ad.id)) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_PERIOD_STILL_ACTIVE',
          message: 'This advertisement is still running. You can renew it once the week ends.',
          details: { currentPeriodEndsAt: ad.current_period_ends_at },
        });
      }
      if (ad.billing_status !== 'renewal_required') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_RENEWAL_NOT_ELIGIBLE',
          message: 'This advertisement is not waiting for a renewal.',
          details: { billingStatus: ad.billing_status },
        });
      }

      const nextPeriodNumber = (await this.repo.getMaxPeriodNumberInTx(client, ad.id)) + 1;
      if (ad.maximum_weeks !== null && nextPeriodNumber > ad.maximum_weeks) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_RENEWAL_LIMIT_REACHED',
          message: 'This campaign has reached its configured maximum number of weeks.',
          details: { maximumWeeks: ad.maximum_weeks },
        });
      }

      const { rows: nowRows } = await client.query<{ now: string }>(`SELECT now()::text AS now`);
      const now = new Date(nowRows[0]!.now);
      if (ad.renewal_end_date !== null) {
        const boundary = new Date(ad.renewal_end_date);
        const wouldEndAt = new Date(now.getTime() + 168 * 60 * 60 * 1000);
        if (wouldEndAt.getTime() > boundary.getTime()) {
          throw new HttpError({
            statusCode: 409,
            code: 'AD_RENEWAL_WINDOW_CLOSED',
            message: 'A new week would run past this campaign’s configured end date.',
            details: { renewalEndDate: ad.renewal_end_date },
          });
        }
      }

      const result = await this.chargeAndOpenPeriodInTx(client, ad, {
        periodNumber: nextPeriodNumber,
        startsAt: now,
        renewalSource: 'manual',
        clientIdempotencyKey: idempotencyKey,
        countsAsRenewal: true,
        actorUserId: params.providerId,
      });

      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      // Lost the idempotency race: a concurrent identical request committed
      // first. Report its week rather than an error, and charge nothing.
      if (
        idempotencyKey &&
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === '23505'
      ) {
        const winner = await this.findCommittedPeriodByKey(params.advertisementId, idempotencyKey);
        if (winner) {
          const ad = await this.repo.getAdById(params.advertisementId);
          if (ad) return { advertisement: ad, period: winner, mhcCharged: 0, created: false };
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /** Read a committed period by idempotency key, outside any transaction. */
  private async findCommittedPeriodByKey(advertisementId: string, idempotencyKey: string) {
    const client = await getPool().connect();
    try {
      return await this.repo.findPeriodByIdempotencyKey(client, advertisementId, idempotencyKey);
    } finally {
      client.release();
    }
  }

  /**
   * Close every week that has run its seven days.
   *
   * Reusable and idempotent. This wave calls it lazily from the serving path;
   * Wave 2F-B will also call it from a scheduler. Nothing is refunded — a served
   * week is non-refundable — and no history is deleted.
   */
  async expireDuePeriods(limit = 200): Promise<{ periods: number; campaigns: number }> {
    return this.repo.expireDuePeriods(limit);
  }

  /** Approved campaigns whose scheduled start has arrived. */
  async listDueScheduledAdIds(limit = 100): Promise<string[]> {
    return this.repo.listDueScheduledAdIds(limit);
  }

  /** The weekly MHC price, for display. Never the source of a charge. */
  async getWeeklyPrice(): Promise<number> {
    const price = await this.repo.getAdvertisementMhcPrice();
    return price?.isActive ? price.mhcPrice : 0;
  }

  private assertWeekly(ad: AdvertisementRow): void {
    if (ad.billing_model !== 'weekly') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_WEEKLY',
        message:
          'This campaign predates weekly billing and is not charged or renewed in credits.',
        details: { billingModel: ad.billing_model },
      });
    }
  }
}
