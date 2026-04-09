export type AdLinkType = 'profile' | 'service' | 'need' | 'external';
export type AdStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled' | 'paused_by_admin';

export type AdvertisementPlanRow = {
  id: string;
  name_en: string;
  name_ar: string | null;
  duration_days: number;
  price: string;
  currency: string;
  description_en: string | null;
  description_ar: string | null;
  is_active: boolean;
  admin_override_allowed: boolean;
  created_at: string;
  updated_at: string;
};

export type AdPricingRuleRow = {
  id: string;
  name: string;
  is_active: boolean;
  role_scope: string[];
  country_scope: string[];
  city_scope: string[];
  category_scope: string[];
  min_duration_days: number | null;
  max_duration_days: number | null;
  price_multiplier: string;
  flat_fee: string;
  starts_at: string | null;
  ends_at: string | null;
  priority: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AdvertisementRow = {
  id: string;
  advertiser_id: string;
  ad_plan_id: string | null;
  title_en: string;
  title_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  image_url: string;
  cta_text_en: string | null;
  cta_text_ar: string | null;
  link_type: AdLinkType;
  link_target: string | null;
  status: AdStatus;
  amount_paid: string | null;
  starts_at: string | null;
  expires_at: string | null;
  priority: number;
  target_roles: string[];
  target_countries: string[];
  target_cities: string[];
  target_categories: string[];
  target_languages: string[];
  target_min_budget: string | null;
  target_max_budget: string | null;
  admin_forced_starts_at: string | null;
  admin_forced_expires_at: string | null;
  admin_status_reason: string | null;
  admin_price_override: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
  updated_at: string;
  advertiser_name?: string;
};

