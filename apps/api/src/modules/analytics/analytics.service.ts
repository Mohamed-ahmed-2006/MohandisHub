// ---------------------------------------------------------------------------
// Analytics service — provider analytics business logic
// ---------------------------------------------------------------------------

import type { ProviderAnalytics, ProviderAnalyticsTopService } from '@mohandishub/shared';

import { AnalyticsRepository } from './analytics.repository.js';

export class AnalyticsService {
  constructor(private readonly repo: AnalyticsRepository = new AnalyticsRepository()) {}

  async getProviderAnalytics(providerId: string): Promise<ProviderAnalytics> {
    const [earnings, totalViews, ordersCount, topServiceRows] = await Promise.all([
      this.repo.getProviderEarnings(providerId),
      this.repo.getProviderServiceViews(providerId),
      this.repo.getProviderOrdersCount(providerId),
      this.repo.getProviderTopServices(providerId, 5),
    ]);

    const topServices: ProviderAnalyticsTopService[] = topServiceRows.map((r) => ({
      id: r.id,
      title: r.title,
      viewCount: r.view_count ?? 0,
      orderCount: r.order_count ?? 0,
      avgRating: r.avg_rating != null ? parseFloat(r.avg_rating) : null,
    }));

    return {
      totalEarnings: earnings.totalEarnings,
      currency: earnings.currency,
      totalServiceViews: totalViews,
      ordersCount,
      topServices,
    };
  }
}
