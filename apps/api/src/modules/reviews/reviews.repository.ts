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
  hidden?: boolean;
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
       WHERE r.target_user_id = $1 AND r.target_type = $2 AND (r.hidden IS NOT TRUE OR r.hidden = false)
       ORDER BY r.created_at DESC
       LIMIT $3::int OFFSET $4::int`,
      [targetUserId, targetType, limit, offset],
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text FROM reviews WHERE target_user_id = $1 AND target_type = $2 AND (hidden IS NOT TRUE OR hidden = false)`,
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

  async findByReservationAndReviewer(
    reservationId: string,
    reviewerId: string,
  ): Promise<ReviewRow | null> {
    const { rows } = await getPool().query<ReviewRow>(
      `SELECT * FROM reviews WHERE reservation_id = $1 AND reviewer_id = $2`,
      [reservationId, reviewerId],
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

  async getReviewCount(targetUserId: string, targetType: string): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text FROM reviews WHERE target_user_id = $1 AND target_type = $2 AND (hidden IS NOT TRUE OR hidden = false)`,
      [targetUserId, targetType],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async findById(reviewId: string): Promise<ReviewRow | null> {
    const { rows } = await getPool().query<ReviewRow>(`SELECT * FROM reviews WHERE id = $1`, [reviewId]);
    return rows[0] ?? null;
  }

  async createReport(data: {
    reviewId: string;
    reporterId: string;
    reason: string;
    comment?: string;
  }): Promise<{ id: string }> {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO review_reports (review_id, reporter_id, reason, comment) VALUES ($1, $2, $3, $4) RETURNING id`,
      [data.reviewId, data.reporterId, data.reason, data.comment ?? null],
    );
    return rows[0]!;
  }

  async createDispute(data: { reviewId: string; disputerId: string; reason: string }): Promise<{ id: string }> {
    const { rows } = await getPool().query<{ id: string }>(
      `INSERT INTO review_disputes (review_id, disputer_id, reason) VALUES ($1, $2, $3) RETURNING id`,
      [data.reviewId, data.disputerId, data.reason],
    );
    return rows[0]!;
  }

  async listReports(page: number, limit: number, statusFilter?: 'pending' | 'all'): Promise<{
    rows: Array<{
      id: string;
      review_id: string;
      reporter_id: string;
      reason: string;
      comment: string | null;
      status: string;
      created_at: string;
      review_rating: number;
      review_comment: string | null;
      target_user_id: string;
      reporter_name: string;
    }>;
    total: number;
  }> {
    const offset = (page - 1) * limit;
    const params =
      statusFilter === 'pending'
        ? [limit, offset, 'pending']
        : [limit, offset];
    const { rows } = await getPool().query(
      `SELECT rr.id, rr.review_id, rr.reporter_id, rr.reason, rr.comment, rr.status, rr.created_at,
              r.rating AS review_rating, r.comment AS review_comment, r.target_user_id,
              COALESCE(u.display_name, u.email) AS reporter_name
       FROM review_reports rr
       JOIN reviews r ON r.id = rr.review_id
       JOIN users u ON u.id = rr.reporter_id
       ${statusFilter === 'pending' ? 'WHERE rr.status = $3' : ''}
       ORDER BY rr.created_at DESC
       LIMIT $1::int OFFSET $2::int`,
      params,
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      statusFilter === 'pending'
        ? `SELECT COUNT(*)::text FROM review_reports WHERE status = $1`
        : `SELECT COUNT(*)::text FROM review_reports`,
      statusFilter === 'pending' ? ['pending'] : [],
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);
    return { rows: rows as never[], total };
  }

  async listDisputes(page: number, limit: number, statusFilter?: 'pending' | 'all'): Promise<{
    rows: Array<{
      id: string;
      review_id: string;
      disputer_id: string;
      reason: string;
      status: string;
      created_at: string;
      review_rating: number;
      review_comment: string | null;
      target_user_id: string;
      disputer_name: string;
    }>;
    total: number;
  }> {
    const offset = (page - 1) * limit;
    const params =
      statusFilter === 'pending'
        ? [limit, offset, 'pending']
        : [limit, offset];
    const { rows } = await getPool().query(
      `SELECT rd.id, rd.review_id, rd.disputer_id, rd.reason, rd.status, rd.created_at,
              r.rating AS review_rating, r.comment AS review_comment, r.target_user_id,
              COALESCE(u.display_name, u.email) AS disputer_name
       FROM review_disputes rd
       JOIN reviews r ON r.id = rd.review_id
       JOIN users u ON u.id = rd.disputer_id
       ${statusFilter === 'pending' ? 'WHERE rd.status = $3' : ''}
       ORDER BY rd.created_at DESC
       LIMIT $1::int OFFSET $2::int`,
      params,
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      statusFilter === 'pending'
        ? `SELECT COUNT(*)::text FROM review_disputes WHERE status = $1`
        : `SELECT COUNT(*)::text FROM review_disputes`,
      statusFilter === 'pending' ? ['pending'] : [],
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);
    return { rows: rows as never[], total };
  }

  async updateReportStatus(
    reportId: string,
    status: 'dismissed' | 'upheld',
    reviewedBy: string,
  ): Promise<void> {
    await getPool().query(
      `UPDATE review_reports SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
      [status, reviewedBy, reportId],
    );
  }

  async updateDisputeStatus(
    disputeId: string,
    status: 'dismissed' | 'upheld',
    reviewedBy: string,
  ): Promise<void> {
    await getPool().query(
      `UPDATE review_disputes SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3`,
      [status, reviewedBy, disputeId],
    );
  }

  async setReviewHidden(reviewId: string, hidden: boolean): Promise<void> {
    await getPool().query(`UPDATE reviews SET hidden = $1 WHERE id = $2`, [hidden, reviewId]);
  }
}
