// ---------------------------------------------------------------------------
// Admin module — internal DB row types
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
};

export type UserDetailRow = UserListRow & {
  wallet_balance: string | null;
  wallet_currency: string | null;
  wallet_frozen: boolean | null;
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
  role_admin: string;
  total_transactions: string;
  total_revenue: string;
  pending_verifications: string;
  active_services: string;
  total_plans: string;
};
