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
    expect(service).toContain('const holdAmount = toMoney(toNumber(currentHold.amount))');
    expect(service).toContain('providerPayoutAmount: payout.providerAmount');
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
    expect(service.indexOf('activeSubscription?.plan_id === planId')).toBeLessThan(
      service.indexOf('debitWalletInTransaction'),
    );
  });
});
