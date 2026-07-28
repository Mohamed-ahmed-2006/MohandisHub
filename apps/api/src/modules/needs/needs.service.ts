import {
  computeCommissionSplit,
  isPaymentMethodEnabledStrict,
  type EffectivePlanLimits,
} from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
import { redactContactDetails } from '../../utils/contact-redaction.js';
import { HttpError } from '../../utils/http-error.js';
import { ActivationGateService } from '../mhc/activation-gate.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PlansService } from '../plans/plans.service.js';
import { UsageQuotaService } from '../plans/usage-quota.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';


import { NeedsRepository } from './needs.repository.js';
import type { BidRow, NeedRow } from './needs.repository.js';
import type {
  CreateBidInput,
  CreateNeedInput,
  UpdateNeedInput,
  UpdateBidInput,
} from './needs.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

export class NeedsService {
  constructor(
    private readonly repo: NeedsRepository = new NeedsRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly plansService: PlansService = new PlansService(),
    private readonly usageQuotaService: UsageQuotaService = new UsageQuotaService(),
    private readonly notificationsService: NotificationsService = new NotificationsService(),
    private readonly activationGate: ActivationGateService = new ActivationGateService(),
  ) {}

  private notifyUser(
    userId: string,
    type: string,
    title: string,
    message: string,
    payload: Record<string, unknown>,
  ): void {
    void this.notificationsService
      .createForUser(userId, { type, title, message, payload })
      .catch(() => {});
  }

  private async assertNeedsFeatureEnabled(): Promise<void> {
    const status = await this.settingsService.getAppStatus();
    if (!status.featureNeedsEnabled) {
      throw new HttpError({
        statusCode: 503,
        code: 'FEATURE_DISABLED',
        message: 'Needs are currently disabled.',
      });
    }
  }

  async createNeed(customerId: string, input: CreateNeedInput) {
    return this.usageQuotaService.withActionLock(customerId, 'new_needs_per_period', async () => {
      await this.assertNeedsFeatureEnabled();
      const status = await this.settingsService.getAppStatus();
      if (status.featureHourlyPricingEnabled === false && input.budgetType === 'hourly') {
        throw new HttpError({
          statusCode: 400,
          code: 'HOURLY_PRICING_DISABLED',
          message: 'Hourly pricing is disabled.',
        });
      }
      if (status.pauseNeeds) {
        throw new HttpError({
          statusCode: 503,
          code: 'NEEDS_PAUSED',
          message: 'Posting new needs is temporarily disabled.',
        });
      }
      let planLimits: EffectivePlanLimits | null = null;
      if (status.featurePlansEnabled) {
        planLimits = await this.plansService.getEffectivePlanLimits(customerId);
        if (planLimits.maxNeeds != null) {
          const count = await this.repo.countActiveNeedsByCustomer(customerId);
          if (count >= planLimits.maxNeeds) {
            throw new HttpError({
              statusCode: 403,
              code: 'PLAN_LIMIT_REACHED',
              message: `Your plan allows up to ${planLimits.maxNeeds} active needs (open, in progress, or awarded). Complete or close one to free a slot, or upgrade.`,
            });
          }
        }
        const q = planLimits.usageQuotas.new_needs_per_period;
        if (q) {
          const { start } = await this.usageQuotaService.resolvePeriodBounds(customerId, q.period);
          const used = await this.usageQuotaService.getCountForWindow(
            customerId,
            'new_needs_per_period',
            start,
          );
          if (used >= q.maxPerPeriod) {
            throw new HttpError({
              statusCode: 403,
              code: 'PLAN_USAGE_QUOTA_EXCEEDED',
              message: `You have reached your plan limit for posting new needs in this period (${q.maxPerPeriod} maximum).`,
            });
          }
        }
      }
      try {
        const created = await this.repo.createNeed(customerId, input);
        if (planLimits?.usageQuotas?.new_needs_per_period) {
          await this.usageQuotaService.consumeIfConfigured(
            customerId,
            'new_needs_per_period',
            planLimits.usageQuotas.new_needs_per_period,
          );
        }
        return created;
      } catch (err: unknown) {
        const pgErr = err as { code?: string; message?: string };
        if (pgErr.code === '42703' || (pgErr.message?.includes('does not exist') ?? false)) {
          throw new HttpError({
            statusCode: 503,
            code: 'SCHEMA_OUTDATED',
            message:
              'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
          });
        }
        throw err;
      }
    });
  }

