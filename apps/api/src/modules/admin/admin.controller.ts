// ---------------------------------------------------------------------------
// Admin controller — HTTP handlers for all admin operations
// ---------------------------------------------------------------------------

import type {
  AdminForceLogoutResponse,
  AdminDashboardStats,
  AdminServiceListItem,
  AdminTransactionListItem,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserOverview,
  AdminWalletFreezeResponse,
  ApiSuccessBody,
  AppSettings,
  BusinessProfile,
  CraftsmanProfile,
  ExpertProfile,
  PaginatedResponse,
  Plan,
  ServiceCategory,
  Transaction,
  UpdateAppSettingsBody,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { logAudit } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SupportService } from '../support/support.service.js';

import { AdminService } from './admin.service.js';
import type {
  AdjustBalanceInput,
  ApproveManualInstapayDepositInput,
  ChangeUserEmailInput,
  CompleteManualInstapayWithdrawalInput,
  CreateCategoryInput,
  CreatePlanInput,
  RejectManualInstapayDepositInput,
  RejectManualInstapayWithdrawalInput,
  RejectServiceInput,
  UpdateBusinessProfileByAdminInput,
  UpdateCategoryInput,
  UpdateCraftsmanProfileByAdminInput,
  UpdateExpertProfileByAdminInput,
  UpdatePlanInput,
  UpdateServiceInput,
  UpdateSettingsInput,
  UpdateUserInput,
} from './admin.validation.js';
import {
  adjustBalanceSchema,
  approveManualInstapayDepositSchema,
  changeUserEmailSchema,
  completeManualInstapayWithdrawalSchema,
  createCategorySchema,
  createPlanSchema,
  rejectManualInstapayDepositSchema,
  rejectManualInstapayWithdrawalSchema,
  rejectServiceSchema,
  userActivityTypeSchema,
  updateBusinessProfileSchema,
  updateCategorySchema,
  updateCraftsmanProfileSchema,
  updateExpertProfileSchema,
  sendNotificationSchema,
  updatePlanSchema,
  updateServiceSchema,
  updateSettingsSchema,
  updateUserSchema,
} from './admin.validation.js';

const adminService = new AdminService();
const notificationsService = new NotificationsService();
const supportService = new SupportService();
const settingsService = new SettingsService();
const reviewsService = new ReviewsService();

function getAdminId(req: { user?: { id: string } | undefined }): string {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
}

function requestIp(req: { ip?: string | undefined; socket?: { remoteAddress?: string | undefined } }): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

function definedKeys(input: Record<string, unknown>): string[] {
  return Object.entries(input)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key)
    .sort();
}

async function logAdminAction(
  req: {
    user?: { id: string } | undefined;
    ip?: string | undefined;
    socket?: { remoteAddress?: string | undefined };
  },
  action: string,
  resourceType: string,
  resourceId: string | null,
  details?: Record<string, unknown>,
): Promise<void> {
  await logAudit({
    actorId: getAdminId(req),
    action,
    resourceType,
    resourceId,
    details: details ?? null,
    ip: requestIp(req),
  });
}

function hasPermission(
  req: { user?: { isAdmin?: boolean; adminPermissions?: string[] } },
  permission: string,
): boolean {
  const user = req.user;
  if (!user?.isAdmin) return false;
  if (!user.adminPermissions || user.adminPermissions.length === 0) return true;
  return user.adminPermissions.includes(permission);
}

function parseValidation<T>(
  schema: {
    safeParse: (data: unknown) => {
      success: boolean;
      data?: T;
      error?: { flatten: () => { fieldErrors: unknown } };
    };
  },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid input.',
      details: parsed.error!.flatten().fieldErrors,
    });
  }
  return parsed.data as T;
}

// ── Notifications ──────────────────────────────────────────────────────────

