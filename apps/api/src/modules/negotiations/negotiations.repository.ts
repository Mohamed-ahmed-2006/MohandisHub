// ---------------------------------------------------------------------------
// Price negotiations — database access
// ---------------------------------------------------------------------------

import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

export type PriceNegotiationRow = {
  id: string;
  service_id: string;
  customer_id: string;
  provider_id: string;
  status: string;
  original_price: string | null;
  agreed_price: string | null;
  latest_amount: string;
  latest_offered_by: string;
  currency: string;
  expires_at: Date;
  agreed_valid_until: Date | null;
  created_at: Date;
  updated_at: Date;
  service_title?: string;
  customer_name?: string;
  provider_name?: string;
};

export type PriceNegotiationRoundRow = {
  id: string;
  negotiation_id: string;
  offered_by: string;
  amount: string;
  message: string | null;
  created_at: Date;
};

const MAX_ROUNDS = 10;
const INACTIVITY_HOURS = 48;

export { MAX_ROUNDS, INACTIVITY_HOURS };

export class NegotiationsRepository {
  private get db(): Pool {
    return getPool();
  }

  async findById(id: string): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `SELECT n.*, s.title AS service_title,
              uc.display_name AS customer_name, up.display_name AS provider_name
       FROM price_negotiations n
       JOIN services s ON s.id = n.service_id
       JOIN users uc ON uc.id = n.customer_id
       JOIN users up ON up.id = n.provider_id
       WHERE n.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findPendingByCustomerAndService(
    customerId: string,
    serviceId: string,
  ): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `SELECT n.*, s.title AS service_title,
              uc.display_name AS customer_name, up.display_name AS provider_name
       FROM price_negotiations n
       JOIN services s ON s.id = n.service_id
       JOIN users uc ON uc.id = n.customer_id
       JOIN users up ON up.id = n.provider_id
       WHERE n.customer_id = $1 AND n.service_id = $2 AND n.status = 'pending'`,
      [customerId, serviceId],
    );
    return rows[0] ?? null;
  }

  async countRounds(negotiationId: string): Promise<number> {
    const { rows } = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM price_negotiation_rounds WHERE negotiation_id = $1`,
      [negotiationId],
    );
    return rows[0] ? parseInt(rows[0].c, 10) : 0;
  }

  async listRounds(negotiationId: string): Promise<PriceNegotiationRoundRow[]> {
    const { rows } = await this.db.query<PriceNegotiationRoundRow>(
      `SELECT * FROM price_negotiation_rounds WHERE negotiation_id = $1 ORDER BY created_at ASC`,
      [negotiationId],
    );
    return rows;
  }

  async createNegotiationWithFirstRound(
    params: {
      serviceId: string;
      customerId: string;
      providerId: string;
      originalPrice: number | null;
      currency: string;
      offeredPrice: number;
      message: string | null;
    },
    client?: PoolClient,
  ): Promise<PriceNegotiationRow> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INACTIVITY_HOURS);
    const q = client ?? this.db;
    const { rows } = await q.query<PriceNegotiationRow>(
      `INSERT INTO price_negotiations (
        service_id, customer_id, provider_id, status,
        original_price, agreed_price, latest_amount, latest_offered_by,
        currency, expires_at
      ) VALUES ($1, $2, $3, 'pending', $4, NULL, $5, $6, $7, $8)
      RETURNING *`,
      [
        params.serviceId,
        params.customerId,
        params.providerId,
        params.originalPrice,
        params.offeredPrice,
        params.customerId,
        params.currency,
        expiresAt.toISOString(),
      ],
    );
    const n = rows[0]!;
    await q.query(
      `INSERT INTO price_negotiation_rounds (negotiation_id, offered_by, amount, message)
       VALUES ($1, $2, $3, $4)`,
      [n.id, params.customerId, params.offeredPrice, params.message],
    );
    return n;
  }

  async insertRound(
    negotiationId: string,
    offeredBy: string,
    amount: number,
    message: string | null,
    client?: PoolClient,
  ): Promise<void> {
    const q = client ?? this.db;
    await q.query(
      `INSERT INTO price_negotiation_rounds (negotiation_id, offered_by, amount, message)
       VALUES ($1, $2, $3, $4)`,
      [negotiationId, offeredBy, amount, message],
    );
  }

  /** Bump inactivity expiry from now. */
  async touchExpiresAt(negotiationId: string, client?: PoolClient): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INACTIVITY_HOURS);
    const q = client ?? this.db;
    await q.query(`UPDATE price_negotiations SET expires_at = $2, updated_at = now() WHERE id = $1`, [
      negotiationId,
      expiresAt.toISOString(),
    ]);
  }

  async updatePendingToAccepted(
    negotiationId: string,
    agreedPrice: number,
    agreedValidUntil: Date,
  ): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `UPDATE price_negotiations
       SET status = 'accepted', agreed_price = $2, agreed_valid_until = $3,
           updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [negotiationId, agreedPrice, agreedValidUntil.toISOString()],
    );
    return rows[0] ?? null;
  }

  async updatePendingToRejected(negotiationId: string): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `UPDATE price_negotiations SET status = 'rejected', updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [negotiationId],
    );
    return rows[0] ?? null;
  }

  async updatePendingToCounter(
    negotiationId: string,
    latestOfferedBy: string,
    latestAmount: number,
  ): Promise<PriceNegotiationRow | null> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + INACTIVITY_HOURS);
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `UPDATE price_negotiations
       SET latest_offered_by = $2, latest_amount = $3, expires_at = $4, updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [negotiationId, latestOfferedBy, latestAmount, expiresAt.toISOString()],
    );
    return rows[0] ?? null;
  }

  async cancelPending(negotiationId: string, customerId: string): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `UPDATE price_negotiations SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND customer_id = $2 AND status = 'pending'
       RETURNING *`,
      [negotiationId, customerId],
    );
    return rows[0] ?? null;
  }

  async cancelPendingByCustomerAndService(customerId: string, serviceId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE price_negotiations SET status = 'cancelled', updated_at = now()
       WHERE customer_id = $1 AND service_id = $2 AND status = 'pending'`,
      [customerId, serviceId],
    );
    return rowCount ?? 0;
  }

  async expirePendingNegotiation(negotiationId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE price_negotiations SET status = 'expired', updated_at = now()
       WHERE id = $1 AND status = 'pending'`,
      [negotiationId],
    );
    return (rowCount ?? 0) > 0;
  }

  async expireAcceptedPastValidUntil(negotiationId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE price_negotiations SET status = 'expired', updated_at = now()
       WHERE id = $1 AND status = 'accepted' AND agreed_valid_until IS NOT NULL AND agreed_valid_until < now()`,
      [negotiationId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markConsumed(negotiationId: string, customerId: string): Promise<PriceNegotiationRow | null> {
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `UPDATE price_negotiations SET status = 'consumed', updated_at = now()
       WHERE id = $1 AND customer_id = $2 AND status = 'accepted'
       RETURNING *`,
      [negotiationId, customerId],
    );
    return rows[0] ?? null;
  }

  async expirePendingForInactiveService(serviceId: string): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE price_negotiations n SET status = 'expired', updated_at = now()
       FROM services s
       WHERE n.service_id = s.id AND n.service_id = $1 AND n.status = 'pending'
         AND s.status <> 'active'`,
      [serviceId],
    );
    return rowCount ?? 0;
  }

  async listForUser(
    userId: string,
    role: 'customer' | 'provider',
    statusFilter: string | undefined,
    serviceId: string | undefined,
    page: number,
    limit: number,
  ): Promise<{ rows: PriceNegotiationRow[]; total: number }> {
    const col = role === 'customer' ? 'n.customer_id' : 'n.provider_id';
    const conditions = [`${col} = $1`];
    const params: unknown[] = [userId];
    let idx = 2;
    if (statusFilter) {
      conditions.push(`n.status = $${idx++}`);
      params.push(statusFilter);
    }
    if (serviceId) {
      conditions.push(`n.service_id = $${idx++}`);
      params.push(serviceId);
    }
    const where = conditions.join(' AND ');
    const countRes = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM price_negotiations n WHERE ${where}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.c ?? '0', 10);
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    const { rows } = await this.db.query<PriceNegotiationRow>(
      `SELECT n.*, s.title AS service_title,
              uc.display_name AS customer_name, up.display_name AS provider_name
       FROM price_negotiations n
       JOIN services s ON s.id = n.service_id
       JOIN users uc ON uc.id = n.customer_id
       JOIN users up ON up.id = n.provider_id
       WHERE ${where}
       ORDER BY n.updated_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    return { rows, total };
  }
}
