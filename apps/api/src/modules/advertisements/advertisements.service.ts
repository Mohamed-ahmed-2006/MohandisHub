import { randomUUID } from 'node:crypto';

import jwt from 'jsonwebtoken';
import type { PoolClient } from 'pg';

import { env } from '../../config/env.js';
import { getPool } from '../../db/pool.js';
import { resolvePublicUploadRef } from '../../lib/supabase-storage.js';
import { HttpError } from '../../utils/http-error.js';
import { WalletRepository } from '../wallet/wallet.repository.js';

import { AdCenterService } from './adcenter.service.js';
import { computeAdCancellationRefundPiastres, egpToPiastres } from './advertisements.money.js';
import { AdvertisementsRepository } from './advertisements.repository.js';
import type { AdvertisementRow } from './advertisements.types.js';
import type {
  AdCenterResolveInput,
  AdminAdControlsInput,
  AdminReviewInput,
  AdminScheduleInput,
  CreateAdInput,
  ListAdsQueryInput,
  UpdateAdInput,
} from './advertisements.validation.js';

const PLATFORM_USER_ID = '00000000-0000-0000-0000-000000000001';
const DAY_MS = 24 * 60 * 60 * 1000;
const DELIVERY_TOKEN_SECONDS = 10 * 60;
const DEFAULT_AD_CONTROLS = { acceptAds: false, pricePerDay: 0 };

