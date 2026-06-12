// ---------------------------------------------------------------------------
// Admin module - internal DB row types
// ---------------------------------------------------------------------------

export type UserRow = {
  id: string;
  email: string;
  display_name: string;
  phone: string | null;
  phone_code: string | null;
  nationality: string | null;
  avatar_url: string | null;
  date_of_birth: string | null;
  primary_role: string;
  is_admin: boolean;
  admin_permissions?: string[];
  is_active: boolean;
  email_verified_at: string | null;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  deleted_at: string | null;
};

export type UserListRow = UserRow & {
  plan_slug: string | null;
  plan_name: string | null;
  business_onboarding_completed_at?: string | null;
};

export type UserDetailRow = UserListRow & {
  wallet_balance: string | null;
  wallet_currency: string | null;
  wallet_frozen: boolean | null;
};

export type UserActivityCountRow = {
  count: string;
};

export type NeedActivityRow = {
  id: string;
  title: string;
  status: string;
  budget_amount: string;
  currency: string;
  bid_count: string;
  created_at: string;
};

export type BidActivityRow = {
  id: string;
  need_id: string;
  need_title: string | null;
  amount: string;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
};

export type JobActivityRow = {
  id: string;
  title: string;
  status: string;
  created_at: string;
};

export type JobApplicationActivityRow = {
  id: string;
  job_id: string;
  job_title: string | null;
  status: string;
  created_at: string;
};

export type BookingActivityRow = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  service_title: string | null;
  customer_name: string | null;
  provider_name: string | null;
  slot_start_at: string | null;
  slot_end_at: string | null;
  created_at: string;
};

/** Plan limits as stored in JSONB (camelCase to match shared PlanLimits). */
export type PlanLimitsRow = {
  maxServices?: number | null;
  maxNeeds?: number | null;
  maxJobs?: number | null;
  canPriorityListing?: boolean;
  bidsVisibleToCustomer?: string | null;
  bidsVisibleTopN?: number | null;
  maxBidsPerNeed?: number | null;
  maxActiveBids?: number | null;
  maxBusinessServices?: number | null;
  maxTeamSlots?: number | null;
  canBusinessFeatured?: boolean;
  canPriorityBid?: boolean;
  canProBadge?: boolean;
  canTrustedBusinessBadge?: boolean;
};

export type PlanRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  billing_cycle: string;
  duration_days: number | null;
  trial_days: number;
  max_services: number | null;
  max_projects: number | null;
  features: string[];
  allowed_roles?: string[] | null;
  plan_limits?: PlanLimitsRow | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type TransactionListRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  type: string;
  amount: string;
  balance_after: string;
  status: string;
  description: string | null;
  reference_type: string | null;
  created_by: string | null;
  created_at: string;
};

export type TransactionRow = {
  id: string;
  wallet_id: string;
  user_id: string;
  type: string;
  amount: string;
  balance_after: string;
  status: string;
  description: string | null;
  reference_type: string | null;
  reference_id: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type MoneyAuditEventRow = {
  id: string;
  kind: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  reservation_id: string | null;
  dispute_id: string | null;
  amount: string;
  currency: string;
  status: string;
  rail: string | null;
  label: string;
  reference_type: string | null;
  reference_id: string | null;
  provider_reference: string | null;
  review_needed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ServiceListRow = {
  id: string;
  title: string;
  provider_id: string;
  provider_name: string;
  provider_email: string;
  provider_role: string;
  category_name_en: string | null;
  category_name_ar: string | null;
  price: string | null;
  currency: string;
  price_type: string;
  status: string;
  is_featured: boolean;
  city: string | null;
  created_at: string;
};

export type CategoryRow = {
  id: string;
  name_en: string;
  name_ar: string;
  slug: string;
  description_en: string | null;
  description_ar: string | null;
  icon: string | null;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type DashboardStatsRow = {
  total_users: string;
  active_users: string;
  role_customer: string;
  role_expert: string;
  role_business: string;
  role_craftsman: string;
  role_admin: string;
  total_transactions: string;
  total_revenue: string;
  transaction_volume: string;
  platform_commission_volume: string;
  pending_verifications: string;
  active_services: string;
  total_plans: string;
  platform_wallet_balance: string;
};
