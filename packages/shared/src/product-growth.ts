import type { NotificationType } from './notifications.js';
import type { UserRole } from './roles.js';
import type { ServiceSearchResult } from './services.js';

export type NotificationChannel = 'in_app' | 'email' | 'push';

export type NotificationCategory =
  | 'security'
  | 'reservations'
  | 'disputes'
  | 'wallet'
  | 'withdrawals'
  | 'messages'
  | 'jobs'
  | 'services'
  | 'reviews'
  | 'admin'
  | 'marketing';

export type NotificationPreference = {
  notificationType: NotificationType;
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  required: boolean;
};

export type NotificationPreferenceGroup = {
  category: NotificationCategory;
  required: boolean;
  preferences: NotificationPreference[];
};

export type NotificationPreferencesResponse = {
  groups: NotificationPreferenceGroup[];
};

export type UpdateNotificationPreferencesBody = {
  preferences: Array<{
    notificationType: NotificationType;
    channel: NotificationChannel;
    enabled: boolean;
  }>;
};

export type PushSubscriptionBody = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
};

export type CouponTargetSurface = 'plan' | 'service' | 'ad' | 'platform_fee' | 'all';
export type CouponFundingSource = 'platform' | 'provider' | 'split';
export type CouponDiscountType = 'fixed' | 'percent';
export type CouponDiscountTarget = 'service_price' | 'platform_commission' | 'both';

export type Coupon = {
  id: string;
  code: string;
  type: CouponDiscountType;
  value: number;
  currency: string;
  targetSurface: CouponTargetSurface;
  discountTarget: CouponDiscountTarget;
  fundingSource: CouponFundingSource | null;
  providerSharePercent: number | null;
  platformSharePercent: number | null;
  minSpend: number | null;
  maxDiscount: number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  useCount: number;
  allowedRoles: UserRole[];
  active: boolean;
  providerCampaignRequestId: string | null;
  generatedQuantity: number | null;
  feePerCouponEgp: number | null;
  generationFeeTransactionId: string | null;
  auditStatus: 'admin_created' | 'provider_requested' | 'approved' | 'rejected' | 'disabled';
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CouponPreviewRequest = {
  code?: string;
  surface: CouponTargetSurface;
  subtotal: number;
  commissionAmount?: number;
  currency?: string;
  providerId?: string;
  itemId?: string;
};

export type CouponPreview = {
  valid: boolean;
  code: string | null;
  couponId: string | null;
  discountAmount: number;
  serviceDiscountAmount: number;
  commissionDiscountAmount: number;
  finalAmount: number;
  finalServiceAmount: number;
  finalCommissionAmount: number;
  currency: string;
  fundingSource: CouponFundingSource | null;
  discountTarget: CouponDiscountTarget | null;
  providerFundedAmount: number;
  platformFundedAmount: number;
  reason?: string;
};

export type ProviderCouponCampaignRequest = {
  id: string;
  providerId: string;
  requestedBy: string;
  couponId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requestedQuantity: number;
  feePerCouponEgp: number;
  totalFeeEgp: number;
  feeTransactionId: string | null;
  couponConfig: Record<string, unknown>;
  adminReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProviderCouponCampaignPreview = {
  requestedQuantity: number;
  feePerCouponEgp: number;
  totalFeeEgp: number;
  walletBalanceEgp: number;
  canSubmit: boolean;
};

export type CreateProviderCouponCampaignBody = CouponPreviewRequest & {
  code: string;
  type: CouponDiscountType;
  value: number;
  discountTarget: CouponDiscountTarget;
  requestedQuantity: number;
  maxUsesPerUser?: number;
  validUntil?: string | null;
};

export type SavedSearchKind = 'service' | 'need';

export type SavedSearch = {
  id: string;
  kind: SavedSearchKind;
  name: string;
  filters: Record<string, unknown>;
  locale: string;
  resultCountSnapshot: number;
  lastViewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertSavedSearchBody = {
  kind: SavedSearchKind;
  name: string;
  filters: Record<string, unknown>;
  locale?: string;
};

export type RecommendationConsent = {
  personalizedRecommendationsEnabled: boolean;
  updatedAt: string | null;
};

export type RecommendationEventType =
  | 'service_view'
  | 'search'
  | 'saved_search'
  | 'booking'
  | 'rating';

export type RecommendationListResponse = {
  consent: RecommendationConsent;
  personalized: boolean;
  items: ServiceSearchResult[];
};

export type BusinessTeamPermission =
  | 'manage_team'
  | 'manage_services'
  | 'manage_jobs'
  | 'manage_reservations'
  | 'view_wallet'
  | 'manage_support_disputes'
  | 'view_analytics';

export type BusinessTeamRole = {
  id: string;
  name: string;
  key: string;
  builtIn: boolean;
  permissions: BusinessTeamPermission[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type BusinessTeamMember = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  roleId: string;
  roleName: string;
  roleKey: string;
  createdAt: string;
};

export type BusinessTeamInvite = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type BusinessTeamOverview = {
  team: {
    id: string;
    businessId: string;
    name: string | null;
  };
  roles: BusinessTeamRole[];
  members: BusinessTeamMember[];
  invites: BusinessTeamInvite[];
};

export type CreateBusinessRoleBody = {
  name: string;
  permissions: BusinessTeamPermission[];
};

export type DeleteBusinessRoleBody = {
  replacementRoleId: string;
};

export type CreateBusinessInviteBody = {
  email: string;
  roleId: string;
};

export type BackupRestoreStatus = {
  latestBackupAt: string | null;
  latestBackupReference: string | null;
  latestMigration: string | null;
  restoreMode: 'single_owner' | 'two_person';
  pendingRestoreCount: number;
  provider: 'supabase' | 'custom_http' | 'disabled';
  providerConfigured: boolean;
  providerStatus: string | null;
};
