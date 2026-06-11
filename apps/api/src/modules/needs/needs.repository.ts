import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type { CreateNeedInput, CreateBidInput } from './needs.validation.js';

export type NeedRow = {
  id: string;
  customer_id: string;
  title: string;
  description: string;
  category_id: string | null;
  budget_type: string;
  budget_amount: string;
  currency: string;
  timeline_days: number | null;
  city: string | null;
  country: string | null;
  reference_url?: string | null;
  status: string;
  awarded_bid_id: string | null;
  created_at: string;
  updated_at: string;
  customer_name?: string;
  category_name_en?: string;
  category_name_ar?: string;
  bid_count?: string;
};

export type BidRow = {
  id: string;
  need_id: string;
  expert_id: string;
  amount: string;
  currency: string;
  message: string;
  delivery_days: number | null;
  estimated_hours: number | null;
  status: string;
  paid_at: string | null;
  payment_transaction_id: string | null;
  customer_last_read_at: string | null;
  expert_last_read_at: string | null;
  created_at: string;
  updated_at: string;
  expert_name?: string;
  expert_email?: string;
  need_title?: string;
};

export type BidMessageRow = {
  id: string;
  bid_id: string;
  sender_id: string;
  content: string;
  attachment_url?: string | null;
  created_at: string;
  sender_name?: string;
};

