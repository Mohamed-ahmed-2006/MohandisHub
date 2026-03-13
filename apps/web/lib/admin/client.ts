import type {
  AcademicRecord,
  AdminBidActivityItem,
  AdminBookingActivityItem,
  AdminChangeUserEmailBody,
  AdminDashboardStats,
  AdminForceLogoutResponse,
  AdminJobActivityItem,
  AdminJobApplicationActivityItem,
  AdminNeedActivityItem,
  AdminReview,
  AdminServiceListItem,
  AdminTransactionListItem,
  AdminUpdateBusinessProfileBody,
  AdminUpdateExpertProfileBody,
  AdminUpdateUserBody,
  AdminUserDetail,
  AdminUserActivityType,
  AdminUserOverview,
  AdminWalletFreezeResponse,
  AdminUserListItem,
  AdjustBalanceBody,
  ApiErrorBody,
  ApiSuccessBody,
  AppSettings,
  BusinessProfile,
  CreateCategoryBody,
  CreatePlanBody,
  ExpertProfile,
  IdentityDocument,
  PaginatedResponse,
  PendingVerificationItem,
  Plan,
  ServiceCategory,
  Transaction,
  UpdateAppSettingsBody,
  UpdateCategoryBody,
  UpdatePlanBody,
} from '@mohandishub/shared';

import { ApiClientRequestError, isApiClientError } from '../auth/client';

import { getApiBaseUrl } from '@/lib/env';

type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  accessToken: string;
  refreshSession?: () => Promise<string | null>;
};

const isApiErrorBody = (value: unknown): value is ApiErrorBody => {
  if (!value || typeof value !== 'object') return false;
  const maybeError = (value as { error?: unknown }).error;
  if (!maybeError || typeof maybeError !== 'object') return false;
  const code = (maybeError as { code?: unknown }).code;
  const message = (maybeError as { message?: unknown }).message;
  return typeof code === 'string' && typeof message === 'string';
};

const apiRequest = async <T>({
  method,
  path,
  body,
  accessToken,
  refreshSession,
}: ApiRequestOptions): Promise<T> => {
  const doRequest = async (token: string): Promise<T> => {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const rawErrorBody: unknown = await response.json().catch(() => null);
      if (isApiErrorBody(rawErrorBody)) {
        throw new ApiClientRequestError({
          code: rawErrorBody.error.code,
          message: rawErrorBody.error.message,
          status: response.status,
          details: rawErrorBody.error.details,
        });
      }
      throw new ApiClientRequestError({
        code: 'HTTP_ERROR',
        message: `Request failed with status ${response.status}`,
        status: response.status,
      });
    }

    if (response.status === 204) return undefined as T;
    const rawBody = (await response.json()) as ApiSuccessBody<T>;
    return rawBody.data;
  };

  try {
    return await doRequest(accessToken);
  } catch (err) {
    if (refreshSession && isApiClientError(err) && err.status === 401) {
      const newToken = await refreshSession();
      if (newToken) {
        return await doRequest(newToken);
      }
    }
    throw err;
  }
};

export type AdminClientOptions = {
  refreshSession?: () => Promise<string | null>;
};

export type AdminUserProfile = {
  expertProfile: ExpertProfile | null;
  businessProfile: BusinessProfile | null;
  identityDocuments: IdentityDocument[];
  academicRecords: AcademicRecord[];
};

export type AdminUserActivityItem =
  | AdminNeedActivityItem
  | AdminBidActivityItem
  | AdminJobActivityItem
  | AdminJobApplicationActivityItem
  | AdminBookingActivityItem
  | AdminTransactionListItem;

