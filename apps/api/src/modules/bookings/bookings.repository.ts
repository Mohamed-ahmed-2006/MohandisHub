// ---------------------------------------------------------------------------
// Bookings repository — database access
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';

export type BookingRow = {
  id: string;
  customer_id: string;
  provider_id: string;
  service_id: string | null;
  need_id: string | null;
  amount: string;
  currency: string;
  commission_amount: string;
  provider_amount: string;
  status: string;
  slot_start_at: string | null;
  slot_end_at: string | null;
  payment_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  service_title?: string;
  provider_name?: string;
  customer_name?: string;
};

export class BookingsRepository {
  async create(data: {
    customerId: string;
    providerId: string;
    serviceId: string;
    amount: number;
    currency: string;
    commissionAmount: number;
    providerAmount: number;
    status: string;
    slotStartAt: Date;
    slotEndAt: Date;
    paymentTransactionId?: string;
  }): Promise<BookingRow> {
    const { rows } = await getPool().query<BookingRow>(
      `INSERT INTO bookings (customer_id, provider_id, service_id, amount, currency, commission_amount, provider_amount, status, slot_start_at, slot_end_at, payment_transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        data.customerId,
        data.providerId,
        data.serviceId,
        data.amount,
        data.currency,
        data.commissionAmount,
        data.providerAmount,
        data.status,
        data.slotStartAt,
        data.slotEndAt,
        data.paymentTransactionId ?? null,
      ],
    );
    return rows[0]!;
  }

  async findById(id: string): Promise<BookingRow | null> {
    const { rows } = await getPool().query<BookingRow>(
      `SELECT b.*, s.title AS service_title,
        COALESCE(up.display_name, up.email) AS provider_name,
        COALESCE(uc.display_name, uc.email) AS customer_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN users up ON up.id = b.provider_id
       JOIN users uc ON uc.id = b.customer_id
       WHERE b.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listByUser(
    userId: string,
    role: 'customer' | 'provider',
    page: number,
    limit: number,
  ): Promise<{ rows: BookingRow[]; total: number }> {
    const offset = (page - 1) * limit;
    const column = role === 'customer' ? 'customer_id' : 'provider_id';
    const baseQuery = `SELECT b.*, s.title AS service_title,
        COALESCE(up.display_name, up.email) AS provider_name,
        COALESCE(uc.display_name, uc.email) AS customer_name
       FROM bookings b
       LEFT JOIN services s ON s.id = b.service_id
       JOIN users up ON up.id = b.provider_id
       JOIN users uc ON uc.id = b.customer_id
       WHERE b.${column} = $1
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`;

    const { rows } = await getPool().query<BookingRow>(baseQuery, [
      userId,
      limit,
      offset,
    ]);

    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM bookings WHERE ${column} = $1`,
      [userId],
    );
    const total = parseInt(countRows[0]!.count, 10);
    return { rows, total };
  }

  async updateStatus(id: string, status: string): Promise<BookingRow | null> {
    const { rows } = await getPool().query<BookingRow>(
      `UPDATE bookings SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [status, id],
    );
    return rows[0] ?? null;
  }
}