const sendNotification = asyncHandler(async (req, res) => {
  const body = parseValidation(sendNotificationSchema, req.body);
  let userIds: string[];
  if (body.target === 'all') {
    userIds = await adminService.listUserIds({ isActive: true });
  } else if (body.target === 'role') {
    userIds = await adminService.listUserIds({ role: body.role!, isActive: true });
  } else {
    userIds = body.userIds!;
  }
  const { created } = await notificationsService.createForUsers(userIds, {
    type: 'admin',
    title: body.title,
    message: body.message,
  });
  await logAdminAction(req, 'admin.notification.send', 'notification', null, {
    target: body.target,
    role: body.target === 'role' ? body.role : null,
    userCount: userIds.length,
    created,
    title: body.title,
  });
  const response: ApiSuccessBody<{ created: number }> = { ok: true, data: { created } };
  res.json(response);
});

// ── Dashboard ─────────────────────────────────────────────────────────────

const getDashboardStats = asyncHandler(async (_req, res) => {
  const stats = await adminService.getDashboardStats();
  const response: ApiSuccessBody<AdminDashboardStats> = { ok: true, data: stats };
  res.json(response);
});

// ── Users ─────────────────────────────────────────────────────────────────

const listUsers = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const filters: {
    role?: string;
    isActive?: boolean;
    search?: string;
    incompleteBusinessSignup?: boolean;
  } = {};
  if (req.query.role) filters.role = req.query.role as string;
  if (req.query.isActive === 'true') filters.isActive = true;
  else if (req.query.isActive === 'false') filters.isActive = false;
  if (req.query.search) filters.search = req.query.search as string;
  if (req.query.incompleteBusinessSignup === 'true') filters.incompleteBusinessSignup = true;

  const result = await adminService.listUsers(filters, page, limit);
  const response: ApiSuccessBody<PaginatedResponse<AdminUserListItem>> = { ok: true, data: result };
  res.json(response);
});

const getUserDetail = asyncHandler(async (req, res) => {
  const detail = await adminService.getUserDetail(req.params.id!);
  const response: ApiSuccessBody<AdminUserDetail> = { ok: true, data: detail };
  res.json(response);
});

const getUserOverview = asyncHandler(async (req, res) => {
  const detail = await adminService.getUserOverview(req.params.id!, {
    includeVerification: hasPermission(req, 'manage_verifications'),
    includeTransactions: hasPermission(req, 'manage_transactions'),
    recentLimit: 5,
  });
  const response: ApiSuccessBody<AdminUserOverview> = { ok: true, data: detail };
  res.json(response);
});

const getUserActivity = asyncHandler(async (req, res) => {
  const parsedType = userActivityTypeSchema.safeParse(req.params.type);
  if (!parsedType.success) {
    throw new HttpError({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Invalid activity type.',
    });
  }

  if (parsedType.data === 'transactions' && !hasPermission(req, 'manage_transactions')) {
    throw new HttpError({
      statusCode: 403,
      code: 'FORBIDDEN',
      message: 'You do not have permission to view transaction activity.',
    });
  }

  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);
  const result = await adminService.getUserActivity(
    req.params.id!,
    parsedType.data,
    page,
    limit,
  );
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

const updateUser = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateUserInput>(updateUserSchema, req.body);
  const user = await adminService.updateUser(req.params.id!, input);
  const changedFields = definedKeys(input as Record<string, unknown>);
  if (changedFields.length > 0) {
    await logAdminAction(req, 'admin.user.update', 'user', req.params.id!, {
      changedFields,
      after: {
        ...(input.primaryRole !== undefined && { primaryRole: input.primaryRole }),
        ...(input.isAdmin !== undefined && { isAdmin: input.isAdmin }),
        ...(input.adminPermissions !== undefined && { adminPermissions: input.adminPermissions }),
        ...(input.planId !== undefined && { planId: input.planId }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
      },
    });
  }
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(req.params.id!);
  await logAdminAction(req, 'admin.user.delete', 'user', req.params.id!, { deleted: true });
  const response: ApiSuccessBody<{ deleted: true }> = { ok: true, data: { deleted: true } };
  res.json(response);
});

