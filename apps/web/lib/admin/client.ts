import type {
  AcademicRecord,
  AdminDashboardStats,
  AdminReview,
  AdminServiceListItem,
  AdminTransactionListItem,
  AdminUpdateUserBody,
  AdminUserDetail,
  AdminUserListItem,
  AdjustBalanceBody,
  ApiErrorBody,
  ApiSuccessBody,
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

export const adminApiClient = {
  // Dashboard
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

  // Plans
  getPlans: (accessToken: string, options?: AdminClientOptions) =>
    apiRequest<Plan[]>({
      method: 'GET',
      path: '/api/admin/plans',
      accessToken,
      ...(options?.refreshSession ? { refreshSession: options.refreshSession } : {}),
    }),

  createPlan: (accessToken: string, body: CreatePlanBody) =>
    apiRequest<Plan>({ method: 'POST', path: '/api/admin/plans', body, accessToken }),

  updatePlan: (accessToken: string, planId: string, body: UpdatePlanBody) =>
    apiRequest<Plan>({ method: 'PATCH', path: `/api/admin/plans/${planId}`, body, accessToken }),

  deletePlan: (accessToken: string, planId: string) =>
    apiRequest<{ deleted: true }>({
      method: 'DELETE',
      path: `/api/admin/plans/${planId}`,
      accessToken,
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
  getPendingVerifications: (accessToken: string) =>
    apiRequest<PendingVerificationItem[]>({
      method: 'GET',
      path: '/api/admin/verification/pending',
      accessToken,
    }),

  reviewIdentityDocument: (
    accessToken: string,
    docId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/identity/${docId}/review`,
      body,
      accessToken,
    }),

  reviewAcademicRecord: (
    accessToken: string,
    recordId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/academic/${recordId}/review`,
      body,
      accessToken,
    }),

  reviewBusinessDocs: (
    accessToken: string,
    userId: string,
    body: { decision: 'approved' | 'rejected'; notes?: string },
  ) =>
    apiRequest<AdminReview>({
      method: 'POST',
      path: `/api/admin/business/${userId}/review`,
      body,
      accessToken,
    }),

  getUserProfile: (accessToken: string, userId: string) =>
    apiRequest<AdminUserProfile>({
      method: 'GET',
      path: `/api/admin/user/${userId}/profile`,
      accessToken,
    }),
};
