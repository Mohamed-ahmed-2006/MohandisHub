import { z } from 'zod';

const categorySchema = z.object({
  enabled: z.boolean(),
  unit: z.enum(['hours', 'days']),
  value: z.number().int().min(0).max(100_000),
});

export const patchRetentionGovernanceSchema = z.object({
  policy: z
    .object({
      masterEnabled: z.boolean().optional(),
      dryRunNextScheduled: z.boolean().optional(),
      categories: z.record(z.string(), categorySchema).optional(),
    })
    .optional(),
  alerts: z
    .object({
      webhookUrl: z.literal('').optional().nullable(),
      alertEmail: z
        .union([z.string().email(), z.literal('')])
        .optional()
        .nullable(),
      deleteCountThresholds: z.record(z.string(), z.number().int().positive()).optional(),
    })
    .optional(),
  maxPublicUploadBytes: z.number().int().positive().optional().nullable(),
  publicUploadAllowedMimes: z.array(z.string().min(3).max(120)).max(24).optional().nullable(),
  supabaseStorageDashboardUrl: z
    .union([z.string().url(), z.literal('')])
    .optional()
    .nullable(),
});

export const runRetentionSchema = z.object({
  dryRun: z.boolean().optional(),
});

export const moderationNeedSchema = z.object({
  needId: z.string().uuid(),
});

export const moderationBidMessageSchema = z.object({
  messageId: z.string().uuid(),
});

export const moderationServiceImageSchema = z.object({
  serviceId: z.string().uuid(),
  urlIndex: z.number().int().min(0).max(9),
});