const activateUser = asyncHandler(async (req, res) => {
  const user = await adminService.activateUser(req.params.id!);
  await logAdminAction(req, 'admin.user.activate', 'user', req.params.id!, { isActive: true });
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const deactivateUser = asyncHandler(async (req, res) => {
  const user = await adminService.deactivateUser(req.params.id!);
  await logAdminAction(req, 'admin.user.deactivate', 'user', req.params.id!, { isActive: false });
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const sendVerificationEmail = asyncHandler(async (req, res) => {
  const result = await adminService.sendVerificationEmail(req.params.id!);
  await logAdminAction(req, 'admin.user.send_verification_email', 'user', req.params.id!, {
    destination: result.destination,
  });
  const response: ApiSuccessBody<{ sent: true; destination: string }> = { ok: true, data: result };
  res.json(response);
});

const verifyEmail = asyncHandler(async (req, res) => {
  const user = await adminService.verifyEmail(req.params.id!);
  await logAdminAction(req, 'admin.user.verify_email', 'user', req.params.id!, {
    emailVerified: true,
  });
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const updateUserExpertProfile = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateExpertProfileByAdminInput>(updateExpertProfileSchema, req.body);
  const profile = await adminService.updateExpertProfileAsAdmin(req.params.id!, input);
  const response: ApiSuccessBody<ExpertProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateUserBusinessProfile = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateBusinessProfileByAdminInput>(
    updateBusinessProfileSchema,
    req.body,
  );
  const profile = await adminService.updateBusinessProfileAsAdmin(req.params.id!, input);
  const response: ApiSuccessBody<BusinessProfile> = { ok: true, data: profile };
  res.json(response);
});

const updateUserCraftsmanProfile = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateCraftsmanProfileByAdminInput>(
    updateCraftsmanProfileSchema,
    req.body,
  );
  const profile = await adminService.updateCraftsmanProfileAsAdmin(req.params.id!, input);
  const response: ApiSuccessBody<CraftsmanProfile> = { ok: true, data: profile };
  res.json(response);
});

const freezeUserWallet = asyncHandler(async (req, res) => {
  const result = await adminService.freezeUserWallet(req.params.id!);
  await logAdminAction(req, 'admin.wallet.freeze', 'wallet', req.params.id!, {
    userId: req.params.id!,
    walletFrozen: true,
  });
  const response: ApiSuccessBody<AdminWalletFreezeResponse> = { ok: true, data: result };
  res.json(response);
});

const unfreezeUserWallet = asyncHandler(async (req, res) => {
  const result = await adminService.unfreezeUserWallet(req.params.id!);
  await logAdminAction(req, 'admin.wallet.unfreeze', 'wallet', req.params.id!, {
    userId: req.params.id!,
    walletFrozen: false,
  });
  const response: ApiSuccessBody<AdminWalletFreezeResponse> = { ok: true, data: result };
  res.json(response);
});

const forceLogoutUser = asyncHandler(async (req, res) => {
  const result = await adminService.forceLogoutUser(req.params.id!);
  await logAdminAction(req, 'admin.user.force_logout', 'user', req.params.id!, {
    revoked: true,
  });
  const response: ApiSuccessBody<AdminForceLogoutResponse> = { ok: true, data: result };
  res.json(response);
});

const changeUserEmail = asyncHandler(async (req, res) => {
  const input = parseValidation<ChangeUserEmailInput>(changeUserEmailSchema, req.body);
  const result = await adminService.changeUserEmail(req.params.id!, input);
  await logAdminAction(req, 'admin.user.change_email', 'user', req.params.id!, {
    newEmail: input.newEmail,
    sendVerificationEmail: input.sendVerificationEmail === true,
    verificationEmailSent: result.verificationEmailSent,
  });
  const response: ApiSuccessBody<typeof result> = { ok: true, data: result };
  res.json(response);
});

// ── Plans ─────────────────────────────────────────────────────────────────

const listPlans = asyncHandler(async (_req, res) => {
  const plans = await adminService.listPlans();
  const response: ApiSuccessBody<Plan[]> = { ok: true, data: plans };
  res.json(response);
});

const createPlan = asyncHandler(async (req, res) => {
  const input = parseValidation<CreatePlanInput>(createPlanSchema, req.body);
  const plan = await adminService.createPlan(input);
  await logAdminAction(req, 'admin.plan.create', 'plan', plan.id, {
    slug: plan.slug,
    price: plan.price,
    currency: plan.currency,
    allowedRoles: plan.allowedRoles,
  });
  const response: ApiSuccessBody<Plan> = { ok: true, data: plan };
  res.status(201).json(response);
});

const updatePlan = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdatePlanInput>(updatePlanSchema, req.body);
  const plan = await adminService.updatePlan(req.params.id!, input);
  await logAdminAction(req, 'admin.plan.update', 'plan', req.params.id!, {
    changedFields: definedKeys(input as Record<string, unknown>),
    slug: plan.slug,
    price: plan.price,
    currency: plan.currency,
    allowedRoles: plan.allowedRoles,
  });
  const response: ApiSuccessBody<Plan> = { ok: true, data: plan };
  res.json(response);
});

