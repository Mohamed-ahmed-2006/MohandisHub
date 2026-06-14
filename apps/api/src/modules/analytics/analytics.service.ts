// ---------------------------------------------------------------------------
// Analytics service — provider analytics business logic
// ---------------------------------------------------------------------------

import type { ProviderAnalytics, ProviderAnalyticsTopService } from '@mohandishub/shared';

import { AnalyticsRepository, type AnalyticsDateRange } from './analytics.repository.js';

export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository = new AnalyticsRepository()) {}

  async getProviderAnalytics(
    providerId: string,
    range: AnalyticsDateRange = {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      to: new Date(),
    },
  ): Promise<ProviderAnalytics> {
    const [
      earnings,
      totalViews,
      ordersCount,
      topServiceRows,
      earningsTrend,
      orderTrend,
      payoutForecast,
      servicePerformanceRows,
    ] = await Promise.all([
      this.repo.getProviderEarnings(providerId, range),
      this.repo.getProviderServiceViews(providerId),
      this.repo.getProviderOrdersCount(providerId, range),
      this.repo.getProviderTopServices(providerId, 5),
      this.repo.getEarningsTrend(providerId, range),
      this.repo.getOrderTrend(providerId, range),
      this.repo.getPayoutForecast(providerId),
      this.repo.getServicePerformance(providerId, 20),
    ]);

    const topServices: ProviderAnalyticsTopService[] = topServiceRows.map((r) => ({
      id: r.id,
      title: r.title,
      viewCount: r.view_count ?? 0,
      orderCount: r.order_count ?? 0,
      avgRating: r.avg_rating != null ? parseFloat(r.avg_rating) : null,
    }));

    const servicePerformance = servicePerformanceRows.map((r) => ({
      id: r.id,
      title: r.title,
      viewCount: r.view_count ?? 0,
      orderCount: r.order_count ?? 0,
      avgRating: r.avg_rating != null ? parseFloat(r.avg_rating) : null,
      city: r.city ?? null,
      categoryNameEn: r.category_name_en ?? null,
      categoryNameAr: r.category_name_ar ?? null,
      disputeCount: parseInt(r.dispute_count ?? '0', 10) || 0,
      cancellationCount: parseInt(r.cancellation_count ?? '0', 10) || 0,
      completionCount: parseInt(r.completion_count ?? '0', 10) || 0,
    }));
    const conversionRate = totalViews > 0 ? ordersCount / totalViews : 0;

    return {
      totalEarnings: earnings.totalEarnings,
      currency: earnings.currency,
      totalServiceViews: totalViews,
      ordersCount,
      topServices,
      dateRange: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      earningsTrend,
      orderTrend,
      conversion: {
        views: totalViews,
        orders: ordersCount,
        rate: Number(conversionRate.toFixed(4)),
      },
      payoutForecast,
      servicePerformance,
    };
  }
}
