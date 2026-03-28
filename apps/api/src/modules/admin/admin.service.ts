// ---------------------------------------------------------------------------
// Admin service — business logic for admin operations
// ---------------------------------------------------------------------------

import type {
  AdminBidActivityItem,
  AdminBookingActivityItem,
  AdminDashboardStats,
  AdminForceLogoutResponse,
  AdminJobActivityItem,
  AdminJobApplicationActivityItem,
  AdminNeedActivityItem,
  AdminServiceListItem,
  AdminTransactionListItem,
  AdminUserActivityCounts,
  AdminUserActivityType,
  AdminUserDetail,
  AdminUserListItem,
  AdminUserOverview,
  AdminWalletFreezeResponse,
  BusinessProfile,
  CraftsmanProfile,
  ExpertProfile,
  ManualDepositRequest,
  PaginatedResponse,
  Plan,
  ServiceCategory,
  Transaction,
  WithdrawalRequest,
} from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { OtpService } from '../otp/otp.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';

import { AdminRepository } from './admin.repository.js';
import type {
  BidActivityRow,
  BookingActivityRow,
  CategoryRow,
  JobActivityRow,
  JobApplicationActivityRow,
  NeedActivityRow,
  PlanRow,
  ServiceListRow,
  TransactionListRow,
  TransactionRow,
  UserDetailRow,
  UserListRow,
} from './admin.types.js';
import type {
  AdjustBalanceInput,
  ChangeUserEmailInput,
  CompleteManualInstapayWithdrawalInput,
  CreateCategoryInput,
  CreatePlanInput,
  RejectManualInstapayDepositInput,
  RejectManualInstapayWithdrawalInput,
  ApproveManualInstapayDepositInput,
  UpdateBusinessProfileByAdminInput,
  UpdateCategoryInput,
  UpdateCraftsmanProfileByAdminInput,
  UpdateExpertProfileByAdminInput,
  UpdatePlanInput,
  UpdateServiceInput,
  UpdateUserInput,
  UserActivityTypeInput,
} from './admin.validation.js';

export class AdminService {
  constructor(
    private readonly repo: AdminRepository = new AdminRepository(),
    private readonly otpService: OtpService = new OtpService(),
    private readonly settingsService: SettingsService = new SettingsService(),
    private readonly authRepository: AuthRepository = new AuthRepository(),
    private readonly profilesService: ProfilesService = new ProfilesService(),
    private readonly walletService: WalletService = new WalletService(),
  ) {}

  // ── Dashboard ───────────────────────────────────────────────────────────

  async getDashboardStats(): Promise<AdminDashboardStats> {
    const row = await this.repo.getDashboardStats();
    return {
      totalUsers: parseInt(row.total_users, 10),
      activeUsers: parseInt(row.active_users, 10),
      usersByRole: {
        customer: parseInt(row.role_customer, 10),
        expert: parseInt(row.role_expert, 10),
        business: parseInt(row.role_business, 10),
        craftsman: parseInt(row.role_craftsman, 10),
        admin: parseInt(row.role_admin, 10),
      },
      totalTransactions: parseInt(row.total_transactions, 10),
      totalRevenue: parseFloat(row.total_revenue),
      transactionVolume: parseFloat(row.transaction_volume),
      platformCommissionVolume: parseFloat(row.platform_commission_volume),
      pendingVerifications: parseInt(row.pending_verifications, 10),
      activeServices: parseInt(row.active_services, 10),
      totalPlans: parseInt(row.total_plans, 10),
      platformWalletBalance: parseFloat(row.platform_wallet_balance ?? '0'),
    };
  }

  // ── Users ───────────────────────────────────────────────────────────────

