import { z } from 'zod';

export const savedSearchKindSchema = z.enum(['service', 'need']);

export const upsertSavedSearchSchema = z.object({
  kind: savedSearchKindSchema,
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.unknown()).default({}),
  locale: z.enum(['en', 'ar']).default('en').optional(),
});

export type UpsertSavedSearchInput = z.infer<typeof upsertSavedSearchSchema>;
