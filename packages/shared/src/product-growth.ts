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

/**
 * The product-facing built-in security tiers of a business workspace.
 *
 * Exactly three, and the backend is the only place they are decided. The
 * database stores the tier in `business_members.role`, where the historical
 * value `manager` carries the Admin tier — the internal value is kept so no
 * existing membership has to be rewritten, and it is mapped here rather than
 * exposed. Custom roles always resolve to `member`; they widen PERMISSIONS,
 * never tier, which is what stops one from conferring ownership.
 */
export type BusinessWorkspaceTier = 'owner' | 'admin' | 'member';

/**
 * Actions the signed-in caller may actually perform, resolved server-side from
 * ownership, tier and the assigned role's permission array.
 *
 * The frontend uses these to decide what to show. It is not a security boundary:
 * every one of them is re-checked by the endpoint that performs the action.
 */
export type BusinessTeamAllowedActions = {
  inviteMembers: boolean;
  revokeInvites: boolean;
  viewInvites: boolean;
  updateMemberRoles: boolean;
  removeMembers: boolean;
  manageRoles: boolean;
  transferOwnership: boolean;
};

export type BusinessTeamRole = {
  id: string;
  name: string;
  key: string;
  builtIn: boolean;
  /** A built-in role retained for historical compatibility (currently `viewer`). */
  legacy: boolean;
  /** The tier a member holding this role receives. Custom roles are always `member`. */
  tier: BusinessWorkspaceTier;
  /** Whether this role may be handed out through invitations and role updates. */
  assignable: boolean;
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
  roleId: string | null;
  roleName: string | null;
  roleKey: string | null;
  tier: BusinessWorkspaceTier;
  isOwner: boolean;
  /** True for the member row belonging to the signed-in caller. */
  isSelf: boolean;
  createdAt: string;
};

/**
 * Invitation status as the API reports it.
 *
 * `expired` is derived from `expires_at` on read, so a still-`pending` row past
 * its expiry is reported as expired without a GET ever writing to it.
 */
export type BusinessTeamInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export type BusinessTeamInvite = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  status: BusinessTeamInviteStatus;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
};

export type BusinessTeamViewer = {
  userId: string;
  /** Null when the caller owns the workspace account but holds no membership row. */
  memberId: string | null;
  tier: BusinessWorkspaceTier;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  roleKey: string | null;
  permissions: BusinessTeamPermission[];
  allowedActions: BusinessTeamAllowedActions;
};

export type BusinessTeamOverview = {
  team: {
    id: string;
    businessId: string;
    name: string | null;
  };
  /** The signed-in caller's own standing in this workspace. */
  viewer: BusinessTeamViewer;
  roles: BusinessTeamRole[];
  members: BusinessTeamMember[];
  invites: BusinessTeamInvite[];
};

/**
 * What an invitation link is allowed to reveal before it is accepted.
 *
 * Deliberately thin. It names the workspace and the offered role because the
 * recipient cannot make a decision without them, masks the invited address so a
 * leaked link does not disclose it in full, and never reveals whether any
 * address has an account.
 */
export type BusinessInvitePreviewState =
  | 'valid'
  | 'expired'
  | 'revoked'
  | 'already_used'
  | 'malformed'
  | 'wrong_account';

export type BusinessInvitePreview = {
  state: BusinessInvitePreviewState;
  /** Present for every state except `malformed`, where no invitation was found. */
  teamName: string | null;
  inviterDisplayName: string | null;
  /** Masked, e.g. `b••@example.com`. Never the full address. */
  maskedEmail: string | null;
  roleName: string | null;
  expiresAt: string | null;
  /** True when the caller must sign in before the invitation can be accepted. */
  requiresAuthentication: boolean;
  /**
   * Whether the signed-in account is the invited one. `null` when nobody is
   * signed in, because the answer would otherwise disclose the invited address.
   */
  signedInAccountMatches: boolean | null;
};

export type BusinessInviteAcceptResult = {
  accepted: boolean;
  /** True when this call created the membership, false when it was already there. */
  created: boolean;
  teamId: string;
  teamName: string | null;
  roleName: string | null;
  tier: BusinessWorkspaceTier;
};

export type UpdateBusinessMemberRoleBody = {
  roleId: string;
};

export type TransferBusinessOwnershipBody = {
  /** The member row that becomes owner. */
  memberId: string;
  /** Must equal the workspace name exactly; a deliberate confirmation step. */
  confirmation: string;
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
