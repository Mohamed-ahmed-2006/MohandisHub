export type AdLinkType = 'profile' | 'service';
export type AdStatus =
  | 'pending_review'
  | 'scheduled'
  | 'active'
  | 'paused_by_admin'
  | 'rejected'
  | 'expired'
  | 'cancelled';

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
  duration_days: number | null;
  daily_price_piastres: number | null;
  quoted_amount_piastres: string | null;
  wallet_hold_id: string | null;
  banner_upload_id: string | null;
  destination_provider_id: string | null;
  destination_service_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  paused_at: string | null;
  paused_seconds: string;
  cancellation_refund_piastres: string;
  content_locked_at: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
  updated_at: string;
  advertiser_name?: string;
  deliveryToken?: string;
};
