// ---------------------------------------------------------------------------
// Admin-specific types - shared between API and frontend
// ---------------------------------------------------------------------------

import type {
  AcademicRecord,
  BusinessProfile,
  CraftsmanProfile,
  ExpertProfile,
  IdentityDocument,
  UpdateBusinessProfileBody,
  UpdateCraftsmanProfileBody,
  UpdateExpertProfileBody,
} from './profiles.js';
import type { UserRole } from './roles.js';
import type { WalletFundingRail } from './wallet.js';

export const ADMIN_PERMISSIONS = [
  'super_admin',
  'manage_users',
  'manage_plans',
  'manage_transactions',
  'manage_services',
  'manage_verifications',
  'manage_notifications',
  'manage_support',
  'manage_media',
  'manage_settings',
  'manage_retention',
  'manage_ads',
  'manage_ad_pricing',
  'manage_ad_scheduling',
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

export const isAdminPermission = (permission: string): permission is AdminPermission =>
  (ADMIN_PERMISSIONS as readonly string[]).includes(permission);

export const normalizeAdminPermissions = (permissions: unknown): AdminPermission[] => {
  if (!Array.isArray(permissions)) return [];
  return [
    ...new Set(
      permissions.filter(
        (p): p is AdminPermission => typeof p === 'string' && isAdminPermission(p),
      ),
    ),
  ];
};

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

export type AdminWalletFundingLiquidity = {
  liabilitiesEgp: Record<WalletFundingRail, number>;
  reviewRequiredWallets: number;
  pendingCryptoPayouts: Array<{
    currency: string;
    amount: number;
  }>;
  providerBalances: Record<
    string,
    {
      amount: number;
      pendingAmount: number;
    }
  > | null;
  providerBalanceError: string | null;
  checkedAt: string;
};

/** Primary role is customer | expert | business. Admin is a separate isAdmin flag. */
export type AdminUserListItem = {
  id: string;
  email: string;
  displayName: string;
  phone: string | null;
  primaryRole: UserRole;
  isAdmin: boolean;
  adminPermissions?: AdminPermission[];
  isActive: boolean;
  emailVerifiedAt: string | null;
  planSlug: string | null;
  planName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
  /** Business signup: email not verified and onboarding not marked complete (easy to miss in lists). */
  incompleteBusinessSignup?: boolean;
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
  phone?: string | null;
  phoneCode?: string | null;
  nationality?: string | null;
  dateOfBirth?: string | null;
  isActive?: boolean;
  isAdmin?: boolean;
  adminPermissions?: AdminPermission[];
  planId?: string | null;
};

export type AdminChangeUserEmailBody = {
  newEmail: string;
  sendVerificationEmail?: boolean;
};

export type AdminForceLogoutResponse = {
  revoked: true;
};

export type AdminWalletFreezeResponse = {
  userId: string;
  walletFrozen: boolean;
};

export type AdminBulkUserAction =
  | 'activate'
  | 'deactivate'
  | 'soft_delete'
  | 'force_logout'
  | 'send_verification_email'
  | 'verify_email'
  | 'freeze_wallet'
  | 'unfreeze_wallet'
  | 'assign_plan';

export type AdminBulkUserActionBody = {
  operationId: string;
  userIds: string[];
  action: AdminBulkUserAction;
  planId?: string | null;
};

export type AdminBulkUserActionItem = {
  userId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  code: string | null;
  message: string | null;
};

export type AdminBulkUserActionResult = {
  operationId: string;
  action: AdminBulkUserAction;
  status: 'processing' | 'completed';
  requestedCount: number;
  succeededCount: number;
  skippedCount: number;
  failedCount: number;
  items: AdminBulkUserActionItem[];
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
  balanceDelta: number | null;
  balanceAfter: number;
  status: string;
  description: string | null;
  referenceType: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type AdminMoneyAuditEvent = {
  id: string;
  kind: 'transaction' | 'hold' | 'deposit' | 'withdrawal' | 'reservation_failure';
  userId: string | null;
  userEmail: string | null;
  userDisplayName: string | null;
  reservationId: string | null;
  disputeId: string | null;
  amount: number;
  currency: string;
  status: string;
  rail: string | null;
  label: string;
  referenceType: string | null;
  referenceId: string | null;
  providerReference: string | null;
  reviewNeeded: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type AdminMoneyAuditFilters = PaginationParams & {
  userId?: string;
  reservationId?: string;
  provider?: string;
  rail?: string;
  status?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  reviewNeeded?: boolean;
};

export type PaymobReadiness = {
  depositsEnabled: boolean;
  withdrawalsEnabled: boolean;
  depositConfigured: boolean;
  payoutConfigured: boolean;
  missingDepositKeys: string[];
  missingPayoutKeys: string[];
  webhookUrl: string | null;
  returnUrl: string | null;
  payoutBaseUrlConfigured: boolean;
  lastDepositCallbackAt: string | null;
  lastDepositCallbackStatus: string | null;
  lastPaymobError: string | null;
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
  currency: string;
  priceType: string;
  status: string;
  isFeatured: boolean;
  city: string | null;
  createdAt: string;
};

export type AdminNeedActivityItem = {
  id: string;
  title: string;
  status: string;
  budgetAmount: number;
  currency: string;
  bidCount: number;
  createdAt: string;
};

export type AdminBidActivityItem = {
  id: string;
  needId: string;
  needTitle: string | null;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

export type AdminJobActivityItem = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

export type AdminJobApplicationActivityItem = {
  id: string;
  jobId: string;
  jobTitle: string | null;
  status: string;
  createdAt: string;
};

export type AdminBookingActivityItem = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  serviceTitle: string | null;
  customerName: string | null;
  providerName: string | null;
  slotStartAt: string | null;
  slotEndAt: string | null;
  createdAt: string;
};

export type AdminUserActivityType =
  | 'needs'
  | 'bids'
  | 'jobs'
  | 'jobApplications'
  | 'bookings'
  | 'transactions';

export type AdminUserActivityCounts = {
  needs: number;
  bids: number;
  jobs: number;
  jobApplications: number;
  bookings: number;
  transactions: number;
};

export type AdminUserRecentActivity = {
  needs: AdminNeedActivityItem[];
  bids: AdminBidActivityItem[];
  jobs: AdminJobActivityItem[];
  jobApplications: AdminJobApplicationActivityItem[];
  bookings: AdminBookingActivityItem[];
  transactions: AdminTransactionListItem[];
};

export type AdminUserOverview = {
  user: AdminUserDetail;
  expertProfile: ExpertProfile | null;
  businessProfile: BusinessProfile | null;
  craftsmanProfile: CraftsmanProfile | null;
  identityDocuments: IdentityDocument[];
  academicRecords: AcademicRecord[];
  activityCounts: AdminUserActivityCounts;
  recentActivity: AdminUserRecentActivity;
};

export type AdminUpdateExpertProfileBody = UpdateExpertProfileBody;
export type AdminUpdateBusinessProfileBody = UpdateBusinessProfileBody;
export type AdminUpdateCraftsmanProfileBody = UpdateCraftsmanProfileBody;
