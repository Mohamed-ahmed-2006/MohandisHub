// ---------------------------------------------------------------------------
// Settings service — app settings business logic
// ---------------------------------------------------------------------------

import {
  MANAGED_SIDEBAR_HREFS,
  type AppSettings,
  type AppStatus,
  type UpdateAppSettingsBody,
} from '@mohandishub/shared';

import { env } from '../../config/env.js';
import { HttpError } from '../../utils/http-error.js';

import { SettingsRepository } from './settings.repository.js';
import type { AppSettingsRow } from './settings.repository.js';

const MANAGED_SIDEBAR_SET = new Set<string>(MANAGED_SIDEBAR_HREFS);

function parsePublicUploadMimes(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const o = raw.filter((x): x is string => typeof x === 'string');
    return o.length > 0 ? o : null;
  }
  return null;
}

function parseSidebarHiddenHrefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && MANAGED_SIDEBAR_SET.has(item)) out.push(item);
  }
  return [...new Set(out)].sort();
}

export class SettingsService {
  constructor(private readonly repo: SettingsRepository = new SettingsRepository()) {}

  /** Full DB row for wallet FX / InstaPay (internal use). */
  async getRawRow(): Promise<AppSettingsRow | null> {
    return this.repo.get();
  }

  async getSettings(): Promise<AppSettings | null> {
    const row = await this.repo.get();
    return row ? this.toAppSettings(row) : null;
  }

  async getAppStatus(): Promise<AppStatus> {
    const row = await this.repo.get();
    if (!row) {
      return this.defaultAppStatus();
    }
    return {
      maintenanceMode: row.maintenance_mode,
      maintenanceMessage: row.maintenance_message,
      signupsLocked: row.signups_locked,
      lockLogins: row.lock_logins,
      depositsPaused: row.deposits_paused,
      moneyMovementsPaused: row.money_movements_paused,
      disableCryptoDeposits: row.disable_crypto_deposits,
      disableCardDeposits: row.disable_card_deposits,
      minDepositAmount: row.min_deposit_amount != null ? parseFloat(row.min_deposit_amount) : null,
      maxDepositAmount: row.max_deposit_amount != null ? parseFloat(row.max_deposit_amount) : null,
      pausePlanSubscriptions: row.pause_plan_subscriptions,
      pauseNeeds: row.pause_needs,
      pauseBids: row.pause_bids,
      pauseAwardBids: row.pause_award_bids,
      pauseUploads: row.pause_uploads,
      pauseVerificationSubmissions: row.pause_verification_submissions,
      pauseChat: row.pause_chat,
      pauseOtpEmails: row.pause_otp_emails,
      featureNeedsEnabled: row.feature_needs_enabled,
      featurePlansEnabled: row.feature_plans_enabled,
      featureWalletEnabled: row.feature_wallet_enabled,
      featureHourlyPricingEnabled: row.feature_hourly_pricing_enabled ?? true,
      globalAnnouncement: row.global_announcement,
      commissionPercent: parseFloat(row.commission_percent ?? '10'),
      commissionMinEgp: parseFloat(row.commission_min_egp ?? '0'),
      commissionReceiverId:
        row.commission_receiver_id ?? '00000000-0000-0000-0000-000000000001',
      reservationAcceptanceFee: parseFloat(row.reservation_acceptance_fee ?? '0'),
      reservationVoiceMinuteRate: parseFloat(row.reservation_voice_minute_rate ?? '1'),
      reservationVideoMinuteRate: parseFloat(row.reservation_video_minute_rate ?? '2'),
      reservationMinPrejoinMinutes: row.reservation_min_prejoin_minutes ?? 5,
      jobInterviewFeeAmount: parseFloat(row.job_interview_fee_amount ?? '0'),
      walletEgpPerUsdtDeposit:
        row.wallet_egp_per_usdt_deposit != null
          ? parseFloat(row.wallet_egp_per_usdt_deposit)
          : null,
      walletEgpPerUsdtWithdrawal:
        row.wallet_egp_per_usdt_withdrawal != null
          ? parseFloat(row.wallet_egp_per_usdt_withdrawal)
          : null,
      platformInstapayDisplay:
        (row.platform_instapay_display as Record<string, unknown> | null) ?? null,
      walletUsdToEgpMigrationRate:
        row.wallet_usd_to_egp_migration_rate != null
          ? parseFloat(row.wallet_usd_to_egp_migration_rate)
          : null,
      walletMigrationUsdToEgpApplied: row.wallet_migration_usd_to_egp_applied ?? false,
      sidebarHiddenHrefs: parseSidebarHiddenHrefs(row.sidebar_hidden_hrefs),
    };
  }