const deletePlan = asyncHandler(async (req, res) => {
  await adminService.deletePlan(req.params.id!);
  await logAdminAction(req, 'admin.plan.delete', 'plan', req.params.id!, { deleted: true });
  const response: ApiSuccessBody<{ deleted: true }> = { ok: true, data: { deleted: true } };
  res.json(response);
});

// ── Transactions ──────────────────────────────────────────────────────────

const listTransactions = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const filters: {
    userId?: string;
    type?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {};
  if (req.query.userId) filters.userId = req.query.userId as string;
  if (req.query.type) filters.type = req.query.type as string;
  if (req.query.status) filters.status = req.query.status as string;
  if (req.query.dateFrom) filters.dateFrom = req.query.dateFrom as string;
  if (req.query.dateTo) filters.dateTo = req.query.dateTo as string;

  const result = await adminService.listTransactions(filters, page, limit);
  const response: ApiSuccessBody<PaginatedResponse<AdminTransactionListItem>> = {
    ok: true,
    data: result,
  };
  res.json(response);
});

const getTransactionDetail = asyncHandler(async (req, res) => {
  const txn = await adminService.getTransactionDetail(req.params.id!);
  const response: ApiSuccessBody<Transaction> = { ok: true, data: txn };
  res.json(response);
});

const adjustBalance = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<AdjustBalanceInput>(adjustBalanceSchema, req.body);
  const txn = await adminService.adjustBalance(input, adminId);
  await logAudit({
    actorId: adminId,
    action: 'admin.wallet.adjust',
    resourceType: 'wallet',
    resourceId: input.userId,
    details: { type: input.type, amount: input.amount },
    ip: requestIp(req),
  });
  const response: ApiSuccessBody<Transaction> = { ok: true, data: txn };
  res.status(201).json(response);
});

const listManualInstapayDeposits = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const result = await adminService.listManualInstapayDeposits({
    page,
    limit,
    ...(status ? { status } : {}),
  });
  res.json({ ok: true, data: result });
});

const approveManualInstapayDeposit = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<ApproveManualInstapayDepositInput>(
    approveManualInstapayDepositSchema,
    req.body,
  );
  const row = await adminService.approveManualInstapayDeposit(req.params.id!, adminId, input);
  await logAdminAction(req, 'admin.wallet.manual_deposit.approve', 'manual_deposit', req.params.id!, {
    creditedAmountEgp: input.creditedAmountEgp,
    userId: row.userId,
    status: row.status,
  });
  res.json({ ok: true, data: row });
});