type DeliveryClaims = {
  type: 'advertisement_delivery';
  adId: string;
  viewerHash: string;
  nonce: string;
  bucket: string;
};

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

  async quote(durationDays: number) {
    const controls = await this.getControls();
    if (!controls.acceptAds) {
      throw new HttpError({
        statusCode: 403,
        code: 'ADS_DISABLED_BY_ADMIN',
        message: 'Ads are currently not accepting new campaigns.',
      });
    }
    const dailyPricePiastres = this.toPiastres(controls.pricePerDay);
    const totalPiastres = dailyPricePiastres * durationDays;
    if (!Number.isSafeInteger(totalPiastres)) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_PRICE_OUT_OF_RANGE',
        message: 'The configured advertisement price is outside the supported range.',
      });
    }
    return {
      durationDays,
      dailyPriceEgp: dailyPricePiastres / 100,
      totalEgp: totalPiastres / 100,
      currency: 'EGP',
      priceSnapshot: {
        dailyPricePiastres,
        totalPiastres,
      },
    };
  }

  async createAd(userId: string, input: CreateAdInput) {
    if (input.linkType === 'service' && !input.linkTarget) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_DESTINATION_REQUIRED',
        message: 'Choose one of your active services for this advertisement.',
      });
    }
    const quote = await this.quote(input.durationDays);
    const requestedStartAt = input.startsAt ? new Date(input.startsAt) : null;
    const now = new Date();
    const startsAt =
      requestedStartAt && requestedStartAt.getTime() > now.getTime() ? requestedStartAt : now;
    const expiresAt = new Date(startsAt.getTime() + input.durationDays * DAY_MS);
    const storagePath = this.resolveBannerStoragePath(input.imageUrl);
    const adId = randomUUID();
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await this.assertAssetsAndDestination(client, userId, {
        bannerUploadId: input.bannerUploadId,
        imageUrl: input.imageUrl,
        linkType: input.linkType,
        linkTarget: input.linkTarget,
        storagePath,
      });

      let holdId: string | null = null;
      if (quote.priceSnapshot.totalPiastres > 0) {
        const wallet = await this.walletRepo.getOrCreateUserWalletInTransaction(client, userId);
        const hold = await this.walletRepo.createHoldInTransaction(
          client,
          wallet.id,
          userId,
          quote.priceSnapshot.totalPiastres / 100,
          'EGP',
          'advertisement',
          adId,
          {
            duration_days: input.durationDays,
            daily_price_piastres: quote.priceSnapshot.dailyPricePiastres,
            quoted_amount_piastres: quote.priceSnapshot.totalPiastres,
          },
        );
        holdId = hold.id;
      }

      const ad = await this.repo.createAdInTx(
        client,
        adId,
        userId,
        input,
        quote.priceSnapshot.dailyPricePiastres,
        quote.priceSnapshot.totalPiastres,
        holdId,
        startsAt,
        expiresAt,
      );
      await client.query('COMMIT');
      return ad;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
        throw new HttpError({
          statusCode: 402,
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient wallet balance for this advertisement.',
        });
      }
      throw error;
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
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad || ad.advertiser_id !== userId) {
        throw new HttpError({
          statusCode: 404,
          code: 'AD_NOT_FOUND',
          message: 'Advertisement not found.',
        });
      }
      if (ad.status !== 'pending_review' || ad.content_locked_at) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_CONTENT_LOCKED',
          message: 'Submitted advertisement content is immutable; create a new campaign.',
        });
      }
      if (input.imageUrl !== undefined || input.bannerUploadId !== undefined) {
        if (!input.imageUrl || !input.bannerUploadId) {
          throw new HttpError({
            statusCode: 400,
            code: 'AD_BANNER_PAIR_REQUIRED',
            message: 'The banner URL and upload identifier must be changed together.',
          });
        }
        const storagePath = this.resolveBannerStoragePath(input.imageUrl);
        const valid = await this.repo.validateBannerUpload(
          client,
          userId,
          input.bannerUploadId,
          storagePath,
        );
        if (!valid) this.throwInvalidBanner();
      }
      const updated = await this.repo.updateAd(adId, input, client);
      if (!updated) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_CONTENT_LOCKED',
          message: 'Submitted advertisement content is immutable; create a new campaign.',
        });
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cancelAd(adId: string, userId: string) {
    return this.cancelCampaign(adId, userId, false, 'cancelled_by_advertiser');
  }

  async reviewAd(adId: string, adminId: string, input: AdminReviewInput) {
    if (input.decision === 'reject' && !input.reason) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_REJECTION_REASON_REQUIRED',
        message: 'A rejection reason is required.',
      });
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad) this.throwAdNotFound();
      if (ad.status !== 'pending_review') {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_REVIEW_STATE_INVALID',
          message: 'Only pending advertisements can be reviewed.',
        });
      }

      if (input.decision === 'reject') {
        if (ad.wallet_hold_id) {
          await this.walletRepo.releaseHoldInTransaction(
            client,
            ad.wallet_hold_id,
            'Advertisement rejected',
            { advertisement_id: ad.id, reviewed_by: adminId },
          );
        }
        const rejected = await this.repo.rejectAdInTx(client, adId, adminId, input.reason!);
        await client.query('COMMIT');
        return rejected!;
      }

      await this.assertStoredAdDeliverable(client, ad);
      const totalPiastres = this.readPiastres(ad.quoted_amount_piastres);
      if (totalPiastres > 0) {
        if (!ad.wallet_hold_id) {
          throw new HttpError({
            statusCode: 409,
            code: 'AD_PAYMENT_HOLD_MISSING',
            message: 'The advertisement payment hold is missing.',
          });
        }
        const hold = await this.walletRepo.findWalletHoldByIdInTransaction(
          client,
          ad.wallet_hold_id,
        );
        if (
          !hold ||
          hold.status !== 'held' ||
          hold.user_id !== ad.advertiser_id ||
          hold.reference_type !== 'advertisement' ||
          hold.reference_id !== ad.id ||
          this.toPiastres(Number(hold.amount)) !== totalPiastres
        ) {
          throw new HttpError({
            statusCode: 409,
            code: 'AD_PAYMENT_HOLD_INVALID',
            message: 'The advertisement payment hold is not available for capture.',
          });
        }
        await this.walletRepo.captureHoldInTransaction(
          client,
          ad.wallet_hold_id,
          'Advertisement approved',
          { advertisement_id: ad.id, reviewed_by: adminId },
        );
        const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
          client,
          PLATFORM_USER_ID,
        );
        await this.walletRepo.creditWithTypeInTransaction(
          client,
          platformWalletId,
          PLATFORM_USER_ID,
          totalPiastres / 100,
          'commission',
          'Advertisement revenue',
          'advertisement',
          ad.id,
        );
      }
      const approved = await this.repo.approveAdInTx(client, adId, adminId);
      if (!approved) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_REVIEW_STATE_INVALID',
          message: 'The advertisement review state changed.',
        });
      }
      await client.query('COMMIT');
      return approved;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async resolveActiveAds(input: AdCenterResolveInput, viewerHash: string) {
    if (!env.ADVERTISEMENTS_ENABLED) return [];
    await this.repo.expireStaleAds();
    const candidates = await this.repo.listActiveAdsForAdCenter(100);
    return this.adCenter
      .rank(candidates, input)
      .slice(0, input.limit ?? 5)
      .map((ad) => {
        const nonce = randomUUID();
        const bucket = this.deliveryBucket(new Date());
        const deliveryToken = jwt.sign(
          {
            type: 'advertisement_delivery',
            adId: ad.id,
            viewerHash,
            nonce,
            bucket,
          } satisfies DeliveryClaims,
          env.JWT_SECRET,
          {
            algorithm: 'HS256',
            expiresIn: DELIVERY_TOKEN_SECONDS,
            issuer: 'mohandishub-api',
            audience: 'advertising',
          },
        );
        return { ...ad, deliveryToken };
      });
  }

  async trackImpression(adId: string, deliveryToken: string, viewerHash: string) {
    const claims = this.verifyDeliveryToken(adId, deliveryToken, viewerHash);
    const impressionId = await this.repo.recordImpression({
      adId,
      viewerHash,
      nonce: claims.nonce,
      bucket: claims.bucket,
    });
    if (!impressionId) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_NOT_DELIVERABLE',
        message: 'This advertisement is no longer deliverable.',
      });
    }
    await this.repo.refreshDeliveryCounters(adId);
    return { accepted: true };
  }

  async trackClick(adId: string, deliveryToken: string, viewerHash: string) {
    const claims = this.verifyDeliveryToken(adId, deliveryToken, viewerHash);
    const accepted = await this.repo.recordClick({
      adId,
      viewerHash,
      nonce: claims.nonce,
      bucket: claims.bucket,
    });
    if (!accepted) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_IMPRESSION_REQUIRED',
        message: 'A recorded viewable impression is required before a click.',
      });
    }
    await this.repo.refreshDeliveryCounters(adId);
    return { accepted: true };
  }

  async applyAdminStatus(
    adId: string,
    adminId: string,
    status: 'active' | 'paused_by_admin' | 'cancelled',
    reason?: string,
  ) {
    if (status === 'cancelled') {
      return this.cancelCampaign(adId, adminId, true, reason ?? 'cancelled_by_admin');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad) this.throwAdNotFound();
      let updated: AdvertisementRow | null;
      if (status === 'paused_by_admin') {
        updated = await this.repo.pauseAdInTx(client, adId, reason ?? 'paused_by_admin');
      } else {
        await this.assertStoredAdDeliverable(client, ad);
        updated = await this.repo.resumeAdInTx(client, adId, reason ?? null);
      }
      if (!updated) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_STATUS_TRANSITION_INVALID',
          message: 'The requested advertisement transition is not valid.',
        });
      }
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async applyAdminSchedule(adId: string, input: AdminScheduleInput) {
    const ad = await this.getAd(adId);
    if (ad.status !== 'pending_review') {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_CONTENT_LOCKED',
        message: 'Only pending campaigns can be rescheduled.',
      });
    }
    if (!ad.duration_days) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_PRICE_SNAPSHOT_MISSING',
        message: 'This legacy campaign requires audited reconciliation before scheduling.',
      });
    }
    const startsAt = input.startsAt
      ? new Date(input.startsAt)
      : new Date(ad.starts_at ?? Date.now());
    const expiresAt = new Date(startsAt.getTime() + ad.duration_days * DAY_MS);
    if (
      input.expiresAt &&
      Math.abs(new Date(input.expiresAt).getTime() - expiresAt.getTime()) > 1_000
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_SCHEDULE_DURATION_MISMATCH',
        message: 'Scheduling cannot change the paid campaign duration.',
      });
    }
    const updated = await this.repo.applyAdminSchedule(adId, {
      ...input,
      startsAt: startsAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    if (!updated) this.throwAdNotFound();
    return updated;
  }

  async getAdminAdControls() {
    return this.getControls();
  }

  async updateAdminAdControls(adminId: string, input: AdminAdControlsInput) {
    return this.repo.upsertGlobalAdControls(adminId, input);
  }

  private async cancelCampaign(adId: string, actorId: string, isAdmin: boolean, reason: string) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.findAdForUpdate(client, adId);
      if (!ad || (!isAdmin && ad.advertiser_id !== actorId)) this.throwAdNotFound();
      if (['cancelled', 'expired', 'rejected'].includes(ad.status)) {
        throw new HttpError({
          statusCode: 409,
          code: 'AD_NOT_CANCELLABLE',
          message: 'This advertisement cannot be cancelled in its current state.',
        });
      }

      let refundPiastres = 0;
      if (ad.status === 'pending_review') {
        refundPiastres = this.readPiastres(ad.quoted_amount_piastres);
        if (ad.wallet_hold_id) {
          await this.walletRepo.releaseHoldInTransaction(
            client,
            ad.wallet_hold_id,
            'Advertisement cancelled before review',
            { advertisement_id: ad.id, cancelled_by: actorId },
          );
        }
      } else {
        refundPiastres = this.computeCancellationRefundPiastres(ad);
        if (refundPiastres > 0) {
          const advertiserWallet = await this.walletRepo.getOrCreateUserWalletInTransaction(
            client,
            ad.advertiser_id,
          );
          const platformWalletId = await this.walletRepo.getOrCreateCommissionWallet(
            client,
            PLATFORM_USER_ID,
          );
          try {
            await this.walletRepo.debitWalletInTransaction(
              client,
              platformWalletId,
              PLATFORM_USER_ID,
              refundPiastres / 100,
              'Advertisement unused-time refund',
              'advertisement_refund',
              ad.id,
            );
          } catch (error) {
            if (error instanceof Error && error.message === 'INSUFFICIENT_BALANCE') {
              throw new HttpError({
                statusCode: 409,
                code: 'AD_REFUND_PLATFORM_BALANCE_INSUFFICIENT',
                message: 'The campaign refund requires audited administrator reconciliation.',
              });
            }
            throw error;
          }
          await this.walletRepo.creditWithTypeInTransaction(
            client,
            advertiserWallet.id,
            ad.advertiser_id,
            refundPiastres / 100,
            'refund',
            'Advertisement unused-time refund',
            'advertisement',
            ad.id,
          );
        }
      }
      const cancelled = await this.repo.cancelAdInTx(client, adId, reason, refundPiastres);
      await client.query('COMMIT');
      return { advertisement: cancelled!, cancelled: true, refundAmount: refundPiastres / 100 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async assertAssetsAndDestination(
    client: PoolClient,
    advertiserId: string,
    input: {
      bannerUploadId: string;
      imageUrl: string;
      linkType: 'profile' | 'service';
      linkTarget?: string | undefined;
      storagePath: string;
    },
  ): Promise<void> {
    const validBanner = await this.repo.validateBannerUpload(
      client,
      advertiserId,
      input.bannerUploadId,
      input.storagePath,
    );
    const validDestination = await this.repo.validateDestination(
      client,
      advertiserId,
      input.linkType,
      input.linkTarget,
    );
    if (!validBanner) this.throwInvalidBanner();
    if (!validDestination) {
      throw new HttpError({
        statusCode: 403,
        code: 'AD_DESTINATION_INVALID',
        message: 'The destination must be your active provider profile or active service.',
      });
    }
  }

  private async assertStoredAdDeliverable(client: PoolClient, ad: AdvertisementRow): Promise<void> {
    if (!ad.banner_upload_id) this.throwInvalidBanner();
    const storagePath = this.resolveBannerStoragePath(ad.image_url);
    await this.assertAssetsAndDestination(client, ad.advertiser_id, {
      bannerUploadId: ad.banner_upload_id,
      imageUrl: ad.image_url,
      linkType: ad.link_type,
      linkTarget: ad.link_type === 'service' ? (ad.destination_service_id ?? undefined) : undefined,
      storagePath,
    });
  }

  private resolveBannerStoragePath(imageUrl: string): string {
    const ref = resolvePublicUploadRef(imageUrl);
    if (!ref) this.throwInvalidBanner();
    return ref.kind === 'supabase' ? ref.path : ref.basename;
  }

  private throwInvalidBanner(): never {
    throw new HttpError({
      statusCode: 400,
      code: 'AD_BANNER_INVALID',
      message: 'The banner must be an owned, verified JPEG, PNG, or WebP upload.',
    });
  }

  private throwAdNotFound(): never {
    throw new HttpError({
      statusCode: 404,
      code: 'AD_NOT_FOUND',
      message: 'Advertisement not found.',
    });
  }

  private verifyDeliveryToken(adId: string, token: string, viewerHash: string): DeliveryClaims {
    try {
      const claims = jwt.verify(token, env.JWT_SECRET, {
        algorithms: ['HS256'],
        issuer: 'mohandishub-api',
        audience: 'advertising',
      }) as DeliveryClaims;
      if (
        claims.type !== 'advertisement_delivery' ||
        claims.adId !== adId ||
        claims.viewerHash !== viewerHash ||
        !claims.nonce ||
        !claims.bucket
      ) {
        throw new Error('claims mismatch');
      }
      return claims;
    } catch {
      throw new HttpError({
        statusCode: 403,
        code: 'AD_DELIVERY_TOKEN_INVALID',
        message: 'The advertisement delivery token is invalid or expired.',
      });
    }
  }

  private deliveryBucket(now: Date): string {
    const bucketMs = 30 * 60 * 1000;
    return new Date(Math.floor(now.getTime() / bucketMs) * bucketMs).toISOString();
  }

  private computeCancellationRefundPiastres(ad: AdvertisementRow): number {
    const totalPiastres = this.readPiastres(ad.quoted_amount_piastres);
    if (totalPiastres <= 0 || !ad.starts_at || !ad.expires_at || !ad.duration_days) return 0;
    const start = new Date(ad.starts_at).getTime();
    const end = new Date(ad.expires_at).getTime();
    const effectiveNow =
      ad.status === 'paused_by_admin' && ad.paused_at
        ? new Date(ad.paused_at).getTime()
        : Date.now();
    return computeAdCancellationRefundPiastres({
      totalPiastres,
      durationDays: ad.duration_days,
      startsAtMs: start,
      expiresAtMs: end,
      effectiveNowMs: effectiveNow,
    });
  }

  private toPiastres(amount: number): number {
    const piastres = egpToPiastres(amount);
    if (piastres == null) {
      throw new HttpError({
        statusCode: 409,
        code: 'AD_PRICE_INVALID',
        message: 'Advertisement prices must use integer piastres.',
      });
    }
    return piastres;
  }

  private readPiastres(value: string | null): number {
    if (!value || !/^\d+$/.test(value)) return 0;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : 0;
  }
}
