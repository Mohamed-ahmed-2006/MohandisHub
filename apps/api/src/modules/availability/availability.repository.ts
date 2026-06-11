// ---------------------------------------------------------------------------
// Availability repository — database access
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';

export type SlotRow = {
  id: string;
  provider_id: string;
  start_at: string;
  end_at: string;
  status: string;
  booking_id: string | null;
  created_at: string;
};

export class AvailabilityRepository {
  async listByProvider(providerId: string, from: Date, to: Date): Promise<SlotRow[]> {
    const { rows } = await getPool().query<SlotRow>(
      `SELECT * FROM availability_slots
       WHERE provider_id = $1 AND start_at < $3 AND end_at > $2
       ORDER BY start_at ASC`,
      [providerId, from, to],
    );
    return rows;
  }

  async listAvailableByProvider(providerId: string, from: Date, to: Date): Promise<SlotRow[]> {
    const { rows } = await getPool().query<SlotRow>(
      `SELECT * FROM availability_slots
       WHERE provider_id = $1 AND status = 'available'
         AND start_at < $3 AND end_at > $2
       ORDER BY start_at ASC`,
      [providerId, from, to],
    );
    return rows;
  }

  async create(
    providerId: string,
    startAt: Date,
    endAt: Date,
    status: string = 'available',
  ): Promise<SlotRow> {
    const { rows } = await getPool().query<SlotRow>(
      `INSERT INTO availability_slots (provider_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [providerId, startAt, endAt, status],
    );
    return rows[0]!;
  }

  async createMany(
    providerId: string,
    slots: Array<{ startAt: Date; endAt: Date }>,
  ): Promise<SlotRow[]> {
    const results: SlotRow[] = [];
    for (const slot of slots) {
      const row = await this.create(providerId, slot.startAt, slot.endAt);
      results.push(row);
    }
    return results;
  }

  async findById(id: string): Promise<SlotRow | null> {
    const { rows } = await getPool().query<SlotRow>(
      `SELECT * FROM availability_slots WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async update(
    id: string,
    updates: { status?: string; startAt?: Date; endAt?: Date },
  ): Promise<SlotRow | null> {
    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    let idx = 1;
    if (updates.status !== undefined) {
      setClauses.push(`status = $${idx++}`);
      params.push(updates.status);
    }
    if (updates.startAt !== undefined) {
      setClauses.push(`start_at = $${idx++}`);
      params.push(updates.startAt);
    }
    if (updates.endAt !== undefined) {
      setClauses.push(`end_at = $${idx++}`);
      params.push(updates.endAt);
    }
    if (params.length === 0) return this.findById(id);
    params.push(id);
    const { rows } = await getPool().query<SlotRow>(
      `UPDATE availability_slots SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await getPool().query(
      `DELETE FROM availability_slots WHERE id = $1 AND (status = 'available' OR status = 'blocked')`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }
}
