// ---------------------------------------------------------------------------
// Admin routes — all admin-only endpoints
// ---------------------------------------------------------------------------

import { Router } from 'express';

import { authenticate } from '../../middleware/authenticate.js';
import { loadAdminFromDb } from '../../middleware/load-admin-from-db.js';
import { requireEmailVerified } from '../../middleware/require-email-verified.js';
import {
  requireAdminAnyPermission,
  requireAdminPermission,
  requireRole,
} from '../../middleware/require-role.js';
import { profilesController } from '../profiles/profiles.controller.js';
import * as retentionAdminController from '../retention/retention.admin.controller.js';

import { adminController } from './admin.controller.js';

const adminRouter = Router();

adminRouter.use(authenticate, requireEmailVerified, loadAdminFromDb, requireRole('admin'));

// Notifications (admin send to users)
adminRouter.post(
  '/notifications/send',
  requireAdminPermission('manage_notifications'),
  adminController.sendNotification,
);

// Dashboard
adminRouter.get(
  '/dashboard/stats',
  requireAdminPermission('super_admin'),
  adminController.getDashboardStats,
);

// Settings
adminRouter.get('/settings', adminController.getSettings);
adminRouter.patch(
  '/settings',
  requireAdminPermission('manage_settings'),
  adminController.updateSettings,
);
adminRouter.post(
  '/factory-reset',
  requireAdminPermission('manage_settings'),
  adminController.factoryReset,
);

// Retention & upload governance
adminRouter.get(
  '/retention',
  requireAdminAnyPermission('manage_retention', 'manage_settings'),
  retentionAdminController.getRetentionDashboard,
);
adminRouter.patch(
  '/retention',
  requireAdminPermission('manage_retention'),
  retentionAdminController.patchRetentionGovernance,
);
adminRouter.post(
  '/retention/run',
  requireAdminPermission('manage_retention'),
  retentionAdminController.postRetentionRun,
);
adminRouter.get(
  '/retention/sweep-log/export',
  requireAdminPermission('manage_retention'),
  retentionAdminController.getRetentionSweepLogExport,
);
adminRouter.get(
  '/moderation/log/export',
  requireAdminPermission('manage_retention'),
  retentionAdminController.getModerationLogExport,
);
adminRouter.post(
  '/moderation/clear-need-references',
  requireAdminPermission('manage_retention'),
  retentionAdminController.postModerationClearNeedReferences,
);
adminRouter.post(
  '/moderation/clear-bid-attachment',
  requireAdminPermission('manage_retention'),
  retentionAdminController.postModerationClearBidAttachment,
);
adminRouter.post(
  '/moderation/remove-service-image',
  requireAdminPermission('manage_retention'),
  retentionAdminController.postModerationRemoveServiceImage,
);

// Users
adminRouter.get('/users', requireAdminPermission('manage_users'), adminController.listUsers);
adminRouter.get(
  '/users/:id',
  requireAdminPermission('manage_users'),
  adminController.getUserDetail,
);
adminRouter.get(
  '/users/:id/overview',
  requireAdminPermission('manage_users'),
  adminController.getUserOverview,
);
adminRouter.get(
  '/users/:id/activity/:type',
  requireAdminPermission('manage_users'),
  adminController.getUserActivity,
);
adminRouter.patch('/users/:id', requireAdminPermission('manage_users'), adminController.updateUser);
adminRouter.patch(
  '/users/:id/expert-profile',
  requireAdminPermission('manage_users'),
  adminController.updateUserExpertProfile,
);
adminRouter.patch(
  '/users/:id/business-profile',
  requireAdminPermission('manage_users'),
  adminController.updateUserBusinessProfile,
);
adminRouter.patch(
  '/users/:id/craftsman-profile',
  requireAdminPermission('manage_users'),
  adminController.updateUserCraftsmanProfile,
);
adminRouter.delete(
  '/users/:id',
  requireAdminPermission('manage_users'),
  adminController.deleteUser,
);
adminRouter.post(
  '/users/:id/activate',
  requireAdminPermission('manage_users'),
  adminController.activateUser,
);
adminRouter.post(
  '/users/:id/deactivate',
  requireAdminPermission('manage_users'),
  adminController.deactivateUser,
);
adminRouter.post(
  '/users/:id/send-verification-email',
  requireAdminPermission('manage_users'),
  adminController.sendVerificationEmail,
);
adminRouter.post(
  '/users/:id/verify-email',
  requireAdminPermission('manage_users'),
  adminController.verifyEmail,
);
adminRouter.post(
  '/users/:id/force-logout',
  requireAdminPermission('manage_users'),
  adminController.forceLogoutUser,
);
adminRouter.post(
  '/users/:id/change-email',
  requireAdminPermission('manage_users'),
  adminController.changeUserEmail,
);
adminRouter.post(
  '/users/:id/wallet/freeze',
  requireAdminPermission('manage_transactions'),
  adminController.freezeUserWallet,
);
adminRouter.post(
  '/users/:id/wallet/unfreeze',
  requireAdminPermission('manage_transactions'),
  adminController.unfreezeUserWallet,
);

// Plans
adminRouter.get('/plans', requireAdminPermission('manage_plans'), adminController.listPlans);
adminRouter.post('/plans', requireAdminPermission('manage_plans'), adminController.createPlan);
adminRouter.patch('/plans/:id', requireAdminPermission('manage_plans'), adminController.updatePlan);
adminRouter.delete(
  '/plans/:id',
  requireAdminPermission('manage_plans'),
  adminController.deletePlan,
);

