import type { AppStatus } from '@mohandishub/shared';
import { parsePaymentMethodsEnabled } from '@mohandishub/shared';

import { getApiBaseUrl } from '@/lib/env';

export async function fetchAppStatus(): Promise<AppStatus> {
  const res = await fetch(`${getApiBaseUrl()}/api/app/status`, {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) {
    return getDefaultAppStatus();
  }
  const json = (await res.json()) as { ok?: boolean; data?: AppStatus };
  if (json.ok && json.data) {
    return json.data;
  }
  return getDefaultAppStatus();
}

function getDefaultAppStatus(): AppStatus {
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
    paymentMethodsEnabled: parsePaymentMethodsEnabled(null, {
      disableCryptoDeposits: false,
      disableCardDeposits: true,
    }),
  };
}
