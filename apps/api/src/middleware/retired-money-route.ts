// ---------------------------------------------------------------------------
// Fail-closed fencing for retired cash-wallet routes (P0-08)
// ---------------------------------------------------------------------------
// Migration 20260728160000 froze every EGP money wallet and switched off every
// deposit and withdrawal rail. The route handlers stayed live, protected only by
// rail flags read with the FAIL-OPEN helper — so a settings row that predates a
// key would silently re-open a retired money rail.
//
// This is the `payBid` pattern (needs.service.ts, 410 ESCROW_PAYMENTS_RETIRED)
// applied to the rest of them. Nothing is deleted: every handler, every service
// method and every historic row stays exactly where it is. The route simply
// refuses, explicitly, unless an admin has deliberately set the rail's flag to
// `true`.
//
// Why a middleware AND a service guard (see assertRailActive in wallet.service):
// the middleware makes the HTTP contract unconditional — a malformed body, a
// missing role, a paused-money state can no longer produce a different status
// code than 410 — while the service guard protects any future non-HTTP caller.
// ---------------------------------------------------------------------------

import { isPaymentMethodEnabledStrict } from '@mohandishub/shared';
import type { NextFunction, Request, Response } from 'express';

import { SettingsService } from '../modules/settings/settings.service.js';
import { HttpError } from '../utils/http-error.js';

/** Customer-funding rails. All retired at launch; customers fund nothing. */
export const DEPOSIT_RAIL_KEYS = [
  'deposit_crypto',
  'deposit_card',
  'deposit_instapay',
  'deposit_paymob',
] as const;

/** Payout rails. All retired at launch; MHC is not cashable. */
export const WITHDRAWAL_RAIL_KEYS = [
  'withdrawal_crypto',
  'withdrawal_instapay',
  'withdrawal_paymob',
] as const;

export type RetiredRailFlow = 'deposit' | 'withdrawal';

const RETIREMENT: Record<RetiredRailFlow, { code: string; message: string }> = {
  deposit: {
    code: 'DEPOSITS_RETIRED',
    message:
      'Wallet deposits are no longer available. MohandisHub does not hold customer funds — customers pay providers directly, and providers buy MHC credits to unlock work.',
  },
  withdrawal: {
    code: 'WITHDRAWALS_RETIRED',
    message:
      'Wallet withdrawals are no longer available. MohandisHub does not hold your earnings — customers pay you directly, and MHC credits are not cashable.',
  },
};

/**
 * True only when an admin has EXPLICITLY enabled at least one rail of this flow.
 *
 * `isPaymentMethodEnabledStrict` is mandatory here. Its lenient sibling treats a
 * missing key as enabled, which is exactly how a settings row written before a
 * key existed would re-open a retired rail.
 */
export const isRailFlowActive = (
  paymentMethodsEnabled: Record<string, boolean> | null | undefined,
  keys: readonly string[],
): boolean => keys.some((key) => isPaymentMethodEnabledStrict(paymentMethodsEnabled, key));

export const retirementError = (flow: RetiredRailFlow): HttpError =>
  new HttpError({ statusCode: 410, ...RETIREMENT[flow] });

/**
 * Refuse a retired route with `410 Gone` unless its rail is deliberately back on.
 *
 * Runs before body parsing, role checks and every other guard, so the answer is
 * the same for a customer, an expert, a craftsman, a business and an admin, and
 * the same for a valid body as for a malformed one.
 */
export const retiredMoneyRoute = (flow: RetiredRailFlow, keys: readonly string[]) => {
  const settingsService = new SettingsService();
  // Named, not anonymous: the router-wiring test identifies the guard on each
  // route by this name, so a route silently losing its fence fails a test.
  return function retiredMoneyRouteGuard(_req: Request, _res: Response, next: NextFunction): void {
    settingsService
      .getAppStatus()
      .then((status) => {
        if (isRailFlowActive(status.paymentMethodsEnabled, keys)) {
          next();
          return;
        }
        next(retirementError(flow));
      })
      // Fail CLOSED on a settings read failure too: a database hiccup must not
      // be the thing that decides a retired money rail is open.
      .catch(() => next(retirementError(flow)));
  };
};
