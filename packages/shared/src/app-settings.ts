// ---------------------------------------------------------------------------
// App settings types — shared between API and frontend
// ---------------------------------------------------------------------------

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
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
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
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
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
  globalAnnouncement: string | null;
  commissionPercent: number;
  commissionMinEgp: number;
  commissionReceiverId: string;
  reservationAcceptanceFee: number;
  reservationVoiceMinuteRate: number;
  reservationVideoMinuteRate: number;
  reservationMinPrejoinMinutes: number;
  jobInterviewFeeAmount: number;
}>;
