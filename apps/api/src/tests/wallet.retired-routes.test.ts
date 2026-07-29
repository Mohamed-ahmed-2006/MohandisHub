import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// P0-08 — retired cash-wallet routes fail closed.
// ---------------------------------------------------------------------------
// Migration 20260728160000 froze every EGP money wallet and switched off every
// deposit and withdrawal rail, but the routes stayed live behind flags read with
// the FAIL-OPEN helper. A settings row written before a key existed would
// therefore have re-opened a retired money rail.
//
// Three things are pinned here, because each is a different way the fence could
// silently disappear:
//
//   1. the rail logic itself is fail-CLOSED — absent key, null map, malformed
//      value, and a settings read that throws all mean "retired";
//   2. every retired route actually carries the guard, and every kept-open route
//      does not — asserted against the real router's handler stack, so deleting
//      a guard or fencing history breaks a test;
//   3. the service methods refuse too, so a caller that never goes through
//      Express cannot move money either.
// ---------------------------------------------------------------------------

const { settingsGetMock } = vi.hoisted(() => ({ settingsGetMock: vi.fn() }));

vi.mock('../modules/settings/settings.repository.js', () => ({
  SettingsRepository: vi.fn(function SettingsRepositoryMock() {
    return { get: settingsGetMock };
  }),
}));

const poolQueryMock = vi.fn();
vi.mock('../db/pool.js', () => ({
  getPool: () => ({ query: poolQueryMock, connect: vi.fn() }),
  hasDatabaseConfig: () => true,
}));
vi.mock('../config/env.js', () => ({ env: {} }));

/** A settings row shaped like the real one, with the rails as stored. */
const settingsRow = (paymentMethodsEnabled: Record<string, boolean> | null) => ({
  maintenance_mode: false,
  maintenance_message: null,
  signups_locked: false,
  lock_logins: false,
  deposits_paused: false,
  money_movements_paused: false,
  disable_crypto_deposits: false,
  disable_card_deposits: false,
  feature_wallet_enabled: true,
  payment_methods_enabled: paymentMethodsEnabled,
});

const makeRes = (): Response =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }) as unknown as Response;

