// ---------------------------------------------------------------------------
// Analytics types — shared between API and frontend
// ---------------------------------------------------------------------------

export type ProviderAnalyticsTopService = {
  id: string;
  title: string;
  viewCount: number;
  orderCount: number;
  avgRating: number | null;
};

export type ProviderAnalytics = {
  totalEarnings: number;
  currency: string;
  totalServiceViews: number;
  ordersCount: number;
  topServices: ProviderAnalyticsTopService[];
};