// Transactions
adminRouter.get(
  '/transactions',
  requireAdminPermission('manage_transactions'),
  adminController.listTransactions,
);
adminRouter.get(
  '/money-audit',
  requireAdminPermission('manage_transactions'),
  adminController.listMoneyAuditEvents,
);
adminRouter.get(
  '/paymob-readiness',
  requireAdminPermission('manage_transactions'),
  adminController.getPaymobReadiness,
);
adminRouter.get(
  '/transactions/:id',
  requireAdminPermission('manage_transactions'),
  adminController.getTransactionDetail,
);
adminRouter.post(
  '/transactions/adjust',
  requireAdminPermission('manage_transactions'),
  adminController.adjustBalance,
);
adminRouter.post(
  '/transactions/:id/reverse',
  requireAdminPermission('manage_transactions'),
  adminController.reverseTransaction,
);

adminRouter.get(
  '/wallet/manual-deposits',
  requireAdminPermission('manage_transactions'),
  adminController.listManualInstapayDeposits,
);
adminRouter.post(
  '/wallet/manual-deposits/:id/approve',
  requireAdminPermission('manage_transactions'),
  adminController.approveManualInstapayDeposit,
);
adminRouter.post(
  '/wallet/manual-deposits/:id/reject',
  requireAdminPermission('manage_transactions'),
  adminController.rejectManualInstapayDeposit,
);
adminRouter.get(
  '/wallet/manual-withdrawals',
  requireAdminPermission('manage_transactions'),
  adminController.listManualInstapayWithdrawals,
);
adminRouter.post(
  '/wallet/manual-withdrawals/:id/complete',
  requireAdminPermission('manage_transactions'),
  adminController.completeManualInstapayWithdrawal,
);
adminRouter.post(
  '/wallet/paymob-withdrawals/:id/complete',
  requireAdminPermission('manage_transactions'),
  adminController.completePaymobWithdrawal,
);
adminRouter.post(
  '/wallet/manual-withdrawals/:id/reject',
  requireAdminPermission('manage_transactions'),
  adminController.rejectManualInstapayWithdrawal,
);

// Services
adminRouter.get(
  '/services',
  requireAdminPermission('manage_services'),
  adminController.listServices,
);
adminRouter.patch(
  '/services/:id',
  requireAdminPermission('manage_services'),
  adminController.updateService,
);
adminRouter.post(
  '/services/:id/approve',
  requireAdminPermission('manage_services'),
  adminController.approveService,
);
adminRouter.post(
  '/services/:id/reject',
  requireAdminPermission('manage_services'),
  adminController.rejectService,
);

// Categories
adminRouter.get(
  '/categories',
  requireAdminPermission('manage_services'),
  adminController.listCategories,
);
adminRouter.post(
  '/categories',
  requireAdminPermission('manage_services'),
  adminController.createCategory,
);
adminRouter.patch(
  '/categories/:id',
  requireAdminPermission('manage_services'),
  adminController.updateCategory,
);
adminRouter.delete(
  '/categories/:id',
  requireAdminPermission('manage_services'),
  adminController.deleteCategory,
);

// Verifications (existing — delegated to profiles controller)
adminRouter.get(
  '/verification/pending',
  requireAdminPermission('manage_verifications'),
  profilesController.getPendingVerifications,
);
adminRouter.get(
  '/verification/users/:userId/reviews',
  requireAdminPermission('manage_verifications'),
  profilesController.getVerificationReviewHistory,
);
adminRouter.post(
  '/verification/sync-verified-at',
  requireAdminPermission('manage_verifications'),
  profilesController.syncVerifiedAt,
);
adminRouter.post(
  '/identity/:docId/review',
  requireAdminPermission('manage_verifications'),
  profilesController.reviewIdentityDocument,
);
adminRouter.post(
  '/academic/:recordId/review',
  requireAdminPermission('manage_verifications'),
  profilesController.reviewAcademicRecord,
);
adminRouter.post(
  '/business/:userId/review',
  requireAdminPermission('manage_verifications'),
  profilesController.reviewBusinessDocs,
);
adminRouter.get(
  '/user/:userId/profile',
  requireAdminPermission('manage_users'),
  profilesController.getAnyUserProfile,
);

// Review reports and disputes
adminRouter.get(
  '/review-reports',
  requireAdminPermission('manage_verifications'),
  adminController.listReviewReports,
);
adminRouter.get(
  '/review-disputes',
  requireAdminPermission('manage_verifications'),
  adminController.listReviewDisputes,
);
adminRouter.patch(
  '/review-reports/:id',
  requireAdminPermission('manage_verifications'),
  adminController.resolveReviewReport,
);
adminRouter.patch(
  '/review-disputes/:id',
  requireAdminPermission('manage_verifications'),
  adminController.resolveReviewDispute,
);

// Support tickets
adminRouter.get(
  '/support/tickets',
  requireAdminPermission('manage_support'),
  adminController.listSupportTickets,
);
adminRouter.patch(
  '/support/tickets/:id',
  requireAdminPermission('manage_support'),
  adminController.updateSupportTicket,
);
adminRouter.delete(
  '/support/tickets/:id',
  requireAdminPermission('manage_support'),
  adminController.deleteSupportTicket,
);

export { adminRouter };
