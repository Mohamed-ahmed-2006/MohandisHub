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
