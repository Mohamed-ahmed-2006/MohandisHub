-- MohandisHub - Reservation production hardening

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_actor VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cancellation_reason_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS cancellation_effective_outcome VARCHAR(50),
  ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS captured_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS settlement_status VARCHAR(40) NOT NULL DEFAULT 'unsettled';

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_cancellation_actor_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_cancellation_actor_check
  CHECK (
    cancellation_actor IS NULL OR cancellation_actor IN ('customer', 'provider', 'admin', 'system')
  );

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_refund_status_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_refund_status_check
  CHECK (
    refund_status IN ('none', 'pending', 'succeeded', 'failed')
  );

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_settlement_status_check;
ALTER TABLE reservations
  ADD CONSTRAINT reservations_settlement_status_check
  CHECK (
    settlement_status IN (
      'unsettled',
      'held',
      'released_to_provider',
      'refunded_to_customer',
      'cancelled_no_refund',
      'partially_refunded'
    )
  );

CREATE INDEX IF NOT EXISTS idx_reservations_cancelled_at ON reservations(cancelled_at);
CREATE INDEX IF NOT EXISTS idx_reservations_settlement_status ON reservations(settlement_status);

CREATE TABLE IF NOT EXISTS reservation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  event_type VARCHAR(50) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_events_reservation_id_created_at
  ON reservation_events(reservation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reservation_action_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(60) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(actor_id, action, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_reservation_action_idempotency_reservation
  ON reservation_action_idempotency(reservation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reservation_action_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  action_type VARCHAR(60) NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  error_code VARCHAR(80),
  error_message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  last_replayed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_action_failures_open
  ON reservation_action_failures(resolved_at, created_at DESC);
