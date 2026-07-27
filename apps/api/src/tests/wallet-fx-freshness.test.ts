import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeoutMock } = vi.hoisted(() => ({
  fetchWithTimeoutMock: vi.fn(),
}));

vi.mock('../lib/fetch-with-timeout.js', () => ({
  fetchWithTimeout: fetchWithTimeoutMock,
}));

import type { SettingsService } from '../modules/settings/settings.service.js';
import { WalletFxService } from '../modules/wallet/wallet-fx.service.js';

function settingsWithRate(rate: string | null, updatedAt: Date | null): SettingsService {
  return {
    getRawRow: vi.fn().mockResolvedValue({
      wallet_egp_per_usdt_deposit: rate,
      wallet_egp_per_usdt_deposit_updated_at: updatedAt,
      wallet_egp_per_usdt_withdrawal: rate,
      wallet_egp_per_usdt_withdrawal_updated_at: updatedAt,
    }),
  } as unknown as SettingsService;
}

describe('wallet FX freshness', () => {
  beforeEach(() => {
    fetchWithTimeoutMock.mockReset();
    fetchWithTimeoutMock.mockResolvedValue(new Response(null, { status: 503 }));
  });

  it('uses a fresh administrator rate when live providers are unavailable', async () => {
    const service = new WalletFxService(settingsWithRate('50.25', new Date()));

    await expect(service.getEgpPerUsdtDeposit()).resolves.toBe(50.25);
  });

  it('rejects a stale administrator rate instead of using a hard-coded fallback', async () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const service = new WalletFxService(settingsWithRate('48.5', stale));

    await expect(service.getEgpPerUsdtDeposit()).rejects.toMatchObject({
      code: 'FX_RATE_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('settles an EGP-denominated invoice without requiring FX', async () => {
    const service = new WalletFxService(settingsWithRate(null, null));

    await expect(
      service.computeDepositCreditEgp({
        providerPayload: {},
        invoicePriceAmount: 125.55,
        invoicePriceCurrency: 'EGP',
      }),
    ).resolves.toMatchObject({
      egp: 125.55,
      snapshot: { rate_source: 'invoice_egp' },
    });
  });
});
