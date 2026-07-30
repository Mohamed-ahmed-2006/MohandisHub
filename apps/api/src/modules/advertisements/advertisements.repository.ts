import type { PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  AdPricingRuleRow,
  AdRenewalSource,
  AdvertisementPeriodRow,
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

const GLOBAL_AD_CONTROLS_RULE_NAME = '__GLOBAL_AD_CONTROLS__';

/** One advertisement period is exactly seven times 24 hours. */
export const AD_PERIOD_HOURS = 168;
export const AD_PERIOD_MS = AD_PERIOD_HOURS * 60 * 60 * 1000;

/** Every period column, in a fixed order, for row reads. */
const PERIOD_COLUMNS = `id, advertisement_id, period_number, starts_at, ends_at,
  mhc_price_snapshot::text, action_charge_id, status, renewal_source,
  client_idempotency_key, created_at, updated_at`;

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
   * The MHC price of one advertisement WEEK, straight from the
   * admin-configurable catalogue. Read for DISPLAY only: charging re-resolves
   * the same row inside its own transaction, so what a screen shows can never
   * become what a provider is charged.
   *
   * `advertisement_plans.price` and `ad_pricing_rules.flat_fee` are legacy EGP
   * fields and are deliberately NOT consulted (see 20260729150000).
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
       VALUES ('advertisement', 'Advertisement week', $1, true)
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

  // -------------------------------------------------------------------------
  // Destination resolution
  // -------------------------------------------------------------------------
  // `advertisements_destination_check` requires a resolved provider or service
  // destination on every non-cancelled row. Nothing populated those columns
  // before weekly billing, which is why every create request failed on a raw
  // 23514 against the live schema.

  /** Is this account a provider whose profile may be advertised? */
  async isAdvertisableProvider(userId: string): Promise<boolean> {
    const { rows } = await getPool().query<{ ok: boolean }>(
      `SELECT true AS ok
       FROM users
       WHERE id = $1
         AND deleted_at IS NULL
         AND is_active = true
         AND primary_role IN ('expert', 'business', 'craftsman')
       LIMIT 1`,
      [userId],
    );
    return rows.length > 0;
  }

  /** The advertiser's own active service, or null if it is neither. */
  async findOwnedActiveServiceId(advertiserId: string, serviceId: string): Promise<string | null> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id FROM services
       WHERE id = $1 AND provider_id = $2 AND status = 'active'
       LIMIT 1`,
      [serviceId, advertiserId],
    );
    return rows[0]?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------

  /**
   * Insert a campaign awaiting review.
   *
   * Nothing financial happens here: no wallet is read, no wallet row is locked,
   * no period exists and `amount_paid` stays 0 (a legacy EGP column). The row is
   * `pending_review`, so no listing query can serve it.
   *
   * `duration_days` is written as 7 to satisfy the legacy 1..365 CHECK and to
   * state the truth — a campaign runs in seven-day weeks.
   */
  async createPendingAdInTx(
    client: PoolClient,
    advertiserId: string,
    input: CreateAdInput,
    startsAt: Date | null,
    advertisementId: string,
    clientIdempotencyKey: string | null,
    destination: { providerId: string | null; serviceId: string | null },
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `INSERT INTO advertisements (
        id, advertiser_id, title_en, title_ar, description_en, description_ar, image_url,
        cta_text_en, cta_text_ar, link_type, link_target, starts_at, expires_at,
        amount_paid, status, priority, duration_days,
        target_roles, target_countries, target_cities, target_categories, target_languages,
        target_min_budget, target_max_budget, client_idempotency_key,
        destination_provider_id, destination_service_id,
        billing_model, billing_status, renewal_mode
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, NULL,
        0, 'pending_review', $13, 7,
        $14::text[], $15::text[], $16::text[], $17::uuid[], $18::text[],
        $19, $20, $21,
        $22, $23,
        'weekly', 'pending_review', 'manual'
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
        startsAt ? startsAt.toISOString() : null,
        input.priority ?? 0,
        input.targetRoles ?? [],
        input.targetCountries ?? [],
        input.targetCities ?? [],
        input.targetCategories ?? [],
        input.targetLanguages ?? [],
        input.targetMinBudget ?? null,
        input.targetMaxBudget ?? null,
        clientIdempotencyKey,
        destination.providerId,
        destination.serviceId,
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
    const filters = ['advertiser_id = $1'];
    const params: unknown[] = [advertiserId];
    let idx = 2;
    if (query.status) {
      filters.push(`status = $${idx++}`);
      params.push(query.status);
    }
    if (query.billingStatus) {
      filters.push(`billing_status = $${idx++}`);
      params.push(query.billingStatus);
    }
    const where = `WHERE ${filters.join(' AND ')}`;
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT * FROM advertisements ${where}
       ORDER BY created_at DESC LIMIT $${idx++}::int OFFSET $${idx++}::int`,
      [...params, query.limit, offset],
    );
    const { rows: countRows } = await getPool().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM advertisements ${where}`,
      params,
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
    if (query.billingStatus) {
      filters.push(`a.billing_status = $${idx++}`);
      params.push(query.billingStatus);
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

  /** Update the destination columns alongside an edited link type. */
  async setDestination(
    id: string,
    destination: { providerId: string | null; serviceId: string | null },
  ): Promise<void> {
    await getPool().query(
      `UPDATE advertisements
       SET destination_provider_id = $2, destination_service_id = $3, updated_at = now()
       WHERE id = $1`,
      [id, destination.providerId, destination.serviceId],
    );
  }

  // -------------------------------------------------------------------------
  // Moderation
  // -------------------------------------------------------------------------

  /**
   * Record an admin rejection. No period, no charge, no refund — this method
   * writes to `advertisements` only, so there is no code path by which a
   * rejection could move credits.
   */
  async rejectAdInTx(
    client: PoolClient,
    id: string,
    adminId: string,
    reason: string,
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'rejected',
           billing_status = 'rejected',
           reviewed_by = $2,
           reviewed_at = now(),
           rejection_reason = $3,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminId, reason],
    );
    return rows[0]!;
  }

  /**
   * Record an admin approval WITHOUT activating anything.
   *
   * Called before the charge attempt, so that an approval survives a 402: the
   * charge primitive unwinds only to its own savepoint, leaving this write
   * intact for the caller to commit.
   */
  async recordApprovalInTx(
    client: PoolClient,
    id: string,
    adminId: string,
    billingStatus: 'awaiting_start' | 'awaiting_credits',
    reason: string | null,
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'scheduled',
           billing_status = $3,
           reviewed_by = $2,
           reviewed_at = now(),
           rejection_reason = NULL,
           admin_status_reason = COALESCE($4, admin_status_reason),
           content_locked_at = COALESCE(content_locked_at, now()),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, adminId, billingStatus, reason],
    );
    return rows[0]!;
  }

  /** Move an approved campaign to "approved, but no credits" without charging. */
  async markAwaitingCreditsInTx(client: PoolClient, id: string): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET billing_status = 'awaiting_credits',
           status = 'scheduled',
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id],
    );
    return rows[0]!;
  }

  // -------------------------------------------------------------------------
  // Periods
  // -------------------------------------------------------------------------

  /**
   * Insert one seven-day period, already ACTIVE.
   *
   * `ends_at` is computed in SQL as `starts_at + interval '168 hours'` so it is
   * derived by the same expression `chk_ad_period_exact_week` verifies — a
   * JavaScript Date cannot round it into a violation.
   */
  async insertActivePeriodInTx(
    client: PoolClient,
    params: {
      id: string;
      advertisementId: string;
      periodNumber: number;
      startsAt: Date;
      mhcPriceSnapshot: number;
      actionChargeId: string | null;
      renewalSource: AdRenewalSource;
      clientIdempotencyKey: string | null;
    },
  ): Promise<AdvertisementPeriodRow> {
    const { rows } = await client.query<AdvertisementPeriodRow>(
      `INSERT INTO advertisement_campaign_periods (
         id, advertisement_id, period_number, starts_at, ends_at,
         mhc_price_snapshot, action_charge_id, status, renewal_source, client_idempotency_key
       ) VALUES (
         $1, $2, $3, $4::timestamptz, $4::timestamptz + interval '168 hours',
         $5, $6, 'active', $7, $8
       )
       RETURNING ${PERIOD_COLUMNS}`,
      [
        params.id,
        params.advertisementId,
        params.periodNumber,
        params.startsAt.toISOString(),
        params.mhcPriceSnapshot,
        params.actionChargeId,
        params.renewalSource,
        params.clientIdempotencyKey,
      ],
    );
    return rows[0]!;
  }

  /**
   * Point the campaign at its newly active period.
   *
   * `starts_at`/`expires_at` are set to the period window, so the existing
   * serving query — which knows nothing about periods — cannot show a campaign
   * outside the week it was paid for.
   */
  async applyActivePeriodInTx(
    client: PoolClient,
    id: string,
    period: { startsAt: string; endsAt: string },
    countsAsRenewal: boolean,
  ): Promise<AdvertisementRow> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'active',
           billing_status = 'active',
           starts_at = $2::timestamptz,
           expires_at = $3::timestamptz,
           current_period_starts_at = $2::timestamptz,
           current_period_ends_at = $3::timestamptz,
           next_renewal_at = $3::timestamptz,
           manual_renewal_required = false,
           renewal_count = renewal_count + CASE WHEN $4::boolean THEN 1 ELSE 0 END,
           content_locked_at = COALESCE(content_locked_at, now()),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, period.startsAt, period.endsAt, countsAsRenewal],
    );
    return rows[0]!;
  }

  /** Highest period number allocated so far. 0 when the campaign has none. */
  async getMaxPeriodNumberInTx(client: PoolClient, advertisementId: string): Promise<number> {
    const { rows } = await client.query<{ n: string }>(
      `SELECT COALESCE(MAX(period_number), 0)::text AS n
       FROM advertisement_campaign_periods
       WHERE advertisement_id = $1`,
      [advertisementId],
    );
    return parseInt(rows[0]?.n ?? '0', 10);
  }

  async findActivePeriodInTx(
    client: PoolClient,
    advertisementId: string,
  ): Promise<AdvertisementPeriodRow | null> {
    const { rows } = await client.query<AdvertisementPeriodRow>(
      `SELECT ${PERIOD_COLUMNS}
       FROM advertisement_campaign_periods
       WHERE advertisement_id = $1 AND status = 'active'
       LIMIT 1`,
      [advertisementId],
    );
    return rows[0] ?? null;
  }

  /** The period a previous manual renewal with this idempotency key bought. */
  async findPeriodByIdempotencyKey(
    client: PoolClient,
    advertisementId: string,
    idempotencyKey: string,
  ): Promise<AdvertisementPeriodRow | null> {
    const { rows } = await client.query<AdvertisementPeriodRow>(
      `SELECT ${PERIOD_COLUMNS}
       FROM advertisement_campaign_periods
       WHERE advertisement_id = $1 AND client_idempotency_key = $2
       LIMIT 1`,
      [advertisementId, idempotencyKey],
    );
    return rows[0] ?? null;
  }

  async listPeriods(advertisementId: string, limit = 24): Promise<AdvertisementPeriodRow[]> {
    const { rows } = await getPool().query<AdvertisementPeriodRow>(
      `SELECT ${PERIOD_COLUMNS}
       FROM advertisement_campaign_periods
       WHERE advertisement_id = $1
       ORDER BY period_number DESC
       LIMIT $2::int`,
      [advertisementId, limit],
    );
    return rows;
  }

  async countPeriods(advertisementId: string): Promise<number> {
    const { rows } = await getPool().query<{ c: string }>(
      `SELECT count(*)::text AS c FROM advertisement_campaign_periods WHERE advertisement_id = $1`,
      [advertisementId],
    );
    return parseInt(rows[0]?.c ?? '0', 10);
  }

  // -------------------------------------------------------------------------
  // Expiration
  // -------------------------------------------------------------------------

  /**
   * Close every weekly period whose seven days have elapsed, and put its
   * campaign into "manual renewal required".
   *
   * `SKIP LOCKED` so two callers — the lazy sweep on the serving path today, a
   * scheduler in Wave 2F-B — never block on each other or double-process a row.
   * Nothing is refunded and no period row is deleted: an expired week was
   * served and is non-refundable.
   *
   * An admin pause is preserved. `paused_by_admin` stays paused while its
   * billing state still records that the week ended.
   */
  async expireDuePeriods(limit = 200): Promise<{ periods: number; campaigns: number }> {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const { rows: closed } = await client.query<{ advertisement_id: string }>(
        `UPDATE advertisement_campaign_periods p
         SET status = 'expired', updated_at = now()
         WHERE p.id IN (
           SELECT dp.id
           FROM advertisement_campaign_periods dp
           JOIN advertisements da ON da.id = dp.advertisement_id
           WHERE dp.status = 'active'
             AND dp.ends_at <= now()
             AND da.billing_model = 'weekly'
           ORDER BY dp.ends_at
           LIMIT $1::int
           FOR UPDATE OF dp SKIP LOCKED
         )
         RETURNING p.advertisement_id`,
        [limit],
      );
      const ids = [...new Set(closed.map((row) => row.advertisement_id))];
      let campaigns = 0;
      if (ids.length > 0) {
        const { rowCount } = await client.query(
          `UPDATE advertisements
           SET status = CASE WHEN status = 'active' THEN 'expired' ELSE status END,
               billing_status = 'renewal_required',
               manual_renewal_required = true,
               current_period_starts_at = NULL,
               current_period_ends_at = NULL,
               next_renewal_at = NULL,
               updated_at = now()
           WHERE id = ANY($1::uuid[])
             AND billing_model = 'weekly'
             AND billing_status = 'active'`,
          [ids],
        );
        campaigns = rowCount ?? 0;
      }
      await client.query('COMMIT');
      return { periods: closed.length, campaigns };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Approved campaigns whose scheduled start has arrived and which hold no paid
   * week yet. The read the Wave 2F-B scheduler will drive; this wave exposes it
   * so the activation service can be invoked deliberately.
   */
  async listDueScheduledAdIds(limit = 100): Promise<string[]> {
    const { rows } = await getPool().query<{ id: string }>(
      `SELECT id
       FROM advertisements
       WHERE billing_model = 'weekly'
         AND status = 'scheduled'
         AND billing_status IN ('awaiting_start', 'awaiting_credits')
         AND reviewed_at IS NOT NULL
         AND COALESCE(starts_at, now()) <= now()
       ORDER BY COALESCE(starts_at, created_at)
       LIMIT $1::int`,
      [limit],
    );
    return rows.map((row) => row.id);
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  /**
   * Cancel a weekly campaign: hide it immediately, close any running week, and
   * make sure nothing can renew it.
   *
   * No refund of any kind. A started week is non-refundable, and no EGP wallet
   * is read — the legacy prorated refund path is reachable only for
   * `billing_model = 'legacy'` campaigns, which were genuinely paid in EGP.
   */
  async cancelWeeklyAdInTx(
    client: PoolClient,
    id: string,
    reason: string,
  ): Promise<AdvertisementRow> {
    await client.query(
      `UPDATE advertisement_campaign_periods
       SET status = 'cancelled', updated_at = now()
       WHERE advertisement_id = $1 AND status IN ('active', 'scheduled')`,
      [id],
    );
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'cancelled',
           billing_status = 'cancelled',
           admin_status_reason = $2,
           manual_renewal_required = false,
           auto_renew_enabled = false,
           current_period_starts_at = NULL,
           current_period_ends_at = NULL,
           next_renewal_at = NULL,
           expires_at = LEAST(COALESCE(expires_at, now()), now()),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, reason],
    );
    return rows[0]!;
  }

  async cancelAd(id: string): Promise<void> {
    await getPool().query(
      `UPDATE advertisements SET status = 'cancelled', updated_at = now() WHERE id = $1`,
      [id],
    );
  }

  /** Legacy (EGP-era) cancellation. Retained for `billing_model = 'legacy'`. */
  async cancelAdInTx(
    client: PoolClient,
    id: string,
    reason: string,
  ): Promise<AdvertisementRow | null> {
    const { rows } = await client.query<AdvertisementRow>(
      `UPDATE advertisements
       SET status = 'cancelled',
           billing_status = CASE WHEN billing_model = 'weekly' THEN 'cancelled' ELSE billing_status END,
           admin_status_reason = $2,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, reason],
    );
    return rows[0] ?? null;
  }

  /**
   * Legacy expiry sweep. Scoped away from weekly campaigns on purpose: a weekly
   * campaign's expiry has to close its PERIOD too, which `expireDuePeriods`
   * does atomically. Flipping only the campaign status here would leave a paid
   * week marked active forever.
   */
  async expireStaleAds(): Promise<void> {
    await getPool().query(
      `UPDATE advertisements
       SET status = 'expired', updated_at = now()
       WHERE status = 'active'
         AND billing_model <> 'weekly'
         AND COALESCE(admin_forced_expires_at, expires_at) IS NOT NULL
         AND COALESCE(admin_forced_expires_at, expires_at) <= now()`,
    );
  }

  /**
   * Campaigns eligible to be shown right now.
   *
   * The `billing_status` clause is belt and braces: a weekly campaign's
   * `status`/`expires_at` are only ever set to a serving state by the activation
   * transaction, but this makes it impossible for a weekly campaign to serve
   * without a paid week even if some other path wrote `status = 'active'`.
   */
  async listActiveAdsForAdCenter(limit: number): Promise<AdvertisementRow[]> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `SELECT *
       FROM advertisements
       WHERE status = 'active'
         AND (billing_model <> 'weekly' OR billing_status = 'active')
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

  async applyAdminStatus(
    id: string,
    status: 'active' | 'paused_by_admin' | 'cancelled',
  ): Promise<AdvertisementRow | null> {
    const { rows } = await getPool().query<AdvertisementRow>(
      `UPDATE advertisements SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
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
