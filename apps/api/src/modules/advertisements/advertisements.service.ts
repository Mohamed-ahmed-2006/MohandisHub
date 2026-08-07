import { randomUUID } from 'node:crypto';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { MhcService } from '../mhc/mhc.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { AdCenterService } from './adcenter.service.js';
import { AdvertisementBillingService } from './advertisement-billing.service.js';
import { requireAdvertisementCommercialAuthority } from './advertisement-ownership.authorization.js';
import { AdvertisementRenewalRepository } from './advertisement-renewal.repository.js';
import {
  AUTO_RENEW_CONSENT_VERSION,
  AdvertisementRenewalService,
  type AutoRenewalStateView,
  type AutomaticRenewalResult,
} from './advertisement-renewal.service.js';
import { AdvertisementsRepository } from './advertisements.repository.js';
import type {
  AdAutoRenewPausedReason,
  AdvertisementPeriodResult,
  AdvertisementRow,
} from './advertisements.types.js';
import type {
  AdCenterResolveInput,
  AdminAdControlsInput,
  AdminPricingOverrideInput,
  AdminScheduleInput,
  AutoRenewalInput,
  CreateAdInput,
  ListAdsQueryInput,
  PeriodHistoryQueryInput,
  UpdateAdInput,
} from './advertisements.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Advertisements are moderated, then sold one seven-day week at a time.
// ---------------------------------------------------------------------------
// Submission is FREE and creates nothing financial: no wallet is read, no wallet
// row is locked, no period exists. An admin then approves or rejects. Charging
// happens when a week actually starts — at approval for an immediate campaign,
// or when a future start becomes due — and again only when the advertiser
// deliberately renews.
//
// The successor to launch constraint LC-01 lives in
// docs/release/ADVERTISEMENT_BILLING.md. Both of LC-01's blockers are resolved
// by this shape: pricing is per week rather than flat per campaign, and the
// refund question is answered ("a started week is non-refundable") rather than
// left open. The weekly price nonetheless stays 0 until Wave 2F-B ships
// automatic renewal, renewal notifications and the full renewal UI.
// ---------------------------------------------------------------------------

export type AdControls = {
  acceptAds: boolean;
  /**
   * MHC charged per advertisement WEEK. Not a currency amount — never render it
   * with a currency symbol.
   */
  mhcPrice: number;
};

export type AdBillingStateView = {
  advertisementId: string;
  billingModel: string;
  billingStatus: string;
  moderationStatus: string;
  /** MHC per advertisement week, for display only. */
  weeklyMhcPrice: number;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  manualRenewalRequired: boolean;
  renewalCount: number;
  rejectionReason: string | null;
  reviewedAt: string | null;
  canRenew: boolean;
  canActivate: boolean;
  /** Whether this campaign may be switched to automatic renewal at all. */
  autoRenewalAvailable: boolean;
  autoRenewEnabled: boolean;
  renewalMode: 'manual' | 'automatic';
  maximumWeeks: number | null;
  renewalEndDate: string | null;
  /** When consent to the standing weekly charge was recorded. */
  autoRenewEnabledAt: string | null;
  autoRenewConsentVersion: string | null;
  /** The terms version a client must accept to enable automatic renewal now. */
  consentVersion: string;
  /** Why the scheduler stopped. Not a lifecycle state — see billingStatus. */
  autoRenewPausedReason: AdAutoRenewPausedReason | null;
  autoRenewPausedAt: string | null;
  lastRenewalOutcome: string | null;
  lastRenewalAttemptAt: string | null;
  /** Total weeks this campaign has ever bought, including the first. */
  periodsUsed: number;
  /** When the running week ends, and therefore when a renewal becomes possible. */
  nextRenewalAt: string | null;
  /** Whether an explicit retry of a paused automatic renewal is offered. */
  canRetryAutomaticRenewal: boolean;
  /** The provider's own credit balance. Null for an admin viewing someone else's. */
  creditBalance: number | null;
  renewalHistory: {
    id: string;
    eventType: string;
    periodNumber: number;
    createdAt: string;
    mhcCharged: number | null;
    requiredMhc: number | null;
  }[];
  periods: {
    id: string;
    periodNumber: number;
    startsAt: string;
    endsAt: string;
    mhcPriceSnapshot: number;
    status: string;
    renewalSource: string;
    hasCharge: boolean;
  }[];
};

