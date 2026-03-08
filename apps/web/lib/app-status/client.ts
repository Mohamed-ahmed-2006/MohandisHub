import type { AppStatus } from '@mohandishub/shared';

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
    globalAnnouncement: null,
    commissionPercent: 10,
    commissionMinEgp: 0,
  };
}
