import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  AdPricingRuleRow,
  AdvertisementPlanRow,
  AdvertisementRow,
} from './advertisements.types.js';
import type {
  AdminPricingOverrideInput,
  AdminScheduleInput,
  CreateAdInput,
  CreatePricingRuleInput,
  ListAdsQueryInput,
  UpdateAdInput,
  UpdatePricingRuleInput,
} from './advertisements.validation.js';

export class AdvertisementsRepository {
  async listPlans(): Promise<AdvertisementPlanRow[]> {
    const { rows } = await getPool().query<AdvertisementPlanRow>(
      `SELECT * FROM advertisement_plans WHERE is_active = true ORDER BY duration_days ASC, price ASC`,
    );
    return rows;
  }

  async getPlanById(id: string): Promise<AdvertisementPlanRow | null> {
    const { rows } = await getPool().query<AdvertisementPlanRow>(
      `SELECT * FROM advertisement_plans WHERE id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createAd(advertiserId: string, input: CreateAdInput): Promise<AdvertisementRow> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `INSERT INTO advertisements (
        advertiser_id, ad_plan_id, title_en, title_ar, description_en, description_ar, image_url,
        cta_text_en, cta_text_ar, link_type, link_target, starts_at, status, priority,
        target_roles, target_countries, target_cities, target_categories, target_languages,
        target_min_budget, target_max_budget
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, 'pending_payment', $13,
        $14::text[], $15::text[], $16::text[], $17::uuid[], $18::text[],
        $19, $20
      ) RETURNING *`,
      [
        advertiserId,
        input.adPlanId,
        input.titleEn,
        input.titleAr ?? null,
        input.descriptionEn ?? null,
        input.descriptionAr ?? null,
        input.imageUrl,
        input.ctaTextEn ?? null,
        input.ctaTextAr ?? null,
        input.linkType,
        input.linkTarget ?? null,
        input.startsAt ?? null,
        input.priority ?? 0,
        input.targetRoles ?? [],
        input.targetCountries ?? [],
        input.targetCities ?? [],
        input.targetCategories ?? [],
        input.targetLanguages ?? [],
        input.targetMinBudget ?? null,
        input.targetMaxBudget ?? null,
      ],
    );
    return rows[0]!;
  }

  async getAdById(id: string): Promise<AdvertisementRow | null> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT a.*, COALESCE(u.display_name, u.email) AS advertiser_name
       FROM advertisements a
       JOIN users u ON u.id = a.advertiser_id
       WHERE a.id = $1 LIMIT 1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listMyAds(advertiserId: string, query: ListAdsQueryInput): Promise<{ rows: AdvertisementRow[]; total: number }> {
    const offset = (query.page - 1) * query.limit;
    const statusFilter = query.status ? `AND status = $4` : '';
    const args = query.status
      ? [advertiserId, query.limit, offset, query.status]
      : [advertiserId, query.limit, offset];
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT * FROM advertisements WHERE advertiser_id = $1 ${statusFilter}
       ORDER BY created_at DESC LIMIT $2::int OFFSET $3::int`,
      args,
    );
    const countArgs = query.status ? [advertiserId, query.status] : [advertiserId];
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM advertisements WHERE advertiser_id = $1 ${
        query.status ? 'AND status = $2' : ''
      }`,
      countArgs,
    );
    return { rows, total: parseInt(countRows[0]?.count ?? '0', 10) };
  }

  async listAllAds(query: ListAdsQueryInput): Promise<{ rows: AdvertisementRow[]; total: number }> {
    const offset = (query.page - 1) * query.limit;
    const filters: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (query.status) {
      filters.push(`a.status = $${idx++}`);
      params.push(query.status);
    }
    if (query.advertiserId) {
      filters.push(`a.advertiser_id = $${idx++}`);
      params.push(query.advertiserId);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT a.*, COALESCE(u.display_name, u.email) AS advertiser_name
       FROM advertisements a
       JOIN users u ON u.id = a.advertiser_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx++}::int OFFSET $${idx++}::int`,
      [...params, query.limit, offset],
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM advertisements a ${where}`,
      params,
    );
    return { rows, total: parseInt(countRows[0]?.count ?? '0', 10) };
  }

  async updateAd(id: string, input: UpdateAdInput): Promise<AdvertisementRow | null> {
    const fields: Record<string, unknown> = {
      ...(input.titleEn !== undefined ? { title_en: input.titleEn } : {}),
      ...(input.titleAr !== undefined ? { title_ar: input.titleAr } : {}),
      ...(input.descriptionEn !== undefined ? { description_en: input.descriptionEn } : {}),
      ...(input.descriptionAr !== undefined ? { description_ar: input.descriptionAr } : {}),
      ...(input.imageUrl !== undefined ? { image_url: input.imageUrl } : {}),
      ...(input.ctaTextEn !== undefined ? { cta_text_en: input.ctaTextEn } : {}),
      ...(input.ctaTextAr !== undefined ? { cta_text_ar: input.ctaTextAr } : {}),
      ...(input.linkType !== undefined ? { link_type: input.linkType } : {}),
      ...(input.linkTarget !== undefined ? { link_target: input.linkTarget } : {}),
      ...(input.startsAt !== undefined ? { starts_at: input.startsAt } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.targetRoles !== undefined ? { target_roles: input.targetRoles } : {}),
      ...(input.targetCountries !== undefined ? { target_countries: input.targetCountries } : {}),
      ...(input.targetCities !== undefined ? { target_cities: input.targetCities } : {}),
      ...(input.targetCategories !== undefined ? { target_categories: input.targetCategories } : {}),
      ...(input.targetLanguages !== undefined ? { target_languages: input.targetLanguages } : {}),
      ...(input.targetMinBudget !== undefined ? { target_min_budget: input.targetMinBudget } : {}),
      ...(input.targetMaxBudget !== undefined ? { target_max_budget: input.targetMaxBudget } : {}),
    };
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.getAdById(id);
    const setSql = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = keys.map((key) => fields[key]);
    const { rows } = await getPool().query<AdvertisementRow>(
      `UPDATE advertisements SET ${setSql}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return rows[0] ?? null;
  }

