// ---------------------------------------------------------------------------
// Support service — business logic for tickets
// ---------------------------------------------------------------------------

import type {
  SupportTicket,
  SupportTicketCategory,
  SupportTicketMessage,
  SupportTicketStatus,
} from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';

import type { TicketRow, TicketMessageRow } from './support.repository.js';
import { SupportRepository } from './support.repository.js';

const CATEGORY_PREFIX: Record<SupportTicketCategory, string> = {
  bug: 'Bug',
  suggestion: 'Suggestion',
  error: 'Error',
  other: 'Other',
};

export function buildSupportTicketSubject(
  category: SupportTicketCategory,
  body: string,
  explicitSubject?: string,
): string {
  if (explicitSubject?.trim()) {
    return explicitSubject.trim().slice(0, 500);
  }
  const firstLine = body.trim().split('\n')[0] ?? '';
  const snippet = firstLine.slice(0, 80);
  const suffix = firstLine.length > 80 ? '…' : '';
  const prefix = CATEGORY_PREFIX[category];
  const built = `${prefix}: ${snippet}${suffix}`;
  return built.slice(0, 500);
}

export class SupportService {
  constructor(private readonly repo: SupportRepository = new SupportRepository()) {}

  private toTicket(row: TicketRow, extra?: { messageCount?: number }): SupportTicket {
    return {
      id: row.id,
      userId: row.user_id,
      subject: row.subject,
      category: row.category as SupportTicketCategory,
      status: row.status as SupportTicketStatus,
      assignedTo: row.assigned_to,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(extra?.messageCount != null && { messageCount: extra.messageCount }),
    };
  }

  private toMessage(row: TicketMessageRow): SupportTicketMessage {
    return {
      id: row.id,
      ticketId: row.ticket_id,
      authorId: row.author_id,
      body: row.body,
      isStaff: row.is_staff,
      createdAt: row.created_at,
      ...(row.attachment_urls?.length ? { attachmentUrls: row.attachment_urls } : {}),
    };
  }

  async createTicket(
    userId: string,
    input: {
      category: SupportTicketCategory;
      body: string;
      subject?: string;
      attachmentUrls?: string[] | null;
    },
  ): Promise<SupportTicket> {
    const subject = buildSupportTicketSubject(input.category, input.body, input.subject);
    const ticket = await this.repo.createTicket(userId, subject, input.category);
    await this.repo.addMessage(ticket.id, userId, input.body, false, input.attachmentUrls);
    return this.toTicket(ticket);
  }

  async getTicket(ticketId: string, userId: string, isAdmin: boolean): Promise<SupportTicket | null> {
    const ticket = await this.repo.getTicketById(ticketId);
    if (!ticket) return null;
    if (!isAdmin && ticket.user_id !== userId) return null;
    return this.toTicket(ticket);
  }

  async listMyTickets(userId: string, page: number, limit: number): Promise<{ items: SupportTicket[]; total: number; page: number; limit: number; totalPages: number }> {
    const offset = (page - 1) * limit;
    const { rows, total } = await this.repo.listTicketsByUser(userId, limit, offset);
    const messageCounts = await Promise.all(rows.map((r) => this.repo.listMessages(r.id).then((msgs) => msgs.length)));
    const items = rows.map((r, i) => this.toTicket(r, { messageCount: messageCounts[i] ?? 0 }));
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listMessages(ticketId: string, userId: string, isAdmin: boolean): Promise<SupportTicketMessage[]> {
    const ticket = await this.repo.getTicketById(ticketId);
    if (!ticket) return [];
    if (!isAdmin && ticket.user_id !== userId) return [];
    const rows = await this.repo.listMessages(ticketId);
    return rows.map((r) => this.toMessage(r));
  }

  async reply(
    ticketId: string,
    userId: string,
    body: string,
    isStaff: boolean,
    attachmentUrls?: string[] | null,
  ): Promise<SupportTicketMessage> {
    const ticket = await this.repo.getTicketById(ticketId);
    if (!ticket) {
      throw new HttpError({ statusCode: 404, code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    }
    if (!isStaff && ticket.user_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'Not your ticket.' });
    }
    const msg = await this.repo.addMessage(ticketId, userId, body, isStaff, attachmentUrls);
    const newStatus = isStaff ? 'in_progress' : 'waiting_reply';
    await this.repo.updateTicketStatus(ticketId, newStatus);
    return this.toMessage(msg);
  }

  async updateStatus(ticketId: string, status: SupportTicketStatus, _adminId: string): Promise<SupportTicket | null> {
    const updated = await this.repo.updateTicketStatus(ticketId, status);
    return updated ? this.toTicket(updated) : null;
  }

  async assign(ticketId: string, assignedTo: string | null, _adminId: string): Promise<SupportTicket | null> {
    const updated = await this.repo.assignTicket(ticketId, assignedTo);
    return updated ? this.toTicket(updated) : null;
  }

  async listAllTickets(
    filters: { status?: string; category?: string },
    page: number,
    limit: number,
  ): Promise<{
    items: (SupportTicket & { userEmail?: string })[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const offset = (page - 1) * limit;
    const { rows, total } = await this.repo.listAllTickets(filters, limit, offset);
    const items = rows.map((r) => {
      const ticket = this.toTicket(r, { messageCount: r.message_count != null ? parseInt(r.message_count, 10) : 0 });
      return { ...ticket, ...(r.user_email != null ? { userEmail: r.user_email } : {}) };
    });
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteTicket(ticketId: string): Promise<boolean> {
    return this.repo.deleteTicket(ticketId);
  }
}
