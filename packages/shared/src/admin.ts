// ---------------------------------------------------------------------------
// Admin-specific types — shared between API and frontend
// ---------------------------------------------------------------------------

import type { UserRole } from './roles.js';

export type PaginationParams = {
  page?: number;
  limit?: number;
};

export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type AdminDashboardStats = {
  totalUsers: number;
  usersByRole: Record<UserRole, number>;
  activeUsers: number;
  totalRevenue: number;
  totalTransactions: number;
  transactionVolume: number;
  platformCommissionVolume: number;
  pendingVerifications: number;
  activeServices: number;
  totalPlans: number;
  platformWalletBalance: number;
};

/** Primary role is customer | expert | business. Admin is a separate isAdmin flag. */
export type AdminUserListItem = {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  primaryRole: UserRole;
  isAdmin: boolean;
  adminPermissions?: string[];
  isActive: boolean;
  emailVerifiedAt: string | null;
  planSlug: string | null;
  planName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
};

export type AdminUserDetail = AdminUserListItem & {
  phoneCode: string | null;
  nationality: string | null;
  avatarUrl: string | null;
  dateOfBirth: string | null;
  walletBalance: number | null;
  walletCurrency: string | null;
  walletFrozen: boolean | null;
};

export type AdminUpdateUserBody = {
  displayName?: string;
  isActive?: boolean;
  primaryRole?: UserRole;
  isAdmin?: boolean;
  adminPermissions?: string[];
  planId?: string | null;
};

export type AdminUserFilters = PaginationParams & {
  role?: UserRole;
  isActive?: boolean;
  search?: string;
};

export type AdminTransactionFilters = PaginationParams & {
  userId?: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type AdminServiceFilters = PaginationParams & {
  status?: string;
  categoryId?: string;
  providerId?: string;
};

export type AdminTransactionListItem = {
  id: string;
  walletId: string;
  userId: string;
  userEmail: string;
  userDisplayName: string;
  type: string;
  amount: number;
  balanceAfter: number;
  status: string;
  description: string | null;
  referenceType: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type AdminServiceListItem = {
  id: string;
  title: string;
  providerId: string;
  providerName: string;
  providerEmail: string;
  providerRole: string;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
  price: number | null;
  priceType: string;
  status: string;
  isFeatured: boolean;
  city: string | null;
  createdAt: string;
};