export class AdvertisementsService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    /**
     * Retained ONLY for the legacy refund path on campaigns that were paid for
     * in EGP before advertisements moved onto credits. No weekly code path
     * touches it, and no money wallet is read or written for a weekly campaign.
     */
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly adCenter: AdCenterService = new AdCenterService(),
    private readonly mhc: MhcService = new MhcService(),
    private readonly billing: AdvertisementBillingService = new AdvertisementBillingService(
      repo,
      mhc,
    ),
    private readonly renewalRepo: AdvertisementRenewalRepository = new AdvertisementRenewalRepository(),
    private readonly renewal: AdvertisementRenewalService = new AdvertisementRenewalService(
      repo,
      renewalRepo,
      billing,
    ),
  ) {}

  private async getControls(): Promise<AdControls> {
    const [acceptAds, price] = await Promise.all([
      this.repo.getGlobalAdAcceptance(),
      this.repo.getAdvertisementMhcPrice(),
    ]);
    return {
      acceptAds: acceptAds ?? true,
      // A missing or switched-off price row reports 0 to the UI rather than
      // guessing. Charging still fails closed on it — see MhcService.chargeAction.
      mhcPrice: price?.isActive ? price.mhcPrice : 0,
    };
  }

  // -------------------------------------------------------------------------
  // Commercial authority
  // -------------------------------------------------------------------------

  /**
   * The commercial-identity gate every advertiser-initiated mutation passes
   * through.
   *
   * It answers "is this actor the canonical controller of the identity that owns
   * this campaign?", which for a Business advertisement is a question about the
   * BCI and never about the workspace: team membership, `manage_team`, an
   * Admin-labelled team role, a reserved permission and a selected workspace are
   * all denied by not being consulted at all.
   *
   * It does NOT replace the ownership re-check each mutation performs inside the
   * transaction that locks the campaign. That check remains the race-safe last
   * word; this one refuses earlier, and refuses things a bare `advertiser_id`
   * comparison cannot see — an advertisement whose recorded commercial owner and
   * legacy anchor contradict each other authorizes nobody.
   *
   * Platform moderation does not come through here. The admin routes gate on
   * admin permissions, and an administrator never acquires the Business's
   * commercial authority.
   */
  private async requireCommercialAuthority(adId: string, userId: string) {
    return requireAdvertisementCommercialAuthority(getPool(), {
      advertisementId: adId,
      actorUserId: userId,
    });
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Submit a campaign for review.
   *
   * Creates ONE `advertisements` row in state `pending_review` and nothing else.
   * There is no charge, no period, and no wallet access on this path at all —
   * which is the property that makes "submitting is free" true by construction
   * rather than by configuration.
   *
   * `uq_advertisements_advertiser_idempotency` still stops a retried submit from
   * creating a second campaign; it matters more now, not less, because a second
   * campaign would become a second thing an admin has to review and a second
   * thing that could be charged.
   */
  async createAd(userId: string, input: CreateAdInput, idempotencyKey?: string | null) {
    const controls = await this.getControls();
    if (!controls.acceptAds) {
      throw new HttpError({
        statusCode: 403,
        code: 'ADS_DISABLED_BY_ADMIN',
        message: 'Ads are currently not accepting new campaigns.',
      });
    }

    const clientIdempotencyKey = idempotencyKey?.trim() || null;
    if (clientIdempotencyKey) {
      // Fast path: a completed retry never re-enters the transaction at all.
      const existing = await this.repo.findAdByIdempotencyKey(userId, clientIdempotencyKey);
      if (existing) return existing;
    }

    // Resolved and ownership-checked BEFORE the insert, because
    // `advertisements_destination_check` requires a real destination on every
    // non-cancelled row. Nothing populated these columns before this change,
    // which is why every create request failed on a raw constraint violation.
    const destination = await this.resolveDestination(userId, input.linkType, input.linkTarget);

    // A start in the past is a start now. Stored as requested otherwise; the
    // campaign will not serve, and will not be charged, until it is approved.
    const requestedStartAt = input.startsAt ? new Date(input.startsAt) : null;
    const startsAt =
      requestedStartAt && requestedStartAt.getTime() > Date.now() ? requestedStartAt : null;
    const advertisementId = randomUUID();

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.createPendingAdInTx(
        client,
        userId,
        input,
        startsAt,
        advertisementId,
        clientIdempotencyKey,
        destination,
      );
      // Ownership is recorded in the same transaction as the campaign, so a
      // Business campaign is never briefly visible without its commercial owner
      // and a rollback takes both away together.
      const owned = await this.repo.stampCommercialOwnerInTx(client, ad.id);
      await client.query('COMMIT');
      return owned ?? ad;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      // Lost the domain idempotency race: a concurrent identical request
      // committed first. Return its campaign rather than an error.
      if (
        clientIdempotencyKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505'
      ) {
        const winner = await this.repo.findAdByIdempotencyKey(userId, clientIdempotencyKey);
        if (winner) return winner;
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Turn a requested link type into the destination columns the database
   * requires, checking that the advertiser owns what they are pointing at.
   */
  private async resolveDestination(
    advertiserId: string,
    linkType: 'profile' | 'service',
    linkTarget: string | undefined,
  ): Promise<{ providerId: string | null; serviceId: string | null }> {
    if (linkType === 'profile') {
      if (!(await this.repo.isAdvertisableProvider(advertiserId))) {
        throw new HttpError({
          statusCode: 403,
          code: 'AD_PROFILE_NOT_ADVERTISABLE',
          message: 'Only an active provider profile can be advertised.',
        });
      }
      // `advertisements_destination_check` requires the service id to be NULL
      // for a profile campaign.
      return { providerId: advertiserId, serviceId: null };
    }

    if (!linkTarget) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_DESTINATION_REQUIRED',
        message: 'Choose which of your services this ad should link to.',
      });
    }
    const serviceId = await this.repo.findOwnedActiveServiceId(advertiserId, linkTarget);
    if (!serviceId) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_SERVICE_NOT_FOUND',
        message: 'That service does not exist, is not active, or is not yours.',
      });
    }
    return { providerId: advertiserId, serviceId };
  }

  async getAd(adId: string) {
    const ad = await this.repo.getAdById(adId);
    if (!ad) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    return ad;
  }

  async listMyAds(userId: string, query: ListAdsQueryInput) {
    return this.repo.listMyAds(userId, query);
  }

  async listAllAds(query: ListAdsQueryInput) {
    return this.repo.listAllAds(query);
  }

  /**
   * Provider edits. Allowed only while a campaign is unreviewed: once an admin
   * has approved specific creative, silently swapping it would make the approval
   * meaningless. `status` is not editable here at all — it was, which let an
   * advertiser approve their own campaign.
   */
  async updateAd(adId: string, userId: string, input: UpdateAdInput) {
    await this.requireCommercialAuthority(adId, userId);
    const ad = await this.getAd(adId);
    if (ad.billing_model === 'weekly' && ad.status !== 'pending_review') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_EDITABLE',
        message: 'A reviewed advertisement cannot be edited. Create a new campaign instead.',
        details: { status: ad.status },
      });
    }
    if (ad.status === 'cancelled' || ad.status === 'expired') {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_NOT_EDITABLE',
        message: 'Cancelled or expired ads cannot be edited.',
      });
    }

    // A changed destination has to be re-resolved and re-checked, or the row
    // would keep pointing at the old target while claiming the new type.
    if (input.linkType !== undefined || input.linkTarget !== undefined) {
      const linkType = input.linkType ?? ad.link_type;
      const linkTarget = input.linkTarget ?? ad.link_target ?? undefined;
      const destination = await this.resolveDestination(userId, linkType, linkTarget);
      const updated = await this.repo.updateAd(adId, input);
      await this.repo.setDestination(adId, destination);
      return updated ? this.repo.getAdById(adId) : updated;
    }
    return this.repo.updateAd(adId, input);
  }

  // -------------------------------------------------------------------------
  // Moderation
  // -------------------------------------------------------------------------

  /**
   * Reject a campaign.
   *
   * Writes to `advertisements` only. No period is created and no credits move —
   * not because a check prevents it, but because this transaction contains no
   * call that could. Repeating a rejection is a no-op that reports the existing
   * rejection.
   */
  async rejectAd(adId: string, adminId: string, reason: string): Promise<AdvertisementRow> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      this.assertModeratable(ad);

      if (ad.status === 'rejected') {
        await client.query('COMMIT');
        return ad;
      }
      if (ad.status !== 'pending_review') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_PENDING_REVIEW',
          message: 'Only an advertisement awaiting review can be rejected.',
          details: { status: ad.status },
        });
      }

      const rejected = await this.repo.rejectAdInTx(client, adId, adminId, reason);
      await client.query('COMMIT');
      return rejected;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Approve a campaign, and — if it starts now — buy its first week in the same
   * transaction.
   *
   * The approval is recorded BEFORE the charge is attempted, so the three
   * outcomes stay distinguishable in the committed row:
   *
   *   approved + charged  -> status active,    billing_status active
   *   approved + no funds -> status scheduled, billing_status awaiting_credits
   *   approved + future   -> status scheduled, billing_status awaiting_start
   *
   * An approved campaign that cannot pay is therefore never confused with one
   * nobody has reviewed, and never confused with a rejection.
   *
   * Concurrent approvals cannot double-charge: the row lock serialises them and
   * the second caller re-reads a row that is already approved.
   */
  async approveAd(
    adId: string,
    adminId: string,
    reason?: string | null,
  ): Promise<AdvertisementPeriodResult> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      this.assertModeratable(ad);

      // Idempotent: an already-approved campaign reports its state and charges
      // nothing. This is the branch every loser of a concurrent race lands on.
      if (ad.status === 'active' || ad.status === 'scheduled') {
        const period = await this.repo.findActivePeriodInTx(client, ad.id);
        await client.query('COMMIT');
        return { advertisement: ad, period, mhcCharged: 0, created: false };
      }
      if (ad.status !== 'pending_review') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_PENDING_REVIEW',
          message: 'Only an advertisement awaiting review can be approved.',
          details: { status: ad.status },
        });
      }

      const { rows: nowRows } = await client.query<{ now: string }>(`SELECT now()::text AS now`);
      const now = new Date(nowRows[0]!.now);
      const scheduledStart = ad.starts_at ? new Date(ad.starts_at) : null;
      const startsInFuture = scheduledStart !== null && scheduledStart.getTime() > now.getTime();

      if (startsInFuture) {
        // Approved, but nothing is bought yet: the week is charged when the
        // start becomes due, so an advertiser is never billed for a week that
        // has not begun.
        const approved = await this.repo.recordApprovalInTx(
          client,
          adId,
          adminId,
          'awaiting_start',
          reason ?? null,
        );
        await client.query('COMMIT');
        return { advertisement: approved, period: null, mhcCharged: 0, created: false };
      }

      const approved = await this.repo.recordApprovalInTx(
        client,
        adId,
        adminId,
        'awaiting_credits',
        reason ?? null,
      );

      let result: AdvertisementPeriodResult;
      try {
        result = await this.billing.openFirstPeriodInTx(client, approved, {
          startsAt: now,
          actorUserId: adminId,
        });
      } catch (error) {
        if (error instanceof HttpError && error.code === 'MHC_INSUFFICIENT_CREDITS') {
          // Keep the approval. The charge primitive unwound only to its own
          // savepoint, so the approval write above is intact and committable.
          //
          // The advertiser is told, once: an admin approving a campaign the
          // advertiser cannot pay for gets the 402 themselves, but the
          // advertiser is not watching and would otherwise see an approved
          // campaign that silently never starts.
          const failureEventId = await this.billing.recordFirstWeekUnfunded(
            client,
            approved,
            error,
          );
          await client.query('COMMIT');
          this.billing.notifyAfterCommit(failureEventId);
        }
        throw error;
      }

      await client.query('COMMIT');
      // The first week is committed; tell the advertiser their campaign is
      // live. Nothing is locked any more, and a failed push cannot undo it.
      this.billing.notifyAfterCommit(result.renewalEventId);
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Activate an approved campaign whose start is due — the reusable service, in
   * its own transaction. Invoked by an admin, by the advertiser retrying after
   * topping up credits, and (from Wave 2F-B) by a scheduler.
   */
  async activateDueAdvertisement(
    adId: string,
    options: { requireAdvertiserId?: string | null; actorUserId?: string | null } = {},
  ): Promise<AdvertisementPeriodResult> {
    // Only when an ADVERTISER is driving it. The admin route and the scheduler
    // pass no `requireAdvertiserId`, and neither of them is claiming commercial
    // authority over the campaign — an administrator activating a due week is
    // platform moderation, not the Business acting.
    if (options.requireAdvertiserId) {
      await this.requireCommercialAuthority(adId, options.requireAdvertiserId);
    }
    return this.billing.activateDuePeriod(adId, options);
  }

  /** Approved campaigns whose scheduled start has arrived. */
  async listDueScheduledAdIds(limit = 100): Promise<string[]> {
    return this.billing.listDueScheduledAdIds(limit);
  }

  /** Close every week that has run its seven days. */
  async expireDuePeriods(limit = 200): Promise<{ periods: number; campaigns: number }> {
    return this.billing.expireDuePeriods(limit);
  }

  /** Buy one more seven-day week at the advertiser's request. */
  async renewAd(
    adId: string,
    userId: string,
    idempotencyKey?: string | null,
  ): Promise<AdvertisementPeriodResult> {
    await this.requireCommercialAuthority(adId, userId);
    return this.billing.renewManually({
      advertisementId: adId,
      providerId: userId,
      idempotencyKey: idempotencyKey ?? null,
    });
  }

  /**
   * Switch this campaign between manual and automatic renewal, or change its
   * bounds.
   *
   * Charges nothing, and never touches the running week. Ownership, consent and
   * every bound are re-checked inside the transaction that locks the campaign —
   * see AdvertisementRenewalService.configureAutoRenewal.
   */
  async setAutoRenewal(
    adId: string,
    userId: string,
    input: AutoRenewalInput,
  ): Promise<AutoRenewalStateView> {
    await this.requireCommercialAuthority(adId, userId);
    return this.renewal.configureAutoRenewal({
      advertisementId: adId,
      providerId: userId,
      input,
    });
  }

  /** The campaign's automatic-renewal configuration. Ownership-checked. */
  async getAutoRenewalState(
    adId: string,
    requester: { id: string; isAdmin: boolean },
  ): Promise<AutoRenewalStateView> {
    return this.renewal.getAutoRenewalState(adId, requester);
  }

  /**
   * Try the automatic renewal again, at the advertiser's explicit request —
   * the supported way out of `awaiting credits`.
   *
   * Deliberately the SAME operation the scheduler runs, with the same locks and
   * the same exactly-once guarantees; the only differences are that it waits for
   * the lock instead of skipping, and that it clears the pause the previous
   * failure set. There is no second charging path for a human to reach.
   */
  async retryAutomaticRenewal(adId: string, userId: string): Promise<AutomaticRenewalResult> {
    await this.requireCommercialAuthority(adId, userId);
    return this.renewal.renewAutomatically(adId, {
      blocking: true,
      clearPause: true,
      requireAdvertiserId: userId,
      actorUserId: userId,
    });
  }

  /**
   * One page of this campaign's weeks.
   *
   * Ownership is enforced HERE, on the server, against the stored
   * `advertiser_id` — never from a client-supplied filter. The response carries
   * what a provider needs to reconcile what they were charged (period number,
   * window, status, how it was bought, the immutable price snapshot) and
   * deliberately not the ledger identifiers behind it.
   */
  async listPeriodHistory(
    adId: string,
    requester: { id: string; isAdmin: boolean },
    query: PeriodHistoryQueryInput,
  ) {
    const ad = await this.getAd(adId);
    if (!requester.isAdmin && ad.advertiser_id !== requester.id) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This ad does not belong to you.',
      });
    }
    const { rows, total } = await this.renewalRepo.listPeriodsPaged(adId, query.page, query.limit);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        periodNumber: row.period_number,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        mhcPriceSnapshot: parseFloat(row.mhc_price_snapshot),
        status: row.status,
        renewalSource: row.renewal_source,
        /** Whether credits actually moved. A free week moves none and writes no charge. */
        hasCharge: row.action_charge_id !== null,
        createdAt: row.created_at,
      })),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  /**
   * Everything a screen needs to describe what this campaign costs and what
   * happens next — including the immutable price snapshot of every week it has
   * ever bought, which is what proves an admin price change did not rewrite
   * history.
   */
  async getBillingState(
    adId: string,
    requester: { id: string; isAdmin: boolean },
  ): Promise<AdBillingStateView> {
    const ad = await this.getAd(adId);
    if (!requester.isAdmin && ad.advertiser_id !== requester.id) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This ad does not belong to you.',
      });
    }
    const isOwner = ad.advertiser_id === requester.id;
    const [periods, controls, renewalHistory, creditBalance] = await Promise.all([
      this.repo.listPeriods(adId),
      this.getControls(),
      this.renewal.listRenewalHistory(adId, 10),
      // Only ever the requester's OWN balance. An admin looking at somebody
      // else's campaign is shown no balance at all rather than theirs.
      isOwner ? this.renewal.getBalanceFor(requester.id).catch(() => null) : Promise.resolve(null),
    ]);

    const isWeekly = ad.billing_model === 'weekly';
    const startDue = !ad.starts_at || new Date(ad.starts_at).getTime() <= Date.now();

    return {
      advertisementId: ad.id,
      billingModel: ad.billing_model,
      billingStatus: ad.billing_status,
      moderationStatus: ad.status,
      weeklyMhcPrice: controls.mhcPrice,
      currentPeriodStartsAt: ad.current_period_starts_at,
      currentPeriodEndsAt: ad.current_period_ends_at,
      manualRenewalRequired: ad.manual_renewal_required,
      renewalCount: ad.renewal_count,
      rejectionReason: ad.rejection_reason,
      reviewedAt: ad.reviewed_at,
      canRenew: isWeekly && ad.billing_status === 'renewal_required',
      canActivate:
        isWeekly &&
        ad.status === 'scheduled' &&
        (ad.billing_status === 'awaiting_credits' || ad.billing_status === 'awaiting_start') &&
        startDue,
      // A campaign that can never be renewed is never offered a toggle. A
      // legacy campaign has no periods and is never charged in credits; a
      // cancelled or rejected one may not buy another week.
      autoRenewalAvailable:
        isWeekly &&
        ad.status !== 'cancelled' &&
        ad.status !== 'rejected' &&
        ad.billing_status !== 'cancelled',
      autoRenewEnabled: ad.auto_renew_enabled,
      renewalMode: ad.renewal_mode,
      maximumWeeks: ad.maximum_weeks,
      renewalEndDate: ad.renewal_end_date,
      autoRenewEnabledAt: ad.auto_renew_enabled_at,
      autoRenewConsentVersion: ad.auto_renew_consent_version,
      consentVersion: AUTO_RENEW_CONSENT_VERSION,
      autoRenewPausedReason: ad.auto_renew_paused_reason,
      autoRenewPausedAt: ad.auto_renew_paused_at,
      lastRenewalOutcome: ad.last_renewal_outcome,
      lastRenewalAttemptAt: ad.last_renewal_attempt_at,
      periodsUsed: periods.length > 0 ? Math.max(...periods.map((p) => p.period_number)) : 0,
      nextRenewalAt: ad.next_renewal_at,
      // Offered only where it can actually do something: an automatic campaign
      // the scheduler has stopped, whose advertiser can fix the cause. A
      // boundary that was REACHED (max weeks, end date) is not retryable —
      // there is no further week to buy.
      canRetryAutomaticRenewal:
        isWeekly &&
        ad.auto_renew_enabled &&
        ad.renewal_mode === 'automatic' &&
        (ad.auto_renew_paused_reason === 'insufficient_credits' ||
          ad.auto_renew_paused_reason === 'pricing_unavailable'),
      creditBalance,
      renewalHistory,
      periods: periods.map((period) => ({
        id: period.id,
        periodNumber: period.period_number,
        startsAt: period.starts_at,
        endsAt: period.ends_at,
        mhcPriceSnapshot: parseFloat(period.mhc_price_snapshot),
        status: period.status,
        renewalSource: period.renewal_source,
        hasCharge: period.action_charge_id !== null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  /**
   * Cancel a campaign.
   *
   * For a weekly campaign this hides the advertisement immediately, closes any
   * running week, and prevents any further renewal. It refunds NOTHING and
   * touches no wallet: a started week is non-refundable, and the campaign's
   * period rows and charge history are all preserved.
   *
   * For a `legacy` campaign the pre-existing prorated EGP refund is retained
   * unchanged — those campaigns really were paid for in EGP and are still owed
   * what they were promised.
   */
  async cancelAd(adId: string, userId: string) {
    await this.requireCommercialAuthority(adId, userId);
    const ad = await this.getAd(adId);

    if (ad.billing_model === 'weekly') {
      return this.cancelWeeklyAd(adId, userId);
    }
    return this.cancelLegacyAd(adId, userId);
  }

  private async cancelWeeklyAd(adId: string, userId: string) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad || ad.advertiser_id !== userId) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (ad.status === 'cancelled') {
        await client.query('COMMIT');
        return { cancelled: true, refundAmount: 0 };
      }
      if (ad.status === 'rejected') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_CANCELLABLE',
          message: 'A rejected advertisement cannot be cancelled.',
        });
      }

      // No refund calculation of any kind on this path, and no wallet call.
      await this.repo.cancelWeeklyAdInTx(client, adId, 'cancelled_by_user;weekly_no_refund');
      await client.query('COMMIT');
      return { cancelled: true, refundAmount: 0 };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** LEGACY (EGP era). Unchanged behaviour for pre-weekly campaigns. */
  private async cancelLegacyAd(adId: string, userId: string) {
    const ad = await this.getAd(adId);
    if (ad.status === 'cancelled' || ad.status === 'expired') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_CANCELLABLE',
        message: 'This advertisement is already cancelled or expired.',
      });
    }

    const client = await getPool().connect();
    let refundAmount = 0;
    try {
      await client.query('BEGIN');
      const lockedAd = await this.repo.findAdForUpdate(client, adId);
      if (!lockedAd || lockedAd.advertiser_id !== userId) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (lockedAd.status === 'cancelled' || lockedAd.status === 'expired') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_CANCELLABLE',
          message: 'This advertisement is already cancelled or expired.',
        });
      }

      // `amount_paid` is the EGP figure historic campaigns were charged. It is 0
      // for every weekly campaign, and weekly campaigns never reach this method.
      refundAmount = this.computeAdCancellationRefund(lockedAd);
      if (refundAmount > 0) {
        const advertiserWallet = await this.walletRepo.findByUserId(userId);
        if (!advertiserWallet) {
          throw new HttpError({
            statusCode: 409,
            code: 'AD_REFUND_WALLET_MISSING',
            message: 'Advertiser wallet is missing, so the ad refund cannot be posted.',
          });
        }
        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          PLATFORM_USER_ID,
        );
        try {
          await this.walletRepo.debitWalletInTransaction(
            client,
            platformWalletId,
            PLATFORM_USER_ID,
            refundAmount,
            'Advertisement cancellation refund funded',
            'advertisement_refund',
            lockedAd.id,
          );
          await this.walletRepo.creditWithTypeInTransaction(
            client,
            advertiserWallet.id,
            userId,
            refundAmount,
            'refund',
            'Advertisement cancellation refund',
            'advertisement',
            lockedAd.id,
          );
        } catch (error) {
          if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
            throw new HttpError({
              statusCode: 409,
              code: 'AD_REFUND_PLATFORM_BALANCE_INSUFFICIENT',
              message:
                'Platform ad revenue wallet cannot fund this refund. Review the ad manually.',
            });
          }
          throw error;
        }
      }

      await this.repo.cancelAdInTx(
        client,
        adId,
        `cancelled_by_user;refund_egp:${refundAmount.toFixed(2)}`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return { cancelled: true, refundAmount };
  }

  // -------------------------------------------------------------------------
  // Serving
  // -------------------------------------------------------------------------

  /**
   * Resolve the campaigns to show.
   *
   * The two expiry sweeps are the lazy half of the lifecycle: a weekly period
   * whose seven days have elapsed is closed here — atomically with its campaign
   * — before anything is ranked, so an unpaid week can never be served. A
   * scheduler that does the same on a timer belongs to Wave 2F-B; this keeps the
   * product coherent without one.
   */
  async resolveActiveAds(input: AdCenterResolveInput) {
    await this.repo.expireStaleAds();
    await this.billing.expireDuePeriods();
    const limit = input.limit ?? 5;
    const candidates = await this.repo.listActiveAdsForAdCenter(100);
    const ranked = this.adCenter.rank(candidates, input).slice(0, limit);
    await Promise.all(ranked.map((ad) => this.repo.incrementImpression(ad.id)));
    return ranked;
  }

  async trackClick(adId: string) {
    await this.getAd(adId);
    await this.repo.incrementClick(adId);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Admin controls
  // -------------------------------------------------------------------------

  async applyAdminStatus(
    adId: string,
    status: 'active' | 'paused_by_admin' | 'cancelled',
    reason?: string,
  ) {
    const ad = await this.getAd(adId);
    // A weekly campaign may not be forced live by a status write: serving is a
    // consequence of holding a paid week, and this route cannot buy one.
    if (ad.billing_model === 'weekly' && status === 'active') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_ACTIVATION_REQUIRES_PERIOD',
        message:
          'A weekly campaign becomes active by approving it or activating its due start, not by setting a status.',
      });
    }
    const updated = await this.repo.applyAdminStatus(adId, status);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    if (reason) {
      await this.repo.applyAdminSchedule(adId, { reason });
    }
    return updated;
  }

  async applyAdminSchedule(adId: string, input: AdminScheduleInput) {
    const updated = await this.repo.applyAdminSchedule(adId, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    return updated;
  }

  async applyAdminPricingOverride(adId: string, input: AdminPricingOverrideInput) {
    const updated = await this.repo.applyAdminPricingOverride(adId, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    return updated;
  }

  async getAdminAdControls(): Promise<AdControls> {
    return this.getControls();
  }

  /**
   * Admin ad pricing edits `mhc_action_prices.advertisement` — the same row the
   * charge primitive reads. There is no second place a price can be set, so the
   * displayed weekly price and the charged weekly price cannot drift.
   *
   * A change applies to FUTURE weeks only. Existing periods carry their own
   * `mhc_price_snapshot` and are never rewritten.
   */
  async updateAdminAdControls(adminId: string, input: AdminAdControlsInput): Promise<AdControls> {
    if (!(input.mhcPrice >= 0)) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_INVALID_MHC_PRICE',
        message: 'Advertisement credit price must be zero or greater.',
      });
    }
    await this.repo.upsertGlobalAdControls(adminId, input.acceptAds);
    await this.repo.setAdvertisementMhcPrice(input.mhcPrice);
    return { acceptAds: input.acceptAds, mhcPrice: input.mhcPrice };
  }

  private assertModeratable(ad: AdvertisementRow): void {
    if (ad.billing_model !== 'weekly') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_WEEKLY',
        message: 'This campaign predates the moderation flow and is not reviewed here.',
        details: { billingModel: ad.billing_model },
      });
    }
  }

  private computeAdCancellationRefund(ad: {
    amount_paid: string | null;
    starts_at: string | null;
    expires_at: string | null;
    admin_forced_starts_at: string | null;
    admin_forced_expires_at: string | null;
  }): number {
    const amountPaid = Number.parseFloat(ad.amount_paid ?? '0');
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) return 0;

    const startsAt = this.parseDate(ad.admin_forced_starts_at ?? ad.starts_at);
    const expiresAt = this.parseDate(ad.admin_forced_expires_at ?? ad.expires_at);
    const now = new Date();
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) return 0;
    if (!startsAt || startsAt.getTime() >= now.getTime()) return this.roundMoney(amountPaid);

    const totalMs = expiresAt.getTime() - startsAt.getTime();
    if (totalMs <= 0) return 0;
    const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
    return this.roundMoney(amountPaid * Math.min(1, remainingMs / totalMs));
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100;
  }
}
