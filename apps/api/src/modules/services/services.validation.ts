import { z } from 'zod';

export const createServiceSchema = z.object({
  title: z.string().min(3).max(300).trim(),
  description: z.string().max(5000).trim().optional(),
  categoryId: z
    .union([z.string().uuid(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v)),
  price: z.coerce.number().min(0).max(1000000).optional(),
  priceType: z.enum(['fixed', 'hourly', 'negotiable']).optional(),
  currency: z.string().max(3).default('EGP').optional(),
  deliveryTimeDays: z
    .union([z.literal(''), z.undefined(), z.coerce.number().int().min(1).max(365)])
    .optional()
    .transform((v) =>
      v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v,
    ),
  tags: z.array(z.string().max(50)).max(20).optional(),
  images: z.array(z.string().url().max(500)).max(10).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  submitForReview: z.boolean().optional(),
});
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

export const updateServiceSchema = z.object({
  title: z.string().min(3).max(300).trim().optional(),
  description: z.string().max(5000).trim().optional(),
  categoryId: z
    .union([z.string().uuid(), z.literal('')])
    .optional()
    .transform((v) => (v === '' || v == null ? undefined : v)),
  price: z.coerce.number().min(0).max(1000000).optional(),
  priceType: z.enum(['fixed', 'hourly', 'negotiable']).optional(),
  currency: z.string().max(3).optional(),
  deliveryTimeDays: z
    .union([z.literal(''), z.undefined(), z.coerce.number().int().min(1).max(365)])
    .optional()
    .transform((v) =>
      v === '' || v == null || (typeof v === 'number' && Number.isNaN(v)) ? undefined : v,
    ),
  tags: z.array(z.string().max(50)).max(20).optional(),
  images: z.array(z.string().url().max(500)).max(10).optional(),
  city: z.string().max(100).optional(),
  area: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
