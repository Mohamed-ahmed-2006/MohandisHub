#!/usr/bin/env node
import { createServer } from 'node:http';

const apiUrl = new URL(process.env.E2E_API_BASE_URL ?? 'http://localhost:4000');
const webUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000');
if (!['localhost', '127.0.0.1', '::1'].includes(apiUrl.hostname)) {
  throw new Error('The local E2E stub only accepts a loopback E2E_API_BASE_URL.');
}
if (!['localhost', '127.0.0.1', '::1'].includes(webUrl.hostname)) {
  throw new Error('The local E2E stub only accepts a loopback PLAYWRIGHT_BASE_URL.');
}

const paymentMethodsEnabled = {
  deposit_crypto: false,
  deposit_card: false,
  deposit_instapay: false,
  deposit_paymob: false,
  withdrawal_crypto: false,
  withdrawal_instapay: false,
  withdrawal_paymob: false,
};

const appStatus = {
  maintenanceMode: false,
  maintenanceMessage: null,
  signupsLocked: false,
  lockLogins: false,
  depositsPaused: false,
  moneyMovementsPaused: false,
  disableCryptoDeposits: true,
  disableCardDeposits: true,
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
  minTransactionEgp: 0,
  commissionReceiverId: '00000000-0000-0000-0000-000000000001',
  reservationAcceptanceFee: 0,
  reservationVoiceMinuteRate: 1,
  reservationVideoMinuteRate: 2,
  reservationMinPrejoinMinutes: 5,
  jobInterviewFeeAmount: 0,
  couponGenerationFeeEgp: 0.25,
  walletEgpPerUsdtDeposit: null,
  walletEgpPerUsdtWithdrawal: null,
  platformInstapayDisplay: null,
  walletUsdToEgpMigrationRate: null,
  walletMigrationUsdToEgpApplied: false,
  sidebarHiddenHrefs: [],
  paymentMethodsEnabled,
  withdrawalLimits: {},
};

const json = (response, status, data) => {
  response.writeHead(status, {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Origin': webUrl.origin,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(data));
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', apiUrl);
  if (url.pathname === '/health' || url.pathname === '/health/ready') {
    json(response, 200, { ok: true, status: 'ready' });
    return;
  }
  if (url.pathname === '/api/app/status') {
    json(response, 200, { ok: true, data: appStatus });
    return;
  }
  if (url.pathname === '/api/geo/country') {
    json(response, 200, { ok: true, data: 'EG' });
    return;
  }
  if (url.pathname === '/api/services/categories') {
    json(response, 200, { ok: true, data: [] });
    return;
  }
  if (url.pathname === '/api/services/recommendations') {
    json(response, 200, { ok: true, data: { items: [] } });
    return;
  }
  if (url.pathname === '/api/services/search') {
    json(response, 200, {
      ok: true,
      data: { items: [], total: 0, page: 1, limit: 20, totalPages: 0 },
    });
    return;
  }
  if (
    url.pathname.startsWith('/api/profiles/top') ||
    url.pathname.startsWith('/api/advertisements/active')
  ) {
    json(response, 200, { ok: true, data: [] });
    return;
  }

  json(response, 404, {
    ok: false,
    error: { code: 'LOCAL_E2E_STUB_NOT_IMPLEMENTED', message: 'Not available in local UI smoke.' },
  });
});

server.listen(Number(apiUrl.port || 4000), apiUrl.hostname, () => {
  process.stdout.write(`Local E2E stub listening on ${apiUrl.origin}\n`);
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