export class NeedsRepository {
  async createNeed(customerId: string, input: CreateNeedInput): Promise<NeedRow> {
    const referenceValue = input.referenceUrls?.length
      ? JSON.stringify(input.referenceUrls)
      : (input.referenceUrl ?? null);
    const { rows } = await getPool().query(
      `INSERT INTO needs (customer_id, title, description, category_id, budget_type, budget_amount, currency, timeline_days, city, country, reference_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [
        customerId,
        input.title,
        input.description,
        input.categoryId ?? null,
        input.budgetType,
        input.budgetAmount,
        input.currency ?? 'EGP',
        input.timelineDays ?? null,
        input.city ?? null,
        input.country ?? null,
        referenceValue,
      ],
    );
    return rows[0] as NeedRow;
  }

  async countNeedsByCustomer(customerId: string): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM needs WHERE customer_id = $1`,
      [customerId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  /** Needs that count toward plan maxNeeds: still in-flight, not completed/closed. */
  async countActiveNeedsByCustomer(customerId: string): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM needs
       WHERE customer_id = $1 AND status IN ('open', 'awarded', 'in_progress')`,
      [customerId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  async listNeedsByCustomer(
    customerId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: NeedRow[]; total: number }> {
    const pool = getPool();
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(
      `SELECT n.*, (SELECT count(*) FROM bids b WHERE b.need_id = n.id)::text AS bid_count
       FROM needs n WHERE n.customer_id = $1 ORDER BY n.created_at DESC LIMIT $2::int OFFSET $3::int`,
      [customerId, limit, offset],
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total FROM needs WHERE customer_id = $1`,
      [customerId],
    );
    return { rows: rows as NeedRow[], total: (countRows[0] as { total: number }).total };
  }

  async listOpenNeeds(
    page: number,
    limit: number,
    categoryId?: string,
  ): Promise<{ rows: NeedRow[]; total: number }> {
    const pool = getPool();
    const offset = (page - 1) * limit;
    const catFilter = categoryId ? 'AND n.category_id = $3' : '';
    const countCatFilter = categoryId ? 'AND n.category_id = $1' : '';
    const queryParams = categoryId ? [limit, offset, categoryId] : [limit, offset];
    const countParams = categoryId ? [categoryId] : [];
    const { rows } = await pool.query(
      `SELECT n.*,
        COALESCE(u.display_name, u.email) AS customer_name,
        sc.name_en AS category_name_en,
        sc.name_ar AS category_name_ar,
        (SELECT count(*) FROM bids b WHERE b.need_id = n.id)::text AS bid_count
       FROM needs n
       JOIN users u ON u.id = n.customer_id
       LEFT JOIN service_categories sc ON sc.id = n.category_id
       WHERE n.status = 'open' ${catFilter}
       ORDER BY n.created_at DESC LIMIT $1::int OFFSET $2::int`,
      queryParams,
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total FROM needs n WHERE n.status = 'open' ${countCatFilter}`,
      countParams,
    );
    return { rows: rows as NeedRow[], total: (countRows[0] as { total: number }).total };
  }

  async getNeedById(needId: string): Promise<NeedRow | null> {
    const { rows } = await getPool().query(
      `SELECT n.*,
        COALESCE(u.display_name, u.email) AS customer_name,
        (SELECT count(*) FROM bids b WHERE b.need_id = n.id)::text AS bid_count
       FROM needs n
       JOIN users u ON u.id = n.customer_id
       WHERE n.id = $1 LIMIT 1`,
      [needId],
    );
    return (rows[0] as NeedRow) ?? null;
  }

  async updateNeed(needId: string, fields: Record<string, unknown>): Promise<NeedRow | null> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.getNeedById(needId);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = keys.map((k) => fields[k]);
    const { rows } = await getPool().query(
      `UPDATE needs SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
      [needId, ...vals],
    );
    return (rows[0] as NeedRow) ?? null;
  }

  async createBid(needId: string, expertId: string, input: CreateBidInput): Promise<BidRow> {
    const { rows } = await getPool().query(
      `INSERT INTO bids (need_id, expert_id, amount, message, delivery_days, estimated_hours)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        needId,
        expertId,
        input.amount,
        input.message,
        input.deliveryDays ?? null,
        input.estimatedHours ?? null,
      ],
    );
    return rows[0] as BidRow;
  }

  /** Bids that still occupy a slot on the need (customer plan maxBidsPerNeed). */
  async countActiveBidsOnNeed(needId: string): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bids WHERE need_id = $1 AND status IN ('pending', 'accepted')`,
      [needId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  /** Pending bids across all needs for this provider (plan maxActiveBids). */
  async countPendingBidsForExpert(expertId: string): Promise<number> {
    const { rows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM bids WHERE expert_id = $1 AND status = 'pending'`,
      [expertId],
    );
    return rows.length > 0 ? parseInt(rows[0]!.count, 10) : 0;
  }

  async listBidsForNeed(needId: string): Promise<BidRow[]> {
    const { rows } = await getPool().query(
      `SELECT b.*, COALESCE(u.display_name, u.email) AS expert_name, u.email AS expert_email,
        ((SELECT m.created_at FROM bid_messages m WHERE m.bid_id = b.id ORDER BY m.created_at DESC LIMIT 1) > b.customer_last_read_at) AS has_unread
       FROM bids b
       JOIN users u ON u.id = b.expert_id
       WHERE b.need_id = $1 ORDER BY b.created_at ASC`,
      [needId],
    );
    return rows as BidRow[];
  }

  /** List bids for a need with expert's plan slug and priority-bid flag for marketplace ordering. */
  async listBidsForNeedWithExpertPlan(
    needId: string,
  ): Promise<(BidRow & { expert_plan_slug: string | null; bidder_can_priority_bid: boolean })[]> {
    const { rows } = await getPool().query(
      `SELECT b.*, COALESCE(u.display_name, u.email) AS expert_name, u.email AS expert_email,
        ((SELECT m.created_at FROM bid_messages m WHERE m.bid_id = b.id ORDER BY m.created_at DESC LIMIT 1) > b.customer_last_read_at) AS has_unread,
        p.slug AS expert_plan_slug,
        CASE WHEN COALESCE(p.plan_limits->>'canPriorityBid', '') IN ('true', '1') THEN true ELSE false END AS bidder_can_priority_bid
       FROM bids b
       JOIN users u ON u.id = b.expert_id
       LEFT JOIN plans p ON p.id = u.plan_id
       WHERE b.need_id = $1 ORDER BY b.created_at ASC`,
      [needId],
    );
    return rows as (BidRow & {
      expert_plan_slug: string | null;
      bidder_can_priority_bid: boolean;
    })[];
  }

  async listBidsByExpert(
    expertId: string,
    page: number,
    limit: number,
  ): Promise<{ rows: BidRow[]; total: number }> {
    const pool = getPool();
    const offset = (page - 1) * limit;
    const { rows } = await pool.query(
      `SELECT b.*, n.title AS need_title,
        ((SELECT m.created_at FROM bid_messages m WHERE m.bid_id = b.id ORDER BY m.created_at DESC LIMIT 1) > b.expert_last_read_at) AS has_unread
       FROM bids b
       JOIN needs n ON n.id = b.need_id
       WHERE b.expert_id = $1 ORDER BY b.created_at DESC LIMIT $2::int OFFSET $3::int`,
      [expertId, limit, offset],
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*)::int AS total FROM bids WHERE expert_id = $1`,
      [expertId],
    );
    return { rows: rows as BidRow[], total: (countRows[0] as { total: number }).total };
  }

  async getBidById(bidId: string): Promise<BidRow | null> {
    const { rows } = await getPool().query(`SELECT * FROM bids WHERE id = $1 LIMIT 1`, [bidId]);
    return (rows[0] as BidRow) ?? null;
  }

  async updateBid(bidId: string, fields: Record<string, unknown>): Promise<BidRow | null> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.getBidById(bidId);
    const setClauses = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const vals = keys.map((k) => fields[k]);
    const { rows } = await getPool().query(
      `UPDATE bids SET ${setClauses}, updated_at = now() WHERE id = $1 RETURNING *`,
      [bidId, ...vals],
    );
    return (rows[0] as BidRow) ?? null;
  }

  async deleteBid(bidId: string): Promise<void> {
    await getPool().query(`DELETE FROM bids WHERE id = $1`, [bidId]);
  }

  async awardBid(needId: string, bidId: string, paymentTransactionId?: string): Promise<void> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.awardBidInTransaction(client, needId, bidId, paymentTransactionId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Award bid within existing transaction. Optionally set paid_at and payment_transaction_id. */
  async awardBidInTransaction(
    client: PoolClient,
    needId: string,
    bidId: string,
    paymentTransactionId?: string,
  ): Promise<void> {
    await client.query(
      `UPDATE needs SET status = 'awarded', awarded_bid_id = $1, updated_at = now() WHERE id = $2`,
      [bidId, needId],
    );
    if (paymentTransactionId) {
      await client.query(
        `UPDATE bids SET status = 'accepted', updated_at = now(), paid_at = now(), payment_transaction_id = $2 WHERE id = $1`,
        [bidId, paymentTransactionId],
      );
    } else {
      await client.query(`UPDATE bids SET status = 'accepted', updated_at = now() WHERE id = $1`, [
        bidId,
      ]);
    }
    await client.query(
      `UPDATE bids SET status = 'rejected', updated_at = now() WHERE need_id = $1 AND id != $2 AND status = 'pending'`,
      [needId, bidId],
    );
  }

  async createBidMessage(
    bidId: string,
    senderId: string,
    content: string,
    attachmentUrl?: string | null,
  ): Promise<BidMessageRow> {
    const { rows } = await getPool().query(
      `INSERT INTO bid_messages (bid_id, sender_id, content, attachment_url) VALUES ($1, $2, $3, $4) RETURNING *`,
      [bidId, senderId, content, attachmentUrl ?? null],
    );
    return rows[0] as BidMessageRow;
  }

  async listBidMessages(
    bidId: string,
    userId?: string,
    isCustomer?: boolean,
  ): Promise<BidMessageRow[]> {
    if (userId) {
      if (isCustomer) {
        await getPool().query(`UPDATE bids SET customer_last_read_at = now() WHERE id = $1`, [
          bidId,
        ]);
      } else {
        await getPool().query(`UPDATE bids SET expert_last_read_at = now() WHERE id = $1`, [bidId]);
      }
    }
    const { rows } = await getPool().query(
      `SELECT m.*, u.display_name AS sender_name 
       FROM bid_messages m 
       JOIN users u ON u.id = m.sender_id 
       WHERE m.bid_id = $1 
       ORDER BY m.created_at ASC`,
      [bidId],
    );
    return rows as BidMessageRow[];
  }
}