const runGuard = async (
  guard: (req: Request, res: Response, next: NextFunction) => void,
): Promise<unknown> => {
  const next = vi.fn();
  guard({} as Request, makeRes(), next as unknown as NextFunction);
  // The guard resolves a promise before calling next().
  await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
  return (next.mock.calls[0] as unknown[])[0];
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsGetMock.mockResolvedValue(settingsRow({}));
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('rail retirement logic is fail-closed', () => {
  it('treats an absent key, a null map and an undefined map as retired', async () => {
    const { isRailFlowActive, DEPOSIT_RAIL_KEYS, WITHDRAWAL_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');

    expect(isRailFlowActive({}, DEPOSIT_RAIL_KEYS)).toBe(false);
    expect(isRailFlowActive(null, DEPOSIT_RAIL_KEYS)).toBe(false);
    expect(isRailFlowActive(undefined, WITHDRAWAL_RAIL_KEYS)).toBe(false);
    // This is the exact trap: the fail-OPEN helper would call the first three
    // enabled. Anything but an explicit `true` must mean retired.
    expect(isRailFlowActive({ deposit_crypto: false }, DEPOSIT_RAIL_KEYS)).toBe(false);
  });

  it('treats an unrelated enabled rail as no permission at all', async () => {
    const { isRailFlowActive, DEPOSIT_RAIL_KEYS, WITHDRAWAL_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    // MHC credit purchase is live. It must not open deposits or withdrawals.
    const live = { credit_purchase_instapay: true };
    expect(isRailFlowActive(live, DEPOSIT_RAIL_KEYS)).toBe(false);
    expect(isRailFlowActive(live, WITHDRAWAL_RAIL_KEYS)).toBe(false);
  });

  it('re-opens a rail only on a deliberate explicit true', async () => {
    const { isRailFlowActive, DEPOSIT_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    expect(isRailFlowActive({ deposit_instapay: true }, DEPOSIT_RAIL_KEYS)).toBe(true);
  });

  it('returns 410 with the documented code for each flow', async () => {
    const { retirementError } = await import('../middleware/retired-money-route.js');
    expect(retirementError('deposit')).toMatchObject({
      statusCode: 410,
      code: 'DEPOSITS_RETIRED',
    });
    expect(retirementError('withdrawal')).toMatchObject({
      statusCode: 410,
      code: 'WITHDRAWALS_RETIRED',
    });
    // The message has to explain what to do instead, not just refuse.
    expect(retirementError('deposit').message).toMatch(/MHC credits/);
    expect(retirementError('withdrawal').message).toMatch(/not cashable/);
  });
});

describe('the retirement middleware', () => {
  it('refuses with 410 when no rail is explicitly enabled', async () => {
    const { retiredMoneyRoute, DEPOSIT_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const error = await runGuard(retiredMoneyRoute('deposit', DEPOSIT_RAIL_KEYS));
    expect(error).toMatchObject({ statusCode: 410, code: 'DEPOSITS_RETIRED' });
  });

  it('refuses with 410 when the settings row has no payment-method map at all', async () => {
    settingsGetMock.mockResolvedValue(settingsRow(null));
    const { retiredMoneyRoute, WITHDRAWAL_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const error = await runGuard(retiredMoneyRoute('withdrawal', WITHDRAWAL_RAIL_KEYS));
    expect(error).toMatchObject({ statusCode: 410, code: 'WITHDRAWALS_RETIRED' });
  });

  it('refuses with 410 when there is no settings row at all', async () => {
    settingsGetMock.mockResolvedValue(null);
    const { retiredMoneyRoute, DEPOSIT_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const error = await runGuard(retiredMoneyRoute('deposit', DEPOSIT_RAIL_KEYS));
    expect(error).toMatchObject({ statusCode: 410 });
  });

  it('refuses with 410 when reading settings fails', async () => {
    // A database hiccup must not be the thing that decides a retired money rail
    // is open.
    settingsGetMock.mockRejectedValue(new Error('connection reset'));
    const { retiredMoneyRoute, DEPOSIT_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const error = await runGuard(retiredMoneyRoute('deposit', DEPOSIT_RAIL_KEYS));
    expect(error).toMatchObject({ statusCode: 410 });
  });

  it('does not depend on the caller, so every role gets the same answer', async () => {
    const { retiredMoneyRoute, WITHDRAWAL_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const guard = retiredMoneyRoute('withdrawal', WITHDRAWAL_RAIL_KEYS);
    for (const role of ['customer', 'expert', 'craftsman', 'business', 'admin']) {
      const next = vi.fn();
      guard({ user: { id: 'u', role } } as unknown as Request, makeRes(), next as NextFunction);
      await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(1));
      expect((next.mock.calls[0] as unknown[])[0]).toMatchObject({
        statusCode: 410,
        code: 'WITHDRAWALS_RETIRED',
      });
    }
  });

  it('lets the request through once an admin deliberately re-enables a rail', async () => {
    settingsGetMock.mockResolvedValue(settingsRow({ withdrawal_instapay: true }));
    const { retiredMoneyRoute, WITHDRAWAL_RAIL_KEYS } =
      await import('../middleware/retired-money-route.js');
    const error = await runGuard(retiredMoneyRoute('withdrawal', WITHDRAWAL_RAIL_KEYS));
    expect(error).toBeUndefined();
  });
});

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean>; stack: Array<{ name: string }> };
};

const routeGuards = (stack: RouteLayer[], method: string, path: string): string[] | null => {
  const layer = stack.find((l) => l.route?.path === path && l.route.methods[method] === true);
  return layer?.route ? layer.route.stack.map((h) => h.name) : null;
};

describe('router wiring — the fence is where it should be, and only there', () => {
  /** Exactly the routes P0-08 retires. */
  const RETIRED: Array<[string, string]> = [
    ['post', '/deposit/checkout'],
    ['post', '/deposits/instapay'],
    ['post', '/deposit/crypto'],
    ['post', '/deposit/stripe'],
    ['post', '/deposit/confirm-stripe'],
    ['post', '/withdrawals'],
    ['post', '/withdrawals/:withdrawalId/cancel'],
    ['post', '/withdrawals/:withdrawalId/verify'],
    ['get', '/withdrawals/quote'],
  ];

  /** Exactly the routes P0-08 must NOT touch. */
  const KEPT_OPEN: Array<[string, string]> = [
    ['get', '/me'],
    ['get', '/me/transactions'],
    ['get', '/me/transactions/:id/receipt'],
    ['get', '/withdrawals'],
    ['get', '/deposit/currencies'],
    ['get', '/deposit/estimate'],
    ['get', '/deposit/instapay/info'],
  ];

  it.each(RETIRED)('fences %s %s', async (method, path) => {
    const { walletRouter } = await import('../modules/wallet/wallet.routes.js');
    const guards = routeGuards(walletRouter.stack as unknown as RouteLayer[], method, path);
    expect(guards, `${method.toUpperCase()} ${path} is not registered`).not.toBeNull();
    expect(guards).toContain('retiredMoneyRouteGuard');
  });

  it.each(KEPT_OPEN)('leaves %s %s open', async (method, path) => {
    const { walletRouter } = await import('../modules/wallet/wallet.routes.js');
    const guards = routeGuards(walletRouter.stack as unknown as RouteLayer[], method, path);
    expect(guards, `${method.toUpperCase()} ${path} is not registered`).not.toBeNull();
    expect(guards).not.toContain('retiredMoneyRouteGuard');
  });

  it('deletes no handler — every retired route still has its original one', async () => {
    const { walletRouter } = await import('../modules/wallet/wallet.routes.js');
    for (const [method, path] of RETIRED) {
      const guards = routeGuards(walletRouter.stack as unknown as RouteLayer[], method, path)!;
      // guard + the untouched controller behind it.
      expect(guards.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('service guards — a non-HTTP caller cannot move money either', () => {
  const retiredCalls: Array<[string, (svc: never) => Promise<unknown>]> = [
    [
      'createDepositCheckout',
      (svc: never) =>
        (
          svc as unknown as { createDepositCheckout: (u: string, i: unknown) => Promise<unknown> }
        ).createDepositCheckout('user-1', { amount: 100, method: 'crypto', currency: 'EGP' }),
    ],
    [
      'submitInstapayManualDeposit',
      (svc: never) =>
        (
          svc as unknown as {
            submitInstapayManualDeposit: (p: unknown) => Promise<unknown>;
          }
        ).submitInstapayManualDeposit({
          userId: 'user-1',
          amountEgp: 100,
          proofUploadId: 'p',
          senderAccount: 's',
        }),
    ],
    [
      'createWithdrawalRequest',
      (svc: never) =>
        (
          svc as unknown as {
            createWithdrawalRequest: (u: string, r: string, i: unknown) => Promise<unknown>;
          }
        ).createWithdrawalRequest('user-1', 'expert', { method: 'instapay', amountEgp: 100 }),
    ],
    [
      'estimateWithdrawalQuote',
      (svc: never) =>
        (
          svc as unknown as {
            estimateWithdrawalQuote: (a: number, c: string) => Promise<unknown>;
          }
        ).estimateWithdrawalQuote(100, 'USDTTRC20'),
    ],
    [
      'verifyWithdrawal',
      (svc: never) =>
        (
          svc as unknown as {
            verifyWithdrawal: (u: string, w: string, c: string) => Promise<unknown>;
          }
        ).verifyWithdrawal('user-1', 'w-1', '123456'),
    ],
    [
      'cancelInstapayWithdrawal',
      (svc: never) =>
        (
          svc as unknown as {
            cancelInstapayWithdrawal: (u: string, w: string) => Promise<unknown>;
          }
        ).cancelInstapayWithdrawal('user-1', 'w-1'),
    ],
  ];

  it.each(retiredCalls)('%s refuses with 410 and writes nothing', async (_name, call) => {
    const { WalletService } = await import('../modules/wallet/wallet.service.js');
    const service = new WalletService() as never;

    await expect(call(service)).rejects.toMatchObject({ statusCode: 410 });
    // Not a single query ran: the guard is the first statement, so no row can be
    // created, locked or modified on a retired path.
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it('refuses before the role check, so the retirement is what the caller is told', async () => {
    // canRequestWithdrawal is false for every role after Wave 1. Without the
    // guard running first, a provider would get 403 FORBIDDEN and never learn
    // that withdrawals are retired rather than merely not permitted.
    const { WalletService } = await import('../modules/wallet/wallet.service.js');
    const service = new WalletService();
    await expect(
      service.createWithdrawalRequest('user-1', 'business', {
        method: 'instapay',
        amountEgp: 50,
      }),
    ).rejects.toMatchObject({ statusCode: 410, code: 'WITHDRAWALS_RETIRED' });
  });
});

describe('preserved paths — history and settlement still work', () => {
  it('leaves the webhook settlement handlers unguarded', async () => {
    // An in-flight deposit from before the freeze may still settle. Fencing the
    // IPN would strand real money, so these must NOT carry the retirement guard.
    const { WalletService } = await import('../modules/wallet/wallet.service.js');
    const service = new WalletService();
    const source = String(
      (service as unknown as { handleNowPaymentsDepositIpn: unknown }).handleNowPaymentsDepositIpn,
    );
    const paymob = String(
      (service as unknown as { handlePaymobDepositWebhook: unknown }).handlePaymobDepositWebhook,
    );
    expect(source).not.toContain('assertRailNotRetired');
    expect(paymob).not.toContain('assertRailNotRetired');
  });

  it('leaves the admin settlement handlers unguarded, so in-flight items can be resolved', async () => {
    const { WalletService } = await import('../modules/wallet/wallet.service.js');
    const service = new WalletService() as unknown as Record<string, unknown>;
    for (const method of [
      'approveManualInstapayDepositAdmin',
      'rejectManualInstapayDepositAdmin',
      'completeInstapayWithdrawalAdmin',
      'completePaymobWithdrawalAdmin',
      'rejectInstapayWithdrawalAdmin',
      'handleNowPaymentsPayoutIpn',
    ]) {
      expect(String(service[method])).not.toContain('assertRailNotRetired');
    }
  });

  it('leaves the history readers unguarded', async () => {
    const { WalletService } = await import('../modules/wallet/wallet.service.js');
    const service = new WalletService() as unknown as Record<string, unknown>;
    for (const method of [
      'getOrCreateWallet',
      'getTransactions',
      'getReceipt',
      'listWithdrawals',
    ]) {
      expect(String(service[method])).not.toContain('assertRailNotRetired');
    }
  });
});
