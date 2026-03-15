import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(10000),
  attachmentUrls: z.array(z.string().url()).max(5).optional(),
});

export const replySchema = z.object({
  body: z.string().min(1).max(10000),
  attachmentUrls: z.array(z.string().url()).max(5).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
