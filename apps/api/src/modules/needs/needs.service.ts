import { HttpError } from '../../utils/http-error.js';

import { NeedsRepository } from './needs.repository.js';
import type { CreateBidInput, CreateNeedInput, UpdateNeedInput } from './needs.validation.js';

export class NeedsService {
  constructor(private readonly repo: NeedsRepository = new NeedsRepository()) {}

  async createNeed(customerId: string, input: CreateNeedInput) {
    return this.repo.createNeed(customerId, input);
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
    await this.repo.awardBid(needId, bidId);
    return { needId, bidId, status: 'awarded' };
  }
}
