// ---------------------------------------------------------------------------
// Reviews service — business logic
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';

import { NeedsRepository } from '../needs/needs.repository.js';

import { ReviewsRepository } from './reviews.repository.js';
import type { ReviewRow } from './reviews.repository.js';
import type { CreateReviewInput } from './reviews.validation.js';

type ReservationReviewRef = {
  id: string;
  customer_id: string;
  provider_id: string;
  status: string;
  legacy_booking_id: string | null;
};

function toReview(row: ReviewRow) {
  return {
    id: row.id,
    reviewerId: row.reviewer_id,
    targetUserId: row.target_user_id,
    targetType: row.target_type as 'expert' | 'business',
    reservationId: row.reservation_id,
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
    private readonly needsRepo: NeedsRepository = new NeedsRepository(),
  ) {}

  async create(reviewerId: string, input: CreateReviewInput) {
    let targetUserId: string;
    let targetType: string;
    let reservationId: string | undefined;
    let bookingId: string | undefined;

    if (input.reservationId || input.bookingId) {
      const reservation = await this.findReservationForReview(input);
      if (!reservation) {
        throw new HttpError({
          statusCode: 404,
          code: 'RESERVATION_NOT_FOUND',
          message: 'Reservation not found.',
        });
      }
      if (reservation.customer_id !== reviewerId) {
        throw new HttpError({
          statusCode: 403,
          code: 'FORBIDDEN',
          message: 'Only the customer can review this reservation.',
        });
      }
      if (reservation.status !== 'completed') {
        throw new HttpError({
          statusCode: 400,
          code: 'RESERVATION_NOT_COMPLETED',
          message: 'Can only review completed reservations.',
        });
      }
      targetUserId = reservation.provider_id;
      targetType = await this.getProviderRole(targetUserId);
      const existing = await this.repo.findByReservation(reservation.id);
      if (existing) {
        throw new HttpError({
          statusCode: 409,
          code: 'ALREADY_REVIEWED',
          message: 'You already reviewed this reservation.',
        });
      }
      reservationId = reservation.id;
      bookingId = reservation.legacy_booking_id ?? input.bookingId;
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
        message: 'Either reservationId, bookingId, or needId is required.',
      });
    }

    const createData: Parameters<ReviewsRepository['create']>[0] = {
      reviewerId,
      targetUserId,
      targetType,
      rating: input.rating,
    };
    if (reservationId != null) createData.reservationId = reservationId;
    if (bookingId != null) createData.bookingId = bookingId;
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

  private async findReservationForReview(
    input: CreateReviewInput,
  ): Promise<ReservationReviewRef | null> {
    if (input.reservationId) {
      const { rows } = await getPool().query<ReservationReviewRef>(
        `SELECT id, customer_id, provider_id, status, legacy_booking_id::text
         FROM reservations
         WHERE id = $1`,
        [input.reservationId],
      );
      return rows[0] ?? null;
    }

    if (input.bookingId) {
      const { rows } = await getPool().query<ReservationReviewRef>(
        `SELECT id, customer_id, provider_id, status, legacy_booking_id::text
         FROM reservations
         WHERE legacy_booking_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [input.bookingId],
      );
      return rows[0] ?? null;
    }

    return null;
  }
}
