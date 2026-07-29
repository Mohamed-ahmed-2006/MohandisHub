import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type { AdPricingRuleRow, AdvertisementRow } from './advertisements.types.js';
import type {
  AdminPricingOverrideInput,
  AdminScheduleInput,
  CreateAdInput,
  CreatePricingRuleInput,
  ListAdsQueryInput,
  UpdateAdInput,
  UpdatePricingRuleInput,
} from './advertisements.validation.js';

const GLOBAL_AD_CONTROLS_RULE_NAME = '__GLOBAL_AD_CONTROLS__';

export class AdvertisementsRepository {
  /**
   * Whether new campaigns are being accepted. `flat_fee` on this row is the
   * legacy EGP price and is intentionally not read: pricing moved to
   * `mhc_action_prices.advertisement` in 20260729150000.
   */
  async getGlobalAdAcceptance(): Promise<boolean | null> {
    const { rows } = await getPool().query<{ is_active: boolean }>(
      `SELECT is_active
       FROM ad_pricing_rules
       WHERE name = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [GLOBAL_AD_CONTROLS_RULE_NAME],
    );
    return rows[0]?.is_active ?? null;
  }

  /**
   * Write the "accepting new campaigns" switch. The price is NOT written here
   * any more — it lives in `mhc_action_prices.advertisement`. `flat_fee` is
   * preserved at whatever value it already held so the historic EGP figure is
   * not silently rewritten by an admin editing the MHC price.
   */
  async upsertGlobalAdControls(adminId: string, acceptAds: boolean): Promise<void> {
    const existing = await getPool().query<{ id: string }>(
      `SELECT id FROM ad_pricing_rules WHERE name = $1 ORDER BY created_at DESC LIMIT 1`,
      [GLOBAL_AD_CONTROLS_RULE_NAME],
    );
    if (existing.rows[0]?.id) {
      await getPool().query(
        `UPDATE ad_pricing_rules
         SET is_active = $2,
             price_multiplier = 1,
             priority = 10000,
             updated_at = now()
         WHERE id = $1`,
        [existing.rows[0].id, acceptAds],
      );
      return;
    }
    await getPool().query(
      `INSERT INTO ad_pricing_rules (
        name, is_active, role_scope, country_scope, city_scope, category_scope,
        min_duration_days, max_duration_days, price_multiplier, flat_fee, starts_at, ends_at, priority, created_by
      ) VALUES (
        $1, $2, '{}'::text[], '{}'::text[], '{}'::text[], '{}'::uuid[],
        NULL, NULL, 1, 0, NULL, NULL, 10000, $3
      )`,
      [GLOBAL_AD_CONTROLS_RULE_NAME, acceptAds, adminId],
    );
  }

  /**
   * The MHC price an advertisement costs, straight from the admin-configurable
   * catalogue. `advertisement_plans.price` and `ad_pricing_rules.flat_fee` are
   * legacy EGP fields and are deliberately NOT consulted (see 20260729150000).
   */
  async getAdvertisementMhcPrice(): Promise<{ mhcPrice: number; isActive: boolean } | null> {
    const { rows } = await getPool().query<{ mhc_price: string; is_active: boolean }>(
      `SELECT mhc_price::text, is_active FROM mhc_action_prices WHERE action_key = 'advertisement'`,
    );
    const row = rows[0];
    if (!row) return null;
    return { mhcPrice: parseFloat(row.mhc_price), isActive: row.is_active };
  }

  async setAdvertisementMhcPrice(mhcPrice: number): Promise<void> {
    await getPool().query(
      `INSERT INTO mhc_action_prices (action_key, name, mhc_price, is_active)
       VALUES ('advertisement', 'Advertisement', $1, true)
       ON CONFLICT (action_key) DO UPDATE
         SET mhc_price = EXCLUDED.mhc_price, is_active = true, updated_at = now()`,
      [mhcPrice],
    );
  }

  /**
   * The advertisement a previous attempt with this idempotency key created.
   * Read on the retry path after uq_advertisements_advertiser_idempotency has
   * already refused the duplicate insert.
   */
  async findAdByIdempotencyKey(
    advertiserId: string,
    idempotencyKey: string,
  ): Promise<AdvertisementRow | null> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT * FROM advertisements
       WHERE advertiser_id = $1 AND client_idempotency_key = $2
       LIMIT 1`,
      [advertiserId, idempotencyKey],
    );
    return rows[0] ?? null;
  }

  /**
   * Insert the advertisement with a PREALLOCATED id, so the caller can charge
   * MHC against it in the same transaction. `amount_paid` is written as 0: it is
   * a legacy EGP column, and the MHC actually charged is recorded in
   * `mhc_action_charges` keyed by this id.
   */
  async createAdInTx(
    client: PoolClient,
    advertiserId: string,
    input: CreateAdInput,
    startsAt: Date,
    expiresAt: Date,
    advertisementId: string,
    clientIdempotencyKey: string | null,
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `INSERT INTO advertisements (
        id, advertiser_id, title_en, title_ar, description_en, description_ar, image_url,
        cta_text_en, cta_text_ar, link_type, link_target, starts_at, expires_at, amount_paid, status, priority,
        target_roles, target_countries, target_cities, target_categories, target_languages,
        target_min_budget, target_max_budget, client_idempotency_key
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, 0, 'active', $14,
        $15::text[], $16::text[], $17::text[], $18::uuid[], $19::text[],
        $20, $21, $22
      ) RETURNING *`,
      [
        advertisementId,
        advertiserId,
        input.titleEn,
        input.titleAr ?? null,
        input.descriptionEn ?? null,
        input.descriptionAr ?? null,
        input.imageUrl,
        input.ctaTextEn ?? null,
        input.ctaTextAr ?? null,
        input.linkType,
        input.linkTarget ?? null,
        startsAt.toISOString(),
        expiresAt.toISOString(),
        input.priority ?? 0,
        input.targetRoles ?? [],
        input.targetCountries ?? [],
        input.targetCities ?? [],
        input.targetCategories ?? [],
        input.targetLanguages ?? [],
        input.targetMinBudget ?? null,
        input.targetMaxBudget ?? null,
        clientIdempotencyKey,
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

  async findAdForUpdate(client: PoolClient, id: string): Promise<AdvertisementRow | null> {
    const { rows } = await client.query<AdvertisementRow>(
      `SELECT *
       FROM advertisements
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listMyAds(
    advertiserId: string,
    query: ListAdsQueryInput,
  ): Promise<{ rows: AdvertisementRow[]; total: number }> {
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
      ...(input.targetCategories !== undefined
        ? { target_categories: input.targetCategories }
        : {}),
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
    await getPool().query(
      `UPDATE advertisements SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  async cancelAdInTx(
    client: PoolClient,
    id: string,
    reason: string,
  ): Promise<AdvertisementRow | null> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'cancelled',
           admin_status_reason = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, reason],
    );
    return rows[0] ?? null;
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

  async applyAdminSchedule(
    id: string,
    input: AdminScheduleInput,
  ): Promise<AdvertisementRow | null> {
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

  async applyAdminPricingOverride(
    id: string,
    input: AdminPricingOverrideInput,
  ): Promise<AdvertisementRow | null> {
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

  async createPricingRule(
    createdBy: string,
    input: CreatePricingRuleInput,
  ): Promise<AdPricingRuleRow> {
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

  async updatePricingRule(
    id: string,
    input: UpdatePricingRuleInput,
  ): Promise<AdPricingRuleRow | null> {
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
    await getPool().query(
      `UPDATE ad_pricing_rules SET is_active = false, updated_at = now() WHERE id = $1`,
      [id],
    );
  }
}