  async updateSettings(partial: UpdateAppSettingsBody, adminId?: string): Promise<AppSettings | null> {
    if (
      partial.maxPublicUploadBytes != null &&
      partial.maxPublicUploadBytes > env.PUBLIC_UPLOAD_MAX_BYTES_CEILING
    ) {
      throw new HttpError({
        statusCode: 400,
        code: 'ABOVE_CEILING',
        message: `maxPublicUploadBytes cannot exceed ${env.PUBLIC_UPLOAD_MAX_BYTES_CEILING}.`,
      });
    }
    const dbPartial: Parameters<SettingsRepository['update']>[0] = {};
    if (partial.maintenanceMode !== undefined) dbPartial.maintenance_mode = partial.maintenanceMode;
    if (partial.maintenanceMessage !== undefined) dbPartial.maintenance_message = partial.maintenanceMessage;
    if (partial.signupsLocked !== undefined) dbPartial.signups_locked = partial.signupsLocked;
    if (partial.depositsPaused !== undefined) dbPartial.deposits_paused = partial.depositsPaused;
    if (partial.moneyMovementsPaused !== undefined) dbPartial.money_movements_paused = partial.moneyMovementsPaused;
    if (adminId !== undefined) dbPartial.updated_by = adminId;
    if (partial.lockLogins !== undefined) dbPartial.lock_logins = partial.lockLogins;
    if (partial.disableCryptoDeposits !== undefined) dbPartial.disable_crypto_deposits = partial.disableCryptoDeposits;
    if (partial.disableCardDeposits !== undefined) dbPartial.disable_card_deposits = partial.disableCardDeposits;
    if (partial.minDepositAmount !== undefined) dbPartial.min_deposit_amount = partial.minDepositAmount;
    if (partial.maxDepositAmount !== undefined) dbPartial.max_deposit_amount = partial.maxDepositAmount;
    if (partial.pausePlanSubscriptions !== undefined) dbPartial.pause_plan_subscriptions = partial.pausePlanSubscriptions;
    if (partial.pauseNeeds !== undefined) dbPartial.pause_needs = partial.pauseNeeds;
    if (partial.pauseBids !== undefined) dbPartial.pause_bids = partial.pauseBids;
    if (partial.pauseAwardBids !== undefined) dbPartial.pause_award_bids = partial.pauseAwardBids;
    if (partial.pauseUploads !== undefined) dbPartial.pause_uploads = partial.pauseUploads;
    if (partial.pauseVerificationSubmissions !== undefined) dbPartial.pause_verification_submissions = partial.pauseVerificationSubmissions;
    if (partial.pauseChat !== undefined) dbPartial.pause_chat = partial.pauseChat;
    if (partial.pauseOtpEmails !== undefined) dbPartial.pause_otp_emails = partial.pauseOtpEmails;
    if (partial.featureNeedsEnabled !== undefined) dbPartial.feature_needs_enabled = partial.featureNeedsEnabled;
    if (partial.featurePlansEnabled !== undefined) dbPartial.feature_plans_enabled = partial.featurePlansEnabled;
    if (partial.featureWalletEnabled !== undefined) dbPartial.feature_wallet_enabled = partial.featureWalletEnabled;
    if (partial.featureHourlyPricingEnabled !== undefined)
      dbPartial.feature_hourly_pricing_enabled = partial.featureHourlyPricingEnabled;
    if (partial.globalAnnouncement !== undefined) dbPartial.global_announcement = partial.globalAnnouncement;
    if (partial.commissionPercent !== undefined) dbPartial.commission_percent = partial.commissionPercent;
    if (partial.commissionMinEgp !== undefined) dbPartial.commission_min_egp = partial.commissionMinEgp;
    if (partial.commissionReceiverId !== undefined)
      dbPartial.commission_receiver_id = partial.commissionReceiverId;
    if (partial.reservationAcceptanceFee !== undefined)
      dbPartial.reservation_acceptance_fee = partial.reservationAcceptanceFee;
    if (partial.reservationVoiceMinuteRate !== undefined)
      dbPartial.reservation_voice_minute_rate = partial.reservationVoiceMinuteRate;
    if (partial.reservationVideoMinuteRate !== undefined)
      dbPartial.reservation_video_minute_rate = partial.reservationVideoMinuteRate;
    if (partial.reservationMinPrejoinMinutes !== undefined)
      dbPartial.reservation_min_prejoin_minutes = partial.reservationMinPrejoinMinutes;
    if (partial.jobInterviewFeeAmount !== undefined)
      dbPartial.job_interview_fee_amount = partial.jobInterviewFeeAmount;
    if (partial.walletEgpPerUsdtDeposit !== undefined)
      dbPartial.walletEgpPerUsdtDeposit = partial.walletEgpPerUsdtDeposit;
    if (partial.walletEgpPerUsdtWithdrawal !== undefined)
      dbPartial.walletEgpPerUsdtWithdrawal = partial.walletEgpPerUsdtWithdrawal;
    if (partial.platformInstapayDisplay !== undefined)
      dbPartial.platformInstapayDisplay = partial.platformInstapayDisplay;
    if (partial.walletUsdToEgpMigrationRate !== undefined)
      dbPartial.walletUsdToEgpMigrationRate = partial.walletUsdToEgpMigrationRate;
    if (partial.sidebarHiddenHrefs !== undefined)
      dbPartial.sidebarHiddenHrefs = parseSidebarHiddenHrefs(partial.sidebarHiddenHrefs);
    if (partial.maxPublicUploadBytes !== undefined)
      dbPartial.maxPublicUploadBytes = partial.maxPublicUploadBytes;
    if (partial.publicUploadAllowedMimes !== undefined)
      dbPartial.publicUploadAllowedMimes = partial.publicUploadAllowedMimes;
    if (partial.supabaseStorageDashboardUrl !== undefined)
      dbPartial.supabaseStorageDashboardUrl = partial.supabaseStorageDashboardUrl;

    const row = await this.repo.update(dbPartial);
    return row ? this.toAppSettings(row) : null;
  }

