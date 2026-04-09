import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { AdCenterService } from './adcenter.service.js';
import { AdvertisementsRepository } from './advertisements.repository.js';
import type { AdvertisementRow } from './advertisements.types.js';
import type {
  AdCenterResolveInput,
  AdminPricingOverrideInput,
  AdminScheduleInput,
  CreateAdInput,
  CreatePricingRuleInput,
  ListAdsQueryInput,
  UpdateAdInput,
  UpdatePricingRuleInput,
} from './advertisements.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

export class AdvertisementsService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly adCenter: AdCenterService = new AdCenterService(),
  ) {}

  async listPlans() {
    return this.repo.listPlans();
  }

  async createAd(userId: string, input: CreateAdInput) {
    const plan = await this.repo.getPlanById(input.adPlanId);
    if (!plan || !plan.is_active) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_PLAN_NOT_FOUND',
        message: 'Advertisement plan not found.',
      });
    }
    return this.repo.createAd(userId, input);
  }

  async getAd(adId: string) {
    const ad = await this.repo.getAdById(adId);
    if (!ad) {
      throw new HttpError({ statusCode: 404, code: 'AD_NOT_FOUND', message: 'Advertisement not found.' });
    }
    return ad;
  }

  async listMyAds(userId: string, query: ListAdsQueryInput) {
    return this.repo.listMyAds(userId, query);
  }

  async listAllAds(query: ListAdsQueryInput) {
    return this.repo.listAllAds(query);
  }

  async updateAd(adId: string, userId: string, input: UpdateAdInput) {
    const ad = await this.getAd(adId);
    if (ad.advertiser_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'This ad does not belong to you.' });
    }
    if (ad.status !== 'pending_payment') {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_NOT_EDITABLE',
        message: 'Only pending-payment ads can be edited.',
      });
    }
    return this.repo.updateAd(adId, input);
  }

  async cancelAd(adId: string, userId: string) {
    const ad = await this.getAd(adId);
    if (ad.advertiser_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'This ad does not belong to you.' });
    }
    await this.repo.cancelAd(adId);
    return { cancelled: true };
  }

  private async calculatePayableAmount(ad: AdvertisementRow): Promise<number> {
    if (ad.admin_price_override != null) return parseFloat(ad.admin_price_override);
    if (!ad.ad_plan_id) return 0;
    const plan = await this.repo.getPlanById(ad.ad_plan_id);
    if (!plan) return 0;
    let amount = parseFloat(plan.price);
    const rules = await this.repo.listPricingRules();
    const activeRules = rules.filter((rule) => {
      if (!rule.is_active) return false;
      const now = Date.now();
      const startsAt = rule.starts_at ? new Date(rule.starts_at).getTime() : null;
      const endsAt = rule.ends_at ? new Date(rule.ends_at).getTime() : null;
      if (startsAt != null && now < startsAt) return false;
      if (endsAt != null && now > endsAt) return false;
      if (rule.role_scope.length > 0 && !rule.role_scope.includes('all')) {
        // Role filtering can be expanded with profile lookups if needed.
      }
      return true;
    });
    if (activeRules.length > 0) {
      const topRule = activeRules.sort((a, b) => b.priority - a.priority)[0]!;
      amount = amount * parseFloat(topRule.price_multiplier) + parseFloat(topRule.flat_fee);
    }
    return Math.max(0, amount);
  }

  async payAd(adId: string, userId: string) {
    const ad = await this.getAd(adId);
    if (ad.advertiser_id !== userId) {
      throw new HttpError({ statusCode: 403, code: 'FORBIDDEN', message: 'This ad does not belong to you.' });
    }
    if (ad.status !== 'pending_payment') {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_NOT_PAYABLE',
        message: 'Only pending-payment ads can be paid.',
      });
    }
    const amount = await this.calculatePayableAmount(ad);
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Wallet is required to pay for advertisement.',
      });
    }
    const plan = ad.ad_plan_id ? await this.repo.getPlanById(ad.ad_plan_id) : null;
    if (!plan) {
      throw new HttpError({
        statusCode: 400,
        code: 'PLAN_NOT_FOUND',
        message: 'Cannot activate ad without a valid plan.',
      });
    }
    const requestedStartAt = ad.starts_at ? new Date(ad.starts_at) : null;
    const now = new Date();
    const startsAt = requestedStartAt && requestedStartAt.getTime() > now.getTime() ? requestedStartAt : now;
    const expiresAt = new Date(startsAt.getTime() + plan.duration_days * 24 * 60 * 60 * 1000);

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const paymentTxId = await this.walletRepo.debitWalletInTransaction(
        client,
        wallet.id,
        userId,
        amount,
        `Advertisement payment: ${ad.title_en}`,
        'advertisement',
        ad.id,
      );
      const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(client, PLATFORM_USER_ID);
      await this.walletRepo.creditWithTypeInTransaction(
        client,
        platformWalletId,
        PLATFORM_USER_ID,
        amount,
        'commission',
        `Advertisement revenue`,
        'advertisement',
        ad.id,
      );
      await this.repo.activatePaidAdInTx(client, ad.id, amount, startsAt, expiresAt);
      await client.query(
        `UPDATE advertisements SET admin_status_reason = COALESCE(admin_status_reason, $2) WHERE id = $1`,
        [ad.id, `payment_tx:${paymentTxId}`],
      );
      await client.query('COMMIT');
      return { paid: true, amount, startsAt: startsAt.toISOString(), expiresAt: expiresAt.toISOString() };
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async resolveActiveAds(input: AdCenterResolveInput) {
    await this.repo.expireStaleAds();
    const limit = input.limit ?? 5;
    const candidates = await this.repo.listActiveAdsForAdCenter(100);
    const ranked = this.adCenter.rank(candidates, input).slice(0, limit);
    await Promise.all(ranked.map((ad) => this.repo.incrementImpression(ad.id)));
    return ranked;
  }

  async trackClick(adId: string) {
    await this.getAd(adId);
    await this.repo.incrementClick(adId);
    return { ok: true };
  }

  async applyAdminStatus(adId: string, status: 'active' | 'paused_by_admin' | 'cancelled', reason?: string) {
    const updated = await this.repo.updateAd(adId, { status });
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'AD_NOT_FOUND', message: 'Advertisement not found.' });
    }
    if (reason) {
      await this.repo.applyAdminSchedule(adId, { reason });
    }
    return updated;
  }

  async applyAdminSchedule(adId: string, input: AdminScheduleInput) {
    const updated = await this.repo.applyAdminSchedule(adId, input);
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'AD_NOT_FOUND', message: 'Advertisement not found.' });
    }
    return updated;
  }

  async applyAdminPricingOverride(adId: string, input: AdminPricingOverrideInput) {
    const updated = await this.repo.applyAdminPricingOverride(adId, input);
    if (!updated) {
      throw new HttpError({ statusCode: 404, code: 'AD_NOT_FOUND', message: 'Advertisement not found.' });
    }
    return updated;
  }

  async listPricingRules() {
    return this.repo.listPricingRules();
  }

  async createPricingRule(adminId: string, input: CreatePricingRuleInput) {
    return this.repo.createPricingRule(adminId, input);
  }

  async updatePricingRule(id: string, input: UpdatePricingRuleInput) {
    const updated = await this.repo.updatePricingRule(id, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_PRICING_RULE_NOT_FOUND',
        message: 'Pricing rule not found.',
      });
    }
    return updated;
  }

  async disablePricingRule(id: string) {
    await this.repo.disablePricingRule(id);
    return { disabled: true };
  }
}