  async cancelAd(id: string): Promise<void> {
    await getPool().query(`UPDATE advertisements SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
  }

  async activatePaidAdInTx(
    client: PoolClient,
    adId: string,
    amountPaid: number,
    startsAt: Date,
    expiresAt: Date,
  ): Promise<void> {
    await client.query(
      `UPDATE advertisements
       SET status = 'active',
           amount_paid = $2,
           starts_at = $3,
           expires_at = $4,
           updated_at = now()
       WHERE id = $1`,
      [adId, amountPaid, startsAt.toISOString(), expiresAt.toISOString()],
    );
  }

  async expireStaleAds(): Promise<void> {
    await getPool().query(
      `UPDATE advertisements
       SET status = 'expired', updated_at = now()
       WHERE status = 'active'
         AND COALESCE(admin_forced_expires_at, expires_at) IS NOT NULL
         AND COALESCE(admin_forced_expires_at, expires_at) <= now()`,
    );
  }

  async listActiveAdsForAdCenter(limit: number): Promise<AdvertisementRow[]> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT *
       FROM advertisements
       WHERE status = 'active'
         AND COALESCE(admin_forced_starts_at, starts_at, now()) <= now()
         AND COALESCE(admin_forced_expires_at, expires_at, now() + interval '100 years') > now()
       ORDER BY priority DESC, created_at DESC
       LIMIT $1::int`,
      [limit],
    );
    return rows;
  }

