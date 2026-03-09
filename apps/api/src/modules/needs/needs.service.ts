import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
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
  ) {}

  async createNeed(customerId: string, input: CreateNeedInput) {
    const status = await this.settingsService.getAppStatus();
    if (status.pauseNeeds) {
      throw new HttpError({
        statusCode: 503,
        code: 'NEEDS_PAUSED',
        message: 'Posting new needs is temporarily disabled.',
      });
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
    return this.repo.listNeedsByCustomer(customerId, page, limit);
  }

  async listOpenNeeds(page: number, limit: number, categoryId?: string) {
    return this.repo.listOpenNeeds(page, limit, categoryId);
  }

  async getNeed(needId: string) {
    const need = await this.repo.getNeedById(needId);
    if (!need)
      throw new HttpError({ statusCode: 404, code: 'NEED_NOT_FOUND', message: 'Need not found.' });
    return need;
  }

  async updateBid(needId: string, bidId: string, expertId: string, input: UpdateBidInput) {
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
    const need = await this.getNeed(needId);
    if (need.customer_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
    }
    const fields: Record<string, unknown> = {};
    if (input.status) fields.status = input.status;
    if (input.title) fields.title = input.title;
    if (input.description) fields.description = input.description;
    return this.repo.updateNeed(needId, fields);
  }

  async createBid(needId: string, expertId: string, input: CreateBidInput) {
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
    const need = await this.getNeed(needId);
    if (need.customer_id !== userId) {
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'Only the need owner can view bids.',
      });
    }
    try {
      return await this.repo.listBidsForNeed(needId);
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

  async createBidMessage(needId: string, bidId: string, userId: string, content: string) {
    const need = await this.getNeed(needId);
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({ statusCode: 404, code: 'BID_NOT_FOUND', message: 'Bid not found' });
    }
    if (need.customer_id !== userId && bid.expert_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not allowed to post messages' });
    }
    return this.repo.createBidMessage(bidId, userId, content);
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
}
