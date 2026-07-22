import type {
  Coupon,
  CouponPreview,
  ProviderCouponCampaignPreview,
  ProviderCouponCampaignRequest,
  UserRole,
} from '@mohandishub/shared';
import type { PoolClient } from 'pg';

import { HttpError } from '../../utils/http-error.js';

import {
  CouponsRepository,
  type CouponCampaignRequestRow,
  type CouponRow,
} from './coupons.repository.js';
import type {
  AdminCouponInput,
  AdminCouponUpdateInput,
  CouponApplyInput,
  CouponPreviewInput,
  ProviderCouponCampaignInput,
} from './coupons.validation.js';

const toNumber = (value: string | null | number | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export class CouponsService {
  constructor(private readonly repo: CouponsRepository = new CouponsRepository()) {}

  async listAdmin(): Promise<Coupon[]> {
    return (await this.repo.listAdmin()).map((row) => this.toCoupon(row));
  }

  async createAdmin(input: AdminCouponInput): Promise<Coupon> {
    if (input.active && !input.fundingSource) {
      throw new HttpError({
        statusCode: 400,
        code: 'COUPON_FUNDING_REQUIRED',
        message: 'Funding source is required before a coupon can be activated.',
      });
    }
    this.assertFundingShares(
      input.fundingSource ?? null,
      input.providerSharePercent ?? null,
      input.platformSharePercent ?? null,
    );
    return this.toCoupon(await this.repo.createAdmin(input));
  }

  async updateAdmin(id: string, input: AdminCouponUpdateInput): Promise<Coupon> {
    if (input.active === true && !input.fundingSource) {
      const existing = await this.repo.findById(id);
      if (!existing?.funding_source) {
        throw new HttpError({
          statusCode: 400,
          code: 'COUPON_FUNDING_REQUIRED',
          message: 'Funding source is required before a coupon can be activated.',
        });
      }
    }
    this.assertFundingShares(
      input.fundingSource ?? null,
      input.providerSharePercent ?? null,
      input.platformSharePercent ?? null,
    );
    const row = await this.repo.updateAdmin(id, input);
    if (!row) {
      throw new HttpError({
        statusCode: 404,
        code: 'COUPON_NOT_FOUND',
        message: 'Coupon not found.',
      });
    }
    return this.toCoupon(row);
  }

  async preview(
    input: CouponPreviewInput,
    user: { id: string; role?: string },
  ): Promise<CouponPreview> {
    const selected = await this.selectBestCoupon(
      input,
      (user.role ?? 'customer') as UserRole,
      user.id,
    );
    if (!selected) {
      return this.invalidPreview(
        input,
        input.code ? 'Coupon is not valid for this purchase.' : 'No eligible coupon found.',
      );
    }
    return this.buildPreview(selected, input);
  }

  async apply(input: CouponApplyInput, user: { id: string; role?: string }) {
    return this.applyInternal(input, user);
  }

  async applyInTransaction(
    client: PoolClient,
    input: CouponApplyInput,
    user: { id: string; role?: string },
  ) {
    return this.applyInternal(input, user, client);
  }

  private async applyInternal(
    input: CouponApplyInput,
    user: { id: string; role?: string },
    client?: PoolClient,
  ) {
    const selected = await this.selectBestCoupon(
      input,
      (user.role ?? 'customer') as UserRole,
      user.id,
    );
    if (!selected) {
      throw new HttpError({
        statusCode: 400,
        code: 'COUPON_NOT_APPLICABLE',
        message: 'Coupon is not valid for this purchase.',
      });
    }
    const preview = this.buildPreview(selected, input);
    if (!preview.valid || preview.discountAmount <= 0) {
      throw new HttpError({
        statusCode: 400,
        code: 'COUPON_NOT_APPLICABLE',
        message: preview.reason ?? 'Coupon is not valid for this purchase.',
      });
    }
    const redemptionInput: Parameters<CouponsRepository['applyRedemption']>[0] = {
      coupon: selected,
      userId: user.id,
      preview,
      applyInput: input,
    };
    if (client) redemptionInput.client = client;
    const redemption = await this.repo.applyRedemption(redemptionInput);
    return { ...preview, redemptionId: redemption.id };
  }

  async previewProviderCampaign(
    user: { id: string; role?: string },
    input: Pick<ProviderCouponCampaignInput, 'requestedQuantity'>,
  ): Promise<ProviderCouponCampaignPreview> {
    this.assertProviderRole(user.role);
    const feePerCouponEgp = await this.repo.getCouponGenerationFeeEgp();
    const totalFeeEgp = Number((feePerCouponEgp * input.requestedQuantity).toFixed(2));
    const walletBalanceEgp = await this.repo.getWalletBalance(user.id);
    return {
      requestedQuantity: input.requestedQuantity,
      feePerCouponEgp,
      totalFeeEgp,
      walletBalanceEgp,
      canSubmit: walletBalanceEgp >= totalFeeEgp,
    };
  }

  async createProviderCampaign(
    user: { id: string; role?: string },
    input: ProviderCouponCampaignInput,
  ): Promise<ProviderCouponCampaignRequest> {
    this.assertProviderRole(user.role);
    if (input.surface !== 'service') {
      throw new HttpError({
        statusCode: 400,
        code: 'PROVIDER_COUPONS_SERVICE_ONLY',
        message: 'Provider coupon campaigns can only target services.',
      });
    }
    const preview = await this.previewProviderCampaign(user, input);
    if (!preview.canSubmit) {
      throw new HttpError({
        statusCode: 400,
        code: 'INSUFFICIENT_WALLET_BALANCE',
        message: 'Wallet balance is not enough to pay the coupon generation fee.',
      });
    }
    const row = await this.repo.createProviderCampaignRequest({
      userId: user.id,
      campaign: input,
      feePerCouponEgp: preview.feePerCouponEgp,
      totalFeeEgp: preview.totalFeeEgp,
    });
    return this.toCampaignRequest(row);
  }

  async listMyCampaigns(user: {
    id: string;
    role?: string;
  }): Promise<ProviderCouponCampaignRequest[]> {
    this.assertProviderRole(user.role);
    return (await this.repo.listMyCampaignRequests(user.id)).map((row) =>
      this.toCampaignRequest(row),
    );
  }

  async listAdminCampaigns(status?: string): Promise<ProviderCouponCampaignRequest[]> {
    return (await this.repo.listAdminCampaignRequests(status)).map((row) =>
      this.toCampaignRequest(row),
    );
  }

  async approveCampaign(
    campaignId: string,
    adminId: string,
    reason: string,
  ): Promise<ProviderCouponCampaignRequest> {
    try {
      return this.toCampaignRequest(
        await this.repo.approveCampaignRequest({ campaignId, adminId, reason }),
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'CAMPAIGN_NOT_FOUND') {
        throw new HttpError({
          statusCode: 404,
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Pending campaign not found.',
        });
      }
      throw err;
    }
  }

  async rejectCampaign(
    campaignId: string,
    adminId: string,
    reason: string,
  ): Promise<ProviderCouponCampaignRequest> {
    try {
      return this.toCampaignRequest(
        await this.repo.rejectCampaignRequest({ campaignId, adminId, reason }),
      );
    } catch (err) {
      if (err instanceof Error && err.message === 'CAMPAIGN_NOT_FOUND') {
        throw new HttpError({
          statusCode: 404,
          code: 'CAMPAIGN_NOT_FOUND',
          message: 'Pending campaign not found.',
        });
      }
      throw err;
    }
  }

  private async selectBestCoupon(
    input: CouponPreviewInput,
    role: UserRole,
    userId: string,
  ): Promise<CouponRow | null> {
    const query: {
      code?: string;
      surface: CouponPreviewInput['surface'];
      currency: string;
      role: UserRole;
    } = {
      surface: input.surface,
      currency: input.currency ?? 'EGP',
      role,
    };
    if (input.code) query.code = input.code;
    const candidates = await this.repo.findCandidates(query);
    let best: { row: CouponRow; discount: number } | null = null;
    for (const row of candidates) {
      const preview = this.buildPreview(row, input);
      if (!preview.valid) continue;
      const userUses = await this.repo.countUserRedemptions(row.id, userId);
      if (row.max_uses_per_user != null && userUses >= row.max_uses_per_user) continue;
      if (!best || preview.discountAmount > best.discount) {
        best = { row, discount: preview.discountAmount };
      }
    }
    return best?.row ?? null;
  }

  private buildPreview(row: CouponRow, input: CouponPreviewInput): CouponPreview {
    const subtotal = Math.max(0, input.subtotal);
    const commission = Math.max(0, input.commissionAmount ?? 0);
    const minSpend = toNumber(row.min_spend) ?? 0;
    if (subtotal < minSpend) return this.invalidPreview(input, 'Minimum spend is not met.', row);
    const value = Number(row.value);
    const serviceEligible =
      row.discount_target === 'service_price' || row.discount_target === 'both' ? subtotal : 0;
    const commissionEligible =
      row.discount_target === 'platform_commission' || row.discount_target === 'both'
        ? commission
        : 0;
    const eligible = serviceEligible + commissionEligible;
    let discount = row.type === 'percent' ? eligible * (value / 100) : value;
    const maxDiscount = toNumber(row.max_discount);
    if (maxDiscount != null) discount = Math.min(discount, maxDiscount);
    discount = Math.min(eligible, Math.max(0, Number(discount.toFixed(2))));
    const serviceDiscount =
      eligible > 0
        ? Number(
            Math.min(
              serviceEligible,
              row.type === 'percent'
                ? serviceEligible * (value / 100)
                : Math.min(discount, serviceEligible),
            ).toFixed(2),
          )
        : 0;
    const commissionDiscount = Number((discount - serviceDiscount).toFixed(2));
    const providerShare = this.providerFundingShare(row);
    const providerFundedAmount = Number((discount * providerShare).toFixed(2));
    const platformFundedAmount = Number((discount - providerFundedAmount).toFixed(2));
    if (input.surface === 'service' && platformFundedAmount > Number(commission.toFixed(2))) {
      return this.invalidPreview(
        input,
        'The platform-funded discount exceeds the available platform commission.',
        row,
      );
    }
    return {
      valid: discount > 0,
      code: row.code,
      couponId: row.id,
      discountAmount: discount,
      serviceDiscountAmount: serviceDiscount,
      commissionDiscountAmount: commissionDiscount,
      finalServiceAmount: Number((subtotal - serviceDiscount).toFixed(2)),
      finalCommissionAmount: Number((commission - commissionDiscount).toFixed(2)),
      finalAmount: Number((subtotal - discount).toFixed(2)),
      currency: row.currency ?? input.currency ?? 'EGP',
      fundingSource: row.funding_source,
      discountTarget: row.discount_target,
      providerFundedAmount,
      platformFundedAmount,
      ...(discount > 0 ? {} : { reason: 'Coupon has no discount for this purchase.' }),
    };
  }

  private invalidPreview(
    input: CouponPreviewInput,
    reason: string,
    row?: CouponRow,
  ): CouponPreview {
    return {
      valid: false,
      code: row?.code ?? input.code ?? null,
      couponId: row?.id ?? null,
      discountAmount: 0,
      serviceDiscountAmount: 0,
      commissionDiscountAmount: 0,
      finalAmount: input.subtotal,
      finalServiceAmount: input.subtotal,
      finalCommissionAmount: input.commissionAmount ?? 0,
      currency: input.currency ?? row?.currency ?? 'EGP',
      fundingSource: row?.funding_source ?? null,
      discountTarget: row?.discount_target ?? null,
      providerFundedAmount: 0,
      platformFundedAmount: 0,
      reason,
    };
  }

  private providerFundingShare(row: CouponRow): number {
    if (row.funding_source === 'provider') return 1;
    if (row.funding_source === 'platform') return 0;
    if (row.funding_source === 'split') return (toNumber(row.provider_share_percent) ?? 50) / 100;
    return 0;
  }

  private assertFundingShares(
    fundingSource: string | null,
    providerSharePercent: number | null,
    platformSharePercent: number | null,
  ): void {
    if (fundingSource !== 'split') return;
    const provider = providerSharePercent ?? 50;
    const platform = platformSharePercent ?? 100 - provider;
    if (Math.abs(provider + platform - 100) > 0.001) {
      throw new HttpError({
        statusCode: 400,
        code: 'INVALID_FUNDING_SPLIT',
        message: 'Split-funded coupons must have provider and platform shares totaling 100%.',
      });
    }
  }

  private assertProviderRole(role?: string): void {
    if (role !== 'expert' && role !== 'craftsman' && role !== 'business') {
      throw new HttpError({
        statusCode: 403,
        code: 'PROVIDER_ROLE_REQUIRED',
        message: 'Only providers can request coupon campaigns.',
      });
    }
  }

  private toCoupon(row: CouponRow): Coupon {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: Number(row.value),
      currency: row.currency ?? 'EGP',
      targetSurface: row.target_surface,
      discountTarget: row.discount_target,
      fundingSource: row.funding_source,
      providerSharePercent: toNumber(row.provider_share_percent),
      platformSharePercent: toNumber(row.platform_share_percent),
      minSpend: toNumber(row.min_spend),
      maxDiscount: toNumber(row.max_discount),
      maxUses: row.max_uses,
      maxUsesPerUser: row.max_uses_per_user,
      useCount: row.use_count,
      allowedRoles: Array.isArray(row.allowed_roles) ? row.allowed_roles : [],
      active: row.active,
      providerCampaignRequestId: row.provider_campaign_request_id,
      generatedQuantity: row.generated_quantity,
      feePerCouponEgp: toNumber(row.fee_per_coupon_egp),
      generationFeeTransactionId: row.generation_fee_transaction_id,
      auditStatus: row.audit_status,
      validFrom: row.valid_from.toISOString(),
      validUntil: row.valid_until?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  private toCampaignRequest(row: CouponCampaignRequestRow): ProviderCouponCampaignRequest {
    return {
      id: row.id,
      providerId: row.provider_id,
      requestedBy: row.requested_by,
      couponId: row.coupon_id,
      status: row.status,
      requestedQuantity: row.requested_quantity,
      feePerCouponEgp: Number(row.fee_per_coupon_egp),
      totalFeeEgp: Number(row.total_fee_egp),
      feeTransactionId: row.fee_transaction_id,
      couponConfig: row.coupon_config,
      adminReason: row.admin_reason,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
