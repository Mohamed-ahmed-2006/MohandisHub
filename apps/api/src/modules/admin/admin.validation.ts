// ---------------------------------------------------------------------------
// Admin module - Zod validation schemas
// ---------------------------------------------------------------------------

import { ADMIN_PERMISSIONS, MANAGED_SIDEBAR_HREFS } from '@mohandishub/shared';
import { z } from 'zod';

import {
  updateBusinessProfileSchema,
  updateCraftsmanProfileSchema,
  updateExpertProfileSchema,
} from '../profiles/profiles.validation.js';

export { updateBusinessProfileSchema, updateCraftsmanProfileSchema, updateExpertProfileSchema };

export const updateUserSchema = z.object({
  displayName: z.string().min(2).max(100).optional(),
  phone: z.string().max(30).nullable().optional(),
  phoneCode: z.string().max(10).nullable().optional(),
  nationality: z.string().max(100).nullable().optional(),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
  primaryRole: z.undefined().optional(),
  isAdmin: z.boolean().optional(),
  adminPermissions: z.array(z.enum(ADMIN_PERMISSIONS)).optional(),
  planId: z.string().uuid().nullable().optional(),
});

export const factoryResetSchema = z.object({
  confirm: z.literal('FACTORY RESET'),
});

export const changeUserEmailSchema = z.object({
  newEmail: z.string().email(),
  sendVerificationEmail: z.boolean().optional(),
});

export const changeUserRoleSchema = z.object({
  role: z.enum(['customer', 'expert', 'business', 'craftsman']),
});

export const userActivityTypeSchema = z.enum([
  'needs',
  'bids',
  'jobs',
  'jobApplications',
  'bookings',
  'transactions',
]);

export const planSubscriberRoleSchema = z.enum(['customer', 'expert', 'business', 'craftsman']);

const planUsageQuotaEntrySchema = z.object({
  maxPerPeriod: z.number().int().min(1),
  period: z.enum(['billing_cycle', 'calendar_month']),
});

export const planLimitsSchema = z
  .object({
    maxServices: z.number().int().min(0).nullable().optional(),
    maxNeeds: z.number().int().min(0).nullable().optional(),
    maxJobs: z.number().int().min(0).nullable().optional(),
    canPriorityListing: z.boolean().optional(),
    bidsVisibleToCustomer: z
      .enum(['all', 'top_n', 'premium_first', 'priority_first'])
      .nullable()
      .optional(),
    bidsVisibleTopN: z.number().int().min(1).nullable().optional(),
    maxBidsPerNeed: z.number().int().min(0).nullable().optional(),
    maxActiveBids: z.number().int().min(0).nullable().optional(),
    maxBusinessServices: z.number().int().min(0).nullable().optional(),
    maxTeamSlots: z.number().int().min(0).nullable().optional(),
    canBusinessFeatured: z.boolean().optional(),
    canPriorityBid: z.boolean().optional(),
    canProBadge: z.boolean().optional(),
    canTrustedBusinessBadge: z.boolean().optional(),
    usageQuotas: z
      .object({
        new_needs_per_period: planUsageQuotaEntrySchema.nullable().optional(),
        new_services_per_period: planUsageQuotaEntrySchema.nullable().optional(),
        new_bids_per_period: planUsageQuotaEntrySchema.nullable().optional(),
        new_jobs_per_period: planUsageQuotaEntrySchema.nullable().optional(),
      })
      .optional(),
  })
  .optional()
  .nullable();

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
  allowedRoles: z
    .array(planSubscriberRoleSchema)
    .min(1)
    .default(['customer', 'expert', 'business', 'craftsman']),
  planLimits: planLimitsSchema,
  sortOrder: z.number().int().min(0).default(0),
  /**
   * MHC charged for THIS plan. `null` clears the price, which fails the plan's
   * purchasing closed rather than making it free — 0 is how a plan is made free.
   *
   * `z.number()` rejects NaN, Infinity and non-numeric strings, so a malformed
   * decimal from an admin form can never reach the price table.
   */
  mhcPrice: z.number().finite().min(0).nullable().optional(),
  /** Defaults to false at the database, so a new plan is never auto-on-sale. */
  isPurchasable: z.boolean().optional(),
  isVisible: z.boolean().optional(),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const adjustBalanceSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['deposit', 'withdrawal', 'adjustment', 'bonus', 'commission']),
  amount: z.number().positive(),
  description: z.string().min(5).max(500),
});

