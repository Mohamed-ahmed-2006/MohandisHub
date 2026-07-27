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
  dateRange?: {
    from: string;
    to: string;
  };
  /** View-based analytics are complete only from this event-collection timestamp onward. */
  analyticsAvailableFrom?: string | null;
  earningsTrend?: Array<{
    date: string;
    amount: number;
  }>;
  orderTrend?: Array<{
    date: string;
    count: number;
  }>;
  conversion?: {
    views: number;
    orders: number;
    rate: number;
  };
  payoutForecast?: {
    available: number;
    pending: number;
    held: number;
    currency: string;
  };
  servicePerformance?: Array<
    ProviderAnalyticsTopService & {
      city: string | null;
      categoryNameEn: string | null;
      categoryNameAr: string | null;
      disputeCount: number;
      cancellationCount: number;
      completionCount: number;
    }
  >;
};