  private toAppSettings(row: AppSettingsRow): AppSettings {
    return {
      id: row.id,
      maintenanceMode: row.maintenance_mode,
      maintenanceMessage: row.maintenance_message,
      signupsLocked: row.signups_locked,
      depositsPaused: row.deposits_paused,
      moneyMovementsPaused: row.money_movements_paused,
      updatedAt: row.updated_at.toISOString(),
      updatedBy: row.updated_by,
      lockLogins: row.lock_logins,
      disableCryptoDeposits: row.disable_crypto_deposits,
      disableCardDeposits: row.disable_card_deposits,
      minDepositAmount: row.min_deposit_amount != null ? parseFloat(row.min_deposit_amount) : null,
      maxDepositAmount: row.max_deposit_amount != null ? parseFloat(row.max_deposit_amount) : null,
      pausePlanSubscriptions: row.pause_plan_subscriptions,
      pauseNeeds: row.pause_needs,
      pauseBids: row.pause_bids,
      pauseAwardBids: row.pause_award_bids,
      pauseUploads: row.pause_uploads,
      pauseVerificationSubmissions: row.pause_verification_submissions,
      pauseChat: row.pause_chat,
      pauseOtpEmails: row.pause_otp_emails,
      featureNeedsEnabled: row.feature_needs_enabled,
      featurePlansEnabled: row.feature_plans_enabled,
      featureWalletEnabled: row.feature_wallet_enabled,
      featureHourlyPricingEnabled: row.feature_hourly_pricing_enabled ?? true,
      globalAnnouncement: row.global_announcement,
      commissionPercent: parseFloat(row.commission_percent ?? '10'),
      commissionMinEgp: parseFloat(row.commission_min_egp ?? '0'),
      commissionReceiverId:
        row.commission_receiver_id ?? '00000000-0000-0000-0000-000000000001',
      reservationAcceptanceFee: parseFloat(row.reservation_acceptance_fee ?? '0'),
      reservationVoiceMinuteRate: parseFloat(row.reservation_voice_minute_rate ?? '1'),
      reservationVideoMinuteRate: parseFloat(row.reservation_video_minute_rate ?? '2'),
      reservationMinPrejoinMinutes: row.reservation_min_prejoin_minutes ?? 5,
      jobInterviewFeeAmount: parseFloat(row.job_interview_fee_amount ?? '0'),
      walletEgpPerUsdtDeposit:
        row.wallet_egp_per_usdt_deposit != null
          ? parseFloat(row.wallet_egp_per_usdt_deposit)
          : null,
      walletEgpPerUsdtWithdrawal:
        row.wallet_egp_per_usdt_withdrawal != null
          ? parseFloat(row.wallet_egp_per_usdt_withdrawal)
          : null,
      platformInstapayDisplay:
        (row.platform_instapay_display as Record<string, unknown> | null) ?? null,
      walletUsdToEgpMigrationRate:
        row.wallet_usd_to_egp_migration_rate != null
          ? parseFloat(row.wallet_usd_to_egp_migration_rate)
          : null,
      walletMigrationUsdToEgpApplied: row.wallet_migration_usd_to_egp_applied ?? false,
      sidebarHiddenHrefs: parseSidebarHiddenHrefs(row.sidebar_hidden_hrefs),
      maxPublicUploadBytes: row.max_public_upload_bytes ?? null,
      publicUploadAllowedMimes: parsePublicUploadMimes(row.public_upload_allowed_mimes),
      supabaseStorageDashboardUrl: row.supabase_storage_dashboard_url ?? null,
    };
  }

