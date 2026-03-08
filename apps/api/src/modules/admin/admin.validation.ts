// ---------------------------------------------------------------------------
// Admin module — Zod validation schemas
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const updateUserSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
  primaryRole: z.enum(['customer', 'expert', 'business']).optional(),
  isAdmin: z.boolean().optional(),
  planId: z.string().uuid().nullable().optional(),
});

export const createPlanSchema = z.object({
  slug: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  price: z.number().min(0),
  currency: z.string().length(3).default('EGP'),
  billingCycle: z.enum(['monthly', 'quarterly', 'yearly', 'one_time']).default('monthly'),
  durationDays: z.number().int().positive().optional(),
  trialDays: z.number().int().min(0).default(0),
  maxServices: z.number().int().positive().optional(),
  maxProjects: z.number().int().positive().optional(),
  features: z.array(z.string()).default([]),
  sortOrder: z.number().int().min(0).default(0),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const adjustBalanceSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['deposit', 'withdrawal', 'adjustment', 'bonus']),
  amount: z.number().positive(),
  description: z.string().max(500).optional(),
});

export const rejectServiceSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const createCategorySchema = z.object({
  nameEn: z.string().min(1).max(100),
  nameAr: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  descriptionEn: z.string().max(500).optional(),
  descriptionAr: z.string().max(500).optional(),
  icon: z.string().max(50).optional(),
  parentId: z.string().uuid().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const updateServiceSchema = z.object({
  status: z
    .enum(['draft', 'pending_review', 'active', 'paused', 'rejected', 'archived'])
    .optional(),
  isFeatured: z.boolean().optional(),
});

export const updateSettingsSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().max(2000).nullable().optional(),
  signupsLocked: z.boolean().optional(),
  depositsPaused: z.boolean().optional(),
  moneyMovementsPaused: z.boolean().optional(),
  lockLogins: z.boolean().optional(),
  disableCryptoDeposits: z.boolean().optional(),
  disableCardDeposits: z.boolean().optional(),
  minDepositAmount: z.number().min(0).nullable().optional(),
  maxDepositAmount: z.number().min(0).nullable().optional(),
  pausePlanSubscriptions: z.boolean().optional(),
  pauseNeeds: z.boolean().optional(),
  pauseBids: z.boolean().optional(),
  pauseAwardBids: z.boolean().optional(),
  pauseUploads: z.boolean().optional(),
  pauseVerificationSubmissions: z.boolean().optional(),
  pauseChat: z.boolean().optional(),
  pauseOtpEmails: z.boolean().optional(),
  featureNeedsEnabled: z.boolean().optional(),
  featurePlansEnabled: z.boolean().optional(),
  featureWalletEnabled: z.boolean().optional(),
  globalAnnouncement: z.string().max(1000).nullable().optional(),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type RejectServiceInput = z.infer<typeof rejectServiceSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