  async listUsers(
    filters: { role?: string; isActive?: boolean; search?: string },
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<AdminUserListItem>> {
    const total = await this.repo.countUsers(filters);
    const rows = await this.repo.listUsers(filters, page, limit);
    return {
      items: rows.map((r) => this.toUserListItem(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async listUserIds(filters: { role?: string; isActive?: boolean }): Promise<string[]> {
    return this.repo.listUserIds(filters);
  }

  async getUserDetail(userId: string): Promise<AdminUserDetail> {
    const row = await this.repo.getUserDetail(userId);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return this.toUserDetail(row);
  }

  async updateUser(userId: string, input: UpdateUserInput): Promise<AdminUserListItem> {
    const dbFields: Record<string, unknown> = {};
    if (input.displayName !== undefined) dbFields.display_name = input.displayName;
    if (input.phone !== undefined) dbFields.phone = input.phone;
    if (input.phoneCode !== undefined) dbFields.phone_code = input.phoneCode;
    if (input.nationality !== undefined) dbFields.nationality = input.nationality;
    if (input.dateOfBirth !== undefined) dbFields.date_of_birth = input.dateOfBirth;
    if (input.isActive !== undefined) dbFields.is_active = input.isActive;
    if (input.primaryRole !== undefined) dbFields.primary_role = input.primaryRole;
    if (input.isAdmin !== undefined) dbFields.is_admin = input.isAdmin;
    if (input.adminPermissions !== undefined)
      dbFields.admin_permissions = Array.isArray(input.adminPermissions) ? input.adminPermissions : [];
    if (input.planId !== undefined) dbFields.plan_id = input.planId;

    if (Object.keys(dbFields).length === 0) {
      const existing = await this.repo.getUserById(userId);
      if (!existing) {
        throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
      }
      return this.toUserListItem(existing);
    }

    const row = await this.repo.updateUser(userId, dbFields);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return this.toUserListItem(row);
  }

  async deleteUser(userId: string): Promise<void> {
    const deleted = await this.repo.softDeleteUser(userId);
    if (!deleted) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
  }

  async activateUser(userId: string): Promise<AdminUserListItem> {
    return this.updateUser(userId, { isActive: true });
  }

  async deactivateUser(userId: string): Promise<AdminUserListItem> {
    return this.updateUser(userId, { isActive: false });
  }

  async sendVerificationEmail(userId: string): Promise<{ sent: true; destination: string }> {
    const result = await this.otpService.sendCode(userId, 'email');
    return { sent: true, destination: result.destination };
  }

  async verifyEmail(userId: string): Promise<AdminUserListItem> {
    await this.repo.setEmailVerified(userId);
    const row = await this.repo.getUserDetail(userId);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return this.toUserListItem(row);
  }

  async getUserOverview(
    userId: string,
    options?: { includeVerification?: boolean; includeTransactions?: boolean; recentLimit?: number },
  ): Promise<AdminUserOverview> {
    const row = await this.repo.getUserDetail(userId);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const recentLimit = Math.max(1, Math.min(options?.recentLimit ?? 5, 25));
    const includeVerification = options?.includeVerification === true;
    const includeTransactions = options?.includeTransactions === true;

    const safeCount = async (fn: () => Promise<number>): Promise<number> => {
      try {
        return await fn();
      } catch (error) {
        if (this.isMissingSchemaError(error)) return 0;
        throw error;
      }
    };

    const safeRows = async <T>(fn: () => Promise<T[]>): Promise<T[]> => {
      try {
        return await fn();
      } catch (error) {
        if (this.isMissingSchemaError(error)) return [];
        throw error;
      }
    };

    const [needsCount, bidsCount, jobsCount, jobApplicationsCount, bookingsCount, transactionsCount] =
      await Promise.all([
        safeCount(() => this.repo.countNeedsByUser(userId)),
        safeCount(() => this.repo.countBidsByUser(userId)),
        safeCount(() => this.repo.countJobsByUser(userId)),
        safeCount(() => this.repo.countJobApplicationsByUser(userId)),
        safeCount(() => this.repo.countBookingsByUser(userId)),
        includeTransactions ? safeCount(() => this.repo.countTransactions({ userId })) : Promise.resolve(0),
      ]);

    const [needsRows, bidsRows, jobsRows, jobApplicationsRows, bookingsRows, transactionsRows] =
      await Promise.all([
        safeRows(() => this.repo.listNeedsByUser(userId, 1, recentLimit)),
        safeRows(() => this.repo.listBidsByUser(userId, 1, recentLimit)),
        safeRows(() => this.repo.listJobsByUser(userId, 1, recentLimit)),
        safeRows(() => this.repo.listJobApplicationsByUser(userId, 1, recentLimit)),
        safeRows(() => this.repo.listBookingsByUser(userId, 1, recentLimit)),
        includeTransactions
          ? safeRows(() => this.repo.listTransactions({ userId }, 1, recentLimit))
          : Promise.resolve([] as TransactionListRow[]),
      ]);

    let expertProfile: AdminUserOverview['expertProfile'] = null;
    let businessProfile: AdminUserOverview['businessProfile'] = null;
    let craftsmanProfile: AdminUserOverview['craftsmanProfile'] = null;
    let identityDocuments: AdminUserOverview['identityDocuments'] = [];
    let academicRecords: AdminUserOverview['academicRecords'] = [];

    expertProfile = await this.profilesService.getExpertProfile(userId).catch(() => null);
    businessProfile = await this.profilesService.getBusinessProfile(userId).catch(() => null);
    craftsmanProfile = await this.profilesService.getCraftsmanProfile(userId).catch(() => null);

    if (includeVerification) {
      identityDocuments = await this.profilesService.getIdentityDocuments(userId);
      academicRecords = await this.profilesService.getAcademicRecords(userId);
    }

    const activityCounts: AdminUserActivityCounts = {
      needs: needsCount,
      bids: bidsCount,
      jobs: jobsCount,
      jobApplications: jobApplicationsCount,
      bookings: bookingsCount,
      transactions: transactionsCount,
    };

    return {
      user: this.toUserDetail(row),
      expertProfile,
      businessProfile,
      craftsmanProfile,
      identityDocuments,
      academicRecords,
      activityCounts,
      recentActivity: {
        needs: needsRows.map((item) => this.toNeedActivityItem(item)),
        bids: bidsRows.map((item) => this.toBidActivityItem(item)),
        jobs: jobsRows.map((item) => this.toJobActivityItem(item)),
        jobApplications: jobApplicationsRows.map((item) => this.toJobApplicationActivityItem(item)),
        bookings: bookingsRows.map((item) => this.toBookingActivityItem(item)),
        transactions: transactionsRows.map((item) => this.toTransactionListItem(item)),
      },
    };
  }

  async getUserActivity(
    userId: string,
    type: UserActivityTypeInput,
    page: number = 1,
    limit: number = 20,
  ): Promise<
    PaginatedResponse<
      | AdminNeedActivityItem
      | AdminBidActivityItem
      | AdminJobActivityItem
      | AdminJobApplicationActivityItem
      | AdminBookingActivityItem
      | AdminTransactionListItem
    >
  > {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(Math.max(1, limit), 50);

    switch (type as AdminUserActivityType) {
      case 'needs': {
        const total = await this.repo.countNeedsByUser(userId);
        const rows = await this.repo.listNeedsByUser(userId, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toNeedActivityItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      case 'bids': {
        const total = await this.repo.countBidsByUser(userId);
        const rows = await this.repo.listBidsByUser(userId, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toBidActivityItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      case 'jobs': {
        const total = await this.repo.countJobsByUser(userId);
        const rows = await this.repo.listJobsByUser(userId, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toJobActivityItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      case 'jobApplications': {
        const total = await this.repo.countJobApplicationsByUser(userId);
        const rows = await this.repo.listJobApplicationsByUser(userId, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toJobApplicationActivityItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      case 'bookings': {
        const total = await this.repo.countBookingsByUser(userId);
        const rows = await this.repo.listBookingsByUser(userId, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toBookingActivityItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      case 'transactions': {
        const total = await this.repo.countTransactions({ userId });
        const rows = await this.repo.listTransactions({ userId }, safePage, safeLimit);
        return {
          items: rows.map((item) => this.toTransactionListItem(item)),
          total,
          page: safePage,
          limit: safeLimit,
          totalPages: Math.ceil(total / safeLimit),
        };
      }
      default:
        throw new HttpError({
          statusCode: 400,
          code: 'INVALID_ACTIVITY_TYPE',
          message: 'Invalid user activity type.',
        });
    }
  }

  async updateExpertProfileAsAdmin(
    userId: string,
    input: UpdateExpertProfileByAdminInput,
  ): Promise<ExpertProfile> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (user.primary_role !== 'expert') {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Expert profile not found for this user role.',
      });
    }
    return this.profilesService.updateExpertProfile(userId, input);
  }

  async updateBusinessProfileAsAdmin(
    userId: string,
    input: UpdateBusinessProfileByAdminInput,
  ): Promise<BusinessProfile> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (user.primary_role !== 'business') {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Business profile not found for this user role.',
      });
    }
    return this.profilesService.updateBusinessProfile(userId, input);
  }

  async updateCraftsmanProfileAsAdmin(
    userId: string,
    input: UpdateCraftsmanProfileByAdminInput,
  ): Promise<CraftsmanProfile> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    if (user.primary_role !== 'craftsman') {
      throw new HttpError({
        statusCode: 404,
        code: 'PROFILE_NOT_FOUND',
        message: 'Craftsman profile not found for this user role.',
      });
    }
    return this.profilesService.updateCraftsmanProfile(userId, input);
  }

  async freezeUserWallet(userId: string): Promise<AdminWalletFreezeResponse> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    const updated = await this.repo.setWalletFrozen(userId, true);
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return { userId, walletFrozen: updated.wallet_frozen === true };
  }

  async unfreezeUserWallet(userId: string): Promise<AdminWalletFreezeResponse> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    const updated = await this.repo.setWalletFrozen(userId, false);
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    return { userId, walletFrozen: updated.wallet_frozen === true };
  }

  async forceLogoutUser(userId: string): Promise<AdminForceLogoutResponse> {
    const user = await this.repo.getUserById(userId);
    if (!user) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }
    await this.authRepository.revokeAllUserTokens(userId);
    return { revoked: true };
  }

  async changeUserEmail(
    userId: string,
    input: ChangeUserEmailInput,
  ): Promise<{ user: AdminUserListItem; verificationEmailSent: boolean }> {
    const newEmail = input.newEmail.trim().toLowerCase();
    const existing = await this.repo.findUserByEmail(newEmail);
    if (existing && existing.id !== userId) {
      throw new HttpError({
        statusCode: 409,
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'An account with this email address already exists.',
      });
    }

    let row: UserListRow | null = null;
    try {
      row = await this.repo.updateUserEmail(userId, newEmail);
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email address already exists.',
        });
      }
      throw error;
    }

    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found.' });
    }

    let verificationEmailSent = false;
    if (input.sendVerificationEmail === true) {
      await this.otpService.sendCode(userId, 'email');
      verificationEmailSent = true;
    }

    return { user: this.toUserListItem(row), verificationEmailSent };
  }

  async factoryReset(adminId: string): Promise<number> {
    return this.repo.factoryReset(adminId);
  }

  // ── Plans ───────────────────────────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    try {
      const rows = await this.repo.listPlans();
      return rows.map((r) => this.toPlan(r));
    } catch (err: unknown) {
      this.throwPlanDbError(err);
    }
  }

  async createPlan(input: CreatePlanInput): Promise<Plan> {
    const dbFields: Record<string, unknown> = {
      slug: input.slug,
      name: input.name,
      price: input.price,
    };
    if (input.description !== undefined) dbFields.description = input.description;
    if (input.currency !== undefined) dbFields.currency = input.currency;
    if (input.billingCycle !== undefined) dbFields.billing_cycle = input.billingCycle;
    if (input.durationDays !== undefined) dbFields.duration_days = input.durationDays;
    if (input.trialDays !== undefined) dbFields.trial_days = input.trialDays;
    if (input.maxServices !== undefined) dbFields.max_services = input.maxServices;
    if (input.maxProjects !== undefined) dbFields.max_projects = input.maxProjects;
    if (input.features !== undefined)
      dbFields.features = Array.isArray(input.features) ? input.features : [];
    if (input.planLimits !== undefined) dbFields.plan_limits = input.planLimits;
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;

    try {
      const row = await this.repo.createPlan(dbFields);
      return this.toPlan(row);
    } catch (err: unknown) {
      this.throwPlanDbError(err, input.slug);
    }
  }

  async updatePlan(planId: string, input: UpdatePlanInput): Promise<Plan> {
    const dbFields: Record<string, unknown> = {};
    if (input.slug !== undefined) dbFields.slug = input.slug;
    if (input.name !== undefined) dbFields.name = input.name;
    if (input.description !== undefined) dbFields.description = input.description;
    if (input.price !== undefined) dbFields.price = input.price;
    if (input.currency !== undefined) dbFields.currency = input.currency;
    if (input.billingCycle !== undefined) dbFields.billing_cycle = input.billingCycle;
    if (input.durationDays !== undefined) dbFields.duration_days = input.durationDays;
    if (input.trialDays !== undefined) dbFields.trial_days = input.trialDays;
    if (input.maxServices !== undefined) dbFields.max_services = input.maxServices;
    if (input.maxProjects !== undefined) dbFields.max_projects = input.maxProjects;
    if (input.features !== undefined)
      dbFields.features = Array.isArray(input.features) ? input.features : [];
    if (input.planLimits !== undefined) dbFields.plan_limits = input.planLimits;
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;
    if (input.isActive !== undefined) dbFields.is_active = input.isActive;

    try {
      const row = await this.repo.updatePlan(planId, dbFields);
      if (!row) {
        throw new HttpError({ statusCode: 404, code: 'PLAN_NOT_FOUND', message: 'Plan not found.' });
      }
      return this.toPlan(row);
    } catch (err: unknown) {
      this.throwPlanDbError(err, input.slug);
    }
  }

  async deletePlan(planId: string): Promise<void> {
    try {
      const deleted = await this.repo.softDeletePlan(planId);
      if (!deleted) {
        throw new HttpError({ statusCode: 404, code: 'PLAN_NOT_FOUND', message: 'Plan not found.' });
      }
    } catch (err: unknown) {
      this.throwPlanDbError(err);
    }
  }

  // ── Transactions ────────────────────────────────────────────────────────

  async listTransactions(
    filters: {
      userId?: string;
      type?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<AdminTransactionListItem>> {
    const total = await this.repo.countTransactions(filters);
    const rows = await this.repo.listTransactions(filters, page, limit);
    return {
      items: rows.map((r) => this.toTransactionListItem(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTransactionDetail(txnId: string): Promise<Transaction> {
    const row = await this.repo.getTransaction(txnId);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'TRANSACTION_NOT_FOUND',
        message: 'Transaction not found.',
      });
    }
    return this.toTransaction(row);
  }

  async adjustBalance(input: AdjustBalanceInput, adminId: string): Promise<Transaction> {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Money movements are temporarily disabled.',
      });
    }

    const wallet = await this.repo.createWalletIfNotExists(input.userId);
    const row = await this.repo.adjustWalletBalance(
      wallet.id,
      input.userId,
      input.type,
      input.amount,
      input.description ?? null,
      adminId,
    );
    return this.toTransaction(row);
  }

  async reverseTransaction(txnId: string, adminId: string): Promise<Transaction> {
    const status = await this.settingsService.getAppStatus();
    if (status.moneyMovementsPaused) {
      throw new HttpError({
        statusCode: 503,
        code: 'MONEY_MOVEMENTS_PAUSED',
        message: 'Money movements are temporarily disabled.',
      });
    }

    try {
      const row = await this.repo.reverseTransaction(txnId, adminId);
      return this.toTransaction(row);
    } catch {
      throw new HttpError({
        statusCode: 400,
        code: 'REVERSE_FAILED',
        message: 'Transaction cannot be reversed.',
      });
    }
  }

  // ── Services ────────────────────────────────────────────────────────────

  async listServices(
    filters: { status?: string; categoryId?: string; providerId?: string },
    page: number = 1,
    limit: number = 20,
  ): Promise<PaginatedResponse<AdminServiceListItem>> {
    const total = await this.repo.countServices(filters);
    const rows = await this.repo.listServices(filters, page, limit);
    return {
      items: rows.map((r) => this.toServiceListItem(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateService(
    serviceId: string,
    input: UpdateServiceInput,
    _adminId?: string,
  ): Promise<AdminServiceListItem> {
    const dbFields: Record<string, unknown> = {};
    if (input.status !== undefined) dbFields.status = input.status;
    if (input.isFeatured !== undefined) dbFields.is_featured = input.isFeatured;

    const row = await this.repo.updateService(serviceId, dbFields);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    return this.toServiceListItem(row);
  }

  async approveService(serviceId: string, adminId: string): Promise<AdminServiceListItem> {
    const row = await this.repo.updateService(serviceId, {
      status: 'active',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    });
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    return this.toServiceListItem(row);
  }

  async rejectService(
    serviceId: string,
    reason: string,
    adminId: string,
  ): Promise<AdminServiceListItem> {
    const row = await this.repo.updateService(serviceId, {
      status: 'rejected',
      rejection_reason: reason,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    });
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'SERVICE_NOT_FOUND',
        message: 'Service not found.',
      });
    }
    return this.toServiceListItem(row);
  }

  // ── Categories ──────────────────────────────────────────────────────────

  async listCategories(): Promise<ServiceCategory[]> {
    const rows = await this.repo.listCategories();
    return rows.map((r) => this.toCategory(r));
  }

  async createCategory(input: CreateCategoryInput): Promise<ServiceCategory> {
    const dbFields: Record<string, unknown> = {
      name_en: input.nameEn,
      name_ar: input.nameAr,
      slug: input.slug,
    };
    if (input.descriptionEn !== undefined) dbFields.description_en = input.descriptionEn;
    if (input.descriptionAr !== undefined) dbFields.description_ar = input.descriptionAr;
    if (input.icon !== undefined) dbFields.icon = input.icon;
    if (input.parentId !== undefined) dbFields.parent_id = input.parentId;
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;

    const row = await this.repo.createCategory(dbFields);
    return this.toCategory(row);
  }

  async updateCategory(categoryId: string, input: UpdateCategoryInput): Promise<ServiceCategory> {
    const dbFields: Record<string, unknown> = {};
    if (input.nameEn !== undefined) dbFields.name_en = input.nameEn;
    if (input.nameAr !== undefined) dbFields.name_ar = input.nameAr;
    if (input.slug !== undefined) dbFields.slug = input.slug;
    if (input.descriptionEn !== undefined) dbFields.description_en = input.descriptionEn;
    if (input.descriptionAr !== undefined) dbFields.description_ar = input.descriptionAr;
    if (input.icon !== undefined) dbFields.icon = input.icon;
    if (input.parentId !== undefined) dbFields.parent_id = input.parentId;
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;
    if (input.isActive !== undefined) dbFields.is_active = input.isActive;

    const row = await this.repo.updateCategory(categoryId, dbFields);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found.',
      });
    }
    return this.toCategory(row);
  }

  async deleteCategory(categoryId: string): Promise<void> {
    const deleted = await this.repo.softDeleteCategory(categoryId);
    if (!deleted) {
      throw new HttpError({
        statusCode: 404,
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category not found.',
      });
    }
  }

  // ── Mappers ─────────────────────────────────────────────────────────────

  private throwPlanDbError(error: unknown, slug?: string): never {
    if (error instanceof HttpError) {
      throw error;
    }

    const pgError = error as {
      code?: string;
      constraint?: string;
      detail?: string;
      column?: string;
    };

    if (pgError.code === '23505') {
      throw new HttpError({
        statusCode: 409,
        code: 'PLAN_SLUG_EXISTS',
        message: slug
          ? `A plan with slug "${slug}" already exists.`
          : 'A plan with the same slug already exists.',
      });
    }

    if (pgError.code === '42703' || pgError.code === '42P01') {
      throw new HttpError({
        statusCode: 500,
        code: 'PLAN_SCHEMA_MISMATCH',
        message:
          'Plans table schema is outdated or incomplete. Run database migrations and try again.',
      });
    }

    if (
      pgError.code === '23502' ||
      pgError.code === '23514' ||
      pgError.code === '22P02' ||
      pgError.code === '42804'
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'PLAN_INVALID_INPUT',
        message: 'Invalid plan data for database constraints.',
        details: {
          ...(pgError.constraint ? { constraint: pgError.constraint } : {}),
          ...(pgError.column ? { column: pgError.column } : {}),
          ...(pgError.detail ? { detail: pgError.detail } : {}),
        },
      });
    }

    throw error;
  }

  private toUserListItem(row: UserListRow): AdminUserListItem {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      phone: row.phone,
      primaryRole: row.primary_role as AdminUserListItem['primaryRole'],
      isAdmin: row.is_admin === true,
      adminPermissions: Array.isArray(row.admin_permissions) ? row.admin_permissions : [],
      isActive: row.is_active,
      emailVerifiedAt: row.email_verified_at,
      planSlug: row.plan_slug,
      planName: row.plan_name,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at,
      deletedAt: row.deleted_at,
    };
  }

  private toUserDetail(row: UserDetailRow): AdminUserDetail {
    return {
      ...this.toUserListItem(row),
      phoneCode: row.phone_code,
      nationality: row.nationality,
      avatarUrl: row.avatar_url,
      dateOfBirth: row.date_of_birth,
      walletBalance: row.wallet_balance ? parseFloat(row.wallet_balance) : null,
      walletCurrency: row.wallet_currency,
      walletFrozen: row.wallet_frozen,
    };
  }

  private toPlan(row: PlanRow): Plan {
    const rawLimits = row.plan_limits as Record<string, unknown> | null | undefined;
    const planLimits =
      rawLimits && typeof rawLimits === 'object' && !Array.isArray(rawLimits)
        ? (rawLimits as Plan['planLimits'])
        : null;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      price: parseFloat(row.price),
      currency: row.currency,
      billingCycle: row.billing_cycle as Plan['billingCycle'],
      durationDays: row.duration_days,
      trialDays: row.trial_days,
      maxServices: row.max_services,
      maxProjects: row.max_projects,
      features: Array.isArray(row.features) ? row.features : [],
      planLimits: planLimits ?? null,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toTransactionListItem(row: TransactionListRow): AdminTransactionListItem {
    return {
      id: row.id,
      walletId: row.wallet_id,
      userId: row.user_id,
      userEmail: row.user_email,
      userDisplayName: row.user_display_name,
      type: row.type,
      amount: parseFloat(row.amount),
      balanceAfter: parseFloat(row.balance_after),
      status: row.status,
      description: row.description,
      referenceType: row.reference_type,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private toTransaction(row: TransactionRow): Transaction {
    return {
      id: row.id,
      walletId: row.wallet_id,
      userId: row.user_id,
      type: row.type as Transaction['type'],
      amount: parseFloat(row.amount),
      balanceAfter: parseFloat(row.balance_after),
      status: row.status as Transaction['status'],
      description: row.description,
      referenceType: row.reference_type,
      referenceId: row.reference_id,
      metadata: row.metadata ?? {},
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  private toServiceListItem(row: ServiceListRow): AdminServiceListItem {
    return {
      id: row.id,
      title: row.title,
      providerId: row.provider_id,
      providerName: row.provider_name,
      providerEmail: row.provider_email,
      providerRole: row.provider_role,
      categoryNameEn: row.category_name_en,
      categoryNameAr: row.category_name_ar,
      price: row.price ? parseFloat(row.price) : null,
      currency: row.currency ?? 'EGP',
      priceType: row.price_type,
      status: row.status,
      isFeatured: row.is_featured,
      city: row.city,
      createdAt: row.created_at,
    };
  }

  private toCategory(row: CategoryRow): ServiceCategory {
    return {
      id: row.id,
      nameEn: row.name_en,
      nameAr: row.name_ar,
      slug: row.slug,
      descriptionEn: row.description_en,
      descriptionAr: row.description_ar,
      icon: row.icon,
      parentId: row.parent_id,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toNeedActivityItem(row: NeedActivityRow): AdminNeedActivityItem {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      budgetAmount: parseFloat(row.budget_amount),
      currency: row.currency,
      bidCount: parseInt(row.bid_count, 10),
      createdAt: row.created_at,
    };
  }

  private toBidActivityItem(row: BidActivityRow): AdminBidActivityItem {
    return {
      id: row.id,
      needId: row.need_id,
      needTitle: row.need_title,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    };
  }

  private toJobActivityItem(row: JobActivityRow): AdminJobActivityItem {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private toJobApplicationActivityItem(
    row: JobApplicationActivityRow,
  ): AdminJobApplicationActivityItem {
    return {
      id: row.id,
      jobId: row.job_id,
      jobTitle: row.job_title,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  private toBookingActivityItem(row: BookingActivityRow): AdminBookingActivityItem {
    return {
      id: row.id,
      status: row.status,
      amount: parseFloat(row.amount),
      currency: row.currency,
      serviceTitle: row.service_title,
      customerName: row.customer_name,
      providerName: row.provider_name,
      slotStartAt: row.slot_start_at,
      slotEndAt: row.slot_end_at,
      createdAt: row.created_at,
    };
  }

  async listManualInstapayDeposits(params: {
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ items: ManualDepositRequest[]; total: number }> {
    const limit = Math.min(params.limit, 100);
    const offset = (params.page - 1) * limit;
    return this.walletService.listManualDepositsForAdmin({
      limit,
      offset,
      ...(params.status ? { status: params.status } : {}),
    });
  }

  async approveManualInstapayDeposit(
    depositId: string,
    adminId: string,
    input: ApproveManualInstapayDepositInput,
  ): Promise<ManualDepositRequest> {
    return this.walletService.approveManualInstapayDepositAdmin(
      depositId,
      adminId,
      input.creditedAmountEgp,
    );
  }

  async rejectManualInstapayDeposit(
    depositId: string,
    adminId: string,
    input: RejectManualInstapayDepositInput,
  ): Promise<ManualDepositRequest> {
    return this.walletService.rejectManualInstapayDepositAdmin(depositId, adminId, input.reason);
  }

  async listManualInstapayWithdrawals(params: {
    status?: string;
    page: number;
    limit: number;
  }): Promise<{ items: WithdrawalRequest[]; total: number }> {
    const limit = Math.min(params.limit, 100);
    const offset = (params.page - 1) * limit;
    return this.walletService.listManualWithdrawalsForAdmin({
      limit,
      offset,
      ...(params.status ? { status: params.status } : {}),
    });
  }

  async completeManualInstapayWithdrawal(
    withdrawalId: string,
    adminId: string,
    input: CompleteManualInstapayWithdrawalInput,
  ): Promise<WithdrawalRequest> {
    return this.walletService.completeInstapayWithdrawalAdmin(
      withdrawalId,
      adminId,
      input.proofUploadId,
    );
  }

  async rejectManualInstapayWithdrawal(
    withdrawalId: string,
    adminId: string,
    input: RejectManualInstapayWithdrawalInput,
  ): Promise<WithdrawalRequest> {
    return this.walletService.rejectInstapayWithdrawalAdmin(withdrawalId, adminId, input.reason);
  }

  private isMissingSchemaError(error: unknown): boolean {
    const pgError = error as { code?: string; message?: string };
    return (
      pgError.code === '42P01' ||
      pgError.code === '42703' ||
      (typeof pgError.message === 'string' &&
        (pgError.message.includes('does not exist') || pgError.message.includes('relation')))
    );
  }
}
