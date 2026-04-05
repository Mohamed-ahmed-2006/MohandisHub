// ---------------------------------------------------------------------------
// App settings types — shared between API and frontend
// ---------------------------------------------------------------------------

/** Hrefs the admin can hide from the in-app sidebar (must match AppSidebar items). */
export const MANAGED_SIDEBAR_HREFS = [
  '/app',
  '/app/bookings',
  '/app/services',
  '/app/calendar',
  '/app/settings',
  '/app/chat',
  '/app/history',
  '/app/support',
  '/app/plan',
  '/app/admin',
] as const;

export type ManagedSidebarHref = (typeof MANAGED_SIDEBAR_HREFS)[number];

export type AppSettings = {
  id: string;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  updatedAt: string;
  updatedBy: string | null;
  // Phase 2
  lockLogins: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  walletMigrationUsdToEgpApplied: boolean;
  /** Hrefs to omit from the app sidebar (e.g. ["/app/support"]). */
  sidebarHiddenHrefs: string[];
  /** Max public upload size in bytes (null = use API default). Cannot exceed server ceiling. */
  maxPublicUploadBytes: number | null;
  /** When set, public uploads must use one of these MIME types. */
  publicUploadAllowedMimes: string[] | null;
  /** Optional link to Supabase Storage dashboard for operators. */
  supabaseStorageDashboardUrl: string | null;
};

/** Public app status returned by GET /api/app/status — subset needed by frontend */
export type AppStatus = {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  lockLogins: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  walletMigrationUsdToEgpApplied: boolean;
  sidebarHiddenHrefs: string[];
};

export type UpdateAppSettingsBody = Partial<{
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  signupsLocked: boolean;
  depositsPaused: boolean;
  moneyMovementsPaused: boolean;
  lockLogins: boolean;
  disableCryptoDeposits: boolean;
  disableCardDeposits: boolean;
  minDepositAmount: number | null;
  maxDepositAmount: number | null;
  pausePlanSubscriptions: boolean;
  pauseNeeds: boolean;
  pauseBids: boolean;
  pauseAwardBids: boolean;
  pauseUploads: boolean;
  pauseVerificationSubmissions: boolean;
  pauseChat: boolean;
  pauseOtpEmails: boolean;
  featureNeedsEnabled: boolean;
  featurePlansEnabled: boolean;
  featureWalletEnabled: boolean;
  featureHourlyPricingEnabled: boolean;
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
  walletEgpPerUsdtDeposit: number | null;
  walletEgpPerUsdtWithdrawal: number | null;
  platformInstapayDisplay: Record<string, unknown> | null;
  walletUsdToEgpMigrationRate: number | null;
  sidebarHiddenHrefs: string[];
  maxPublicUploadBytes: number | null;
  publicUploadAllowedMimes: string[] | null;
  supabaseStorageDashboardUrl: string | null;
}>;