const rejectManualInstapayDeposit = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<RejectManualInstapayDepositInput>(
    rejectManualInstapayDepositSchema,
    req.body,
  );
  const row = await adminService.rejectManualInstapayDeposit(req.params.id!, adminId, input);
  await logAdminAction(req, 'admin.wallet.manual_deposit.reject', 'manual_deposit', req.params.id!, {
    reason: input.reason,
    userId: row.userId,
    status: row.status,
  });
  res.json({ ok: true, data: row });
});

const listManualInstapayWithdrawals = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const result = await adminService.listManualInstapayWithdrawals({
    page,
    limit,
    ...(status ? { status } : {}),
  });
  res.json({ ok: true, data: result });
});

const completeManualInstapayWithdrawal = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<CompleteManualInstapayWithdrawalInput>(
    completeManualInstapayWithdrawalSchema,
    req.body,
  );
  const row = await adminService.completeManualInstapayWithdrawal(req.params.id!, adminId, input);
  await logAdminAction(req, 'admin.wallet.manual_withdrawal.complete', 'manual_withdrawal', req.params.id!, {
    proofUploadId: input.proofUploadId,
    userId: row.userId,
    status: row.status,
  });
  res.json({ ok: true, data: row });
});

const rejectManualInstapayWithdrawal = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<RejectManualInstapayWithdrawalInput>(
    rejectManualInstapayWithdrawalSchema,
    req.body,
  );
  const row = await adminService.rejectManualInstapayWithdrawal(req.params.id!, adminId, input);
  await logAdminAction(req, 'admin.wallet.manual_withdrawal.reject', 'manual_withdrawal', req.params.id!, {
    reason: input.reason,
    userId: row.userId,
    status: row.status,
  });
  res.json({ ok: true, data: row });
});

const reverseTransaction = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const txn = await adminService.reverseTransaction(req.params.id!, adminId);
  await logAdminAction(req, 'admin.wallet.transaction.reverse', 'transaction', req.params.id!, {
    userId: txn.userId,
    type: txn.type,
    amount: txn.amount,
    status: txn.status,
  });
  const response: ApiSuccessBody<Transaction> = { ok: true, data: txn };
  res.json(response);
});

// ── Services ──────────────────────────────────────────────────────────────

const listServices = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const filters: { status?: string; categoryId?: string; providerId?: string } = {};
  if (req.query.status) filters.status = req.query.status as string;
  if (req.query.categoryId) filters.categoryId = req.query.categoryId as string;
  if (req.query.providerId) filters.providerId = req.query.providerId as string;

  const result = await adminService.listServices(filters, page, limit);
  const response: ApiSuccessBody<PaginatedResponse<AdminServiceListItem>> = {
    ok: true,
    data: result,
  };
  res.json(response);
});

const updateServiceHandler = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateServiceInput>(updateServiceSchema, req.body);
  const service = await adminService.updateService(req.params.id!, input);
  await logAdminAction(req, 'admin.service.update', 'service', req.params.id!, {
    changedFields: definedKeys(input as Record<string, unknown>),
    status: service.status,
    isFeatured: service.isFeatured,
    providerId: service.providerId,
  });
  const response: ApiSuccessBody<AdminServiceListItem> = { ok: true, data: service };
  res.json(response);
});

const approveService = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const service = await adminService.approveService(req.params.id!, adminId);
  await logAdminAction(req, 'admin.service.approve', 'service', req.params.id!, {
    providerId: service.providerId,
    status: service.status,
  });
  const response: ApiSuccessBody<AdminServiceListItem> = { ok: true, data: service };
  res.json(response);
});

const rejectService = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<RejectServiceInput>(rejectServiceSchema, req.body);
  const service = await adminService.rejectService(req.params.id!, input.reason, adminId);
  await logAdminAction(req, 'admin.service.reject', 'service', req.params.id!, {
    providerId: service.providerId,
    status: service.status,
    reason: input.reason,
  });
  const response: ApiSuccessBody<AdminServiceListItem> = { ok: true, data: service };
  res.json(response);
});

