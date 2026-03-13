import { describe, expect, it, vi } from 'vitest';

import type {
  ReservationActionIdempotencyRow,
  ReservationRow,
} from '../modules/reservations/reservations.repository.js';
import { ReservationsService } from '../modules/reservations/reservations.service.js';

const makeReservationRow = (overrides: Partial<ReservationRow> = {}): ReservationRow => ({
  id: 'reservation-1',
  customer_id: 'customer-1',
  provider_id: 'provider-1',
  purpose: 'service',
  job_id: null,
  job_application_id: null,
  service_id: 'service-1',
  slot_id: 'slot-1',
  mode: 'online',
  online_type: 'voice',
  status: 'accepted',
  requested_start_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  requested_end_at: new Date(Date.now() + 49 * 60 * 60 * 1000).toISOString(),
  expert_price_amount: '50',
  currency: 'USD',
  admin_acceptance_fee: '5',
  admin_minute_rate: '0',
  policy_snapshot: {
    customerFreeCancelHours: 24,
    providerPenaltyCancelHours: 2,
    customerLateCancelPayoutPercent: 100,
    providerLateCancelPenaltyAmount: 5,
    interviewBusinessFailureRefundOnly: false,
  },
  fixed_price_hold_id: 'hold-1',
  rejection_reason: null,
  auto_rejected: false,
  suggested_slots: [],
  conversation_id: null,
  final_location_text: null,
  final_location_lat: null,
  final_location_lng: null,
  accepted_at: new Date().toISOString(),
  started_at: null,
  ended_at: null,
  completed_at: null,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_actor: null,
  cancellation_reason_code: null,
  cancellation_effective_outcome: null,
  refund_amount: '0',
  captured_amount: '0',
  penalty_amount: '0',
  refund_status: 'none',
  settlement_status: 'held',
  customer_done_due_at: null,
  done_prompted_at: null,
  disconnect_auto_release_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  provider_name: 'Provider',
  customer_name: 'Customer',
  service_title: 'Service',
  ...overrides,
});

describe('ReservationsService hardening', () => {
  it('returns stored reservation for idempotent cancellation retries', async () => {
    const reservation = makeReservationRow({ status: 'cancelled' });
    const repo = {
      findActionIdempotency: vi.fn<() => Promise<ReservationActionIdempotencyRow | null>>().mockResolvedValue({
        id: 'idem-1',
        actor_id: 'customer-1',
        action: 'cancel_reservation',
        idempotency_key: 'retry-key',
        reservation_id: reservation.id,
        response_json: {},
        created_at: new Date().toISOString(),
      }),
      findReservationById: vi.fn().mockResolvedValue(reservation),
    };

    const service = new ReservationsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.cancelReservation(
      'customer-1',
      'customer',
      reservation.id,
      { reasonCode: 'customer_changed_mind' },
      'retry-key',
    );

    expect(repo.findActionIdempotency).toHaveBeenCalledWith(
      'customer-1',
      'cancel_reservation',
      'retry-key',
    );
    expect(result.id).toBe(reservation.id);
    expect(result.status).toBe('cancelled');
  });

  it('blocks cancelling completed reservations', async () => {
    const repo = {
      findActionIdempotency: vi.fn().mockResolvedValue(null),
      findReservationById: vi.fn().mockResolvedValue(makeReservationRow({ status: 'completed' })),
    };

    const service = new ReservationsService(
      repo as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.cancelReservation('customer-1', 'customer', 'reservation-1', {
        reasonCode: 'customer_changed_mind',
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESERVATION_STATE',
    });
  });

  it('reconciles released holds as refunded settlements', async () => {
    const reservation = makeReservationRow({
      status: 'cancelled',
      cancellation_effective_outcome: 'full_refund',
      settlement_status: 'held',
    });
    const updated = makeReservationRow({
      ...reservation,
      settlement_status: 'refunded_to_customer',
    });
    const repo = {
      findReservationById: vi.fn().mockResolvedValue(reservation),
      updateReservation: vi.fn().mockResolvedValue(updated),
      createEvent: vi.fn().mockResolvedValue({
        id: 'event-1',
        reservation_id: reservation.id,
        event_type: 'reconciled',
        actor_id: 'admin-1',
        metadata: {},
        created_at: new Date().toISOString(),
      }),
    };
    const walletRepo = {
      findWalletHoldById: vi.fn().mockResolvedValue({
        id: 'hold-1',
        status: 'released',
      }),
    };

    const service = new ReservationsService(
      repo as never,
      {} as never,
      walletRepo as never,
      {} as never,
      {} as never,
    );

    const result = await service.reconcileReservationMoney('admin-1', 'admin', reservation.id);

    expect(repo.updateReservation).toHaveBeenCalledWith(reservation.id, {
      settlementStatus: 'refunded_to_customer',
    });
    expect(result.settlementStatus).toBe('refunded_to_customer');
  });
});