  private defaultAppStatus(): AppStatus {
    return {
      maintenanceMode: false,
      maintenanceMessage: null,
      signupsLocked: false,
      lockLogins: false,
      depositsPaused: false,
      moneyMovementsPaused: false,
      disableCryptoDeposits: false,
      disableCardDeposits: false,
      minDepositAmount: null,
      maxDepositAmount: null,
      pausePlanSubscriptions: false,
      pauseNeeds: false,
      pauseBids: false,
      pauseAwardBids: false,
      pauseUploads: false,
      pauseVerificationSubmissions: false,
      pauseChat: false,
      pauseOtpEmails: false,
      featureNeedsEnabled: true,
      featurePlansEnabled: true,
      featureWalletEnabled: true,
      featureHourlyPricingEnabled: true,
      globalAnnouncement: null,
      commissionPercent: 10,
      commissionMinEgp: 0,
      commissionReceiverId: '00000000-0000-0000-0000-000000000001',
      reservationAcceptanceFee: 0,
      reservationVoiceMinuteRate: 1,
      reservationVideoMinuteRate: 2,
      reservationMinPrejoinMinutes: 5,
      jobInterviewFeeAmount: 0,
      walletEgpPerUsdtDeposit: null,
      walletEgpPerUsdtWithdrawal: null,
      platformInstapayDisplay: null,
      walletUsdToEgpMigrationRate: null,
      walletMigrationUsdToEgpApplied: false,
      sidebarHiddenHrefs: [],
    };
  }
}
