import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

import { SettingsService } from '../settings/settings.service.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { NeedsRepository } from './needs.repository.js';
import type { CreateBidInput, CreateNeedInput, UpdateNeedInput } from './needs.validation.js';

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
    return this.repo.listBidsForNeed(needId);
  }

  async listMyBids(expertId: string, page: number, limit: number) {
    return this.repo.listBidsByExpert(expertId, page, limit);
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
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Payments are temporarily disabled.',
      });
    }

    const need = await this.getNeed(needId);
    if (need.customer_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your need.' });
    }
    if (need.status !== 'open') {
      throw new HttpError({ statusCode: 400, code: 'NEED_NOT_OPEN', message: 'Need is not open.' });
    }
    const bid = await this.repo.getBidById(bidId);
    if (!bid || bid.need_id !== needId) {
      throw new HttpError({
        statusCode: 404,
        code: 'BID_NOT_FOUND',
        message: 'Bid not found for this need.',
      });
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

    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const platformWalletId = await this.walletRepo.getOrCreatePlatformWallet(client);
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
          '00000000-0000-0000-0000-000000000001',
          commission,
          'commission',
          `Commission from bid`,
          'bid',
          bidId,
        );
      }
      await this.repo.awardBidInTransaction(client, needId, bidId, paymentTxId);
      await client.query('COMMIT');
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

    return { needId, bidId, status: 'awarded' };
  }
}
