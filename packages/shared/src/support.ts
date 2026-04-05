// ---------------------------------------------------------------------------
// Support ticket types — shared between API and frontend
// ---------------------------------------------------------------------------

export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting_reply' | 'resolved' | 'closed';

export type SupportTicketCategory = 'bug' | 'suggestion' | 'error' | 'other';

export type SupportTicket = {
  id: string;
  userId: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
};

export type SupportTicketMessage = {
  id: string;
  ticketId: string;
  authorId: string;
  body: string;
  isStaff: boolean;
  createdAt: string;
  attachmentUrls?: string[];
};

export type CreateSupportTicketBody = {
  category: SupportTicketCategory;
  body: string;
  /** If omitted, the API builds a subject from category and a short body snippet. */
  subject?: string;
  /** Optional URLs from POST /api/upload (images/files). Max 2 per request. */
  attachmentUrls?: string[];
};

export type ReplySupportTicketBody = {
  body: string;
  /** Optional URLs from POST /api/upload (images/files). Max 2 per request. */
  attachmentUrls?: string[];
};