// ── Categories ────────────────────────────────────────────────────────────

const listCategories = asyncHandler(async (_req, res) => {
  const categories = await adminService.listCategories();
  const response: ApiSuccessBody<ServiceCategory[]> = { ok: true, data: categories };
  res.json(response);
});

const createCategory = asyncHandler(async (req, res) => {
  const input = parseValidation<CreateCategoryInput>(createCategorySchema, req.body);
  const category = await adminService.createCategory(input);
  await logAdminAction(req, 'admin.category.create', 'category', category.id, {
    slug: category.slug,
    nameEn: category.nameEn,
    nameAr: category.nameAr,
  });
  const response: ApiSuccessBody<ServiceCategory> = { ok: true, data: category };
  res.status(201).json(response);
});

const updateCategory = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateCategoryInput>(updateCategorySchema, req.body);
  const category = await adminService.updateCategory(req.params.id!, input);
  await logAdminAction(req, 'admin.category.update', 'category', req.params.id!, {
    changedFields: definedKeys(input as Record<string, unknown>),
    slug: category.slug,
    isActive: category.isActive,
  });
  const response: ApiSuccessBody<ServiceCategory> = { ok: true, data: category };
  res.json(response);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await adminService.deleteCategory(req.params.id!);
  await logAdminAction(req, 'admin.category.delete', 'category', req.params.id!, { deleted: true });
  const response: ApiSuccessBody<{ deleted: true }> = { ok: true, data: { deleted: true } };
  res.json(response);
});

// ── Settings ───────────────────────────────────────────────────────────────

const getSettings = asyncHandler(async (_req, res) => {
  const settings = await settingsService.getSettings();
  if (!settings) {
    throw new HttpError({
      statusCode: 500,
      code: 'SETTINGS_NOT_FOUND',
      message: 'App settings could not be loaded.',
    });
  }
  const response: ApiSuccessBody<AppSettings> = { ok: true, data: settings };
  res.json(response);
});

const updateSettings = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<UpdateSettingsInput>(updateSettingsSchema, req.body);
  const filtered = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined),
  ) as UpdateAppSettingsBody;
  const before = await settingsService.getSettings();
  const settings = await settingsService.updateSettings(filtered, adminId);
  if (!settings) {
    throw new HttpError({
      statusCode: 500,
      code: 'SETTINGS_UPDATE_FAILED',
      message: 'Failed to update app settings.',
    });
  }
  const changedFields = definedKeys(filtered as Record<string, unknown>);
  await logAdminAction(req, 'admin.settings.update', 'app_settings', settings.id, {
    changedFields,
    before: before
      ? Object.fromEntries(changedFields.map((key) => [key, before[key as keyof AppSettings] ?? null]))
      : null,
    after: Object.fromEntries(changedFields.map((key) => [key, settings[key as keyof AppSettings] ?? null])),
  });
  const response: ApiSuccessBody<AppSettings> = { ok: true, data: settings };
  res.json(response);
});

const factoryReset = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const usersDeleted = await adminService.factoryReset(adminId);
  await logAudit({
    actorId: adminId,
    action: 'factory_reset',
    resourceType: 'app',
    details: { usersDeleted },
    ip: requestIp(req),
  });
  const response: ApiSuccessBody<{ usersDeleted: number }> = { ok: true, data: { usersDeleted } };
  res.json(response);
});

const listReviewReports = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const status = (req.query.status as string) === 'all' ? 'all' : 'pending';
  const data = await reviewsService.listReports(page, limit, status);
  res.json({ ok: true, data });
});

const listReviewDisputes = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const status = (req.query.status as string) === 'all' ? 'all' : 'pending';
  const data = await reviewsService.listDisputes(page, limit, status);
  res.json({ ok: true, data });
});

