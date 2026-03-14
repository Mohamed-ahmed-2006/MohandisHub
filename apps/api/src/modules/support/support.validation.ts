import { z } from 'zod';

export const createTicketSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(10000),
});

export const replySchema = z.object({
  body: z.string().min(1).max(10000),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
