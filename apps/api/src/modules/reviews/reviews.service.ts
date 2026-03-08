// ---------------------------------------------------------------------------
// Reviews service — business logic
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

import { BookingsRepository } from '../bookings/bookings.repository.js';
import { NeedsRepository } from '../needs/needs.repository.js';

import { ReviewsRepository } from './reviews.repository.js';
import type { ReviewRow } from './reviews.repository.js';
import type { CreateReviewInput } from './reviews.validation.js';

function toReview(row: ReviewRow) {
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    targetUserId: row.target_user_id,
    targetType: row.target_type as 'expert' | 'business',
    bookingId: row.booking_id,
    needId: row.need_id,
    rating: row.rating,
    comment: row.comment,
    createdAt: row.created_at,
    reviewerName: row.reviewer_name,
  };
}

export class ReviewsService {
  private async getProviderRole(userId: string): Promise<'expert' | 'business'> {
    const { rows } = await getPool().query<{ primary_role: string }>(
      `SELECT primary_role FROM users WHERE id = $1`,
      [userId],
    );
    const role = rows[0]?.primary_role;
    return role === 'business' ? 'business' : 'expert';
  }

  constructor(
    private readonly repo: ReviewsRepository = new ReviewsRepository(),
    private readonly bookingsRepo: BookingsRepository = new BookingsRepository(),
    private readonly needsRepo: NeedsRepository = new NeedsRepository(),
  ) {}

  async create(reviewerId: string, input: CreateReviewInput) {
    let targetUserId: string;
    let targetType: string;

    if (input.bookingId) {
      const booking = await this.bookingsRepo.findById(input.bookingId);
      if (!booking) {
        throw new HttpError({
          statusCode: 404,
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found.',
        });
      }
      if (booking.customer_id !== reviewerId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Only the customer can review this booking.',
        });
      }
      if (booking.status !== 'completed') {
        throw new HttpError({
          statusCode: 400,
          code: 'BOOKING_NOT_COMPLETED',
          message: 'Can only review completed bookings.',
        });
      }
      targetUserId = booking.provider_id;
      targetType = await this.getProviderRole(targetUserId);
      const existing = await this.repo.findByBooking(input.bookingId);
      if (existing) {
        throw new HttpError({
          statusCode: 409,
          code: 'ALREADY_REVIEWED',
          message: 'You already reviewed this booking.',
        });
      }
    } else if (input.needId) {
      const need = await this.needsRepo.getNeedById(input.needId);
      if (!need) {
        throw new HttpError({
          statusCode: 404,
          code: 'NEED_NOT_FOUND',
          message: 'Need not found.',
        });
      }
      if (need.customer_id !== reviewerId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Only the need owner can review.',
        });
      }
      if (need.status !== 'completed') {
        throw new HttpError({
          statusCode: 400,
          code: 'NEED_NOT_COMPLETED',
          message: 'Can only review after marking the need as completed.',
        });
      }
      const bidId = need.awarded_bid_id;
      if (!bidId) {
        throw new HttpError({
          statusCode: 400,
          code: 'NEED_NOT_AWARDED',
          message: 'Need has no awarded bid.',
        });
      }
      const bid = await this.needsRepo.getBidById(bidId);
      if (!bid) {
        throw new HttpError({
          statusCode: 400,
          code: 'BID_NOT_FOUND',
          message: 'Awarded bid not found.',
        });
      }
      targetUserId = bid.expert_id;
      targetType = 'expert';
      const existing = await this.repo.findByNeed(input.needId);
      if (existing) {
        throw new HttpError({
          statusCode: 409,
          code: 'ALREADY_REVIEWED',
          message: 'You already reviewed this need.',
        });
      }
    } else {
      throw new HttpError({
        statusCode: 400,
        code: 'MISSING_REFERENCE',
        message: 'Either bookingId or needId is required.',
      });
    }

    const createData: Parameters<ReviewsRepository['create']>[0] = {
      reviewerId,
      targetUserId,
      targetType,
      rating: input.rating,
    };
    if (input.bookingId != null) createData.bookingId = input.bookingId;
    if (input.needId != null) createData.needId = input.needId;
    if (input.comment != null) createData.comment = input.comment;
    const row = await this.repo.create(createData);
    return toReview(row);
  }

  async listByTarget(
    targetUserId: string,
    targetType: 'expert' | 'business',
    page: number,
    limit: number,
  ) {
    const { rows, total } = await this.repo.listByTarget(
      targetUserId,
      targetType,
      page,
      limit,
    );
    return {
      items: rows.map(toReview),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
