// ---------------------------------------------------------------------------
// Support repository — DB access for tickets and messages
// ---------------------------------------------------------------------------

import { getPool } from '../../db/pool.js';

export type TicketRow = {
  id: string;
  user_id: string;
  subject: string;
  status: string;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export type TicketMessageRow = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_staff: boolean;
  created_at: string;
  attachment_urls?: string[] | null;
};

export class SupportRepository {
  async createTicket(userId: string, subject: string): Promise<TicketRow> {
    const pool = getPool();
    const { rows } = await pool.query<TicketRow>(
      `INSERT INTO support_tickets (user_id, subject, status)
       VALUES ($1, $2, 'open')
       RETURNING id, user_id, subject, status, assigned_to, created_at, updated_at`,
      [userId, subject],
    );
    if (!rows[0]) throw new Error('Insert ticket failed');
    return rows[0];
  }

  async addMessage(
    ticketId: string,
    authorId: string,
    body: string,
    isStaff: boolean,
    attachmentUrls?: string[] | null,
  ): Promise<TicketMessageRow> {
    const pool = getPool();
    const urls = attachmentUrls?.length ? attachmentUrls : [];
    const { rows } = await pool.query<TicketMessageRow>(
      `INSERT INTO support_ticket_messages (ticket_id, author_id, body, is_staff, attachment_urls)
       VALUES ($1, $2, $3, $4, $5::text[])
       RETURNING id, ticket_id, author_id, body, is_staff, created_at, attachment_urls`,
      [ticketId, authorId, body, isStaff, urls],
    );
    if (!rows[0]) throw new Error('Insert message failed');
    await pool.query(
      `UPDATE support_tickets SET updated_at = now() WHERE id = $1`,
      [ticketId],
    );
    return rows[0];
  }

  async getTicketById(ticketId: string): Promise<TicketRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<TicketRow>(
      `SELECT id, user_id, subject, status, assigned_to, created_at, updated_at
       FROM support_tickets WHERE id = $1`,
      [ticketId],
    );
    return rows[0] ?? null;
  }

  async listTicketsByUser(userId: string, limit: number, offset: number): Promise<{ rows: TicketRow[]; total: number }> {
    const pool = getPool();
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM support_tickets WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    const { rows } = await pool.query<TicketRow>(
      `SELECT id, user_id, subject, status, assigned_to, created_at, updated_at
       FROM support_tickets WHERE user_id = $1
       ORDER BY updated_at DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return { rows, total };
  }

  async listMessages(ticketId: string): Promise<TicketMessageRow[]> {
    const pool = getPool();
    const { rows } = await pool.query<TicketMessageRow>(
      `SELECT id, ticket_id, author_id, body, is_staff, created_at,
              COALESCE(attachment_urls, '{}') AS attachment_urls
       FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    );
    return rows;
  }

  async updateTicketStatus(ticketId: string, status: string): Promise<TicketRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<TicketRow>(
      `UPDATE support_tickets SET status = $1, updated_at = now() WHERE id = $2
       RETURNING id, user_id, subject, status, assigned_to, created_at, updated_at`,
      [status, ticketId],
    );
    return rows[0] ?? null;
  }

  async assignTicket(ticketId: string, assignedTo: string | null): Promise<TicketRow | null> {
    const pool = getPool();
    const { rows } = await pool.query<TicketRow>(
      `UPDATE support_tickets SET assigned_to = $1, updated_at = now() WHERE id = $2
       RETURNING id, user_id, subject, status, assigned_to, created_at, updated_at`,
      [assignedTo, ticketId],
    );
    return rows[0] ?? null;
  }

  async listAllTickets(filters: { status?: string }, limit: number, offset: number): Promise<{ rows: (TicketRow & { user_email?: string; message_count?: string })[]; total: number }> {
    const pool = getPool();
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    let idx = 1;
    if (filters.status) {
      conditions.push(`t.status = $${idx++}`);
      params.push(filters.status);
    }
    const where = conditions.join(' AND ');
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM support_tickets t WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);
    params.push(limit, offset);
    const limitParam = params.length - 1;
    const offsetParam = params.length;
    const { rows } = await pool.query<TicketRow & { user_email?: string; message_count?: string }>(
      `SELECT t.id, t.user_id, t.subject, t.status, t.assigned_to, t.created_at, t.updated_at,
              u.email AS user_email,
              (SELECT COUNT(*)::text FROM support_ticket_messages m WHERE m.ticket_id = t.id) AS message_count
       FROM support_tickets t
       JOIN users u ON u.id = t.user_id
       WHERE ${where}
       ORDER BY t.updated_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
      params,
    );
    return { rows, total };
  }
}