  async incrementClick(id: string): Promise<void> {
    await getPool().query(
      `UPDATE advertisements SET clicks = clicks + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async incrementImpression(id: string): Promise<void> {
    await getPool().query(
      `UPDATE advertisements SET impressions = impressions + 1, updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async applyAdminSchedule(id: string, input: AdminScheduleInput): Promise<AdvertisementRow | null> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `UPDATE advertisements
       SET admin_forced_starts_at = $2,
           admin_forced_expires_at = $3,
           admin_status_reason = $4,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, input.startsAt ?? null, input.expiresAt ?? null, input.reason ?? null],
    );
    return rows[0] ?? null;
  }

  async applyAdminPricingOverride(id: string, input: AdminPricingOverrideInput): Promise<AdvertisementRow | null> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `UPDATE advertisements SET admin_price_override = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, input.amount],
    );
    return rows[0] ?? null;
  }

  async listPricingRules(): Promise<AdPricingRuleRow[]> {
    const { rows } = await getPool().query<AdPricingRuleRow>(
      `SELECT * FROM ad_pricing_rules ORDER BY priority DESC, created_at DESC`,
    );
    return rows;
  }

  async createPricingRule(createdBy: string, input: CreatePricingRuleInput): Promise<AdPricingRuleRow> {
    const { rows } = await getPool().query<AdPricingRuleRow>(
      `INSERT INTO ad_pricing_rules (
        name, is_active, role_scope, country_scope, city_scope, category_scope,
        min_duration_days, max_duration_days, price_multiplier, flat_fee, starts_at, ends_at, priority, created_by
      ) VALUES (
        $1, $2, $3::text[], $4::text[], $5::text[], $6::uuid[],
        $7, $8, $9, $10, $11, $12, $13, $14
      ) RETURNING *`,
      [
        input.name,
        input.isActive ?? true,
        input.roleScope ?? [],
        input.countryScope ?? [],
        input.cityScope ?? [],
        input.categoryScope ?? [],
        input.minDurationDays ?? null,
        input.maxDurationDays ?? null,
        input.priceMultiplier ?? 1,
        input.flatFee ?? 0,
        input.startsAt ?? null,
        input.endsAt ?? null,
        input.priority ?? 0,
        createdBy,
      ],
    );
    return rows[0]!;
  }

  async updatePricingRule(id: string, input: UpdatePricingRuleInput): Promise<AdPricingRuleRow | null> {
    const fields: Record<string, unknown> = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
      ...(input.roleScope !== undefined ? { role_scope: input.roleScope } : {}),
      ...(input.countryScope !== undefined ? { country_scope: input.countryScope } : {}),
      ...(input.cityScope !== undefined ? { city_scope: input.cityScope } : {}),
      ...(input.categoryScope !== undefined ? { category_scope: input.categoryScope } : {}),
      ...(input.minDurationDays !== undefined ? { min_duration_days: input.minDurationDays } : {}),
      ...(input.maxDurationDays !== undefined ? { max_duration_days: input.maxDurationDays } : {}),
      ...(input.priceMultiplier !== undefined ? { price_multiplier: input.priceMultiplier } : {}),
      ...(input.flatFee !== undefined ? { flat_fee: input.flatFee } : {}),
      ...(input.startsAt !== undefined ? { starts_at: input.startsAt } : {}),
      ...(input.endsAt !== undefined ? { ends_at: input.endsAt } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    };
    const keys = Object.keys(fields);
    if (keys.length === 0) {
      const { rows } = await getPool().query<AdPricingRuleRow>(
        `SELECT * FROM ad_pricing_rules WHERE id = $1`,
        [id],
      );
      return rows[0] ?? null;
    }
    const setSql = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = keys.map((key) => fields[key]);
    const { rows } = await getPool().query<AdPricingRuleRow>(
      `UPDATE ad_pricing_rules SET ${setSql}, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    return rows[0] ?? null;
  }

  async disablePricingRule(id: string): Promise<void> {
    await getPool().query(`UPDATE ad_pricing_rules SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
  }
}