export const reverseTransactionSchema = z.object({
  reason: z.string().min(5).max(1000),
});

export const rejectServiceSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const sendNotificationSchema = z
  .object({
    target: z.enum(['all', 'users', 'role']),
    userIds: z.array(z.string().uuid()).optional(),
    role: z.enum(['customer', 'expert', 'business', 'craftsman']).optional(),
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(2000),
  })
  .refine(
    (data) => {
      if (data.target === 'users') return Array.isArray(data.userIds) && data.userIds.length > 0;
      if (data.target === 'role') return typeof data.role === 'string';
      return true;
    },
    { message: 'target "users" requires userIds; target "role" requires role' },
  );

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
  featureHourlyPricingEnabled: z.boolean().optional(),
  globalAnnouncement: z.string().max(1000).nullable().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  commissionMinEgp: z.number().min(0).optional(),
  minTransactionEgp: z.number().min(0).optional(),
  commissionReceiverId: z.string().uuid().optional(),
  reservationAcceptanceFee: z.number().min(0).optional(),
  reservationVoiceMinuteRate: z.number().min(0).optional(),
  reservationVideoMinuteRate: z.number().min(0).optional(),
  reservationMinPrejoinMinutes: z.number().int().min(1).max(180).optional(),
  jobInterviewFeeAmount: z.number().min(0).optional(),
  walletEgpPerUsdtDeposit: z.number().positive().nullable().optional(),
  walletEgpPerUsdtWithdrawal: z.number().positive().nullable().optional(),
  platformInstapayDisplay: z.record(z.string(), z.unknown()).nullable().optional(),
  walletUsdToEgpMigrationRate: z.number().positive().nullable().optional(),
  sidebarHiddenHrefs: z
    .array(z.string())
    .optional()
    .refine(
      (arr) => !arr || arr.every((h) => (MANAGED_SIDEBAR_HREFS as readonly string[]).includes(h)),
      { message: 'sidebarHiddenHrefs must only contain managed sidebar paths' },
    ),
  paymentMethodsEnabled: z.record(z.string(), z.boolean()).optional(),
  withdrawalLimits: z
    .record(
      z.enum(['crypto', 'instapay', 'paymob']),
      z.object({
        minAmountEgp: z.number().positive().optional(),
        maxAmountEgp: z.number().positive().nullable().optional(),
        dailyMaxAmountEgp: z.number().positive().nullable().optional(),
      }),
    )
    .optional(),
});

export const approveManualInstapayDepositSchema = z.object({
  creditedAmountEgp: z.number().positive().optional(),
  reason: z.string().min(5).max(1000),
});

export const rejectManualInstapayDepositSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const completeManualInstapayWithdrawalSchema = z.object({
  proofUploadId: z.string().uuid(),
  reason: z.string().min(5).max(1000),
  transferReference: z.string().max(255).optional(),
});

export const completePaymobWithdrawalSchema = z.object({
  providerReference: z.string().max(255).optional(),
  note: z.string().min(5).max(1000),
});

export const rejectManualInstapayWithdrawalSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type FactoryResetInput = z.infer<typeof factoryResetSchema>;
export type ChangeUserEmailInput = z.infer<typeof changeUserEmailSchema>;
export type ChangeUserRoleInput = z.infer<typeof changeUserRoleSchema>;
export type UserActivityTypeInput = z.infer<typeof userActivityTypeSchema>;
export type UpdateExpertProfileByAdminInput = z.infer<typeof updateExpertProfileSchema>;
export type UpdateBusinessProfileByAdminInput = z.infer<typeof updateBusinessProfileSchema>;
export type UpdateCraftsmanProfileByAdminInput = z.infer<typeof updateCraftsmanProfileSchema>;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
export type AdjustBalanceInput = z.infer<typeof adjustBalanceSchema>;
export type ReverseTransactionInput = z.infer<typeof reverseTransactionSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
export type RejectServiceInput = z.infer<typeof rejectServiceSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
export type ApproveManualInstapayDepositInput = z.infer<typeof approveManualInstapayDepositSchema>;
export type RejectManualInstapayDepositInput = z.infer<typeof rejectManualInstapayDepositSchema>;
export type CompleteManualInstapayWithdrawalInput = z.infer<
  typeof completeManualInstapayWithdrawalSchema
>;
export type CompletePaymobWithdrawalInput = z.infer<typeof completePaymobWithdrawalSchema>;
export type RejectManualInstapayWithdrawalInput = z.infer<
  typeof rejectManualInstapayWithdrawalSchema
>;
