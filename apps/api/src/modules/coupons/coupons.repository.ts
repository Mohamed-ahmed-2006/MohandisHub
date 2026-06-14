import type { CouponTargetSurface, UserRole } from '@mohandishub/shared';
import type { Pool, PoolClient } from 'pg';

import { getPool } from '../../db/pool.js';

import type {
  AdminCouponInput,
  AdminCouponUpdateInput,
  CouponApplyInput,
  ProviderCouponCampaignInput,
} from './coupons.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

export type CouponRow = {
  id: string;
  code: string;
  type: 'fixed' | 'percent';
  value: string;
  currency: string | null;
  target_surface: CouponTargetSurface;
  discount_target: 'service_price' | 'platform_commission' | 'both';
  funding_source: 'platform' | 'provider' | 'split' | null;
  provider_share_percent: string | null;
  platform_share_percent: string | null;
  min_spend: string | null;
  max_discount: string | null;
  max_uses: number | null;
  max_uses_per_user: number | null;
  use_count: number;
  allowed_roles: UserRole[] | null;
  active: boolean;
  provider_campaign_request_id: string | null;
  generated_quantity: number | null;
  fee_per_coupon_egp: string | null;
  generation_fee_transaction_id: string | null;
  audit_status: 'admin_created' | 'provider_requested' | 'approved' | 'rejected' | 'disabled';
  valid_from: Date;
  valid_until: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type CouponCampaignRequestRow = {
  id: string;
  provider_id: string;
  requested_by: string;
  coupon_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  requested_quantity: number;
  fee_per_coupon_egp: string;
  total_fee_egp: string;
  fee_transaction_id: string | null;
  coupon_config: Record<string, unknown>;
  admin_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export class CouponsRepository {
  constructor(private readonly db: Pool = getPool()) {}

  async listAdmin(): Promise<CouponRow[]> {
    const { rows } = await this.db.query<CouponRow>(
      `SELECT *
       FROM coupons
       ORDER BY created_at DESC`,
    );
    return rows;
  }

  async createAdmin(input: AdminCouponInput): Promise<CouponRow> {
    const { rows } = await this.db.query<CouponRow>(
      `INSERT INTO coupons (
         code, type, value, currency, target_surface, discount_target, funding_source,
         provider_share_percent, platform_share_percent, min_spend, max_discount, max_uses,
         max_uses_per_user, allowed_roles, active, valid_from, valid_until
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,COALESCE($16::timestamptz, now()),$17)
       RETURNING *`,
      [
        input.code,
        input.type,
        input.value,
        input.currency,
        input.targetSurface,
        input.discountTarget,
        input.fundingSource ?? null,
        input.providerSharePercent ?? null,
        input.platformSharePercent ?? null,
        input.minSpend ?? null,
        input.maxDiscount ?? null,
        input.maxUses ?? null,
        input.maxUsesPerUser ?? null,
        JSON.stringify(input.allowedRoles ?? []),
        input.active && Boolean(input.fundingSource),
        input.validFrom ?? null,
        input.validUntil ?? null,
      ],
    );
    if (!rows[0]) throw new Error('Coupon create failed');
    return rows[0];
  }

  async updateAdmin(id: string, input: AdminCouponUpdateInput): Promise<CouponRow | null> {
    const pairs: Array<[string, unknown]> = [];
    const map: Record<string, string> = {
      code: 'code',
      type: 'type',
      value: 'value',
      currency: 'currency',
      targetSurface: 'target_surface',
      discountTarget: 'discount_target',
      fundingSource: 'funding_source',
      providerSharePercent: 'provider_share_percent',
      platformSharePercent: 'platform_share_percent',
      minSpend: 'min_spend',
      maxDiscount: 'max_discount',
      maxUses: 'max_uses',
      maxUsesPerUser: 'max_uses_per_user',
      active: 'active',
      validFrom: 'valid_from',
      validUntil: 'valid_until',
    };
    for (const [key, value] of Object.entries(input)) {
      if (key === 'allowedRoles') {
        pairs.push(['allowed_roles', JSON.stringify(value ?? [])]);
      } else if (key in map) {
        pairs.push([map[key]!, value ?? null]);
      }
    }
    if (pairs.length === 0) return this.findById(id);
    const sets = pairs.map(([column], i) => `${column} = $${i + 1}`).join(', ');
    const params = pairs.map(([, value]) => value);
    params.push(id);
    const { rows } = await this.db.query<CouponRow>(
      `UPDATE coupons
       SET ${sets}, updated_at = now(),
           active = CASE WHEN funding_source IS NULL THEN false ELSE active END,
           platform_share_percent = CASE
             WHEN funding_source = 'split' AND platform_share_percent IS NULL
             THEN 100 - COALESCE(provider_share_percent, 0)
             ELSE platform_share_percent
           END
       WHERE id = $${params.length}
       RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }

  async findById(id: string): Promise<CouponRow | null> {
    const { rows } = await this.db.query<CouponRow>('SELECT * FROM coupons WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findCandidates(input: {
    code?: string;
    surface: CouponTargetSurface;
    currency: string;
    role: UserRole;
  }): Promise<CouponRow[]> {
    const params: unknown[] = [input.surface, input.currency, input.role];
    const codeClause = input.code ? `AND upper(code) = upper($4)` : '';
    if (input.code) params.push(input.code);
    const { rows } = await this.db.query<CouponRow>(
      `SELECT *
       FROM coupons
       WHERE active = true
         AND funding_source IS NOT NULL
         AND currency = $2
         AND (target_surface = $1 OR target_surface = 'all')
         AND valid_from <= now()
         AND (valid_until IS NULL OR valid_until > now())
         AND (max_uses IS NULL OR use_count < max_uses)
         AND (
           jsonb_array_length(COALESCE(allowed_roles, '[]'::jsonb)) = 0
           OR allowed_roles ? $3
         )
         ${codeClause}
       ORDER BY created_at DESC`,
      params,
    );
    return rows;
  }

  async countUserRedemptions(couponId: string, userId: string): Promise<number> {
    const { rows } = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM coupon_redemptions
       WHERE coupon_id = $1 AND user_id = $2`,
      [couponId, userId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async applyRedemption(input: {
    coupon: CouponRow;
    userId: string;
    preview: {
      discountAmount: number;
      finalAmount: number;
      serviceDiscountAmount: number;
      commissionDiscountAmount: number;
      providerFundedAmount: number;
      platformFundedAmount: number;
    };
    applyInput: CouponApplyInput;
    client?: PoolClient;
  }) {
    const client = input.client ?? (await this.db.connect());
    const ownsTransaction = input.client == null;
    try {
      if (ownsTransaction) await client.query('BEGIN');
      const locked = await this.lockCoupon(client, input.coupon.id);
      if (!locked) throw new Error('Coupon not found');
      const redemptions = await this.countUserRedemptionsForClient(
        client,
        input.coupon.id,
        input.userId,
      );
      if (locked.max_uses_per_user != null && redemptions >= locked.max_uses_per_user) {
        throw new Error('COUPON_USER_LIMIT_REACHED');
      }
      if (locked.max_uses != null && locked.use_count >= locked.max_uses) {
        throw new Error('COUPON_LIMIT_REACHED');
      }
      const { rows } = await client.query(
        `INSERT INTO coupon_redemptions (
           coupon_id, user_id, surface, item_id, provider_id, subtotal,
           discount_amount, final_amount, currency, funding_source, source_reference,
           discount_target, service_subtotal, commission_subtotal,
           service_discount_amount, commission_discount_amount,
           provider_funded_amount, platform_funded_amount
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id`,
        [
          input.coupon.id,
          input.userId,
          input.applyInput.surface,
          input.applyInput.itemId ?? null,
          input.applyInput.providerId ?? null,
          input.applyInput.subtotal,
          input.preview.discountAmount,
          input.preview.finalAmount,
          input.applyInput.currency ?? 'EGP',
          input.coupon.funding_source,
          input.applyInput.sourceReference ?? null,
          input.coupon.discount_target,
          input.applyInput.subtotal,
          input.applyInput.commissionAmount ?? 0,
          input.preview.serviceDiscountAmount,
          input.preview.commissionDiscountAmount,
          input.preview.providerFundedAmount,
          input.preview.platformFundedAmount,
        ],
      );
      await client.query(
        'UPDATE coupons SET use_count = use_count + 1, updated_at = now() WHERE id = $1',
        [input.coupon.id],
      );
      if (ownsTransaction) await client.query('COMMIT');
      return rows[0] as { id: string };
    } catch (err) {
      if (ownsTransaction) await client.query('ROLLBACK');
      throw err;
    } finally {
      if (ownsTransaction) client.release();
    }
  }

  async getCouponGenerationFeeEgp(): Promise<number> {
    const { rows } = await this.db.query<{ coupon_generation_fee_egp: string }>(
      `SELECT coupon_generation_fee_egp::text FROM app_settings LIMIT 1`,
    );
    return parseFloat(rows[0]?.coupon_generation_fee_egp ?? '0.25');
  }

  async getWalletBalance(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ balance: string }>(
      `SELECT balance::text FROM wallets WHERE user_id = $1`,
      [userId],
    );
    return parseFloat(rows[0]?.balance ?? '0');
  }

  async createProviderCampaignRequest(input: {
    userId: string;
    campaign: ProviderCouponCampaignInput;
    feePerCouponEgp: number;
    totalFeeEgp: number;
  }): Promise<CouponCampaignRequestRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const providerWallet = await this.getOrCreateWalletForUser(client, input.userId);
      const currentBalance = parseFloat(providerWallet.balance);
      if (currentBalance < input.totalFeeEgp) {
        throw new Error('INSUFFICIENT_WALLET_BALANCE');
      }

      const providerBalanceAfter = Number((currentBalance - input.totalFeeEgp).toFixed(2));
      await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [
        providerBalanceAfter,
        providerWallet.id,
      ]);
      const { rows: debitRows } = await client.query<{ id: string }>(
        `INSERT INTO transactions
           (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, metadata)
         VALUES ($1, $2, 'payment', $3, $4, 'completed', $5, 'coupon_campaign_fee', $6)
         RETURNING id`,
        [
          providerWallet.id,
          input.userId,
          input.totalFeeEgp,
          providerBalanceAfter,
          `Coupon generation fee for ${input.campaign.requestedQuantity} coupons`,
          JSON.stringify({
            requested_quantity: input.campaign.requestedQuantity,
            fee_per_coupon_egp: input.feePerCouponEgp,
          }),
        ],
      );

      const platformWallet = await this.getOrCreateWalletForUser(client, PLATFORM_USER_ID);
      const platformBalanceAfter = Number(
        (parseFloat(platformWallet.balance) + input.totalFeeEgp).toFixed(2),
      );
      await client.query(`UPDATE wallets SET balance = $1 WHERE id = $2`, [
        platformBalanceAfter,
        platformWallet.id,
      ]);
      await client.query(
        `INSERT INTO transactions
           (wallet_id, user_id, type, amount, balance_after, status, description, reference_type, reference_id, metadata)
         VALUES ($1, $2, 'commission', $3, $4, 'completed', $5, 'coupon_campaign_fee', $6, $7)`,
        [
          platformWallet.id,
          PLATFORM_USER_ID,
          input.totalFeeEgp,
          platformBalanceAfter,
          'Coupon generation fee collected from provider',
          debitRows[0]!.id,
          JSON.stringify({ provider_id: input.userId }),
        ],
      );

      const { rows } = await client.query<CouponCampaignRequestRow>(
        `INSERT INTO coupon_campaign_requests
           (provider_id, requested_by, requested_quantity, fee_per_coupon_egp,
            total_fee_egp, fee_transaction_id, coupon_config)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          input.userId,
          input.userId,
          input.campaign.requestedQuantity,
          input.feePerCouponEgp,
          input.totalFeeEgp,
          debitRows[0]!.id,
          JSON.stringify(input.campaign),
        ],
      );
      await client.query('COMMIT');
      return rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async listMyCampaignRequests(userId: string): Promise<CouponCampaignRequestRow[]> {
    const { rows } = await this.db.query<CouponCampaignRequestRow>(
      `SELECT * FROM coupon_campaign_requests
       WHERE provider_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows;
  }

  async listAdminCampaignRequests(status?: string): Promise<CouponCampaignRequestRow[]> {
    const params: unknown[] = [];
    const statusClause = status ? 'WHERE status = $1' : '';
    if (status) params.push(status);
    const { rows } = await this.db.query<CouponCampaignRequestRow>(
      `SELECT * FROM coupon_campaign_requests
       ${statusClause}
       ORDER BY created_at DESC`,
      params,
    );
    return rows;
  }

  async approveCampaignRequest(input: {
    campaignId: string;
    adminId: string;
    reason: string;
  }): Promise<CouponCampaignRequestRow> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const { rows: campaignRows } = await client.query<CouponCampaignRequestRow>(
        `SELECT * FROM coupon_campaign_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
        [input.campaignId],
      );
      const campaign = campaignRows[0];
      if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
      const config = campaign.coupon_config as ProviderCouponCampaignInput;
      const { rows: couponRows } = await client.query<CouponRow>(
        `INSERT INTO coupons (
           code, type, value, currency, target_surface, discount_target, funding_source,
           provider_share_percent, platform_share_percent, max_uses, max_uses_per_user,
           allowed_roles, active, valid_from, valid_until, provider_campaign_request_id,
           generated_quantity, fee_per_coupon_egp, generation_fee_transaction_id, audit_status
         )
         VALUES ($1,$2,$3,$4,$5,$6,'provider',100,0,$7,$8,'["customer"]'::jsonb,true,now(),$9,$10,$11,$12,$13,'approved')
         RETURNING *`,
        [
          config.code,
          config.type,
          config.value,
          config.currency ?? 'EGP',
          config.surface,
          config.discountTarget,
          campaign.requested_quantity,
          config.maxUsesPerUser ?? null,
          config.validUntil ?? null,
          campaign.id,
          campaign.requested_quantity,
          campaign.fee_per_coupon_egp,
          campaign.fee_transaction_id,
        ],
      );
      const { rows } = await client.query<CouponCampaignRequestRow>(
        `UPDATE coupon_campaign_requests
         SET status = 'approved', coupon_id = $2, admin_reason = $3,
             reviewed_by = $4, reviewed_at = now(), updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [campaign.id, couponRows[0]!.id, input.reason, input.adminId],
      );
      await client.query('COMMIT');
      return rows[0]!;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async rejectCampaignRequest(input: {
    campaignId: string;
    adminId: string;
    reason: string;
  }): Promise<CouponCampaignRequestRow> {
    const { rows } = await this.db.query<CouponCampaignRequestRow>(
      `UPDATE coupon_campaign_requests
       SET status = 'rejected', admin_reason = $2, reviewed_by = $3,
           reviewed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [input.campaignId, input.reason, input.adminId],
    );
    if (!rows[0]) throw new Error('CAMPAIGN_NOT_FOUND');
    return rows[0];
  }

  private async getOrCreateWalletForUser(
    client: PoolClient,
    userId: string,
  ): Promise<{ id: string; balance: string }> {
    const { rows } = await client.query<{ id: string; balance: string }>(
      `INSERT INTO wallets (user_id, currency)
       VALUES ($1, 'EGP')
       ON CONFLICT (user_id) DO UPDATE SET user_id = wallets.user_id
       RETURNING id, balance::text`,
      [userId],
    );
    return rows[0]!;
  }

  private async lockCoupon(client: PoolClient, id: string): Promise<CouponRow | null> {
    const { rows } = await client.query<CouponRow>(
      'SELECT * FROM coupons WHERE id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] ?? null;
  }

  private async countUserRedemptionsForClient(
    client: PoolClient,
    couponId: string,
    userId: string,
  ): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM coupon_redemptions
       WHERE coupon_id = $1 AND user_id = $2`,
      [couponId, userId],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