  async listMyNeeds(customerId: string, page: number, limit: number) {
    await this.assertNeedsFeatureEnabled();
    return this.repo.listNeedsByCustomer(customerId, page, limit);
  }

  async listOpenNeeds(page: number, limit: number, categoryId?: string) {
    await this.assertNeedsFeatureEnabled();
    return this.repo.listOpenNeeds(page, limit, categoryId);
  }

  async getNeed(needId: string) {
    await this.assertNeedsFeatureEnabled();
    const need = await this.repo.getNeedById(needId);
    if (!need)
      throw new HttpError({ statusCode: 404, code: 'NEED_NOT_FOUND', message: 'Need not found.' });
    return need;
  }

  async updateBid(needId: string, bidId: string, expertId: string, input: UpdateBidInput) {
    await this.assertNeedsFeatureEnabled();
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found.' });
    }
    if (bid.expert_id !== expertId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your bid.' });
    }
    if (bid.status !== 'pending') {
      throw new HttpError({
        statusCode: 400,
        code: 'BID_NOT_PENDING',
        message: 'Can only edit pending bids.',
      });
    }

    const fields: Record<string, unknown> = {};
    if (input.amount !== undefined) fields.amount = input.amount;
    if (input.message !== undefined) fields.message = input.message;
    if (input.deliveryDays !== undefined) fields.delivery_days = input.deliveryDays;
    if (input.estimatedHours !== undefined) fields.estimated_hours = input.estimatedHours;
    return this.repo.updateBid(bidId, fields);
  }

  async deleteBid(needId: string, bidId: string, expertId: string) {
    await this.assertNeedsFeatureEnabled();
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found.' });
    }
    if (bid.expert_id !== expertId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your bid.' });
    }
    if (bid.status !== 'pending') {
      throw new HttpError({
        statusCode: 400,
        code: 'BID_NOT_PENDING',
        message: 'Can only delete pending bids.',
      });
    }
    return this.repo.deleteBid(bidId);
  }

  async updateNeed(needId: string, userId: string, input: UpdateNeedInput) {
    await this.assertNeedsFeatureEnabled();
    const need = await this.getNeed(needId);
    if (need.customer_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
    }
    if (input.status) {
      this.assertNeedStatusTransition(need.status, input.status);
    }
    const fields: Record<string, unknown> = {};
    if (input.status) fields.status = input.status;
    if (input.title) fields.title = input.title;
    if (input.description) fields.description = input.description;
    const updated = await this.repo.updateNeed(needId, fields);
    if (input.status === 'closed') {
      const bids = await this.repo.listBidsForNeed(needId);
      const seen = new Set<string>();
      for (const b of bids) {
        if (seen.has(b.expert_id)) continue;
        seen.add(b.expert_id);
        this.notifyUser(
          b.expert_id,
          'need_closed',
          'Need closed',
          'A need you bid on was closed by the customer.',
          { needId, bidId: b.id },
        );
      }
    }
    return updated;
  }

  async createBid(needId: string, expertId: string, input: CreateBidInput) {
    return this.usageQuotaService.withActionLock(needId, 'bids_on_need', () =>
      this.usageQuotaService.withActionLock(expertId, 'new_bids_per_period', async () => {
        await this.assertNeedsFeatureEnabled();
        const status = await this.settingsService.getAppStatus();
        if (status.pauseBids) {
          throw new HttpError({
            statusCode: 503,
            code: 'BIDS_PAUSED',
            message: 'Placing bids is temporarily disabled.',
          });
        }

        const need = await this.getNeed(needId);
        if (need.status !== 'open') {
          throw new HttpError({
            statusCode: 400,
            code: 'NEED_NOT_OPEN',
            message: 'This need is not open for bids.',
          });
        }
        if (need.customer_id === expertId) {
          throw new HttpError({
            statusCode: 400,
            code: 'SELF_BID',
            message: 'You cannot bid on your own need.',
          });
        }
        const minTransactionEgp = status.minTransactionEgp ?? 0;
        if (minTransactionEgp > 0 && input.amount <= minTransactionEgp) {
          throw new HttpError({
            statusCode: 400,
            code: 'BID_AMOUNT_BELOW_MINIMUM',
            message: `Bid amount must be greater than the minimum transaction amount (${minTransactionEgp} EGP) so your payout stays positive after commission.`,
          });
        }
        let bidderLimitsForMeter: EffectivePlanLimits | undefined;
        if (status.featurePlansEnabled) {
          const customerLimits = await this.plansService.getEffectivePlanLimits(need.customer_id);
          if (customerLimits.maxBidsPerNeed != null) {
            const bidCount = await this.repo.countActiveBidsOnNeed(needId);
            if (bidCount >= customerLimits.maxBidsPerNeed) {
              throw new HttpError({
                statusCode: 403,
                code: 'PLAN_LIMIT_REACHED',
                message: `This need has reached the maximum number of bids allowed (${customerLimits.maxBidsPerNeed}) for the owner's plan.`,
              });
            }
          }
          const bidderLimits = await this.plansService.getEffectivePlanLimits(expertId);
          bidderLimitsForMeter = bidderLimits;
          if (bidderLimits.maxActiveBids != null) {
            const pending = await this.repo.countPendingBidsForExpert(expertId);
            if (pending >= bidderLimits.maxActiveBids) {
              throw new HttpError({
                statusCode: 403,
                code: 'PLAN_LIMIT_REACHED',
                message: `Your plan allows up to ${bidderLimits.maxActiveBids} active bids. Withdraw or wait for responses before placing more.`,
              });
            }
          }
          const bidQ = bidderLimits.usageQuotas.new_bids_per_period;
          if (bidQ) {
            const { start } = await this.usageQuotaService.resolvePeriodBounds(
              expertId,
              bidQ.period,
            );
            const used = await this.usageQuotaService.getCountForWindow(
              expertId,
              'new_bids_per_period',
              start,
            );
            if (used >= bidQ.maxPerPeriod) {
              throw new HttpError({
                statusCode: 403,
                code: 'PLAN_USAGE_QUOTA_EXCEEDED',
                message: `You have reached your plan limit for new bids in this period (${bidQ.maxPerPeriod} maximum).`,
              });
            }
          }
        }
        try {
          const bid = await this.repo.createBid(needId, expertId, input);
          if (bidderLimitsForMeter?.usageQuotas.new_bids_per_period) {
            await this.usageQuotaService.consumeIfConfigured(
              expertId,
              'new_bids_per_period',
              bidderLimitsForMeter.usageQuotas.new_bids_per_period,
            );
          }
          this.notifyUser(
            need.customer_id,
            'need_bid_received',
            'New bid on your need',
            'A provider submitted a new bid.',
            { needId, bidId: bid.id },
          );
          return bid;
        } catch (err: unknown) {
          const pgErr = err as { code?: string };
          if (pgErr.code === '23505') {
            throw new HttpError({
              statusCode: 409,
              code: 'DUPLICATE_BID',
              message: 'You already placed a bid on this need.',
            });
          }
          throw err;
        }
      }),
    );
  }

  async listBidsForNeed(needId: string, userId: string) {
    await this.assertNeedsFeatureEnabled();
    const need = await this.getNeed(needId);
    if (need.customer_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the need owner can view bids.',
      });
    }
    try {
      const status = await this.settingsService.getAppStatus();
      if (!status.featurePlansEnabled) {
        return await this.repo.listBidsForNeed(needId);
      }
      const limits = await this.plansService.getEffectivePlanLimits(userId);
      const visibility = limits.bidsVisibleToCustomer;
      const bidsWithPlan = await this.repo.listBidsForNeedWithExpertPlan(needId);
      const sorted = [...bidsWithPlan].sort((a, b) => {
        const score = (x: (typeof bidsWithPlan)[0]) => {
          let s = 0;
          if (x.bidder_can_priority_bid) s += 100;
          if (x.expert_plan_slug && x.expert_plan_slug !== 'free') s += 10;
          return s;
        };
        const d = score(b) - score(a);
        if (d !== 0) return d;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      let result = sorted;
      if (visibility === 'top_n') {
        const n = limits.bidsVisibleTopN ?? 3;
        result = sorted.slice(0, n);
      }
      return result.map(
        ({ expert_plan_slug: _plan, bidder_can_priority_bid: _pri, ...bid }) => bid as BidRow,
      );
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '42703' || (pgErr.message?.includes('does not exist') ?? false)) {
        throw new HttpError({
          statusCode: 503,
          code: 'SCHEMA_OUTDATED',
          message:
            'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
        });
      }
      throw err;
    }
  }

  async listMyBids(expertId: string, page: number, limit: number) {
    await this.assertNeedsFeatureEnabled();
    try {
      return await this.repo.listBidsByExpert(expertId, page, limit);
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '42703' || (pgErr.message?.includes('does not exist') ?? false)) {
        throw new HttpError({
          statusCode: 503,
          code: 'SCHEMA_OUTDATED',
          message:
            'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
        });
      }
      throw err;
    }
  }

  async awardBid(needId: string, bidId: string, userId: string) {
    await this.assertNeedsFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
    if (status.pauseAwardBids) {
      throw new HttpError({
        statusCode: 503,
        code: 'AWARD_BIDS_PAUSED',
        message: 'Awarding bids is temporarily disabled.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const need = await this.findNeedForUpdate(client, needId);
      if (!need) {
        throw new HttpError({
          statusCode: 404,
          code: 'NEED_NOT_FOUND',
          message: 'Need not found.',
        });
      }
      if (need.customer_id !== userId) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
      }
      if (
        need.status !== 'open' &&
        need.status !== 'awarded' &&
        need.status !== 'awarded_pending_provider_acceptance'
      ) {
        throw new HttpError({
          statusCode: 400,
          code: 'NEED_NOT_AWARDABLE',
          message: 'Need cannot be awarded in its current status.',
        });
      }
      // Once the provider has paid to activate, the customer cannot silently
      // re-award to someone else — the provider has spent real credits.
      if (need.activated_at != null) {
        throw new HttpError({
          statusCode: 409,
          code: 'NEED_ALREADY_ACTIVATED',
          message:
            'This job has already been activated by the awarded provider and can no longer be re-awarded.',
        });
      }

      const bids = await this.listBidsForNeedForUpdate(client, needId);
      const targetBid = bids.find((row) => row.id === bidId);
      if (!targetBid) {
        throw new HttpError({
          statusCode: 404,
          code: 'BID_NOT_FOUND',
          message: 'Bid not found for this need.',
        });
      }
      if (!['pending', 'awarded_pending', 'rejected', 'accepted'].includes(targetBid.status)) {
        throw new HttpError({
          statusCode: 400,
          code: 'BID_NOT_AWARDABLE',
          message: 'Bid cannot be awarded in its current status.',
        });
      }

      const currentlyAccepted = bids.find((row) => row.status === 'accepted');
      const isReplacement = currentlyAccepted != null && currentlyAccepted.id !== targetBid.id;

      if (isReplacement && this.hasBidPaymentStarted(currentlyAccepted)) {
        throw new HttpError({
          statusCode: 409,
          code: 'AWARD_REPLACEMENT_BLOCKED',
          message: 'Cannot replace awarded bid after payment has started.',
        });
      }

      const losers = bids.filter(
        (row) =>
          row.id !== targetBid.id &&
          ['pending', 'awarded_pending', 'accepted'].includes(row.status),
      );

      // Awarding is now an OFFER, not an activation. The provider must accept and
      // pay the MHC activation price before the job opens. Nothing is charged
      // here, so a customer can never spend a provider's credits.
      const expiryHours = await this.activationGate.getAwardAcceptanceExpiryHours();

      await client.query(
        `UPDATE bids
         SET status = 'awarded_pending', award_offered_at = now(), updated_at = now()
         WHERE id = $1`,
        [targetBid.id],
      );
      await client.query(
        `UPDATE bids
         SET status = 'rejected', updated_at = now()
         WHERE need_id = $1
           AND id != $2
           AND status IN ('pending', 'awarded_pending', 'accepted')`,
        [needId, targetBid.id],
      );
      // expiryHours = 0 means "never expires"; store NULL so the sweep skips it.
      // The CHECK constraint requires an expiry when status is pending, so a
      // never-expiring award uses a far-future sentinel instead of NULL.
      await client.query(
        `UPDATE needs
         SET status = 'awarded_pending_provider_acceptance',
             awarded_bid_id = NULL,
             pending_award_bid_id = $1,
             pending_award_at = now(),
             pending_award_expires_at = CASE
               WHEN $3::int > 0 THEN now() + ($3::int * INTERVAL '1 hour')
               ELSE 'infinity'::timestamptz
             END,
             updated_at = now()
         WHERE id = $2`,
        [targetBid.id, needId, expiryHours],
      );

      await client.query('COMMIT');
      this.notifyUser(
        targetBid.expert_id,
        'need_bid_awarded',
        'You were selected — activate to start',
        expiryHours > 0
          ? `A customer selected your bid. Accept and activate it with credits within ${expiryHours} hours to unlock the job.`
          : 'A customer selected your bid. Accept and activate it with credits to unlock the job.',
        { needId, bidId: targetBid.id, requiresActivation: true },
      );
      for (const lo of losers) {
        this.notifyUser(
          lo.expert_id,
          'need_bid_rejected',
          'Bid not selected',
          'Another bid was selected for this need.',
          { needId, bidId: lo.id },
        );
      }
      return {
        needId,
        bidId: targetBid.id,
        status: 'awarded_pending_provider_acceptance',
        awaitingProviderActivation: true,
      };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgErr = err as { code?: string; constraint?: string };
      if (pgErr.code === '23505' && pgErr.constraint === 'uniq_bids_one_accepted_per_need') {
        throw new HttpError({
          statusCode: 409,
          code: 'AWARD_CONFLICT',
          message: 'Another bid has already been accepted for this need.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * LEGACY / RETIRED FOR LAUNCH — internal customer→provider escrow payment.
   *
   * The launch model is: the customer pays the provider DIRECTLY using the
   * provider's own payment methods, and MohandisHub never holds job money. Its
   * only revenue rail is MHC (see MhcService).
   *
   * This method still contains the full escrow implementation so the historical
   * behaviour and ledger remain auditable, but it is fenced behind the
   * fail-CLOSED `escrow_bid_payment` flag and therefore unreachable unless an
   * admin deliberately re-enables it. Do not build new features on it.
   */
  async payBid(needId: string, bidId: string, userId: string) {
    await this.assertNeedsFeatureEnabled();
    const status = await this.settingsService.getAppStatus();

    // Fail-CLOSED: an absent flag must NOT re-open the retired escrow rail.
    if (!isPaymentMethodEnabledStrict(status.paymentMethodsEnabled, 'escrow_bid_payment')) {
      throw new HttpError({
        statusCode: 410,
        code: 'ESCROW_PAYMENTS_RETIRED',
        message:
          'In-platform escrow payments are no longer available. Pay the provider directly using the payment details shown on the job after the provider activates it.',
      });
    }

    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Payments are temporarily disabled.',
      });
    }

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const need = await this.findNeedForUpdate(client, needId);
      if (!need) {
        throw new HttpError({
          statusCode: 404,
          code: 'NEED_NOT_FOUND',
          message: 'Need not found.',
        });
      }
      if (need.customer_id !== userId) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
      }
      if (need.status !== 'awarded' && need.status !== 'completed') {
        throw new HttpError({
          statusCode: 400,
          code: 'NEED_NOT_AWARDED',
          message: 'Need is not awarded yet.',
        });
      }

      const bid = await this.findBidForUpdate(client, bidId);
      if (!bid || bid.need_id !== needId) {
        throw new HttpError({
          statusCode: 404,
          code: 'BID_NOT_FOUND',
          message: 'Bid not found for this need.',
        });
      }
      if (bid.status !== 'accepted' || need.awarded_bid_id !== bid.id) {
        throw new HttpError({
          statusCode: 400,
          code: 'BID_NOT_CURRENT_AWARDED',
          message: 'Only the currently awarded accepted bid can be paid.',
        });
      }

      if (this.hasBidPaymentStarted(bid)) {
        await client.query('COMMIT');
        return { needId, bidId, paid: true, alreadyPaid: true };
      }

      const amount = parseFloat(bid.amount);
      const commissionPercent = status.commissionPercent ?? 10;
      const commissionMinEgp = status.commissionMinEgp ?? 0;
      // Single source of truth for the split. Caps commission at `amount` so the
      // expert payout can never be negative and the platform can never be
      // credited more than the customer paid.
      const { commission, providerAmount: expertAmount } = computeCommissionSplit(
        amount,
        commissionPercent,
        commissionMinEgp,
      );

      const customerWallet = await this.walletRepo.findByUserId(need.customer_id);
      if (!customerWallet) {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'You need a wallet with sufficient balance. Please deposit first.',
        });
      }
      const customerBalance = parseFloat(customerWallet.balance);
      if (customerBalance < amount) {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: `Insufficient balance. Required: ${amount} ${bid.currency}, available: ${customerBalance}.`,
        });
      }

      let expertWallet = await this.walletRepo.findByUserId(bid.expert_id);
      if (!expertWallet) {
        expertWallet = await this.walletRepo.createForUser(bid.expert_id);
      }

      const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
        client,
        PLATFORM_USER_ID,
      );
      const paymentTxId = await this.walletRepo.debitWalletInTransaction(
        client,
        customerWallet.id,
        need.customer_id,
        amount,
        `Payment for need: ${need.title}`,
        'bid',
        bidId,
      );
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        expertWallet.id,
        bid.expert_id,
        expertAmount,
        'payment',
        `Earned from need: ${need.title}`,
        'bid',
        bidId,
      );
      if (commission > 0) {
        await this.walletRepo.creditWithTypeInTransaction(
          client,
          platformWalletId,
          PLATFORM_USER_ID,
          commission,
          'commission',
          `Commission from bid`,
          'bid',
          bidId,
        );
      }

      await client.query(
        `UPDATE bids
         SET paid_at = now(), payment_transaction_id = $2, updated_at = now()
         WHERE id = $1`,
        [bidId, paymentTxId],
      );

      await client.query('COMMIT');
      this.notifyUser(
        bid.expert_id,
        'need_bid_paid',
        'Bid payment received',
        'The customer paid for your awarded bid.',
        { needId, bidId },
      );
      return { needId, bidId, paid: true, alreadyPaid: false };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance. Please deposit first.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async listBidMessages(needId: string, bidId: string, userId: string) {
    await this.assertNeedsFeatureEnabled();
    const need = await this.getNeed(needId);
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found' });
    }
    const isCustomer = need.customer_id === userId;
    if (!isCustomer && bid.expert_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not allowed to view messages',
      });
    }
    const messages = await this.repo.listBidMessages(bidId, userId, isCustomer);
    const unlocked = await this.isBidUnlocked(bidId);
    if (unlocked) {
      // This bid was paid for: reveal the original text stored alongside the
      // redacted copy.
      return messages.map((m) => ({
        ...m,
        content: m.raw_content ?? m.content,
        contact_locked: false,
        thread_read_only: false,
      }));
    }
    // Not unlocked. Never return raw_content, and strip attachments so an image
    // of a business card cannot bypass the text filter.
    //
    // A losing bid on an ACTIVATED need is archived: permanently readable but
    // permanently redacted and closed to new messages (decision D3). Signalling
    // that explicitly stops the UI presenting an unreachable input box.
    const archived = need.activated_at != null;
    return messages.map(({ raw_content: _raw, ...m }) => ({
      ...m,
      attachment_url: null,
      contact_locked: true,
      thread_read_only: archived,
    }));
  }

  /**
   * Is THIS bid's thread unlocked?
   *
   * Keyed on an `mhc_job_activations` row for the bid, not on `needs.activated_at`.
   * The need-scoped test was a paywall bypass: once any bid on a need was
   * activated, every other bid thread on that need unlocked too, handing the
   * customer's contact details to every provider who bid and paid nothing.
   */
  private async isBidUnlocked(bidId: string): Promise<boolean> {
    if (!(await this.activationGate.isGateEnabled())) return true;
    return this.activationGate.isAwardActivated(bidId);
  }

  async createBidMessage(
    needId: string,
    bidId: string,
    userId: string,
    input: { content: string; attachmentUrl?: string },
  ) {
    await this.assertNeedsFeatureEnabled();
    const need = await this.getNeed(needId);
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found' });
    }
    if (need.customer_id !== userId && bid.expert_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Not allowed to post messages',
      });
    }

    const trimmed = input.content.trim();
    const url = input.attachmentUrl?.trim();

    const unlocked = await this.isBidUnlocked(bidId);

    // A losing bid on an activated need is closed for good. Without this, the
    // provider who lost could keep messaging the customer indefinitely on a job
    // that went to someone else.
    if (!unlocked && need.activated_at != null) {
      throw new HttpError({
        statusCode: 403,
        code: 'BID_THREAD_ARCHIVED',
        message: 'This conversation is closed because the job was awarded to another provider.',
      });
    }

    if (unlocked) {
      const contentForDb = trimmed.length > 0 ? trimmed : url ? '[Image]' : '';
      return this.repo.createBidMessage(bidId, userId, contentForDb, url ?? null);
    }

    // Pre-activation. Attachments are blocked outright: a photo of a phone number
    // or business card would defeat text redaction entirely.
    if (url) {
      throw new HttpError({
        statusCode: 403,
        code: 'ATTACHMENTS_LOCKED_UNTIL_ACTIVATION',
        message:
          'Attachments are only available after the provider activates the job. Please describe the work in text for now.',
      });
    }

    const maskingEnabled = await this.activationGate.isContactMaskingEnabled();
    if (!maskingEnabled) {
      const contentForDb = trimmed.length > 0 ? trimmed : '';
      return this.repo.createBidMessage(bidId, userId, contentForDb, null);
    }

    const { content: safeContent, redacted } = redactContactDetails(trimmed);
    // Store the original in raw_content for moderation and for reveal after
    // activation; serve only `content` until then.
    return this.repo.createBidMessage(bidId, userId, safeContent, null, {
      contactRedacted: redacted,
      rawContent: trimmed,
    });
  }

  private async findNeedForUpdate(client: PoolClient, needId: string): Promise<NeedRow | null> {
    const { rows } = await client.query<NeedRow>(`SELECT * FROM needs WHERE id = $1 FOR UPDATE`, [
      needId,
    ]);
    return rows[0] ?? null;
  }

  private async findBidForUpdate(client: PoolClient, bidId: string): Promise<BidRow | null> {
    const { rows } = await client.query<BidRow>(`SELECT * FROM bids WHERE id = $1 FOR UPDATE`, [
      bidId,
    ]);
    return rows[0] ?? null;
  }

  private async listBidsForNeedForUpdate(client: PoolClient, needId: string): Promise<BidRow[]> {
    const { rows } = await client.query<BidRow>(
      `SELECT * FROM bids WHERE need_id = $1 FOR UPDATE`,
      [needId],
    );
    return rows;
  }

  private hasBidPaymentStarted(bid: BidRow): boolean {
    return bid.paid_at != null || bid.payment_transaction_id != null;
  }

  private assertNeedStatusTransition(from: string, to: string): void {
    if (from === to) return;
    const allowed: Record<string, string[]> = {
      open: ['awarded_pending_provider_acceptance', 'closed'],
      // Provider acceptance/expiry is driven by the activation flow and the
      // expiry worker, not by a customer status PATCH. The customer may still
      // close the need to withdraw the offer.
      awarded_pending_provider_acceptance: ['closed'],
      awarded: ['in_progress', 'completed', 'closed'],
      in_progress: ['completed', 'closed'],
      completed: [],
      closed: [],
    };
    if (!(allowed[from] ?? []).includes(to)) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_NEED_STATUS_TRANSITION',
        message: `Cannot transition need status from ${from} to ${to}.`,
      });
    }
  }
}
