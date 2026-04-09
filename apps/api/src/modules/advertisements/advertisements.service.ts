import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { AdCenterService } from './adcenter.service.js';
import { AdvertisementsRepository } from './advertisements.repository.js';
import type {
  AdCenterResolveInput,
  AdminAdControlsInput,
  AdminPricingOverrideInput,
  AdminScheduleInput,
  CreateAdInput,
  ListAdsQueryInput,
  UpdateAdInput,
} from './advertisements.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';

const DEFAULT_AD_CONTROLS = { acceptAds: true, pricePerDay: 0 };

export class AdvertisementsService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly adCenter: AdCenterService = new AdCenterService(),
  ) {}

  private async getControls() {
    return (await this.repo.getGlobalAdControls()) ?? DEFAULT_AD_CONTROLS;
  }

  async createAd(userId: string, input: CreateAdInput) {
    const controls = await this.getControls();
    if (!controls.acceptAds) {
      throw new HttpError({
        statusCode: 403,
        code: 'ADS_DISABLED_BY_ADMIN',
        message: 'Ads are currently not accepting new campaigns.',
      });
    }
    const amount = Math.max(0, controls.pricePerDay * input.durationDays);
    const wallet = await this.walletRepo.findByUserId(userId);
    if (!wallet) {
      throw new HttpError({
        statusCode: 402,
        code: 'INSUFFICIENT_BALANCE',
        message: 'Wallet is required to create advertisement.',
      });
    }

    const requestedStartAt = input.startsAt ? new Date(input.startsAt) : null;
    const now = new Date();
    const startsAt = requestedStartAt && requestedStartAt.getTime() > now.getTime() ? requestedStartAt : now;
    const expiresAt = new Date(startsAt.getTime() + input.durationDays * 24 * 60 * 60 * 1000);

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.createAdInTx(client, userId, input, amount, startsAt, expiresAt);
      if (amount > 0) {
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
          'Advertisement revenue',
          'advertisement',
          ad.id,
        );
        await client.query(
          `UPDATE advertisements SET admin_status_reason = COALESCE(admin_status_reason, $2) WHERE id = $1`,
          [ad.id, `payment_tx:${paymentTxId}`],
        );
      }
      await client.query('COMMIT');
      return ad;
    } catch (err: unknown) {
      await client.query('ROLLBACK');
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance for this ad.',
        });
      }
      throw err;
    } finally {
      client.release();
    }
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
    if (ad.status === 'cancelled' || ad.status === 'expired') {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_NOT_EDITABLE',
        message: 'Cancelled or expired ads cannot be edited.',
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

  async getAdminAdControls() {
    return this.getControls();
  }

  async updateAdminAdControls(adminId: string, input: AdminAdControlsInput) {
    return this.repo.upsertGlobalAdControls(adminId, input);
  }
}
