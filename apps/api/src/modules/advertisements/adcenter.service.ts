import type { AdvertisementRow } from './advertisements.types.js';
import type { AdCenterResolveInput } from './advertisements.validation.js';

type CustomerContext = {
  role?: string;
  country?: string;
  city?: string;
  locale?: string;
  categories: string[];
  budget?: number;
};

export class AdCenterService {
  private normalize(input: AdCenterResolveInput): CustomerContext {
    const role = input.role?.toLowerCase();
    const country = input.country?.toLowerCase();
    const city = input.city?.toLowerCase();
    const locale = input.locale?.toLowerCase();
    const budget = input.budget;
    return {
      categories: (input.categories ?? []).map((x) => x.toLowerCase()),
      ...(role !== undefined ? { role } : {}),
      ...(country !== undefined ? { country } : {}),
      ...(city !== undefined ? { city } : {}),
      ...(locale !== undefined ? { locale } : {}),
      ...(budget !== undefined ? { budget } : {}),
    };
  }

  private score(ad: AdvertisementRow, ctx: CustomerContext): number {
    let score = 0;
    const roleMatch =
      ad.target_roles.length === 0 ||
      (ctx.role ? ad.target_roles.map((x) => x.toLowerCase()).includes(ctx.role) : false);
    const countryMatch =
      ad.target_countries.length === 0 ||
      (ctx.country ? ad.target_countries.map((x) => x.toLowerCase()).includes(ctx.country) : false);
    const cityMatch =
      ad.target_cities.length === 0 ||
      (ctx.city ? ad.target_cities.map((x) => x.toLowerCase()).includes(ctx.city) : false);
    const categoryMatch =
      ad.target_categories.length === 0 ||
      ad.target_categories.some((c) => ctx.categories.includes(c.toLowerCase()));
    const langMatch =
      ad.target_languages.length === 0 ||
      (ctx.locale ? ad.target_languages.map((x) => x.toLowerCase()).includes(ctx.locale) : false);
    const budget = ctx.budget;
    const minBudget = ad.target_min_budget ? parseFloat(ad.target_min_budget) : null;
    const maxBudget = ad.target_max_budget ? parseFloat(ad.target_max_budget) : null;
    const budgetMatch =
      budget == null ||
      ((minBudget == null || budget >= minBudget) && (maxBudget == null || budget <= maxBudget));

    if (!roleMatch) return -9999;
    if (!countryMatch) return -9999;
    if (!cityMatch) return -9999;
    if (!categoryMatch) return -9999;
    if (!langMatch) return -9999;
    if (!budgetMatch) return -9999;

    score += ad.priority * 10;
    if (roleMatch) score += 8;
    if (countryMatch) score += 6;
    if (cityMatch) score += 5;
    if (categoryMatch) score += 7;
    if (langMatch) score += 4;
    if (budgetMatch) score += 5;

    // Basic quality score with guard against early noisy CTR.
    const impressions = ad.impressions ?? 0;
    const clicks = ad.clicks ?? 0;
    if (impressions >= 20) {
      const ctr = clicks / Math.max(impressions, 1);
      score += ctr * 20;
    }
    return score;
  }

  rank(ads: AdvertisementRow[], input: AdCenterResolveInput): AdvertisementRow[] {
    const ctx = this.normalize(input);
    return [...ads]
      .map((ad) => ({ ad, score: this.score(ad, ctx) }))
      .filter((x) => x.score > -9000)
      .sort((a, b) => b.score - a.score || b.ad.priority - a.ad.priority)
      .map((x) => x.ad);
  }
}

