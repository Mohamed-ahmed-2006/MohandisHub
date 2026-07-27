import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createInvoice: vi.fn(),
}));

vi.mock('../config/env.js', () => ({
  env: {
    NOWPAYMENTS_API_KEY: 'sandbox-api-key',
    NOWPAYMENTS_FIAT_ENABLED: false,
    NOWPAYMENTS_WITHDRAWAL_DEFAULT_CURRENCY: 'USDTTRC20',
    NOWPAYMENTS_ALLOWED_PAY_CURRENCIES: 'USDTTRC20',
    API_PUBLIC_URL: 'http://localhost:4000',
    WEB_PUBLIC_URL: 'http://localhost:3000/en/app/settings/wallet',
    PORT: 4000,
  },
}));

vi.mock('../lib/nowpayments.client.js', () => ({
  authenticateNowPayments: vi.fn(),
  createInvoice: mocks.createInvoice,
  createPayout: vi.fn(),
  estimatePrice: vi.fn(),
  getAvailableCurrencies: vi.fn(),
  getAvailableCurrenciesDetailed: vi.fn(),
  NowPaymentsApiError: class NowPaymentsApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  verifyNowPaymentsIpnSignature: vi.fn(),
  verifyPayout: vi.fn(),
}));

import { WalletService } from '../modules/wallet/wallet.service.js';

const depositRow = {
  id: 'deposit-1',
  order_id: 'np_dep_test',
  status: 'initiating',
  checkout_url: null,
};

const settings = {
  getAppStatus: vi.fn().mockResolvedValue({
    featureWalletEnabled: true,
    depositsPaused: false,
    minDepositAmount: null,
    maxDepositAmount: null,
    paymentMethodsEnabled: { deposit_crypto: true },
  }),
};

describe('database-first deposit failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists the intent before a provider timeout and marks the outcome unknown', async () => {
    const sequence: string[] = [];
    const repository = {
      findByUserId: vi.fn().mockResolvedValue({
        id: 'wallet-1',
        user_id: 'user-1',
        balance: '0',
        currency: 'EGP',
        is_frozen: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      createDepositIntent: vi.fn().mockImplementation(() => {
        sequence.push('intent');
        return Promise.resolve({ created: true, row: depositRow });
      }),
      markDepositIntentProviderFailure: vi.fn().mockImplementation((_id, state) => {
        sequence.push(`failure:${state}`);
        return Promise.resolve();
      }),
    };
    mocks.createInvoice.mockImplementation(() => {
      sequence.push('provider');
      return Promise.reject(new Error('request timed out'));
    });
    const service = new WalletService(repository as never, settings as never, {} as never);

    await expect(
      service.createDepositCheckout(
        'user-1',
        { amount: 100, method: 'crypto', currency: 'USD', payCurrency: 'USDTTRC20' },
        '91ffc487-b07e-474d-b763-eaf6aa14a322',
      ),
    ).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_OUTCOME_UNKNOWN' });

    expect(sequence).toEqual(['intent', 'provider', 'failure:unknown']);
  });

  it('does not contact the provider again for an in-progress idempotency key', async () => {
    const repository = {
      findByUserId: vi.fn().mockResolvedValue({
        id: 'wallet-1',
        user_id: 'user-1',
        balance: '0',
        currency: 'EGP',
        is_frozen: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      createDepositIntent: vi.fn().mockResolvedValue({
        created: false,
        row: depositRow,
      }),
    };
    const service = new WalletService(repository as never, settings as never, {} as never);

    await expect(
      service.createDepositCheckout(
        'user-1',
        { amount: 100, method: 'crypto', currency: 'USD', payCurrency: 'USDTTRC20' },
        '91ffc487-b07e-474d-b763-eaf6aa14a322',
      ),
    ).rejects.toMatchObject({ code: 'DEPOSIT_IN_PROGRESS', statusCode: 409 });
    expect(mocks.createInvoice).not.toHaveBeenCalled();
  });
});
