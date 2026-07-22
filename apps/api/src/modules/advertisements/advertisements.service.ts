import { env } from '../../config/env.js';
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

const DEFAULT_AD_CONTROLS = { acceptAds: false, pricePerDay: 0 };

export class AdvertisementsService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly adCenter: AdCenterService = new AdCenterService(),
  ) {}

  private async getControls() {
    if (!env.ADVERTISEMENTS_ENABLED) return DEFAULT_AD_CONTROLS;
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
    const startsAt =
      requestedStartAt && requestedStartAt.getTime() > now.getTime() ? requestedStartAt : now;
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
        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          PLATFORM_USER_ID,
        );
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
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
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
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This ad does not belong to you.',
      });
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
      throw new HttpError({
        statusCode: 403,
        code: 'FORBIDDEN',
        message: 'This ad does not belong to you.',
      });
    }
    if (ad.status === 'cancelled' || ad.status === 'expired') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_CANCELLABLE',
        message: 'This advertisement is already cancelled or expired.',
      });
    }

    const client = await getPool().connect();
    let refundAmount = 0;
    try {
      await client.query('BEGIN');
      const lockedAd = await this.repo.findAdForUpdate(client, adId);
      if (!lockedAd || lockedAd.advertiser_id !== userId) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (lockedAd.status === 'cancelled' || lockedAd.status === 'expired') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_CANCELLABLE',
          message: 'This advertisement is already cancelled or expired.',
        });
      }

      refundAmount = this.computeAdCancellationRefund(lockedAd);
      if (refundAmount > 0) {
        const advertiserWallet = await this.walletRepo.findByUserId(userId);
        if (!advertiserWallet) {
          throw new HttpError({
            statusCode: 409,
            code: 'AD_REFUND_WALLET_MISSING',
            message: 'Advertiser wallet is missing, so the ad refund cannot be posted.',
          });
        }
        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          PLATFORM_USER_ID,
        );
        try {
          await this.walletRepo.debitWalletInTransaction(
            client,
            platformWalletId,
            PLATFORM_USER_ID,
            refundAmount,
            'Advertisement cancellation refund funded',
            'advertisement_refund',
            lockedAd.id,
          );
          await this.walletRepo.creditWithTypeInTransaction(
            client,
            advertiserWallet.id,
            userId,
            refundAmount,
            'refund',
            'Advertisement cancellation refund',
            'advertisement',
            lockedAd.id,
          );
        } catch (error) {
          if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
            throw new HttpError({
              statusCode: 409,
              code: 'AD_REFUND_PLATFORM_BALANCE_INSUFFICIENT',
              message:
                'Platform ad revenue wallet cannot fund this refund. Review the ad manually.',
            });
          }
          throw error;
        }
      }

      await this.repo.cancelAdInTx(
        client,
        adId,
        `cancelled_by_user;refund_egp:${refundAmount.toFixed(2)}`,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { cancelled: true, refundAmount };
  }

  async resolveActiveAds(input: AdCenterResolveInput) {
    if (!env.ADVERTISEMENTS_ENABLED) return [];
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

  async applyAdminStatus(
    adId: string,
    status: 'active' | 'paused_by_admin' | 'cancelled',
    reason?: string,
  ) {
    const updated = await this.repo.updateAd(adId, { status });
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    if (reason) {
      await this.repo.applyAdminSchedule(adId, { reason });
    }
    return updated;
  }

  async applyAdminSchedule(adId: string, input: AdminScheduleInput) {
    const updated = await this.repo.applyAdminSchedule(adId, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    return updated;
  }

  async applyAdminPricingOverride(adId: string, input: AdminPricingOverrideInput) {
    const updated = await this.repo.applyAdminPricingOverride(adId, input);
    if (!updated) {
      throw new HttpError({
        statusCode: 404,
        code: 'AD_NOT_FOUND',
        message: 'Advertisement not found.',
      });
    }
    return updated;
  }

  async getAdminAdControls() {
    return this.getControls();
  }

  async updateAdminAdControls(adminId: string, input: AdminAdControlsInput) {
    return this.repo.upsertGlobalAdControls(adminId, input);
  }

  private computeAdCancellationRefund(ad: {
    amount_paid: string | null;
    starts_at: string | null;
    expires_at: string | null;
    admin_forced_starts_at: string | null;
    admin_forced_expires_at: string | null;
  }): number {
    const amountPaid = Number.parseFloat(ad.amount_paid ?? '0');
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) return 0;

    const startsAt = this.parseDate(ad.admin_forced_starts_at ?? ad.starts_at);
    const expiresAt = this.parseDate(ad.admin_forced_expires_at ?? ad.expires_at);
    const now = new Date();
    if (!expiresAt || expiresAt.getTime() <= now.getTime()) return 0;
    if (!startsAt || startsAt.getTime() >= now.getTime()) return this.roundMoney(amountPaid);

    const totalMs = expiresAt.getTime() - startsAt.getTime();
    if (totalMs <= 0) return 0;
    const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
    return this.roundMoney(amountPaid * Math.min(1, remainingMs / totalMs));
  }

  private parseDate(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private roundMoney(amount: number): number {
    return Math.round(amount * 100) / 100;
  }
}