export const adminApiClient = {
  // Dashboard
  getSettings: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<AppSettings>({
      method: 'GET',
      path: '/api/admin/settings',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  updateSettings: (
    accessToken: string,
    body: UpdateAppSettingsBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<AppSettings>({
      method: 'PATCH',
      path: '/api/admin/settings',
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  getDashboardStats: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<AdminDashboardStats>({
      method: 'GET',
      path: '/api/admin/dashboard/stats',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  // Users
  getUsers: (
    accessToken: string,
    params?: { page?: number; limit?: number; role?: string; isActive?: string; search?: string },
    options?: AdminClientOptions,
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.role) query.set('role', params.role);
    if (params?.isActive !== undefined) query.set('isActive', params.isActive);
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    return apiRequest<PaginatedResponse<AdminUserListItem>>({
      method: 'GET',
      path: `/api/admin/users${qs ? `?${qs}` : ''}`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    });
  },

  getUserDetail: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminUserDetail>({
      method: 'GET',
      path: `/api/admin/users/${userId}`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  getUserOverview: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminUserOverview>({
      method: 'GET',
      path: `/api/admin/users/${userId}/overview`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  getUserActivity: (
    accessToken: string,
    userId: string,
    type: AdminUserActivityType,
    params?: { page?: number; limit?: number },
    options?: AdminClientOptions,
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return apiRequest<PaginatedResponse<AdminUserActivityItem>>({
      method: 'GET',
      path: `/api/admin/users/${userId}/activity/${type}${qs ? `?${qs}` : ''}`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    });
  },

  updateUser: (
    accessToken: string,
    userId: string,
    body: AdminUpdateUserBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<AdminUserListItem>({
      method: 'PATCH',
      path: `/api/admin/users/${userId}`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  deleteUser: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<{ deleted: true }>({
      method: 'DELETE',
      path: `/api/admin/users/${userId}`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  activateUser: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminUserListItem>({
      method: 'POST',
      path: `/api/admin/users/${userId}/activate`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  deactivateUser: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminUserListItem>({
      method: 'POST',
      path: `/api/admin/users/${userId}/deactivate`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  sendVerificationEmail: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<{ sent: true; destination: string }>({
      method: 'POST',
      path: `/api/admin/users/${userId}/send-verification-email`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  verifyEmail: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminUserListItem>({
      method: 'POST',
      path: `/api/admin/users/${userId}/verify-email`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  sendNotification: (
    accessToken: string,
    body: { target: 'all' | 'users' | 'role'; userIds?: string[]; role?: string; title: string; message: string },
    options?: AdminClientOptions,
  ) =>
    apiRequest<{ created: number }>({
      method: 'POST',
      path: '/api/admin/notifications/send',
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  updateExpertProfile: (
    accessToken: string,
    userId: string,
    body: AdminUpdateExpertProfileBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<ExpertProfile>({
      method: 'PATCH',
      path: `/api/admin/users/${userId}/expert-profile`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  updateBusinessProfile: (
    accessToken: string,
    userId: string,
    body: AdminUpdateBusinessProfileBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<BusinessProfile>({
      method: 'PATCH',
      path: `/api/admin/users/${userId}/business-profile`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  freezeUserWallet: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminWalletFreezeResponse>({
      method: 'POST',
      path: `/api/admin/users/${userId}/wallet/freeze`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  unfreezeUserWallet: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminWalletFreezeResponse>({
      method: 'POST',
      path: `/api/admin/users/${userId}/wallet/unfreeze`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  forceLogoutUser: (accessToken: string, userId: string, options?: AdminClientOptions) =>
    apiRequest<AdminForceLogoutResponse>({
      method: 'POST',
      path: `/api/admin/users/${userId}/force-logout`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  changeUserEmail: (
    accessToken: string,
    userId: string,
    body: AdminChangeUserEmailBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<{ user: AdminUserListItem; verificationEmailSent: boolean }>({
      method: 'POST',
      path: `/api/admin/users/${userId}/change-email`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  // Plans
  getPlans: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<Plan[]>({
      method: 'GET',
      path: '/api/admin/plans',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  createPlan: (accessToken: string, body: CreatePlanBody, options?: AdminClientOptions) =>
    apiRequest<Plan>({
      method: 'POST',
      path: '/api/admin/plans',
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  updatePlan: (
    accessToken: string,
    planId: string,
    body: UpdatePlanBody,
    options?: AdminClientOptions,
  ) =>
    apiRequest<Plan>({
      method: 'PATCH',
      path: `/api/admin/plans/${planId}`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  deletePlan: (accessToken: string, planId: string, options?: AdminClientOptions) =>
    apiRequest<{ deleted: true }>({
      method: 'DELETE',
      path: `/api/admin/plans/${planId}`,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  // Transactions
  getTransactions: (
    accessToken: string,
    params?: {
      page?: number;
      limit?: number;
      userId?: string;
      type?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.userId) query.set('userId', params.userId);
    if (params?.type) query.set('type', params.type);
    if (params?.status) query.set('status', params.status);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    const qs = query.toString();
    return apiRequest<PaginatedResponse<AdminTransactionListItem>>({
      method: 'GET',
      path: `/api/admin/transactions${qs ? `?${qs}` : ''}`,
      accessToken,
    });
  },

  getTransactionDetail: (accessToken: string, txnId: string) =>
    apiRequest<Transaction>({
      method: 'GET',
      path: `/api/admin/transactions/${txnId}`,
      accessToken,
    }),

  adjustBalance: (accessToken: string, body: AdjustBalanceBody, options?: AdminClientOptions) =>
    apiRequest<Transaction>({
      method: 'POST',
      path: '/api/admin/transactions/adjust',
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  reverseTransaction: (accessToken: string, txnId: string) =>
    apiRequest<Transaction>({
      method: 'POST',
      path: `/api/admin/transactions/${txnId}/reverse`,
      accessToken,
    }),

  // Services
  getServices: (
    accessToken: string,
    params?: {
      page?: number;
      limit?: number;
      status?: string;
      categoryId?: string;
      providerId?: string;
    },
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.status) query.set('status', params.status);
    if (params?.categoryId) query.set('categoryId', params.categoryId);
    if (params?.providerId) query.set('providerId', params.providerId);
    const qs = query.toString();
    return apiRequest<PaginatedResponse<AdminServiceListItem>>({
      method: 'GET',
      path: `/api/admin/services${qs ? `?${qs}` : ''}`,
      accessToken,
    });
  },

  updateService: (
    accessToken: string,
    serviceId: string,
    body: { status?: string; isFeatured?: boolean },
  ) =>
    apiRequest<AdminServiceListItem>({
      method: 'PATCH',
      path: `/api/admin/services/${serviceId}`,
      body,
      accessToken,
    }),

  approveService: (accessToken: string, serviceId: string) =>
    apiRequest<AdminServiceListItem>({
      method: 'POST',
      path: `/api/admin/services/${serviceId}/approve`,
      accessToken,
    }),

  rejectService: (accessToken: string, serviceId: string, reason: string) =>
    apiRequest<AdminServiceListItem>({
      method: 'POST',
      path: `/api/admin/services/${serviceId}/reject`,
      body: { reason },
      accessToken,
    }),

  // Categories
  getCategories: (accessToken: string) =>
    apiRequest<ServiceCategory[]>({ method: 'GET', path: '/api/admin/categories', accessToken }),

  createCategory: (accessToken: string, body: CreateCategoryBody) =>
    apiRequest<ServiceCategory>({
      method: 'POST',
      path: '/api/admin/categories',
      body,
      accessToken,
    }),

  updateCategory: (accessToken: string, categoryId: string, body: UpdateCategoryBody) =>
    apiRequest<ServiceCategory>({
      method: 'PATCH',
      path: `/api/admin/categories/${categoryId}`,
      body,
      accessToken,
    }),

  deleteCategory: (accessToken: string, categoryId: string) =>
    apiRequest<{ deleted: true }>({
      method: 'DELETE',
      path: `/api/admin/categories/${categoryId}`,
      accessToken,
    }),

  // Verifications (existing)
  syncVerifiedAt: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<{ experts: number; businesses: number }>({
      method: 'POST',
      path: '/api/admin/verification/sync-verified-at',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  getPendingVerifications: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<PendingVerificationItem[]>({
      method: 'GET',
      path: '/api/admin/verification/pending',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  reviewIdentityDocument: (
    accessToken: string,
    docId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
    options?: AdminClientOptions,
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/identity/${docId}/review`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  reviewAcademicRecord: (
    accessToken: string,
    recordId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
    options?: AdminClientOptions,
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/academic/${recordId}/review`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  reviewBusinessDocs: (
    accessToken: string,
    userId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
    options?: AdminClientOptions,
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/business/${userId}/review`,
      body,
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  getUserProfile: (accessToken: string, userId: string) =>
    apiRequest<AdminUserProfile>({
      method: 'GET',
      path: `/api/admin/user/${userId}/profile`,
      accessToken,
    }),

  listReviewReports: (
    accessToken: string,
    params?: { page?: number; limit?: number; status?: 'pending' | 'all' },
  ) =>
    apiRequest<{
      rows: Array<{
        id: string;
        review_id: string;
        reporter_id: string;
        reason: string;
        comment: string | null;
        status: string;
        created_at: string;
        review_rating: number;
        review_comment: string | null;
        target_user_id: string;
        reporter_name: string;
      }>;
      total: number;
    }>({
      method: 'GET',
      path: `/api/admin/review-reports?page=${params?.page ?? 1}&limit=${params?.limit ?? 20}&status=${params?.status ?? 'pending'}`,
      accessToken,
    }),

  listReviewDisputes: (
    accessToken: string,
    params?: { page?: number; limit?: number; status?: 'pending' | 'all' },
  ) =>
    apiRequest<{
      rows: Array<{
        id: string;
        review_id: string;
        disputer_id: string;
        reason: string;
        status: string;
        created_at: string;
        review_rating: number;
        review_comment: string | null;
        target_user_id: string;
        disputer_name: string;
      }>;
      total: number;
    }>({
      method: 'GET',
      path: `/api/admin/review-disputes?page=${params?.page ?? 1}&limit=${params?.limit ?? 20}&status=${params?.status ?? 'pending'}`,
      accessToken,
    }),

  resolveReviewReport: (
    accessToken: string,
    reportId: string,
    body: { decision: 'dismissed' | 'upheld'; hideReview?: boolean },
  ) =>
    apiRequest<{ reportId: string; decision: string; hideReview: boolean }>({
      method: 'PATCH',
      path: `/api/admin/review-reports/${reportId}`,
      body,
      accessToken,
    }),

  resolveReviewDispute: (
    accessToken: string,
    disputeId: string,
    body: { decision: 'dismissed' | 'upheld'; hideReview?: boolean },
  ) =>
    apiRequest<{ disputeId: string; decision: string; hideReview: boolean }>({
      method: 'PATCH',
      path: `/api/admin/review-disputes/${disputeId}`,
      body,
      accessToken,
    }),
};
