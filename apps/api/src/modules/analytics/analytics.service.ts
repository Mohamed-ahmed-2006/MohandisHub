// ---------------------------------------------------------------------------
// Analytics service — provider analytics business logic
// ---------------------------------------------------------------------------

import {
  type ProviderAnalytics,
  type ProviderAnalyticsTopService,
  type ReservationPricingBreakdown,
} from '@mohandishub/shared';

import { computeFixedReservationPayoutSplit } from '../reservations/reservations.money.js';

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
      analyticsAvailableFrom,
    ] = await Promise.all([
      this.repo.getProviderEarnings(providerId, range),
      this.repo.getProviderServiceViews(providerId, range),
      this.repo.getProviderOrdersCount(providerId, range),
      this.repo.getProviderTopServices(providerId, range, 5),
      this.repo.getEarningsTrend(providerId, range),
      this.repo.getOrderTrend(providerId, range),
      this.repo.getPayoutForecast(providerId),
      this.repo.getServicePerformance(providerId, range, 20),
      this.repo.getViewAnalyticsAvailableFrom(providerId),
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
    let pendingReceivables = 0;
    let disputedReceivables = 0;
    for (const row of payoutForecast.receivables) {
      const pricing = row.policy_snapshot?.pricingBreakdown as
        | ReservationPricingBreakdown
        | undefined;
      if (!pricing) continue;
      const split = computeFixedReservationPayoutSplit({
        heldAmount: Number(row.held_amount),
        platformFeeAmount: Number(row.platform_fee),
        pricing,
        fallbackCommissionPercent: pricing.commissionPercent ?? 0,
        fallbackCommissionMinEgp: pricing.commissionMinEgp ?? 0,
      });
      if (row.reservation_status === 'disputed') disputedReceivables += split.providerAmount;
      else pendingReceivables += split.providerAmount;
    }

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
      analyticsAvailableFrom,
      earningsTrend,
      orderTrend,
      conversion: {
        views: totalViews,
        orders: ordersCount,
        rate: Number(conversionRate.toFixed(4)),
      },
      payoutForecast: {
        available: payoutForecast.available,
        pending: Number(pendingReceivables.toFixed(2)),
        held: Number(disputedReceivables.toFixed(2)),
        currency: payoutForecast.currency,
      },
      servicePerformance,
    };
  }
}
