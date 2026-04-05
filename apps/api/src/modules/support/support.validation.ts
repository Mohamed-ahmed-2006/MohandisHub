import { z } from 'zod';

const supportCategoryEnum = z.enum(['bug', 'suggestion', 'error', 'other']);

/**
 * Public upload responses may be absolute https URLs (e.g. Supabase) or root-relative
 * paths (e.g. `/uploads/...`). Zod's `.url()` rejects the latter and caused 400s when
 * clients stored paths without a scheme.
 */
const attachmentUrlString = z.string().refine(
  (val) => {
    const trimmed = val.trim();
    if (!trimmed || trimmed.includes('..')) return false;
    try {
      const u = new URL(trimmed);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return trimmed.startsWith('/');
    }
  },
  { message: 'Invalid attachment URL (expected http(s) URL or root-relative path).' },
);

export const createTicketSchema = z.object({
  /** Defaults to `other` when omitted (older clients). */
  category: supportCategoryEnum.optional(),
  body: z.string().min(1).max(10000),
  subject: z.string().min(1).max(500).optional(),
  attachmentUrls: z.array(attachmentUrlString).max(2).optional(),
});

export const replySchema = z.object({
  body: z.string().min(1).max(10000),
  attachmentUrls: z.array(attachmentUrlString).max(2).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type ReplyInput = z.infer<typeof replySchema>;
