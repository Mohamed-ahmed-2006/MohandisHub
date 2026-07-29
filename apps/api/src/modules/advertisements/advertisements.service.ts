import { randomUUID } from 'node:crypto';

import { getPool } from '../../db/pool.js';
import { HttpError } from '../../utils/http-error.js';
import { MhcService } from '../mhc/mhc.service.js';
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

// ---------------------------------------------------------------------------
// LAUNCH CONSTRAINT LC-01 — advertisements must stay priced at 0.
// ---------------------------------------------------------------------------
// The MHC charging path below is complete and tested, but two properties of it
// are not yet product decisions, and both are only harmless while the price is 0:
//
//   1. Charging is FLAT PER CAMPAIGN, not per day. `mhc_action_prices` has one
//      price per action key and no duration dimension, so a 1-day and a 365-day
//      campaign cost the same. The pre-P0-03 model was pricePerDay × duration.
//
//   2. There is NO CANCELLATION OR REFUND POLICY. Cancelling an MHC-charged
//      campaign refunds nothing today. `refundActionCharge` exists but refunds in
//      FULL only — it cannot prorate — and no policy has been chosen.
//
// At a non-zero price, a provider who cancels on day 1 of 30 silently loses their
// credits. So: keep `mhc_action_prices.advertisement.mhc_price` at 0 (or leave the
// action inactive, which fails closed) until both decisions are implemented AND
// tested. See docs/release/LAUNCH_CONSTRAINTS.md#lc-01.
//
// Do not "just set a price" in an admin panel to enable paid ads. That is a
// change, not a configuration step.
// ---------------------------------------------------------------------------

/** `mhc_action_prices` key. The only pricing source for a launch campaign. */
const AD_ACTION_KEY = 'advertisement';
const AD_REFERENCE_TYPE = 'advertisement';

export type AdControls = {
  acceptAds: boolean;
  /** MHC charged per campaign. Not a currency amount — never render a symbol. */
  mhcPrice: number;
};

export class AdvertisementsService {
  constructor(
    private readonly repo: AdvertisementsRepository = new AdvertisementsRepository(),
    /**
     * Retained ONLY for the legacy refund path on campaigns that were paid for
     * in EGP before P0-03. Nothing on the creation path touches it, and no
     * money wallet is read or written for a launch advertisement.
     */
    private readonly walletRepo: WalletRepository = new WalletRepository(),
    private readonly adCenter: AdCenterService = new AdCenterService(),
    private readonly mhc: MhcService = new MhcService(),
  ) {}

  private async getControls(): Promise<AdControls> {
    const [acceptAds, price] = await Promise.all([
      this.repo.getGlobalAdAcceptance(),
      this.repo.getAdvertisementMhcPrice(),
    ]);
    return {
      acceptAds: acceptAds ?? true,
      // A missing or switched-off price row reports 0 to the UI rather than
      // guessing. Charging still fails closed on it — see MhcService.chargeAction.
      mhcPrice: price?.isActive ? price.mhcPrice : 0,
    };
  }

  /**
   * Create a campaign and charge its MHC price in ONE transaction.
   *
   * Two database-enforced guards, at two different levels:
   *
   *   uq_advertisements_advertiser_idempotency  stops a retried request from
   *     creating a second campaign at all;
   *   uq_mhc_action_charge_reference            stops a second charge against
   *     the campaign that does exist.
   *
   * The first is what makes the second sufficient: without domain idempotency a
   * duplicate request produces a *different* advertisement id, which the charge
   * table would rightly treat as a new, chargeable business reference.
   *
   * The advertisement id is preallocated so it can be the charge's reference
   * before the row is committed, and the insert happens first so a duplicate
   * collides before any credits move.
   */
  async createAd(userId: string, input: CreateAdInput, idempotencyKey?: string | null) {
    const controls = await this.getControls();
    if (!controls.acceptAds) {
      throw new HttpError({
        statusCode: 403,
        code: 'ADS_DISABLED_BY_ADMIN',
        message: 'Ads are currently not accepting new campaigns.',
      });
    }

    const clientIdempotencyKey = idempotencyKey?.trim() || null;
    if (clientIdempotencyKey) {
      // Fast path: a completed retry never re-enters the transaction at all.
      const existing = await this.repo.findAdByIdempotencyKey(userId, clientIdempotencyKey);
      if (existing) return existing;
    }

    const requestedStartAt = input.startsAt ? new Date(input.startsAt) : null;
    const now = new Date();
    const startsAt =
      requestedStartAt && requestedStartAt.getTime() > now.getTime() ? requestedStartAt : now;
    const expiresAt = new Date(startsAt.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
    const advertisementId = randomUUID();

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const ad = await this.repo.createAdInTx(
        client,
        userId,
        input,
        startsAt,
        expiresAt,
        advertisementId,
        clientIdempotencyKey,
      );

      // Same transaction as the insert: a failed charge leaves no campaign, and
      // a failed campaign leaves no charge. There is no ordering of these two
      // writes that can diverge.
      await this.mhc.chargeAction({
        client,
        userId,
        actionKey: AD_ACTION_KEY,
        referenceType: AD_REFERENCE_TYPE,
        referenceId: ad.id,
        idempotencyKey: `advertisement:${ad.id}`,
        description: `Advertisement campaign: ${ad.title_en}`,
        metadata: { duration_days: input.durationDays },
      });

      await client.query('COMMIT');
      return ad;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      // Lost the domain idempotency race: a concurrent identical request
      // committed first. Return its campaign rather than an error, and do not
      // charge again.
      if (
        clientIdempotencyKey &&
        typeof err === 'object' &&
        err !== null &&
        (err as { code?: unknown }).code === '23505'
      ) {
        const winner = await this.repo.findAdByIdempotencyKey(userId, clientIdempotencyKey);
        if (winner) return winner;
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

      // LEGACY PATH ONLY. `amount_paid` is the EGP figure historic campaigns
      // were charged; launch campaigns are charged in MHC and store 0 here, so
      // this yields 0 for them and no wallet is touched. Retained because a
      // pre-P0-03 campaign is still entitled to the refund it was promised.
      // Cancelling an MHC campaign currently refunds nothing — a refund policy
      // for credits is a product decision and is not invented here.
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

  async getAdminAdControls(): Promise<AdControls> {
    return this.getControls();
  }

  /**
   * Admin ad pricing edits `mhc_action_prices.advertisement` — the same row the
   * charge primitive reads. There is no second place a price can be set, so the
   * displayed price and the charged price cannot drift.
   */
  async updateAdminAdControls(adminId: string, input: AdminAdControlsInput): Promise<AdControls> {
    if (!(input.mhcPrice >= 0)) {
      throw new HttpError({
        statusCode: 400,
        code: 'AD_INVALID_MHC_PRICE',
        message: 'Advertisement credit price must be zero or greater.',
      });
    }
    await this.repo.upsertGlobalAdControls(adminId, input.acceptAds);
    await this.repo.setAdvertisementMhcPrice(input.mhcPrice);
    return { acceptAds: input.acceptAds, mhcPrice: input.mhcPrice };
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
