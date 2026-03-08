// ---------------------------------------------------------------------------
// Settings service — app settings business logic
// ---------------------------------------------------------------------------

import type { AppSettings, AppStatus, UpdateAppSettingsBody } from '@mohandishub/shared';

import { SettingsRepository } from './settings.repository.js';
import type { AppSettingsRow } from './settings.repository.js';

export class SettingsService {
  constructor(private readonly repo: SettingsRepository = new SettingsRepository()) {}

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
      globalAnnouncement: row.global_announcement,
    };
  }

  async updateSettings(partial: UpdateAppSettingsBody, adminId?: string): Promise<AppSettings | null> {
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
    if (partial.globalAnnouncement !== undefined) dbPartial.global_announcement = partial.globalAnnouncement;

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
      globalAnnouncement: row.global_announcement,
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
      globalAnnouncement: null,
    };
  }
}
