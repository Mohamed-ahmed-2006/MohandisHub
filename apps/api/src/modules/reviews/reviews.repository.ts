// ---------------------------------------------------------------------------
// Reviews repository — database access
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';

export type ReviewRow = {
  id: string;
  reviewer_id: string;
  target_user_id: string;
  target_type: string;
  reservation_id: string | null;
  booking_id: string | null;
  need_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
  reviewer_name?: string;
};

export class ReviewsRepository {
  async create(data: {
    reviewerId: string;
    targetUserId: string;
    targetType: string;
    reservationId?: string;
    bookingId?: string;
    needId?: string;
    rating: number;
    comment?: string;
  }): Promise<ReviewRow> {
    const { rows } = await getPool().query<ReviewRow>(
      `INSERT INTO reviews (reviewer_id, target_user_id, target_type, reservation_id, booking_id, need_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.reviewerId,
        data.targetUserId,
        data.targetType,
        data.reservationId ?? null,
        data.bookingId ?? null,
        data.needId ?? null,
        data.rating,
        data.comment ?? null,
      ],
    );
    const row = rows[0]!;
    const { rows: nameRows } = await getPool().query<{ display_name: string }>(
      `SELECT COALESCE(display_name, email) AS display_name FROM users WHERE id = $1`,
      [data.reviewerId],
    );
    row.reviewer_name = nameRows[0]?.display_name ?? '';
    return row;
  }

  async listByTarget(
    targetUserId: string,
    targetType: string,
    page: number,
    limit: number,
  ): Promise<{ rows: ReviewRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const { rows } = await getPool().query<ReviewRow>(
      `SELECT r.*, COALESCE(u.display_name, u.email) AS reviewer_name
       FROM reviews r
       JOIN users u ON u.id = r.reviewer_id
       WHERE r.target_user_id = $1 AND r.target_type = $2
       ORDER BY r.created_at DESC
       LIMIT $3 OFFSET $4`,
      [targetUserId, targetType, limit, offset],
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text FROM reviews WHERE target_user_id = $1 AND target_type = $2`,
      [targetUserId, targetType],
    );
    const total = parseInt(countRows[0]!.count, 10);
    return { rows, total };
  }

  async findByBooking(bookingId: string): Promise<ReviewRow | null> {
    const { rows } = await getPool().query<ReviewRow>(
      `SELECT * FROM reviews WHERE booking_id = $1`,
      [bookingId],
    );
    return rows[0] ?? null;
  }

  async findByReservation(reservationId: string): Promise<ReviewRow | null> {
    const { rows } = await getPool().query<ReviewRow>(
      `SELECT * FROM reviews WHERE reservation_id = $1`,
      [reservationId],
    );
    return rows[0] ?? null;
  }

  async findByNeed(needId: string): Promise<ReviewRow | null> {
    const { rows } = await getPool().query<ReviewRow>(
      `SELECT * FROM reviews WHERE need_id = $1`,
      [needId],
    );
    return rows[0] ?? null;
  }

  async getAvgRating(targetUserId: string, targetType: string): Promise<number | null> {
    const { rows } = await getPool().query<{ avg: string }>(
      `SELECT AVG(rating)::text FROM reviews WHERE target_user_id = $1 AND target_type = $2`,
      [targetUserId, targetType],
    );
    const avg = rows[0]?.avg;
    return avg != null ? parseFloat(avg) : null;
  }
}
