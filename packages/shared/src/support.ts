// ---------------------------------------------------------------------------
// Support ticket types — shared between API and frontend
// ---------------------------------------------------------------------------

export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting_reply' | 'resolved' | 'closed';

export type SupportTicket = {
  id: string;
  userId: string;
  subject: string;
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
  subject: string;
  body: string;
  /** Optional URLs from POST /api/upload (images/files). */
  attachmentUrls?: string[];
};

export type ReplySupportTicketBody = {
  body: string;
  /** Optional URLs from POST /api/upload (images/files). */
  attachmentUrls?: string[];
};
