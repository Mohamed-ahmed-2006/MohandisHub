import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Phase 4 marketplace money invariants', () => {
  it('reserves reservation idempotency keys before creating bookings', () => {
    const service = read('src/modules/reservations/reservations.service.ts');
    const repo = read('src/modules/reservations/reservations.repository.ts');

    expect(repo).toContain('reserveActionIdempotency');
    expect(repo).toContain('ON CONFLICT (actor_id, action, idempotency_key) DO NOTHING');
    expect(service).toContain("'IDEMPOTENT_REQUEST_IN_PROGRESS'");
    expect(service).toContain("'create_reservation'");
    expect(service).toContain("'book_job_interview'");
  });

  it('locks pending reservations before expiring them', () => {
    const service = read('src/modules/reservations/reservations.service.ts');
    const repo = read('src/modules/reservations/reservations.repository.ts');

    expect(repo).toContain('findPendingReservationForExpiry');
    expect(repo).toContain("WHERE id = $1 AND status = 'pending'");
    expect(repo).toContain('FOR UPDATE');
    expect(service).toContain('const locked = await this.repo.findPendingReservationForExpiry');
    expect(service).toContain('expiredRows.push(locked)');
  });

  it('settles reservation disputes with explicit money outcomes and audit metadata', () => {
    const validation = read('src/modules/reservations/reservations.validation.ts');
    const service = read('src/modules/reservations/reservations.service.ts');

    expect(validation).toContain('settlementOutcome');
    expect(validation).toContain('resolutionNotes: z.string().trim().min(1)');
    expect(service).toContain('applyDisputeSettlement');
    expect(service).toContain('Dispute resolved with full customer refund');
    expect(service).toContain('Dispute resolved with full provider release');
    expect(service).toContain('Reservation dispute split refund');
    expect(service).toContain('Reservation dispute split provider release');
    expect(service).toContain('DISPUTE_SETTLEMENT_REQUIRED');
  });

  it('refunds unused prepaid ad spend on cancellation through wallet ledger entries', () => {
    const service = read('src/modules/advertisements/advertisements.service.ts');
    const repo = read('src/modules/advertisements/advertisements.repository.ts');

    expect(repo).toContain('findAdForUpdate');
    expect(repo).toContain('cancelAdInTx');
    expect(service).toContain('computeAdCancellationRefund');
    expect(service).toContain('Advertisement cancellation refund funded');
    expect(service).toContain('Advertisement cancellation refund');
    expect(service).toContain('AD_REFUND_PLATFORM_BALANCE_INSUFFICIENT');
  });

  it('does not charge a user again for the same active plan subscription', () => {
    const service = read('src/modules/plans/plans.service.ts');

    expect(service).toContain('activeSubscriptionRows');
    expect(service).toContain('activeSubscription?.plan_id === planId');
    expect(service).toContain('subscriptionEndsAt: activeSubscription.ends_at');
    // The already-on-this-plan check must come before the charge. Asserted
    // against the MHC charge, not the retired `debitWalletInTransaction`: plan
    // pricing moved to per-plan MHC and the EGP debit no longer exists here.
    expect(service.indexOf('activeSubscription?.plan_id === planId')).toBeLessThan(
      service.indexOf('this.mhc.chargeAction'),
    );
  });

  it('buys a plan with MHC and never with the frozen EGP wallet', () => {
    const service = read('src/modules/plans/plans.service.ts');

    // The price comes from the plan's own scope, resolved inside the charging
    // primitive. No amount is passed in, and no money wallet is read or locked.
    expect(service).toContain("priceScope: { scopeType: 'plan', scopeId: planId }");
    expect(service).toContain('actionKey: PLAN_ACTION_KEY');
    expect(service).not.toContain('debitWalletInTransaction');
    expect(service).not.toMatch(/FROM wallets/);
  });
});
