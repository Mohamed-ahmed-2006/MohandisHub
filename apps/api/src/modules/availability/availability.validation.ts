import { z } from 'zod';

export const createSlotSchema = z.object({
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
}).refine((d) => new Date(d.endAt) > new Date(d.startAt), {
  message: 'endAt must be after startAt',
});

export const createSlotsSchema = z.object({
  slots: z.array(z.object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })).min(1).refine(
    (arr) => arr.every((s) => new Date(s.endAt) > new Date(s.startAt)),
    { message: 'Each slot must have endAt after startAt' },
  ),
});

export const updateSlotSchema = z.object({
  status: z.enum(['available', 'booked', 'blocked']).optional(),
  startAt: z.string().datetime().optional(),
  endAt: z.string().datetime().optional(),
});

export type CreateSlotInput = z.infer<typeof createSlotSchema>;
export type CreateSlotsInput = z.infer<typeof createSlotsSchema>;
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;
