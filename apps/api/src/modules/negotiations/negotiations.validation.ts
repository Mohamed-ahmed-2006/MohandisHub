import { z } from 'zod';

export const createNegotiationSchema = z.object({
  serviceId: z.string().uuid(),
  offeredPrice: z.coerce.number().positive().max(100_000_000),
  message: z.string().max(2000).optional(),
});

export const respondNegotiationSchema = z
  .object({
    decision: z.enum(['accept', 'reject', 'counter']),
    counterPrice: z.coerce.number().positive().max(100_000_000).optional(),
    message: z.string().max(2000).optional(),
    validForHours: z.union([z.literal(24), z.literal(48), z.literal(168)]).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'counter' && v.counterPrice == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counterPrice is required when decision is counter',
        path: ['counterPrice'],
      });
    }
  });

export type CreateNegotiationInput = z.infer<typeof createNegotiationSchema>;
export type RespondNegotiationInput = z.infer<typeof respondNegotiationSchema>;
