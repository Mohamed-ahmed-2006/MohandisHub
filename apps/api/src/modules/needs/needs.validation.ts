import { z } from 'zod';

export const createNeedSchema = z.object({
  title: z.string().min(3).max(300).trim(),
  description: z.string().min(10).max(5000).trim(),
  categoryId: z
    .union([z.string().uuid(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v)),
  budgetType: z.enum(['fixed', 'hourly']),
  budgetAmount: z.coerce.number().min(1).max(1000000),
  currency: z.string().max(10).default('EGP'),
  timelineDays: z
    .union([z.literal(''), z.undefined(), z.coerce.number().int().min(1).max(365)])
    .optional()
    .transform((v) =>
      v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v,
    ),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  referenceUrl: z
    .union([z.string().url().max(500), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v)),
  referenceUrls: z
    .array(z.string().url().max(500))
    .max(5)
    .optional(),
});
export type CreateNeedInput = z.infer<typeof createNeedSchema>;

export const updateNeedSchema = z.object({
  status: z.enum(['open', 'closed', 'awarded', 'in_progress', 'completed']).optional(),
  title: z.string().min(3).max(300).optional(),
  description: z.string().min(10).max(5000).optional(),
});
export type UpdateNeedInput = z.infer<typeof updateNeedSchema>;

export const createBidSchema = z.object({
  amount: z.number().min(1).max(1000000),
  message: z.string().min(5).max(3000),
  deliveryDays: z.number().int().min(1).max(365).optional(),
  estimatedHours: z.number().int().min(1).max(168).optional(),
});
export type CreateBidInput = z.infer<typeof createBidSchema>;

export const updateBidSchema = z.object({
  amount: z.number().min(1).max(1000000).optional(),
  message: z.string().min(5).max(3000).optional(),
  deliveryDays: z.number().int().min(1).max(365).optional(),
  estimatedHours: z.number().int().min(1).max(168).optional(),
});
export type UpdateBidInput = z.infer<typeof updateBidSchema>;

export const awardBidSchema = z.object({
  bidId: z.string().uuid(),
});
