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
  ExpertProfile,
  PaginatedResponse,
  Plan,
  ServiceCategory,
  Transaction,
  UpdateAppSettingsBody,
} from '@mohandishub/shared';

import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ReviewsService } from '../reviews/reviews.service.js';
import { SettingsService } from '../settings/settings.service.js';

import { AdminService } from './admin.service.js';
import type {
  AdjustBalanceInput,
  ChangeUserEmailInput,
  CreateCategoryInput,
  CreatePlanInput,
  RejectServiceInput,
  UpdateBusinessProfileByAdminInput,
  UpdateCategoryInput,
  UpdateExpertProfileByAdminInput,
  UpdatePlanInput,
  UpdateServiceInput,
  UpdateSettingsInput,
  UpdateUserInput,
} from './admin.validation.js';
import {
  adjustBalanceSchema,
  changeUserEmailSchema,
  createCategorySchema,
  createPlanSchema,
  rejectServiceSchema,
  userActivityTypeSchema,
  updateBusinessProfileSchema,
  updateCategorySchema,
  updateExpertProfileSchema,
  sendNotificationSchema,
  updatePlanSchema,
  updateServiceSchema,
  updateSettingsSchema,
  updateUserSchema,
} from './admin.validation.js';

const adminService = new AdminService();
const notificationsService = new NotificationsService();
const settingsService = new SettingsService();
const reviewsService = new ReviewsService();

function getAdminId(req: { user?: { id: string } }): string {
  if (!req.user) {
    throw new HttpError({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required.',
    });
  }
  return req.user.id;
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
  const filters: { role?: string; isActive?: boolean; search?: string } = {};
  if (req.query.role) filters.role = req.query.role as string;
  if (req.query.isActive === 'true') filters.isActive = true;
  else if (req.query.isActive === 'false') filters.isActive = false;
  if (req.query.search) filters.search = req.query.search as string;

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
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const deleteUser = asyncHandler(async (req, res) => {
  await adminService.deleteUser(req.params.id!);
  const response: ApiSuccessBody<{ deleted: true }> = { ok: true, data: { deleted: true } };
  res.json(response);
});

const activateUser = asyncHandler(async (req, res) => {
  const user = await adminService.activateUser(req.params.id!);
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const deactivateUser = asyncHandler(async (req, res) => {
  const user = await adminService.deactivateUser(req.params.id!);
  const response: ApiSuccessBody<AdminUserListItem> = { ok: true, data: user };
  res.json(response);
});

const sendVerificationEmail = asyncHandler(async (req, res) => {
  const result = await adminService.sendVerificationEmail(req.params.id!);
  const response: ApiSuccessBody<{ sent: true; destination: string }> = { ok: true, data: result };
  res.json(response);
});

const verifyEmail = asyncHandler(async (req, res) => {
  const user = await adminService.verifyEmail(req.params.id!);
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

const freezeUserWallet = asyncHandler(async (req, res) => {
  const result = await adminService.freezeUserWallet(req.params.id!);
  const response: ApiSuccessBody<AdminWalletFreezeResponse> = { ok: true, data: result };
  res.json(response);
});

const unfreezeUserWallet = asyncHandler(async (req, res) => {
  const result = await adminService.unfreezeUserWallet(req.params.id!);
  const response: ApiSuccessBody<AdminWalletFreezeResponse> = { ok: true, data: result };
  res.json(response);
});

const forceLogoutUser = asyncHandler(async (req, res) => {
  const result = await adminService.forceLogoutUser(req.params.id!);
  const response: ApiSuccessBody<AdminForceLogoutResponse> = { ok: true, data: result };
  res.json(response);
});

const changeUserEmail = asyncHandler(async (req, res) => {
  const input = parseValidation<ChangeUserEmailInput>(changeUserEmailSchema, req.body);
  const result = await adminService.changeUserEmail(req.params.id!, input);
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
  const response: ApiSuccessBody<Plan> = { ok: true, data: plan };
  res.status(201).json(response);
});

const updatePlan = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdatePlanInput>(updatePlanSchema, req.body);
  const plan = await adminService.updatePlan(req.params.id!, input);
  const response: ApiSuccessBody<Plan> = { ok: true, data: plan };
  res.json(response);
});

const deletePlan = asyncHandler(async (req, res) => {
  await adminService.deletePlan(req.params.id!);
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
  const response: ApiSuccessBody<Transaction> = { ok: true, data: txn };
  res.status(201).json(response);
});

const reverseTransaction = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const txn = await adminService.reverseTransaction(req.params.id!, adminId);
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
  const response: ApiSuccessBody<AdminServiceListItem> = { ok: true, data: service };
  res.json(response);
});

const approveService = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const service = await adminService.approveService(req.params.id!, adminId);
  const response: ApiSuccessBody<AdminServiceListItem> = { ok: true, data: service };
  res.json(response);
});

const rejectService = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const input = parseValidation<RejectServiceInput>(rejectServiceSchema, req.body);
  const service = await adminService.rejectService(req.params.id!, input.reason, adminId);
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
  const response: ApiSuccessBody<ServiceCategory> = { ok: true, data: category };
  res.status(201).json(response);
});

const updateCategory = asyncHandler(async (req, res) => {
  const input = parseValidation<UpdateCategoryInput>(updateCategorySchema, req.body);
  const category = await adminService.updateCategory(req.params.id!, input);
  const response: ApiSuccessBody<ServiceCategory> = { ok: true, data: category };
  res.json(response);
});

const deleteCategory = asyncHandler(async (req, res) => {
  await adminService.deleteCategory(req.params.id!);
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
  const settings = await settingsService.updateSettings(filtered, adminId);
  if (!settings) {
    throw new HttpError({
      statusCode: 500,
      code: 'SETTINGS_UPDATE_FAILED',
      message: 'Failed to update app settings.',
    });
  }
  const response: ApiSuccessBody<AppSettings> = { ok: true, data: settings };
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
  res.json({ ok: true, data: { reportId, decision, hideReview } });
});

const resolveReviewDispute = asyncHandler(async (req, res) => {
  const adminId = getAdminId(req);
  const disputeId = req.params.id as string;
  const body = req.body as { decision: 'dismissed' | 'upheld'; hideReview?: boolean };
  const decision = body.decision ?? 'dismissed';
  const hideReview = body.hideReview === true;
  await reviewsService.resolveDispute(disputeId, adminId, decision, hideReview);
  res.json({ ok: true, data: { disputeId, decision, hideReview } });
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
  listReviewReports,
  listReviewDisputes,
  resolveReviewReport,
  resolveReviewDispute,
  sendNotification,
};
