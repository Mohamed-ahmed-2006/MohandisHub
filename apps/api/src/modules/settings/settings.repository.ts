// ---------------------------------------------------------------------------
// Settings repository — app_settings table access
// ---------------------------------------------------------------------------

import type { Pool } from 'pg';

import { getPool } from '../../db/pool.js';

export type AppSettingsRow = {
  id: string;
  maintenance_mode: boolean;
  maintenance_message: string | null;
  signups_locked: boolean;
  deposits_paused: boolean;
  money_movements_paused: boolean;
  updated_at: Date;
  updated_by: string | null;
  lock_logins: boolean;
  disable_crypto_deposits: boolean;
  disable_card_deposits: boolean;
  min_deposit_amount: string | null;
  max_deposit_amount: string | null;
  pause_plan_subscriptions: boolean;
  pause_needs: boolean;
  pause_bids: boolean;
  pause_award_bids: boolean;
  pause_uploads: boolean;
  pause_verification_submissions: boolean;
  pause_chat: boolean;
  pause_otp_emails: boolean;
  feature_needs_enabled: boolean;
  feature_plans_enabled: boolean;
  feature_wallet_enabled: boolean;
  feature_hourly_pricing_enabled?: boolean;
  global_announcement: string | null;
  commission_percent?: string;
  commission_min_egp?: string;
  commission_receiver_id?: string;
  reservation_acceptance_fee?: string;
  reservation_voice_minute_rate?: string;
  reservation_video_minute_rate?: string;
  reservation_min_prejoin_minutes?: number;
  job_interview_fee_amount?: string;
  wallet_egp_per_usdt_deposit?: string | null;
  wallet_egp_per_usdt_withdrawal?: string | null;
  platform_instapay_display?: Record<string, unknown> | null;
  wallet_usd_to_egp_migration_rate?: string | null;
  wallet_migration_usd_to_egp_applied?: boolean;
};

export type AppSettingsUpdate = Partial<{
  maintenance_mode: boolean;
  maintenance_message: string | null;
  signups_locked: boolean;
  deposits_paused: boolean;
  money_movements_paused: boolean;
  updated_by: string | null;
  lock_logins: boolean;
  disable_crypto_deposits: boolean;
  disable_card_deposits: boolean;
  min_deposit_amount: number | null;
  max_deposit_amount: number | null;
  pause_plan_subscriptions: boolean;
  pause_needs: boolean;
  pause_bids: boolean;
  pause_award_bids: boolean;
  pause_uploads: boolean;
  pause_verification_submissions: boolean;
  pause_chat: boolean;
  pause_otp_emails: boolean;
  feature_needs_enabled: boolean;
  feature_plans_enabled: boolean;
  feature_wallet_enabled: boolean;
  feature_hourly_pricing_enabled: boolean;
  global_announcement: string | null;
  commission_percent: number;
  commission_min_egp: number;
  commission_receiver_id: string;
  reservation_acceptance_fee: number;
  reservation_voice_minute_rate: number;
  reservation_video_minute_rate: number;
  reservation_min_prejoin_minutes: number;
  job_interview_fee_amount: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
}>;

export class SettingsRepository {
  private get db(): Pool {
    return getPool();
  }

  async get(): Promise<AppSettingsRow | null> {
    const { rows } = await this.db.query<AppSettingsRow>(`SELECT * FROM app_settings LIMIT 1`);
    return rows[0] ?? null;
  }

  private readonly keyMap: Record<string, string> = {
    maintenanceMode: 'maintenance_mode',
    maintenanceMessage: 'maintenance_message',
    signupsLocked: 'signups_locked',
    depositsPaused: 'deposits_paused',
    moneyMovementsPaused: 'money_movements_paused',
    updatedBy: 'updated_by',
    lockLogins: 'lock_logins',
    disableCryptoDeposits: 'disable_crypto_deposits',
    disableCardDeposits: 'disable_card_deposits',
    minDepositAmount: 'min_deposit_amount',
    maxDepositAmount: 'max_deposit_amount',
    pausePlanSubscriptions: 'pause_plan_subscriptions',
    pauseNeeds: 'pause_needs',
    pauseBids: 'pause_bids',
    pauseAwardBids: 'pause_award_bids',
    pauseUploads: 'pause_uploads',
    pauseVerificationSubmissions: 'pause_verification_submissions',
    pauseChat: 'pause_chat',
    pauseOtpEmails: 'pause_otp_emails',
    featureNeedsEnabled: 'feature_needs_enabled',
    featurePlansEnabled: 'feature_plans_enabled',
    featureWalletEnabled: 'feature_wallet_enabled',
    featureHourlyPricingEnabled: 'feature_hourly_pricing_enabled',
    globalAnnouncement: 'global_announcement',
    commissionPercent: 'commission_percent',
    commissionMinEgp: 'commission_min_egp',
    commissionReceiverId: 'commission_receiver_id',
    reservationAcceptanceFee: 'reservation_acceptance_fee',
    reservationVoiceMinuteRate: 'reservation_voice_minute_rate',
    reservationVideoMinuteRate: 'reservation_video_minute_rate',
    reservationMinPrejoinMinutes: 'reservation_min_prejoin_minutes',
  jobInterviewFeeAmount: 'job_interview_fee_amount',
  walletEgpPerUsdtDeposit: 'wallet_egp_per_usdt_deposit',
  walletEgpPerUsdtWithdrawal: 'wallet_egp_per_usdt_withdrawal',
  platformInstapayDisplay: 'platform_instapay_display',
  walletUsdToEgpMigrationRate: 'wallet_usd_to_egp_migration_rate',
};

  async update(partial: AppSettingsUpdate): Promise<AppSettingsRow | null> {
    const entries = Object.entries(partial).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return this.get();

    const setClauses: string[] = ['updated_at = now()'];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of entries) {
      const dbKey = this.keyMap[key] ?? key;
      setClauses.push(`${dbKey} = $${idx++}`);
      params.push(value);
    }

    const { rows } = await this.db.query<AppSettingsRow>(
      `UPDATE app_settings SET ${setClauses.join(', ')} RETURNING *`,
      params,
    );
    return rows[0] ?? null;
  }
}
