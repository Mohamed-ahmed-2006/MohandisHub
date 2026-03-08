import { z } from 'zod';

export const createBookingSchema = z.object({
  serviceId: z.string().uuid(),
  slotStartAt: z.string().datetime(),
  slotEndAt: z.string().datetime(),
});

export const updateBookingSchema = z.object({
  status: z.enum([
    'pending_payment',
    'paid',
    'scheduled',
    'in_progress',
    'completed',
    'cancelled',
    'refunded',
  ]),
});

export type CreateBookingInput = z.infer<typeof createBookingSchema>;
export type UpdateBookingInput = z.infer<typeof updateBookingSchema>;
