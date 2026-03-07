// ---------------------------------------------------------------------------
// Admin service — business logic for admin operations
// ---------------------------------------------------------------------------

import type {
  AdminDashboardStats,
  AdminServiceListItem,
  AdminTransactionListItem,
  AdminUserDetail,
  AdminUserListItem,
  PaginatedResponse,
  Plan,
  ServiceCategory,
  Transaction,
} from '@mohandishub/shared';

import { HttpError } from '../../utils/http-error.js';
import { OtpService } from '../otp/otp.service.js';

import { AdminRepository } from './admin.repository.js';
import type {
  CategoryRow,
  PlanRow,
  ServiceListRow,
  TransactionListRow,
  TransactionRow,
  UserDetailRow,
  UserListRow,
} from './admin.types.js';
import type {
  AdjustBalanceInput,
  CreateCategoryInput,
  CreatePlanInput,
  UpdateCategoryInput,
  UpdatePlanInput,
  UpdateServiceInput,
  UpdateUserInput,
} from './admin.validation.js';

export class AdminService {
  constructor(
    private readonly repo: AdminRepository = new AdminRepository(),
    private readonly otpService: OtpService = new OtpService(),
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
        admin: parseInt(row.role_admin, 10),
      },
      totalTransactions: parseInt(row.total_transactions, 10),
      totalRevenue: parseFloat(row.total_revenue),
      pendingVerifications: parseInt(row.pending_verifications, 10),
      activeServices: parseInt(row.active_services, 10),
      totalPlans: parseInt(row.total_plans, 10),
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
    if (input.isActive !== undefined) dbFields.is_active = input.isActive;
    if (input.primaryRole !== undefined) dbFields.primary_role = input.primaryRole;
    if (input.isAdmin !== undefined) dbFields.is_admin = input.isAdmin;
    if (input.planId !== undefined) dbFields.plan_id = input.planId;

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

  // ── Plans ───────────────────────────────────────────────────────────────

  async listPlans(): Promise<Plan[]> {
    const rows = await this.repo.listPlans();
    return rows.map((r) => this.toPlan(r));
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
    if (input.features !== undefined) dbFields.features = JSON.stringify(input.features);
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;

    try {
      const row = await this.repo.createPlan(dbFields);
      return this.toPlan(row);
    } catch (err: unknown) {
      const pgError = err as { code?: string };
      if (pgError.code === '23505') {
        throw new HttpError({
          statusCode: 409,
          code: 'PLAN_SLUG_EXISTS',
          message: `A plan with slug "${input.slug}" already exists.`,
        });
      }
      throw err;
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
    if (input.features !== undefined) dbFields.features = JSON.stringify(input.features);
    if (input.sortOrder !== undefined) dbFields.sort_order = input.sortOrder;
    if (input.isActive !== undefined) dbFields.is_active = input.isActive;

    const row = await this.repo.updatePlan(planId, dbFields);
    if (!row) {
      throw new HttpError({ statusCode: 404, code: 'PLAN_NOT_FOUND', message: 'Plan not found.' });
    }
    return this.toPlan(row);
  }

  async deletePlan(planId: string): Promise<void> {
    const deleted = await this.repo.softDeletePlan(planId);
    if (!deleted) {
      throw new HttpError({ statusCode: 404, code: 'PLAN_NOT_FOUND', message: 'Plan not found.' });
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

  private toUserListItem(row: UserListRow): AdminUserListItem {
    return {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      phone: row.phone,
      primaryRole: row.primary_role as AdminUserListItem['primaryRole'],
      isAdmin: row.is_admin === true,
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
}