const resolveReviewReport = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const reportId = req.params.id as string;
  const body = req.body as { decision: 'dismissed' | 'upheld'; hideReview?: boolean };
  const decision = body.decision ?? 'dismissed';
  const hideReview = body.hideReview === true;
  await reviewsService.resolveReport(reportId, adminId, decision, hideReview);
  await logAdminAction(req, 'admin.review_report.resolve', 'review_report', reportId, {
    decision,
    hideReview,
  });
  res.json({ ok: true, data: { reportId, decision, hideReview } });
});

const resolveReviewDispute = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const disputeId = req.params.id as string;
  const body = req.body as { decision: 'dismissed' | 'upheld'; hideReview?: boolean };
  const decision = body.decision ?? 'dismissed';
  const hideReview = body.hideReview === true;
  await reviewsService.resolveDispute(disputeId, adminId, decision, hideReview);
  await logAdminAction(req, 'admin.review_dispute.resolve', 'review_dispute', disputeId, {
    decision,
    hideReview,
  });
  res.json({ ok: true, data: { disputeId, decision, hideReview } });
});

// ── Support tickets ───────────────────────────────────────────────────────

const listSupportTickets = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
  const status = req.query.status as string | undefined;
  const category = req.query.category as string | undefined;
  const filters: { status?: string; category?: string } = {};
  if (status) filters.status = status;
  if (category) filters.category = category;
  const data = await supportService.listAllTickets(filters, page, limit);
  res.json({ ok: true, data });
});

const updateSupportTicket = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const ticketId = req.params.id as string;
  const body = (req.body || {}) as { status?: string; assignedTo?: string | null };
  if (body.status != null) {
    await supportService.updateStatus(ticketId, body.status as 'open' | 'in_progress' | 'waiting_reply' | 'resolved' | 'closed', adminId);
  }
  if (body.assignedTo !== undefined) {
    await supportService.assign(ticketId, body.assignedTo ?? null, adminId);
  }
  const ticket = await supportService.getTicket(ticketId, '', true);
  await logAdminAction(req, 'admin.support_ticket.update', 'support_ticket', ticketId, {
    changedFields: definedKeys(body as Record<string, unknown>),
    status: body.status ?? null,
    assignedTo: body.assignedTo ?? null,
  });
  res.json({ ok: true, data: ticket });
});

const deleteSupportTicket = asyncHandler(async (req, res) => {
  const ticketId = req.params.id as string;
  const deleted = await supportService.deleteTicket(ticketId);
  if (!deleted) {
    throw new HttpError({ statusCode: 404, code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
  }
  await logAdminAction(req, 'admin.support_ticket.delete', 'support_ticket', ticketId, { deleted: true });
  res.json({ ok: true, data: { id: ticketId } });
});

export const adminController = {
  getDashboardStats,
  listUsers,
  getUserDetail,
  getUserOverview,
  getUserActivity,
  updateUser,
  updateUserExpertProfile,
  updateUserBusinessProfile,
  updateUserCraftsmanProfile,
  deleteUser,
  activateUser,
  deactivateUser,
  sendVerificationEmail,
  verifyEmail,
  freezeUserWallet,
  unfreezeUserWallet,
  forceLogoutUser,
  changeUserEmail,
  listPlans,
  createPlan,
  updatePlan,
  deletePlan,
  listTransactions,
  getTransactionDetail,
  adjustBalance,
  listManualInstapayDeposits,
  approveManualInstapayDeposit,
  rejectManualInstapayDeposit,
  listManualInstapayWithdrawals,
  completeManualInstapayWithdrawal,
  rejectManualInstapayWithdrawal,
  reverseTransaction,
  listServices,
  updateService: updateServiceHandler,
  approveService,
  rejectService,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSettings,
  updateSettings,
  factoryReset,
  listReviewReports,
  listReviewDisputes,
  resolveReviewReport,
  resolveReviewDispute,
  sendNotification,
  listSupportTickets,
  updateSupportTicket,
  deleteSupportTicket,
};
