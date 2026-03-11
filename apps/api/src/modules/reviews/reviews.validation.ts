import { z } from 'zod';

export const createReviewSchema = z
  .object({
    reservationId: z.string().uuid().optional(),
    bookingId: z.string().uuid().optional(),
    needId: z.string().uuid().optional(),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2000).optional(),
  })
  .refine((d) => d.reservationId != null || d.bookingId != null || d.needId != null, {
    message: 'Either reservationId, bookingId, or needId is required',
  });

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const reportReviewSchema = z.object({
  reason: z.enum(['inappropriate', 'fake', 'spam', 'other']),
  comment: z.string().max(1000).optional(),
});
export type ReportReviewInput = z.infer<typeof reportReviewSchema>;

export const disputeReviewSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type DisputeReviewInput = z.infer<typeof disputeReviewSchema>;
