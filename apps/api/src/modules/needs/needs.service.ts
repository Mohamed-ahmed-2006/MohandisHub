import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { PlansService } from '../plans/plans.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { NeedsRepository } from './needs.repository.js';
import type { BidRow, NeedRow } from './needs.repository.js';
import type { CreateBidInput, CreateNeedInput, UpdateNeedInput, UpdateBidInput } from './needs.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

export class NeedsService {
  constructor(
    private readonly repo: NeedsRepository = new NeedsRepository(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly plansService: PlansService = new PlansService(),
  ) {}

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
    if (status.featurePlansEnabled) {
      const limits = await this.plansService.getEffectivePlanLimits(customerId);
      if (limits.maxNeeds != null) {
        const count = await this.repo.countActiveNeedsByCustomer(customerId);
        if (count >= limits.maxNeeds) {
          throw new HttpError({
            statusCode: 403,
            code: 'PLAN_LIMIT_REACHED',
            message: `Your plan allows up to ${limits.maxNeeds} active needs (open, in progress, or awarded). Complete or close one to free a slot, or upgrade.`,
          });
        }
      }
    }
    try {
      return await this.repo.createNeed(customerId, input);
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
      throw new HttpError({ statusCode: 400, code: 'BID_NOT_PENDING', message: 'Can only edit pending bids.' });
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
      throw new HttpError({ statusCode: 400, code: 'BID_NOT_PENDING', message: 'Can only delete pending bids.' });
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
    return this.repo.updateNeed(needId, fields);
  }

  async createBid(needId: string, expertId: string, input: CreateBidInput) {
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
    }
    try {
      return await this.repo.createBid(needId, expertId, input);
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
      return result.map(({ expert_plan_slug: _plan, bidder_can_priority_bid: _pri, ...bid }) => bid as BidRow);
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code === '42703' || (pgErr.message?.includes('does not exist') ?? false)) {
        throw new HttpError({
          statusCode: 503,
          code: 'SCHEMA_OUTDATED',
          message: 'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
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
          message: 'Database schema is out of date. Please run migrations in the API folder: npm run migrate',
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
        throw new HttpError({ statusCode: 404, code: 'NEED_NOT_FOUND', message: 'Need not found.' });
      }
      if (need.customer_id !== userId) {
        throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
      }
      if (need.status !== 'open' && need.status !== 'awarded') {
        throw new HttpError({
          statusCode: 400,
          code: 'NEED_NOT_AWARDABLE',
          message: 'Need cannot be awarded in its current status.',
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
      if (!['pending', 'rejected', 'accepted'].includes(targetBid.status)) {
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

      await client.query(
        `UPDATE bids
         SET status = 'accepted', updated_at = now()
         WHERE id = $1`,
        [targetBid.id],
      );
      await client.query(
        `UPDATE bids
         SET status = 'rejected', updated_at = now()
         WHERE need_id = $1
           AND id != $2
           AND status IN ('pending', 'accepted')`,
        [needId, targetBid.id],
      );
      await client.query(
        `UPDATE needs
         SET status = 'awarded', awarded_bid_id = $1, updated_at = now()
         WHERE id = $2`,
        [targetBid.id, needId],
      );

      await client.query('COMMIT');
      return { needId, bidId: targetBid.id, status: 'awarded' };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const pgErr = err as { code?: string; constraint?: string };
      if (
        pgErr.code === '23505' &&
        pgErr.constraint === 'uniq_bids_one_accepted_per_need'
      ) {
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

  async payBid(needId: string, bidId: string, userId: string) {
    await this.assertNeedsFeatureEnabled();
    const status = await this.settingsService.getAppStatus();
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
        throw new HttpError({ statusCode: 404, code: 'NEED_NOT_FOUND', message: 'Need not found.' });
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
      const commission = Math.max(amount * (commissionPercent / 100), commissionMinEgp);
      const expertAmount = amount - commission;

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
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not allowed to view messages' });
    }
    return this.repo.listBidMessages(bidId, userId, isCustomer);
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
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not allowed to post messages' });
    }
    const trimmed = input.content.trim();
    const url = input.attachmentUrl?.trim();
    const contentForDb = trimmed.length > 0 ? trimmed : url ? '[Image]' : '';
    return this.repo.createBidMessage(bidId, userId, contentForDb, url ?? null);
  }

  private async findNeedForUpdate(client: PoolClient, needId: string): Promise<NeedRow | null> {
    const { rows } = await client.query<NeedRow>(
      `SELECT * FROM needs WHERE id = $1 FOR UPDATE`,
      [needId],
    );
    return rows[0] ?? null;
  }

  private async findBidForUpdate(client: PoolClient, bidId: string): Promise<BidRow | null> {
    const { rows } = await client.query<BidRow>(
      `SELECT * FROM bids WHERE id = $1 FOR UPDATE`,
      [bidId],
    );
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
      open: ['awarded', 'closed'],
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
